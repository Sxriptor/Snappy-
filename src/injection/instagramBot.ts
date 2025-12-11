import { Configuration } from '../types';

/**
 * Build an injection script for Instagram that:
 * - Monitors DM notifications
 * - Replies to new messages automatically
 * - Accepts message requests that fall into the "requests" folder
 */
export function buildInstagramBotScript(config: Configuration): string {
  const serializedConfig = JSON.stringify(config || {});

  return `
(function() {
  if (window.__SNAPPY_RUNNING__ && window.__SNAPPY_INSTAGRAM_RUNNING__) {
    console.log('[Snappy][Instagram] Already running');
    return;
  }

  window.__SNAPPY_RUNNING__ = true;
  window.__SNAPPY_INSTAGRAM_RUNNING__ = true;

  const CONFIG = ${serializedConfig};
  const seenMessages = new Set();
  const seenRequests = new Set();
  let isRunning = true;
  let pollInterval = null;
  let isProcessing = false;

  const MIN_MESSAGE_LENGTH = 2;
  const POLL_MS = (CONFIG?.instagram && CONFIG.instagram.pollIntervalMs) || 5000;
  const typingDelayRange = CONFIG?.typingDelayRangeMs || [50, 150];
  const preReplyDelayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];

  function log(msg) {
    const formatted = '[Snappy][Instagram] ' + msg;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Navigate to the DMs section
   */
  function navigateToDMs() {
    // Look for the Messages/DM icon in the sidebar (usually an SVG with specific path)
    const links = Array.from(document.querySelectorAll('a[href*="/direct/"]'));
    if (links.length > 0) {
      const dmLink = links[0];
      if (!window.location.href.includes('/direct/')) {
        log('Navigating to DMs...');
        dmLink.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Check if we're on the DMs page
   */
  function isOnDMsPage() {
    return window.location.href.includes('/direct/');
  }

  /**
   * Find the message requests tab/button
   */
  function findRequestsTab() {
    // Instagram typically shows "Requests" or a number badge for pending requests
    const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase().trim();
      if (text && (text.includes('request') || text.includes('pending'))) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Find all message request items in the requests list
   */
  function findMessageRequests() {
    // Message requests are typically in a list, similar to regular DMs
    // Look for unread indicators or "Accept" buttons
    const requests = [];

    // Strategy 1: Find elements with "Accept" button nearby
    const acceptButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(btn => {
      const text = btn.textContent?.toLowerCase();
      return text && text.includes('accept');
    });

    for (const acceptBtn of acceptButtons) {
      // Find the parent container that represents the request
      let container = acceptBtn.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        const text = container.textContent || '';
        if (text.length > 10 && text.length < 500) {
          const requestId = 'req-' + text.substring(0, 50).replace(/\\s+/g, '-');
          if (!seenRequests.has(requestId)) {
            requests.push({
              id: requestId,
              element: container,
              acceptButton: acceptBtn
            });
            break;
          }
        }
        container = container.parentElement;
      }
    }

    // Strategy 2: Look for conversation items in requests section
    if (window.location.href.includes('/requests')) {
      const conversationItems = Array.from(document.querySelectorAll('[role="listitem"], [role="button"]'));
      for (const item of conversationItems) {
        const text = item.textContent || '';
        if (text.length > MIN_MESSAGE_LENGTH && text.length < 500) {
          const requestId = 'req-' + text.substring(0, 50).replace(/\\s+/g, '-');
          if (!seenRequests.has(requestId)) {
            // Check if it has an accept action
            const hasAccept = item.textContent?.toLowerCase().includes('accept');
            if (hasAccept) {
              requests.push({
                id: requestId,
                element: item,
                acceptButton: null // Will need to find it when processing
              });
            }
          }
        }
      }
    }

    return requests;
  }

  /**
   * Accept a message request
   */
  async function acceptMessageRequest(request) {
    try {
      log('Accepting message request: ' + request.id);

      // Click on the request to open it
      request.element.click();
      await sleep(1500);

      // Find and click Accept button
      let acceptBtn = request.acceptButton;
      if (!acceptBtn) {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        acceptBtn = buttons.find(btn => {
          const text = btn.textContent?.toLowerCase();
          return text && text.includes('accept');
        });
      }

      if (acceptBtn) {
        acceptBtn.click();
        await sleep(800);
        seenRequests.add(request.id);
        log('✓ Accepted message request: ' + request.id);
        return true;
      } else {
        log('Accept button not found for request: ' + request.id);
        return false;
      }
    } catch (err) {
      log('Error accepting request: ' + err);
      return false;
    }
  }

  /**
   * Find all conversation items in the DM list
   */
  function findConversations() {
    // Instagram DMs are typically in a list with role="listitem" or similar
    const conversations = [];

    // Look for conversation containers - they usually have specific classes
    // Instagram uses div elements with role="listitem" for DM conversations
    const items = Array.from(document.querySelectorAll('[role="listitem"]'));

    for (const item of items) {
      // Check for unread indicator (blue dot, bold text, etc.)
      const hasUnread = hasUnreadIndicator(item);
      if (!hasUnread) continue;

      // Extract conversation identifier
      const text = item.textContent || '';
      const convId = 'conv-' + text.substring(0, 50).replace(/\\s+/g, '-');

      if (!seenMessages.has(convId)) {
        conversations.push({
          id: convId,
          element: item
        });
      }
    }

    return conversations;
  }

  /**
   * Check if a conversation has unread messages
   */
  function hasUnreadIndicator(element) {
    // Look for common unread indicators:
    // 1. Blue dot (notification badge)
    // 2. Bold text
    // 3. Specific classes or attributes

    // Check for notification badge/dot
    const badge = element.querySelector('[role="status"], [aria-label*="unread"], [aria-label*="notification"]');
    if (badge) return true;

    // Check for bold text (Instagram often bolds unread message previews)
    const fontWeights = [];
    const spans = element.querySelectorAll('span, div');
    spans.forEach(el => {
      const weight = window.getComputedStyle(el).fontWeight;
      if (weight === 'bold' || weight === '700' || parseInt(weight) >= 600) {
        fontWeights.push(el);
      }
    });
    if (fontWeights.length > 0) return true;

    // Check for specific unread classes
    const html = element.innerHTML.toLowerCase();
    if (html.includes('unread') || html.includes('notification')) return true;

    return false;
  }

  /**
   * Open a conversation
   */
  async function openConversation(conversation) {
    try {
      log('Opening conversation: ' + conversation.id);
      conversation.element.click();
      await sleep(1500); // Wait for conversation to load
      return true;
    } catch (err) {
      log('Error opening conversation: ' + err);
      return false;
    }
  }

  /**
   * Get messages from the current open conversation
   */
  function getConversationMessages() {
    const messages = [];

    // Instagram message containers - typically divs with specific structure
    // Messages usually have different classes for sent vs received
    const messageElements = Array.from(document.querySelectorAll('[role="row"], [class*="message"], [class*="Message"]'));

    for (const el of messageElements) {
      const text = extractMessageText(el);
      if (!text || text.length < MIN_MESSAGE_LENGTH) continue;

      // Determine if incoming or outgoing
      const isIncoming = isIncomingMessage(el);

      messages.push({
        text: text,
        isIncoming: isIncoming,
        element: el
      });
    }

    return messages;
  }

  /**
   * Extract text from a message element
   */
  function extractMessageText(element) {
    // Try to find the text content, avoiding timestamps and metadata
    const textElements = element.querySelectorAll('span, p, div');
    let longestText = '';

    for (const el of textElements) {
      const text = el.textContent?.trim() || '';
      if (text.length > longestText.length && text.length < 5000) {
        // Avoid timestamps (short, contains numbers/colons)
        if (!/^\\d{1,2}:\\d{2}/.test(text) && !/^\\d+[smhd]/.test(text)) {
          longestText = text;
        }
      }
    }

    return longestText;
  }

  /**
   * Determine if a message is incoming (from other person)
   */
  function isIncomingMessage(element) {
    // Check positioning - incoming messages are typically on the left
    const rect = element.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const messageCenter = (rect.left + rect.right) / 2;
    const isOnLeft = messageCenter < windowWidth / 2;

    // Also check classes for incoming/outgoing indicators
    const classes = element.className.toLowerCase();
    const html = element.innerHTML.toLowerCase();

    const incomingKeywords = ['incoming', 'received', 'other', 'left'];
    const outgoingKeywords = ['outgoing', 'sent', 'self', 'right', 'you'];

    const hasIncoming = incomingKeywords.some(kw => classes.includes(kw) || html.includes(kw));
    const hasOutgoing = outgoingKeywords.some(kw => classes.includes(kw) || html.includes(kw));

    if (hasIncoming) return true;
    if (hasOutgoing) return false;

    // Default to position-based detection
    return isOnLeft;
  }

  /**
   * Get the latest unread incoming message
   */
  function getLatestIncomingMessage(messages) {
    // Find the last incoming message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.isIncoming) {
        const msgId = 'msg-' + msg.text.substring(0, 100);
        if (!seenMessages.has(msgId)) {
          return { text: msg.text, id: msgId };
        }
      }
    }
    return null;
  }

  /**
   * Generate a reply based on rules or AI
   */
  async function generateReply(messageText) {
    // Try rule-based matching first
    const rules = CONFIG?.replyRules || [];
    const lower = messageText.toLowerCase();

    for (const rule of rules) {
      const matchStr = typeof rule.match === 'string' ? rule.match : '';
      const match = rule.caseSensitive ? matchStr : matchStr.toLowerCase();
      const text = rule.caseSensitive ? messageText : lower;

      if (match && text.includes(match)) {
        log('Rule matched: ' + matchStr);
        return rule.reply;
      }
    }

    // Try AI if enabled
    const aiConfig = CONFIG?.ai;
    if (aiConfig?.enabled) {
      try {
        log('Requesting AI reply...');
        const messages = [
          { role: 'system', content: aiConfig.systemPrompt || 'You are a friendly person responding to Instagram DMs. Keep responses brief and casual.' },
          { role: 'user', content: messageText }
        ];

        const url = 'http://' + (aiConfig.llmEndpoint || 'localhost') + ':' + (aiConfig.llmPort || 8080) + '/v1/chat/completions';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), aiConfig.requestTimeoutMs || 30000);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: aiConfig.modelName || 'local-model',
            messages,
            temperature: aiConfig.temperature || 0.7,
            max_tokens: aiConfig.maxTokens || 150
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const aiReply = data?.choices?.[0]?.message?.content?.trim();
          if (aiReply) {
            log('AI reply generated');
            return aiReply;
          }
        } else {
          log('AI request failed: HTTP ' + response.status);
        }
      } catch (err) {
        if (err?.name === 'AbortError') {
          log('AI request timed out');
        } else {
          log('AI error: ' + err?.message);
        }
      }
    }

    // Fallback responses
    if (lower.includes('?')) return "That's a good question! Let me get back to you on that.";
    if (lower.includes('thank')) return "You're welcome! 😊";
    if (lower.includes('hi') || lower.includes('hey') || lower.includes('hello')) return "Hey! What's up?";

    return null;
  }

  /**
   * Type a message into the input field
   */
  async function typeMessage(text) {
    // Find the message input - Instagram typically uses a contenteditable div or textarea
    const input = document.querySelector('[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"], textarea');

    if (!input) {
      log('Input field not found');
      return false;
    }

    input.focus();
    await sleep(200);

    // Clear existing content
    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = '';
      input.textContent = '';
    } else if (input.value !== undefined) {
      input.value = '';
    }

    // Type character by character
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (input.getAttribute('contenteditable') === 'true') {
        input.textContent = (input.textContent || '') + char;
      } else if (input.value !== undefined) {
        input.value += char;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

      const delay = Math.floor(Math.random() * (typingDelayRange[1] - typingDelayRange[0])) + typingDelayRange[0];
      await sleep(delay);
    }

    log('Typed message: "' + text.substring(0, 30) + '..."');
    return true;
  }

  /**
   * Send the message
   */
  async function sendMessage() {
    // Find the send button - usually a button with "Send" text or specific SVG
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const sendBtn = buttons.find(btn => {
      const text = btn.textContent?.toLowerCase();
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
      return (text && text.includes('send')) || (ariaLabel && ariaLabel.includes('send'));
    });

    if (sendBtn) {
      sendBtn.click();
      log('Send button clicked');
      await sleep(800);
      return true;
    }

    // Fallback: Try Enter key
    const input = document.querySelector('[contenteditable="true"][role="textbox"], textarea');
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      log('Sent via Enter key');
      await sleep(800);
      return true;
    }

    log('Could not send message');
    return false;
  }

  /**
   * Process a single conversation
   */
  async function processConversation(conversation) {
    try {
      // Open the conversation
      const opened = await openConversation(conversation);
      if (!opened) return;

      // Get messages
      const messages = getConversationMessages();
      log('Found ' + messages.length + ' messages in conversation');

      if (messages.length === 0) {
        log('No messages found');
        return;
      }

      // Get latest incoming message
      const latestMsg = getLatestIncomingMessage(messages);
      if (!latestMsg) {
        log('No new incoming messages');
        return;
      }

      log('Latest incoming message: "' + latestMsg.text.substring(0, 50) + '..."');

      // Mark as seen
      seenMessages.add(latestMsg.id);
      seenMessages.add(conversation.id);

      // Generate reply
      const reply = await generateReply(latestMsg.text);
      if (!reply) {
        log('No reply generated');
        return;
      }

      // Random skip
      const skipProb = CONFIG?.randomSkipProbability || 0.15;
      if (Math.random() < skipProb) {
        log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%)');
        return;
      }

      // Pre-reply delay
      const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
      log('Waiting ' + delay + 'ms before replying');
      await sleep(delay);

      // Type and send
      const typed = await typeMessage(reply);
      if (!typed) return;

      await sleep(500);

      const sent = await sendMessage();
      if (sent) {
        log('✓ Reply sent: "' + reply.substring(0, 60) + '..."');
      }
    } catch (err) {
      log('Error processing conversation: ' + err);
    }
  }

  /**
   * Main polling loop
   */
  async function poll() {
    if (!isRunning || isProcessing) return;
    isProcessing = true;

    try {
      // Ensure we're on the DMs page
      if (!isOnDMsPage()) {
        const navigated = navigateToDMs();
        if (navigated) {
          await sleep(2000); // Wait for page load
        }
        isProcessing = false;
        return;
      }

      log('Polling for new messages and requests...');

      // Check for message requests
      const requestsTab = findRequestsTab();
      if (requestsTab) {
        // Click on requests tab
        requestsTab.click();
        await sleep(1500);

        const requests = findMessageRequests();
        if (requests.length > 0) {
          log('Found ' + requests.length + ' message request(s)');
          for (const request of requests) {
            if (!isRunning) break;
            await acceptMessageRequest(request);
            await sleep(1000);
          }
        }

        // Navigate back to main DMs
        const primaryTab = Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(btn => {
          const text = btn.textContent?.toLowerCase();
          return text && (text.includes('primary') || text.includes('general'));
        });
        if (primaryTab) {
          primaryTab.click();
          await sleep(1000);
        }
      }

      // Check for unread conversations
      const conversations = findConversations();
      if (conversations.length === 0) {
        log('No unread conversations');
        isProcessing = false;
        return;
      }

      log('Found ' + conversations.length + ' unread conversation(s)');

      // Process each conversation
      for (const conv of conversations) {
        if (!isRunning) break;
        await processConversation(conv);
        await sleep(2000);
      }
    } catch (err) {
      log('Poll error: ' + err);
    } finally {
      isProcessing = false;
    }
  }

  function stop() {
    isRunning = false;
    if (pollInterval) clearInterval(pollInterval);
    window.__SNAPPY_RUNNING__ = false;
    window.__SNAPPY_INSTAGRAM_RUNNING__ = false;
    log('Instagram bot stopped');
  }

  // Start polling
  log('🚀 Instagram DM bot started');
  poll();
  pollInterval = setInterval(poll, POLL_MS);

  window.__SNAPPY_STOP__ = stop;
})();
`;
}
