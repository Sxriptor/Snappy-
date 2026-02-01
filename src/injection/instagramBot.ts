import { Configuration } from '../types';

/**
 * Build an injection script for Instagram that:
 * - Navigates to DMs and finds unread conversations (keep existing navigation)
 * - Uses improved div[role="row"] detection once inside conversations
 * - Replies to new messages automatically with human-like typing
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
  let isRunning = true;
  let pollInterval = null;
  let isProcessing = false;

  const MIN_MESSAGE_LENGTH = 2;
  const BASE_POLL_MS = (CONFIG?.instagram && CONFIG.instagram.pollIntervalMs) || 8000;
  const POLL_VARIANCE_MS = 4000; // Random variance for more natural scanning
  const typingDelayRange = CONFIG?.typingDelayRangeMs || [50, 150];
  const preReplyDelayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];

  function getRandomPollInterval() {
    return BASE_POLL_MS + Math.floor(Math.random() * POLL_VARIANCE_MS);
  }

  function log(msg) {
    const formatted = '[Snappy][Instagram] ' + msg;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract message text from a row element
   * Instagram wraps each message in many divs, but the real message is always 
   * the innermost div with dir="auto" that contains readable text.
   */
  function getMessageText(row) {
    // Look for div with dir="auto" which contains the actual message text
    const messageDiv = row.querySelector('div[dir="auto"]');
    if (messageDiv) {
      const text = messageDiv.innerText.trim();
      if (text) {
        log('Extracted text from dir="auto": "' + text.substring(0, 50) + '..."');
        return text;
      }
    }
    
    // If this element IS a dir="auto" div, get its text directly
    if (row.getAttribute('dir') === 'auto') {
      const text = row.innerText.trim();
      if (text) {
        log('Extracted text from dir="auto" element: "' + text.substring(0, 50) + '..."');
        return text;
      }
    }
    
    // Fallback to span if dir="auto" not found
    const span = row.querySelector('span');
    if (span) {
      const text = span.innerText.trim();
      if (text) {
        log('Extracted text from span: "' + text.substring(0, 50) + '..."');
        return text;
      }
    }
    
    log('No text found in element');
    return null;
  }

  /**
   * Detect if a message is incoming (not sent by us)
   * Instagram doesn't label this cleanly, but here's the reliable heuristic:
   * Incoming messages are left aligned and do NOT have "Seen" or "Delivered" nearby
   */
  function isIncoming(row) {
    return !row.innerText.includes('Seen') && !row.innerText.includes('Delivered');
  }

  /**
   * Navigate to the DMs section
   */
  function navigateToDMs() {
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
   * Find all conversation items in the DM list
   */
  function findConversations() {
    const conversations = [];

    let items = Array.from(document.querySelectorAll('[role="listitem"]'));

    if (items.length === 0) {
      log('No [role="listitem"] found, trying alternative selectors...');

      items = Array.from(document.querySelectorAll('a[href*="/direct/t/"]'));
      log('Found ' + items.length + ' direct message links');

      if (items.length === 0) {
        const unreadDivs = Array.from(document.querySelectorAll('div')).filter(div =>
          div.textContent?.includes('Unread') && div.textContent.length < 200
        );
        log('Found ' + unreadDivs.length + ' elements with "Unread" text');

        items = unreadDivs.map(div => {
          let parent = div.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            if (parent.tagName === 'A' || parent.getAttribute('role') === 'button') {
              return parent;
            }
            parent = parent.parentElement;
          }
          return div.parentElement;
        }).filter(el => el !== null);
      }
    }

    log('Found ' + items.length + ' total conversation items to check');

    for (const item of items) {
      const hasUnread = hasUnreadIndicator(item);

      const text = item.textContent?.substring(0, 80) || '';
      if (text.length > 0) {
        const hasUnreadText = text.includes('Unread');
        log('Item: "' + text + '" - hasUnread=' + hasUnread + ', hasUnreadText=' + hasUnreadText);
      }

      if (!hasUnread) continue;

      const fullText = item.textContent || '';
      const convId = 'conv-' + fullText.substring(0, 50).replace(/\\s+/g, '-');

      if (!seenMessages.has(convId)) {
        log('✓ Found unread conversation: ' + convId.substring(0, 60));
        conversations.push({ id: convId, element: item });
      } else {
        log('Skipping already seen conversation: ' + convId.substring(0, 60));
      }
    }

    return conversations;
  }

  /**
   * Check if a conversation has unread messages
   */
  function hasUnreadIndicator(element) {
    const unreadDiv = element.querySelector('div.x9f619.x1ja2u2z.xzpqnlu.x1hyvwdk.x14bfe9o.xjm9jq1.x6ikm8r.x10wlt62.x10l6tqk.x1i1rx1s');
    if (unreadDiv && unreadDiv.textContent?.includes('Unread')) {
      return true;
    }

    const allDivs = element.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.textContent?.trim() === 'Unread') {
        return true;
      }
    }

    const badge = element.querySelector('[role="status"], [aria-label*="unread"], [aria-label*="notification"]');
    if (badge) return true;

    const spans = element.querySelectorAll('span, div');
    for (const el of spans) {
      const weight = window.getComputedStyle(el).fontWeight;
      if ((weight === 'bold' || weight === '700' || parseInt(weight) >= 600) && el.textContent && el.textContent.length > 3) {
        return true;
      }
    }

    return false;
  }

  /**
   * Open a conversation
   */
  async function openConversation(conversation) {
    try {
      log('Opening conversation: ' + conversation.id);

      let clickTarget = conversation.element;

      if (conversation.element.tagName === 'A') {
        clickTarget = conversation.element;
      } else {
        const link = conversation.element.querySelector('a[href*="/direct/t/"]');
        if (link) {
          clickTarget = link;
          log('Found direct message link within element');
        } else {
          const clickable = conversation.element.querySelector('[role="button"], a, button');
          if (clickable) {
            clickTarget = clickable;
            log('Found clickable element within container');
          }
        }
      }

      log('Clicking element: ' + clickTarget.tagName);
      clickTarget.click();
      
      // Wait longer for conversation to fully load
      await sleep(3000);
      
      // Additional wait if we're still loading
      let retries = 0;
      while (retries < 3) {
        const messageRows = document.querySelectorAll('div[role="row"], div[dir="auto"]');
        if (messageRows.length > 0) {
          log('Conversation loaded with ' + messageRows.length + ' potential message elements');
          break;
        }
        log('Waiting for conversation to load... (retry ' + (retries + 1) + ')');
        await sleep(1000);
        retries++;
      }
      
      return true;
    } catch (err) {
      log('Error opening conversation: ' + err);
      return false;
    }
  }

  /**
   * Get messages from the current open conversation using improved detection
   */
  function getConversationMessages() {
    const messages = [];
    
    // Try multiple selectors to find message elements
    let messageElements = Array.from(document.querySelectorAll('div[role="row"]'));
    log('Found ' + messageElements.length + ' message rows with role="row"');
    
    // If no role="row" found, try alternative selectors
    if (messageElements.length === 0) {
      // Try looking for divs with dir="auto" directly (message content)
      messageElements = Array.from(document.querySelectorAll('div[dir="auto"]'));
      log('Found ' + messageElements.length + ' elements with dir="auto"');
      
      // If still nothing, try common message selectors
      if (messageElements.length === 0) {
        messageElements = Array.from(document.querySelectorAll('[data-testid*="message"], [class*="message"], [class*="Message"]'));
        log('Found ' + messageElements.length + ' elements with message-related attributes');
      }
      
      // Last resort: look for any div containing text that might be messages
      if (messageElements.length === 0) {
        const allDivs = Array.from(document.querySelectorAll('div'));
        messageElements = allDivs.filter(div => {
          const text = div.innerText?.trim();
          return text && text.length > 2 && text.length < 1000 && 
                 !text.includes('Unread') && !text.includes('Active') &&
                 div.querySelector('div[dir="auto"]'); // Must contain a dir="auto" child
        });
        log('Found ' + messageElements.length + ' potential message containers');
      }
    }

    for (const element of messageElements) {
      const text = getMessageText(element);
      
      if (!text) {
        log('Skipping element: no text found');
        continue;
      }
      
      if (text.length < MIN_MESSAGE_LENGTH) {
        log('Skipping element: text too short (' + text.length + ' chars): "' + text + '"');
        continue;
      }

      // Use the reliable heuristic for incoming messages
      const isIncomingMsg = isIncoming(element);
      
      log('Message found: "' + text.substring(0, 30) + '..." - Incoming: ' + isIncomingMsg + ' - Length: ' + text.length);

      messages.push({ text: text, isIncoming: isIncomingMsg, element: element });
    }

    return messages;
  }

  /**
   * Get the latest unread incoming message
   */
  function getLatestIncomingMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.isIncoming) {
        const msgId = 'msg-' + msg.text.substring(0, 100).replace(/\\s+/g, '-');
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
      const opened = await openConversation(conversation);
      if (!opened) return;

      const messages = getConversationMessages();
      log('Found ' + messages.length + ' messages in conversation');

      if (messages.length === 0) {
        log('No messages found');
        return;
      }

      const latestMsg = getLatestIncomingMessage(messages);
      if (!latestMsg) {
        log('No new incoming messages');
        return;
      }

      log('Latest incoming message: "' + latestMsg.text.substring(0, 50) + '..."');

      seenMessages.add(latestMsg.id);
      seenMessages.add(conversation.id);

      const reply = await generateReply(latestMsg.text);
      if (!reply) {
        log('No reply generated');
        return;
      }

      const skipProb = CONFIG?.randomSkipProbability || 0.15;
      if (Math.random() < skipProb) {
        log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%)');
        return;
      }

      const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
      log('Waiting ' + delay + 'ms before replying');
      await sleep(delay);

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
   * Main polling loop - keep navigation, improve message detection
   */
  async function poll() {
    if (!isRunning || isProcessing) return;
    isProcessing = true;

    try {
      if (!isOnDMsPage()) {
        const navigated = navigateToDMs();
        if (navigated) {
          await sleep(2000);
        }
        isProcessing = false;
        return;
      }

      log('Polling for new messages...');

      const conversations = findConversations();
      if (conversations.length === 0) {
        log('No unread conversations');
        isProcessing = false;
        return;
      }

      log('Found ' + conversations.length + ' unread conversation(s)');

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

  function scheduleNextPoll() {
    if (!isRunning) return;
    const delay = getRandomPollInterval();
    log('Next scan in ' + Math.round(delay / 1000) + 's');
    pollInterval = setTimeout(() => {
      poll();
      scheduleNextPoll();
    }, delay);
  }

  function stop() {
    isRunning = false;
    if (pollInterval) {
      clearTimeout(pollInterval);
      clearInterval(pollInterval);
    }
    window.__SNAPPY_RUNNING__ = false;
    window.__SNAPPY_INSTAGRAM_RUNNING__ = false;
    log('Instagram bot stopped');
  }

  // Start polling
  log('🚀 Instagram DM bot started - navigating to DMs and monitoring messages');
  poll();
  scheduleNextPoll();

  window.__SNAPPY_STOP__ = stop;
})();
`;
}