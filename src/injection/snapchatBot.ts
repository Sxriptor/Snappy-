/**
 * Snapchat-Specific Bot Implementation
 * Handles Snapchat Web's unique DOM structure with conversation memory
 */

import { log, getConfig, markMessageSeen, isMessageSeen } from './bot';
import { Configuration } from '../types';

// Conversation memory - stores summaries per user
interface ConversationMemory {
  sender: string;
  messages: { text: string; timestamp: number; isIncoming: boolean }[];
  summary: string;
  lastUpdated: number;
}

const conversationMemories: Map<string, ConversationMemory> = new Map();

const MIN_MESSAGE_LENGTH = 5; // Minimum message length to process

// Snapchat-specific selectors (updated for current Snapchat Web)
const SNAPCHAT_SELECTORS = {
  // Chat list items (conversations in sidebar)
  chatListItem: '.O4POs, [class*="ChatListItem"], [class*="conversationListItem"], [class*="conversation-"]',
  chatListContainer: '[class*="ChatList"], [class*="conversationList"], [class*="chat-list"], [class*="sidebar"], nav, aside',

  // Unread indicator - more specific based on actual HTML
  unreadBadge: '.HEkDJ.DEp5Z.UW13F, .HEkDJ.DEp5Z, [class*="unread"], [class*="badge"]',

  // Active conversation - MORE SPECIFIC to actual message groups with headers
  messageContainer: '[class*="MessageList"], [class*="messageList"], main[class*="chat"], [role="main"]',
  // NEW: Target elements that have a header sibling or parent (actual messages)
  messageBubble: 'div:has(> header.R1ne3), article:has(header), [class*="message"]:has(header)',
  messageText: '[class*="MessageContent"], [class*="messageContent"], [class*="text"], [class*="content"]',

  // Sender info
  senderName: 'header.R1ne3 span.nonIntl, [class*="FriendName"], [class*="username"]',
  conversationHeader: '[class*="ConversationHeader"], [class*="chatHeader"], header[class*="conversation"]',

  // Input and send
  inputField: '[contenteditable="true"], textarea[class*="Input"], [placeholder*="Send"], [role="textbox"]',
  sendButton: 'button[class*="Send"], button[aria-label*="Send"], [class*="sendButton"]',

  // Incoming vs outgoing - expanded with more variations
  incomingMessage: '[class*="received"], [class*="incoming"], [class*="other"], [class*="left"]',
  outgoingMessage: '[class*="sent"], [class*="outgoing"], [class*="self"], [class*="right"]'
};

let isRunning = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let config: Configuration;
let isProcessing = false; // Lock to prevent concurrent processing

/**
 * Log with visual feedback to console and UI
 */
function snapLog(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  const formatted = `[${timestamp}] [Snapchat] ${message}`;
  log(formatted);
  
  // Also log to browser console for debugging
  console.log('%c' + formatted, 'color: #FFFC00; background: #000; padding: 2px 5px;');
  
  // Dispatch event for UI to catch
  window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp } }));
}

/**
 * Find element using multiple selectors
 */
function findElement(selectors: string): HTMLElement | null {
  const selectorList = selectors.split(', ');
  for (const selector of selectorList) {
    try {
      const el = document.querySelector(selector) as HTMLElement;
      if (el) return el;
    } catch (e) { /* invalid selector */ }
  }
  return null;
}

/**
 * Find all elements using multiple selectors
 */
function findAllElements(selectors: string): HTMLElement[] {
  const selectorList = selectors.split(', ');
  const results: HTMLElement[] = [];
  for (const selector of selectorList) {
    try {
      document.querySelectorAll(selector).forEach(el => results.push(el as HTMLElement));
    } catch (e) { /* invalid selector */ }
  }
  return results;
}


/**
 * Clean username by removing status suffixes, emojis, and corrupted unicode
 */
function cleanUsername(rawName: string): string {
  if (!rawName) return 'Unknown';

  let cleaned = rawName.trim();

  // Remove emojis and unicode symbols (including corrupted ones like ≡ƒÿè)
  // This regex removes most emoji ranges and special unicode characters
  cleaned = cleaned
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Emojis
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .replace(/[≡ƒÿè]+/g, '')                // Common corrupted emoji patterns
    .replace(/[\x00-\x1F\x7F]/g, '')        // Control characters
    .trim();

  // Status suffixes to remove (case-insensitive)
  const statusSuffixes = [
    'typing',
    'typing...',
    'typing…',
    'delivered',
    'read',
    'received',
    'opened',
    'sent',
    'viewed',
    'online',
    'offline',
    'active now',
    'just now',
    'new chat',
    'new snap',
  ];

  // Remove status suffixes from the end
  for (const suffix of statusSuffixes) {
    const regex = new RegExp(`\\s+${suffix}\\s*$`, 'i');
    cleaned = cleaned.replace(regex, '');
  }

  // Handle cases where status might be separated by newline
  const parts = cleaned.split(/[\n\r]+/);
  if (parts.length > 0) {
    cleaned = parts[0].trim();
  }

  // Remove any trailing timestamps like "2m", "5h", "1d"
  cleaned = cleaned.replace(/\s+\d+[smhd]\s*$/i, '');

  return cleaned || 'Unknown';
}

/**
 * Get current conversation's sender name
 */
function getCurrentSender(): string {
  // Try to get from conversation header
  const header = findElement(SNAPCHAT_SELECTORS.conversationHeader);
  if (header) {
    const nameEl = header.querySelector(SNAPCHAT_SELECTORS.senderName.split(', ').join(', '));
    if (nameEl?.textContent) {
      return cleanUsername(nameEl.textContent);
    }
  }
  
  // Fallback: look for any visible username
  const nameEl = findElement(SNAPCHAT_SELECTORS.senderName);
  if (nameEl?.textContent) {
    return cleanUsername(nameEl.textContent);
  }
  
  return 'Unknown';
}

/**
 * Check if text is a Snapchat UI/status element (not a real message)
 */
function isStatusOrUIText(text: string): boolean {
  const lowerText = text.toLowerCase().trim();
  
  // Exact match status keywords
  const exactStatusKeywords = [
    'opened', 'typing', 'typing...', 'received', 'delivered', 'viewed', 'sent',
    'new chat', 'snap', 'screenshot', 'chat', 'opened snap', 'new snap',
    'streaks', 'streak', 'tap to chat', 'tap to view', 'double tap to like',
    'say something...', 'send a message', 'type a message', 'send a chat',
    'spotlight', 'stories', 'discover', 'map', 'memories', 'camera',
    'add friends', 'my ai', 'team snapchat', 'just now', 'today', 'yesterday'
  ];
  
  if (exactStatusKeywords.includes(lowerText)) {
    return true;
  }
  
  // Partial match patterns for status text
  const statusPatterns = [
    /^typing\.{0,3}$/i,           // "Typing", "Typing...", "Typing..."
    /^opened\s/i,                  // "Opened 2m ago"
    /^delivered\s/i,               // "Delivered 5m ago"
    /^received\s/i,                // "Received just now"
    /^sent\s/i,                    // "Sent 1h ago"
    /^viewed\s/i,                  // "Viewed"
    /^\d+[smhd]\s*(ago)?$/i,       // "2m ago", "5h", "1d ago"
    /^\d+:\d+\s*(am|pm)?$/i,       // "2:30 PM", "14:30"
    /^(mon|tue|wed|thu|fri|sat|sun)/i,  // Day names
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,  // Month names
    /^new\s+(chat|snap|message)/i, // "New chat", "New snap"
    /^tap\s+to\s+/i,               // "Tap to view", "Tap to chat"
    /^double\s+tap/i,              // "Double tap to..."
    /^swipe\s+/i,                  // "Swipe to..."
    /^reply\s+to\s+/i,             // "Reply to..."
    /^\d+\s*(new\s+)?(message|chat|snap)/i,  // "3 new messages"
    /^(chat|snap)\s+opened/i,      // "Chat opened"
    /screenshot/i,                 // Any screenshot mention
    /streak/i,                     // Any streak mention
  ];
  
  for (const pattern of statusPatterns) {
    if (pattern.test(lowerText)) {
      return true;
    }
  }
  
  // Skip if it's just timestamps, emojis, or very short
  if (/^[\d:.\s]+$/.test(text)) return true;  // Only numbers/time
  if (/^[^\w\s]*$/.test(text)) return true;   // Only symbols/emoji
  if (text.length < 2) return true;            // Too short
  
  // Skip partial/incomplete messages (ends with "..." and is short)
  if (text.endsWith('...') && text.length < 25) return true;
  
  return false;
}

/**
 * Get all messages in current conversation
 * NEW APPROACH: Messages are in <li> elements, grouped by sender
 */
function getConversationMessages(): { text: string; isIncoming: boolean }[] {
  const messages: { text: string; isIncoming: boolean }[] = [];

  // Find ALL ul.ujRzj elements (there's one per conversation)
  const allMessageLists = Array.from(document.querySelectorAll('ul.ujRzj'));
  snapLog(`Found ${allMessageLists.length} ul.ujRzj elements`);

  // Find the VISIBLE one (the active conversation)
  // Look for the one with the most visible content or that's currently scrollable
  let messageList: Element | null = null;

  for (const ul of allMessageLists) {
    const rect = ul.getBoundingClientRect();
    // Check if this ul is visible (has dimensions and is in viewport)
    if (rect.width > 0 && rect.height > 100) {
      messageList = ul;
      snapLog(`Found visible message list: width=${rect.width.toFixed(0)}px, height=${rect.height.toFixed(0)}px`);
      break;
    }
  }

  // Fallback: Just use the first one with messages
  if (!messageList && allMessageLists.length > 0) {
    for (const ul of allMessageLists) {
      if (ul.querySelectorAll('li').length > 0) {
        messageList = ul;
        snapLog(`Using first ul.ujRzj with messages as fallback`);
        break;
      }
    }
  }

  if (!messageList) {
    snapLog('ERROR: Could not find any visible message list');
    return messages;
  }

  // Get all top-level <li> elements (each represents a message group)
  const messageGroups = Array.from(messageList.querySelectorAll(':scope > li'));
  snapLog(`Found ${messageGroups.length} message groups in active conversation`);

  for (const group of messageGroups) {
    // Check if this group has a header (indicates sender)
    const header = group.querySelector('header.R1ne3');

    let isOutgoing = false;
    let isIncoming = false;

    if (header) {
      // Has header - determine sender
      // Check if header contains a span with class "nonIntl" that says exactly "Me"
      const meSpan = header.querySelector('span.nonIntl');
      const senderName = meSpan?.textContent?.trim() || '';

      // HARDCODED: If sender is exactly "Me", it's our message (outgoing)
      // Otherwise, it's from someone else (incoming)
      if (senderName === 'Me') {
        isOutgoing = true;
        isIncoming = false;
        snapLog(`Message group from: "Me" [OUTGOING]`);
      } else {
        isOutgoing = false;
        isIncoming = true;
        snapLog(`Message group from: "${senderName}" [INCOMING]`);
      }
    }

    // Now find all individual messages in this group
    // Messages are in <div class="KB4Aq"> elements
    const messageDivs = Array.from(group.querySelectorAll('div.KB4Aq'));

    for (const msgDiv of messageDivs) {
      // Get the actual text content from span.ogn1z
      const textSpan = msgDiv.querySelector('span.ogn1z');
      if (!textSpan) continue;

      const text = textSpan.textContent?.trim() || '';
      if (!text || text.length < MIN_MESSAGE_LENGTH) continue;

      // Skip status/UI text
      if (isStatusOrUIText(text)) continue;

      // If we still don't know direction, use visual positioning
      if (!isIncoming && !isOutgoing) {
        const rect = msgDiv.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const messageCenter = (rect.left + rect.right) / 2;
        const screenCenter = windowWidth / 2;
        const threshold = windowWidth * 0.1;

        if (messageCenter < screenCenter - threshold) {
          isIncoming = true;
        } else if (messageCenter > screenCenter + threshold) {
          isOutgoing = true;
        } else {
          snapLog(`  -> Skipping message with unknown direction: "${text.substring(0, 30)}..."`);
          continue;
        }
      }

      const direction = isIncoming ? 'INCOMING' : 'OUTGOING';
      snapLog(`  -> ${direction}: "${text}"`);
      messages.push({ text, isIncoming });
    }
  }

  snapLog(`Total messages collected: ${messages.length}`);
  return messages;
}

/**
 * Get the latest incoming message that we haven't replied to yet
 * Looks for the most recent incoming message, even if we've sent messages after it
 */
function getLatestIncomingMessage(): string | null {
  const messages = getConversationMessages();
  
  if (messages.length === 0) {
    return null;
  }
  
  // Find the last incoming message
  // We iterate backwards to find the most recent one
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.isIncoming) {
      // Found an incoming message - check if we've already processed it
      const msgId = `${getCurrentSender()}-${msg.text.substring(0, 100)}`;
      if (isMessageSeen(msgId)) {
        snapLog('Latest incoming message already processed');
        return null;
      }
      
      snapLog(`Found latest incoming message: "${msg.text.substring(0, 50)}..."`);
      return msg.text;
    }
  }
  
  snapLog('No incoming messages found in conversation');
  return null;
}

/**
 * Generate a summary of the conversation
 */
function generateConversationSummary(memory: ConversationMemory): string {
  const recentMessages = memory.messages.slice(-10); // Last 10 messages
  
  if (recentMessages.length === 0) {
    return 'No conversation history yet.';
  }
  
  const topics: string[] = [];
  const incomingTexts = recentMessages.filter(m => m.isIncoming).map(m => m.text.toLowerCase());
  
  // Simple topic extraction
  if (incomingTexts.some(t => t.includes('?'))) topics.push('asking questions');
  if (incomingTexts.some(t => t.includes('hi') || t.includes('hey') || t.includes('hello'))) topics.push('greeting');
  if (incomingTexts.some(t => t.includes('how are') || t.includes('what\'s up'))) topics.push('checking in');
  if (incomingTexts.some(t => t.includes('thanks') || t.includes('thank you'))) topics.push('expressing gratitude');
  
  const summary = `${memory.sender}: ${recentMessages.length} messages. Topics: ${topics.length > 0 ? topics.join(', ') : 'general chat'}. Last message: "${recentMessages[recentMessages.length - 1]?.text.substring(0, 50)}..."`;
  
  return summary;
}

/**
 * Update conversation memory for a sender
 */
function updateConversationMemory(sender: string, messages: { text: string; isIncoming: boolean }[]): void {
  let memory = conversationMemories.get(sender);
  
  if (!memory) {
    memory = {
      sender,
      messages: [],
      summary: '',
      lastUpdated: Date.now()
    };
  }
  
  // Filter and deduplicate messages before adding
  const now = Date.now();
  const existingTexts = new Set(memory.messages.map(m => m.text.toLowerCase().trim()));
  
  for (const msg of messages) {
    // Skip status/UI text
    if (isStatusOrUIText(msg.text)) {
      continue;
    }
    
    // Skip duplicates
    const normalizedText = msg.text.toLowerCase().trim();
    if (existingTexts.has(normalizedText)) {
      continue;
    }
    
    // Skip very short messages
    if (msg.text.length < MIN_MESSAGE_LENGTH) {
      continue;
    }
    
    memory.messages.push({ ...msg, timestamp: now });
    existingTexts.add(normalizedText);
  }
  
  // Keep only last 50 messages
  if (memory.messages.length > 50) {
    memory.messages = memory.messages.slice(-50);
  }
  
  // Update summary
  memory.summary = generateConversationSummary(memory);
  memory.lastUpdated = now;
  
  conversationMemories.set(sender, memory);
  snapLog(`Memory updated for ${sender}: ${memory.messages.length} valid messages`);
}

/**
 * Get memory for a sender
 */
function getConversationMemory(sender: string): ConversationMemory | null {
  return conversationMemories.get(sender) || null;
}


/**
 * Check if a chat preview indicates a NEW incoming message
 * Returns true only if:
 * - Shows "New Chat" text
 * - Has a blue/unread dot indicator
 * - Preview text suggests incoming (not "You:" or "Delivered")
 */
function isNewIncomingChat(chatElement: HTMLElement): boolean {
  const chatText = chatElement.textContent?.toLowerCase() || '';
  const chatHtml = chatElement.innerHTML?.toLowerCase() || '';
  
  // Check for explicit "new chat" or "new snap" indicators
  if (chatText.includes('new chat') || chatText.includes('new snap')) {
    snapLog('Found "new chat" indicator');
    return true;
  }
  
  // Check for unread badge/dot (blue indicator)
  const hasUnreadBadge = chatElement.querySelector('[class*="unread"], [class*="Unread"], [class*="badge"], [class*="Badge"], [class*="dot"], [class*="Dot"]') !== null;
  const hasUnreadClass = chatElement.className.toLowerCase().includes('unread');
  
  if (!hasUnreadBadge && !hasUnreadClass) {
    return false; // No unread indicator at all
  }
  
  snapLog('Found unread indicator on chat');
  
  // Check if the preview shows it's from US (outgoing) - skip these
  // Snapchat shows "You:" or "Delivered" or "Sent" for outgoing messages
  const outgoingIndicators = ['you:', 'delivered', 'sent', 'opened', 'viewed'];
  for (const indicator of outgoingIndicators) {
    if (chatText.includes(indicator)) {
      snapLog(`Skipping - preview shows outgoing indicator: "${indicator}"`);
      return false; // This is showing our last message, not theirs
    }
  }
  
  // Has unread indicator and doesn't look like our outgoing message
  snapLog('Chat appears to have new incoming message');
  return true;
}

/**
 * Find chats with unread messages
 */
function findUnreadChats(): HTMLElement[] {
  const chatItems = findAllElements(SNAPCHAT_SELECTORS.chatListItem);
  const unreadChats: HTMLElement[] = [];
  
  for (const item of chatItems) {
    // Skip chats that look like My AI or system accounts
    const chatText = item.textContent?.toLowerCase() || '';
    if (chatText.includes('my ai') || chatText.includes('team snapchat') || chatText.includes('snapchat')) {
      continue;
    }
    
    // Only include if it's actually a NEW incoming message
    if (isNewIncomingChat(item)) {
      unreadChats.push(item);
    }
  }
  
  return unreadChats;
}

/**
 * Navigate back to the main Snapchat homepage/chat list
 */
async function navigateToHomepage(): Promise<boolean> {
  try {
    snapLog('Navigating back to homepage...');
    
    // Method 1: Look for a back button or close button in the conversation header
    const conversationHeader = findElement(SNAPCHAT_SELECTORS.conversationHeader);
    if (conversationHeader) {
      const backBtn = conversationHeader.querySelector('[aria-label*="Back"], [aria-label*="Close"], button[class*="back"]') as HTMLElement;
      if (backBtn && backBtn.offsetParent !== null) {
        backBtn.click();
        snapLog('Clicked back button in conversation header');
        await sleep(1500);
        return true;
      }
    }
    
    // Method 2: Press Escape key to close current view
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
    snapLog('Pressed Escape to close conversation');
    await sleep(1000);
    
    // Method 3: Click on the Snapchat logo/brand area (usually top-left)
    const logoSelectors = [
      '[aria-label*="Snapchat"]',
      'svg[class*="logo"]',
      '[class*="Logo"]',
      'header [class*="brand"]',
      'nav [class*="logo"]'
    ];
    
    for (const selector of logoSelectors) {
      const logo = document.querySelector(selector) as HTMLElement;
      if (logo && logo.offsetParent !== null) {
        logo.click();
        snapLog('Clicked Snapchat logo to return to homepage');
        await sleep(1500);
        return true;
      }
    }
    
    // Method 4: Click on an empty area of the chat list (but avoid "My AI")
    const chatListContainer = findElement(SNAPCHAT_SELECTORS.chatListContainer);
    if (chatListContainer) {
      // Find a safe area to click that's not on "My AI" or any specific chat
      const rect = chatListContainer.getBoundingClientRect();
      
      // Click near the top of the chat list, but not on the first item (which might be My AI)
      const clickX = rect.left + rect.width * 0.3; // 30% from left edge
      const clickY = rect.top + 30; // 30px from top
      
      // Make sure we're not clicking on any chat item
      const elementAtPoint = document.elementFromPoint(clickX, clickY);
      const chatItem = elementAtPoint?.closest(SNAPCHAT_SELECTORS.chatListItem);
      
      if (!chatItem) {
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          clientX: clickX,
          clientY: clickY
        });
        chatListContainer.dispatchEvent(clickEvent);
        snapLog('Clicked on empty area of chat list');
        await sleep(1000);
      }
    }
    
    // Method 5: Try to find and click a "Chats" or "Messages" tab/button
    const chatsTabSelectors = [
      '[aria-label*="Chats"]',
      '[aria-label*="Messages"]',
      'button[class*="chat"]',
      '[data-testid*="chat"]',
      'nav button:first-child' // Often the first nav button is "Chats"
    ];
    
    for (const selector of chatsTabSelectors) {
      const chatsTab = document.querySelector(selector) as HTMLElement;
      if (chatsTab && chatsTab.offsetParent !== null) {
        // Make sure it's not "My AI" by checking text content
        const text = chatsTab.textContent?.toLowerCase() || '';
        if (!text.includes('ai') && !text.includes('my ai')) {
          chatsTab.click();
          snapLog('Clicked Chats tab to return to homepage');
          await sleep(1500);
          return true;
        }
      }
    }
    
    snapLog('Successfully attempted to navigate to homepage');
    return true;
  } catch (e) {
    snapLog(`Error navigating to homepage: ${e}`);
    return false;
  }
}

/**
 * Ensure the chat is still open and focused
 * Re-clicks the chat element if needed
 */
async function ensureChatIsOpen(chatElement: HTMLElement, expectedSender: string): Promise<boolean> {
  // Check if we're still in the correct conversation
  const currentSender = getCurrentSender();
  
  if (currentSender === expectedSender) {
    // We're still in the right chat
    snapLog(`Chat with ${expectedSender} is still open`);
    return true;
  }
  
  // We're not in the right chat anymore, re-open it
  snapLog(`Chat closed or switched, re-opening chat with ${expectedSender}`);
  
  try {
    chatElement.click();
    await sleep(1000); // Wait for chat to open
    
    const newSender = getCurrentSender();
    if (newSender === expectedSender) {
      snapLog(`Successfully re-opened chat with ${expectedSender}`);
      return true;
    } else {
      snapLog(`Failed to re-open correct chat. Expected: ${expectedSender}, Got: ${newSender}`);
      return false;
    }
  } catch (e) {
    snapLog(`Error re-opening chat: ${e}`);
    return false;
  }
}

/**
 * Click on a chat to open it
 */
async function openChat(chatElement: HTMLElement): Promise<boolean> {
  try {
    chatElement.click();
    snapLog('Clicked on chat to open');
    
    // Wait for conversation to load with multiple checks
    let attempts = 0;
    const maxAttempts = 5;
    
    while (attempts < maxAttempts) {
      await sleep(500);
      attempts++;
      
      // Check if we have a conversation loaded by looking for message container
      const messageContainer = findElement(SNAPCHAT_SELECTORS.messageContainer);
      const inputField = findElement(SNAPCHAT_SELECTORS.inputField);
      
      if (messageContainer && inputField) {
        snapLog(`Chat opened successfully after ${attempts * 500}ms`);
        return true;
      }
      
      if (attempts < maxAttempts) {
        snapLog(`Chat not fully loaded yet, waiting... (attempt ${attempts}/${maxAttempts})`);
      }
    }
    
    snapLog('Chat may not be fully loaded, but proceeding');
    return true;
  } catch (e) {
    snapLog(`Error opening chat: ${e}`);
    return false;
  }
}

/**
 * Type text into input field with human-like delays
 */
async function typeMessage(text: string): Promise<boolean> {
  let input = findElement(SNAPCHAT_SELECTORS.inputField);
  
  if (!input) {
    snapLog('Error: Input field not found');
    return false;
  }
  
  // Focus the input and ensure it stays focused
  input.focus();
  snapLog('Input field focused');
  
  // Clear existing content
  if (input.getAttribute('contenteditable') === 'true') {
    input.innerHTML = '';
    input.textContent = '';
  } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    input.value = '';
  }
  
  // Type character by character
  const typingDelay = config?.typingDelayRangeMs || [50, 150];
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // Re-find input field periodically to handle DOM changes
    if (i % 10 === 0) {
      const currentInput = findElement(SNAPCHAT_SELECTORS.inputField);
      if (currentInput && currentInput !== input) {
        input = currentInput;
        input.focus();
        snapLog('Re-focused input field during typing');
      }
    }
    
    // Ensure input is still focused
    if (document.activeElement !== input) {
      input.focus();
    }
    
    if (input.getAttribute('contenteditable') === 'true') {
      input.textContent = (input.textContent || '') + char;
    } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      input.value += char;
    }
    
    // Dispatch input event
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    
    // Random delay between characters
    const delay = Math.floor(Math.random() * (typingDelay[1] - typingDelay[0])) + typingDelay[0];
    await sleep(delay);
  }
  
  snapLog(`Typed message: "${text.substring(0, 30)}..."`);
  return true;
}

/**
 * Click the send button
 */
async function clickSend(): Promise<boolean> {
  let sendBtn = findElement(SNAPCHAT_SELECTORS.sendButton);
  
  if (!sendBtn) {
    // Try pressing Enter as fallback
    const input = findElement(SNAPCHAT_SELECTORS.inputField);
    if (input) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      snapLog('Sent via Enter key');
      
      // Wait a moment to see if message was sent
      await sleep(500);
      return true;
    }
    snapLog('Error: Send button not found and Enter fallback failed');
    return false;
  }
  
  // Ensure send button is clickable
  if (sendBtn.style.display === 'none' || sendBtn.style.visibility === 'hidden') {
    snapLog('Send button is hidden, trying Enter key instead');
    const input = findElement(SNAPCHAT_SELECTORS.inputField);
    if (input) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      snapLog('Sent via Enter key (hidden button)');
      await sleep(500);
      return true;
    }
  }
  
  try {
    sendBtn.click();
    snapLog('Send button clicked');
    
    // Wait a moment to ensure the message is sent
    await sleep(500);
    return true;
  } catch (e) {
    snapLog(`Error clicking send button: ${e}`);
    
    // Try Enter key as final fallback
    const input = findElement(SNAPCHAT_SELECTORS.inputField);
    if (input) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      snapLog('Sent via Enter key (click failed)');
      await sleep(500);
      return true;
    }
    
    return false;
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Match message against reply rules
 */
function findMatchingReply(messageText: string): string | null {
  const rules = config?.replyRules || [];
  
  for (const rule of rules) {
    const matchStr = typeof rule.match === 'string' ? rule.match : '';
    const text = rule.caseSensitive ? messageText : messageText.toLowerCase();
    const match = rule.caseSensitive ? matchStr : matchStr.toLowerCase();
    
    if (text.includes(match)) {
      snapLog(`Rule matched: "${matchStr}" -> "${rule.reply}"`);
      return rule.reply;
    }
  }
  
  return null;
}

/**
 * Generate a contextual reply based on conversation memory
 * Uses AI Brain via direct fetch to LLM server for intelligent responses
 */
async function generateContextualReply(sender: string, latestMessage: string): Promise<string | null> {
  // Use the comprehensive status/UI filter
  if (isStatusOrUIText(latestMessage)) {
    snapLog(`Skipping status/UI text: "${latestMessage}"`);
    return null;
  }
  
  // Skip very short messages that are likely UI elements or incomplete
  if (latestMessage.length < MIN_MESSAGE_LENGTH) {
    snapLog(`Skipping too short (${latestMessage.length} chars): "${latestMessage}"`);
    return null;
  }
  
  // Skip messages that look like partial/truncated text (preview snippets)
  if (latestMessage.endsWith('...') && latestMessage.length < 30) {
    snapLog(`Skipping truncated preview: "${latestMessage}"`);
    return null;
  }
  
  // First try rule-based matching (fast path)
  const ruleReply = findMatchingReply(latestMessage);
  if (ruleReply) return ruleReply;
  
  // Try AI if config has AI enabled
  const aiConfig = config?.ai;
  if (aiConfig?.enabled) {
    try {
      snapLog(`Requesting AI reply for: "${latestMessage.substring(0, 30)}..."`);
      
      // Build conversation context from memory
      const memory = getConversationMemory(sender);
      const messages: Array<{role: string; content: string}> = [];
      
      // Add system prompt
      messages.push({
        role: 'system',
        content: aiConfig.systemPrompt || 'You are a friendly person chatting casually. Keep responses brief and natural.'
      });
      
      // Add conversation history from memory
      if (aiConfig.contextHistoryEnabled && memory?.messages?.length) {
        const historyLimit = aiConfig.maxContextMessages || 10;
        const recentMsgs = memory.messages.slice(-historyLimit);
        recentMsgs.forEach(m => {
          messages.push({
            role: m.isIncoming ? 'user' : 'assistant',
            content: m.text
          });
        });
      }
      
      // Add current message
      messages.push({ role: 'user', content: latestMessage });
      
      // Call LLM server directly
      const url = `http://${aiConfig.llmEndpoint || 'localhost'}:${aiConfig.llmPort || 8080}/v1/chat/completions`;
      snapLog(`Calling AI at: ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), aiConfig.requestTimeoutMs || 30000);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: aiConfig.modelName || 'local-model',
          messages: messages,
          temperature: aiConfig.temperature || 0.7,
          max_tokens: aiConfig.maxTokens || 150
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        if (data.choices?.[0]?.message?.content) {
          const aiReply = data.choices[0].message.content.trim();
          snapLog(`AI reply received: "${aiReply.substring(0, 30)}..."`);
          return aiReply;
        }
      } else {
        snapLog(`AI request failed: HTTP ${response.status}`);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        snapLog('AI request timed out');
      } else {
        snapLog(`AI error: ${error.message}`);
      }
    }
    
    snapLog('AI returned no reply, falling back to defaults');
  }
  
  // Fallback to simple pattern matching if AI unavailable
  const memory = getConversationMemory(sender);
  const lowerMsg = latestMessage.toLowerCase();
  
  if (lowerMsg.includes('?')) {
    return "Let me think about that and get back to you!";
  }
  
  if (lowerMsg.includes('hi') || lowerMsg.includes('hey') || lowerMsg.includes('hello')) {
    return memory ? `Hey! Good to hear from you again!` : `Hey! What's up?`;
  }
  
  if (lowerMsg.includes('how are') || lowerMsg.includes("what's up") || lowerMsg.includes('whats up')) {
    return "I'm doing great, thanks for asking! How about you?";
  }
  
  if (lowerMsg.includes('thanks') || lowerMsg.includes('thank you')) {
    return "You're welcome! 😊";
  }
  
  if (lowerMsg.includes('bye') || lowerMsg.includes('later') || lowerMsg.includes('gtg')) {
    return "Talk to you later! 👋";
  }
  
  // No match - return null (don't reply to everything)
  return null;
}


// Senders to ignore (e.g., Snapchat AI, bots)
const IGNORED_SENDERS = [
  'my ai',
  'myai',
  'snapchat ai',
  'ai',
  'team snapchat'
];

/**
 * Check if a sender should be ignored
 */
function shouldIgnoreSender(sender: string): boolean {
  const normalized = sender.toLowerCase().trim();
  return IGNORED_SENDERS.some(ignored => normalized === ignored || normalized.includes(ignored));
}

/**
 * Process a single conversation
 */
async function processConversation(chatElement: HTMLElement): Promise<void> {
  // Open the chat
  const opened = await openChat(chatElement);
  if (!opened) return;
  
  // Get sender name
  const sender = getCurrentSender();
  snapLog(`Processing conversation with: ${sender}`);
  
  // Skip ignored senders (like Snapchat AI)
  if (shouldIgnoreSender(sender)) {
    snapLog(`Skipping ignored sender: ${sender}`);
    return;
  }
  
  // Get all messages and update memory
  const messages = getConversationMessages();
  snapLog(`Found ${messages.length} total messages in conversation`);
  
  // Log last few messages for debugging
  const lastFew = messages.slice(-3);
  lastFew.forEach((msg, idx) => {
    const direction = msg.isIncoming ? 'INCOMING' : 'OUTGOING';
    snapLog(`  [${idx}] ${direction}: "${msg.text.substring(0, 40)}..."`);
  });
  
  updateConversationMemory(sender, messages);
  
  // Get the latest incoming message
  const latestMessage = getLatestIncomingMessage();
  if (!latestMessage) {
    snapLog('No new incoming message to process');
    return;
  }
  
  // Generate message ID to avoid duplicates - use message content only, not timestamp
  // This ensures the same message always gets the same ID
  const msgId = `${sender}-${latestMessage.substring(0, 100)}`;
  snapLog(`Message ID: ${msgId.substring(0, 60)}...`);
  
  if (isMessageSeen(msgId)) {
    snapLog('Message already processed, skipping');
    return;
  }
  
  // Mark as seen immediately to prevent duplicate processing
  markMessageSeen(msgId);
  
  snapLog(`Latest message from ${sender}: "${latestMessage.substring(0, 50)}..."`);
  
  // Generate reply (now async with AI support)
  const reply = await generateContextualReply(sender, latestMessage);
  
  if (!reply) {
    snapLog('No reply generated (no matching rule or AI returned nothing)');
    return;
  }
  
  // Random skip check
  const skipProb = config?.randomSkipProbability || 0.15;
  if (Math.random() < skipProb) {
    snapLog(`Randomly skipping (${Math.round(skipProb * 100)}% chance)`);
    return;
  }
  
  // Pre-reply delay
  const preDelay = config?.preReplyDelayRangeMs || [2000, 6000];
  const delay = Math.floor(Math.random() * (preDelay[1] - preDelay[0])) + preDelay[0];
  snapLog(`Waiting ${delay}ms before replying...`);
  await sleep(delay);
  
  // Ensure we're still in the correct chat before typing
  await ensureChatIsOpen(chatElement, sender);
  
  // Type and send
  const typed = await typeMessage(reply);
  if (!typed) {
    snapLog('Failed to type message, ensuring chat is still open');
    await ensureChatIsOpen(chatElement, sender);
    return;
  }
  
  await sleep(500); // Brief pause before sending
  
  // Ensure we're still in the correct chat before sending
  await ensureChatIsOpen(chatElement, sender);
  
  const sent = await clickSend();
  if (sent) {
    snapLog(`✓ Reply sent to ${sender}: "${reply}"`);
    
    // Wait a moment to ensure message is fully sent before leaving
    await sleep(1000);
    
    // Navigate back to homepage instead of staying in chat
    await navigateToHomepage();
    
    // Mark our own reply as seen to avoid replying to it
    const botMsgId = `${sender}-${reply.substring(0, 100)}`;
    markMessageSeen(botMsgId);
    
    // Update memory with our reply
    const memory = getConversationMemory(sender);
    if (memory) {
      memory.messages.push({ text: reply, isIncoming: false, timestamp: Date.now() });
      memory.summary = generateConversationSummary(memory);
      conversationMemories.set(sender, memory);
    }
  }
}

/**
 * Main polling loop - checks for unread messages
 */
async function pollForMessages(): Promise<void> {
  if (!isRunning) return;
  
  // Skip if already processing a message
  if (isProcessing) {
    snapLog('Still processing previous message, skipping poll');
    return;
  }
  
  try {
    snapLog('Scanning for unread messages...');
    
    const unreadChats = findUnreadChats();
    
    if (unreadChats.length === 0) {
      snapLog('No unread messages found');
      return;
    }
    
    snapLog(`Found ${unreadChats.length} unread conversation(s)`);
    
    // Process each unread chat
    for (const chat of unreadChats) {
      if (!isRunning) break;
      
      // Set processing lock before starting
      isProcessing = true;
      
      try {
        await processConversation(chat);
      } finally {
        // Always release lock when done
        isProcessing = false;
      }
      
      // Wait between processing conversations
      await sleep(2000);
    }
  } catch (error) {
    isProcessing = false; // Release lock on error
    snapLog(`Error in poll loop: ${error}`);
  }
}

/**
 * Start the Snapchat bot
 */
function startSnapchatBot(): void {
  if (isRunning) {
    snapLog('Bot already running');
    return;
  }
  
  config = getConfig();
  isRunning = true;
  
  snapLog('🚀 Snapchat Bot started!');
  snapLog(`Config: ${config.replyRules.length} rules, skip ${Math.round((config.randomSkipProbability || 0.15) * 100)}%`);
  
  // Initial scan
  pollForMessages();
  
  // Set up polling interval (every 5 seconds)
  pollInterval = setInterval(() => {
    pollForMessages();
  }, 5000);
}

/**
 * Stop the Snapchat bot
 */
function stopSnapchatBot(): void {
  if (!isRunning) {
    snapLog('Bot not running');
    return;
  }
  
  isRunning = false;
  
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  
  snapLog('🛑 Snapchat Bot stopped');
}

/**
 * Check if bot is running
 */
function isSnapchatBotRunning(): boolean {
  return isRunning;
}

/**
 * Get all conversation memories (for debugging/display)
 */
function getAllMemories(): Map<string, ConversationMemory> {
  return conversationMemories;
}

/**
 * Debug function to inspect message classification
 * Call from console: window.__snapDebug()
 */
function debugMessageClassification(): void {
  snapLog('=== DEBUG: Message Classification ===');
  const bubbles = findAllElements(SNAPCHAT_SELECTORS.messageBubble);
  snapLog(`Total bubbles found: ${bubbles.length}`);

  bubbles.forEach((bubble, idx) => {
    const text = bubble.textContent?.trim() || '';

    // Collect all classes from bubble and parents
    let classList = bubble.className.toLowerCase();
    let currentElement: HTMLElement | null = bubble;
    for (let i = 0; i < 3 && currentElement?.parentElement; i++) {
      currentElement = currentElement.parentElement as HTMLElement;
      classList += ' ' + currentElement.className.toLowerCase();
    }

    // Check data attributes
    const dataAttrs = Array.from(bubble.attributes)
      .filter(attr => attr.name.startsWith('data-'))
      .map(attr => `${attr.name}=${attr.value}`.toLowerCase())
      .join(' ');

    // Get position info
    const rect = bubble.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const isOnLeft = rect.left < windowWidth / 2;
    const isOnRight = rect.right > windowWidth / 2;

    snapLog(`\n[${idx}] Text: "${text.substring(0, 50)}..."`);
    snapLog(`    Classes: ${classList.substring(0, 150)}...`);
    snapLog(`    Data attrs: ${dataAttrs || 'none'}`);
    snapLog(`    Position: left=${rect.left.toFixed(0)}px, right=${rect.right.toFixed(0)}px (window=${windowWidth}px)`);
    snapLog(`    Visual position: ${isOnLeft ? 'LEFT' : ''} ${isOnRight ? 'RIGHT' : ''}`);

    const isIncoming = classList.includes('received') || classList.includes('incoming') ||
                       classList.includes('other') || classList.includes('left');
    const isOutgoing = classList.includes('sent') || classList.includes('outgoing') ||
                       classList.includes('self') || classList.includes('right');

    snapLog(`    isIncoming: ${isIncoming}, isOutgoing: ${isOutgoing}`);
    snapLog(`    isStatusText: ${isStatusOrUIText(text)}`);
  });

  snapLog('\n=== END DEBUG ===');
  snapLog('Tip: Check the console for visual highlighting of messages');

  // Visually highlight messages for 5 seconds
  bubbles.forEach((bubble, idx) => {
    const originalBorder = bubble.style.border;
    const text = bubble.textContent?.trim() || '';
    let classList = bubble.className.toLowerCase();
    let currentElement: HTMLElement | null = bubble;
    for (let i = 0; i < 3 && currentElement?.parentElement; i++) {
      currentElement = currentElement.parentElement as HTMLElement;
      classList += ' ' + currentElement.className.toLowerCase();
    }

    const isIncoming = classList.includes('received') || classList.includes('incoming') ||
                       classList.includes('other') || classList.includes('left');
    const isOutgoing = classList.includes('sent') || classList.includes('outgoing') ||
                       classList.includes('self') || classList.includes('right');

    if (isStatusOrUIText(text)) {
      bubble.style.border = '3px solid orange'; // Status text
    } else if (isIncoming) {
      bubble.style.border = '3px solid green'; // Incoming
    } else if (isOutgoing) {
      bubble.style.border = '3px solid blue'; // Outgoing
    } else {
      bubble.style.border = '3px solid red'; // Unknown
    }

    setTimeout(() => {
      bubble.style.border = originalBorder;
    }, 5000);
  });

  console.log('%cColor codes: 🟢 Green=Incoming | 🔵 Blue=Outgoing | 🔴 Red=Unknown | 🟠 Orange=Status/UI', 'font-size: 14px; font-weight: bold;');
}

/**
 * Debug function to inspect chat list and unread detection
 * Call from console: window.__snapDebugChats()
 */
function debugChatList(): void {
  snapLog('=== DEBUG: Chat List Detection ===');
  const chatItems = findAllElements(SNAPCHAT_SELECTORS.chatListItem);
  snapLog(`Total chat items found: ${chatItems.length}`);

  chatItems.forEach((item, idx) => {
    const text = item.textContent?.trim().substring(0, 80) || '';
    const hasUnreadBadge = item.querySelector('[class*="unread"], [class*="Unread"], [class*="badge"], [class*="Badge"], [class*="dot"], [class*="Dot"]') !== null;
    const hasUnreadClass = item.className.toLowerCase().includes('unread');
    const isNew = isNewIncomingChat(item);

    snapLog(`\n[${idx}] Chat: "${text}"`);
    snapLog(`    Has unread badge: ${hasUnreadBadge}`);
    snapLog(`    Has unread class: ${hasUnreadClass}`);
    snapLog(`    Detected as new incoming: ${isNew}`);
    snapLog(`    Classes: ${item.className.substring(0, 100)}...`);

    // Visual highlight
    const originalBorder = item.style.border;
    item.style.border = isNew ? '3px solid lime' : '2px solid gray';
    setTimeout(() => {
      item.style.border = originalBorder;
    }, 5000);
  });

  const unreadChats = findUnreadChats();
  snapLog(`\n✓ Total unread chats detected: ${unreadChats.length}`);
  snapLog('=== END DEBUG ===');
  console.log('%c🟢 Lime border = New incoming chat detected | Gray border = No new messages', 'font-size: 14px; font-weight: bold;');
}

/**
 * Debug function to show all current selectors
 * Call from console: window.__snapSelectors()
 */
function debugSelectors(): void {
  console.log('=== SNAPCHAT SELECTORS ===');
  console.log(JSON.stringify(SNAPCHAT_SELECTORS, null, 2));
  console.log('\n=== TESTING SELECTORS ===');

  for (const [key, selector] of Object.entries(SNAPCHAT_SELECTORS)) {
    const elements = findAllElements(selector);
    console.log(`${key}: ${elements.length} elements found`);
    if (elements.length > 0 && elements.length < 5) {
      elements.forEach((el, i) => {
        console.log(`  [${i}] ${el.tagName} - "${el.textContent?.substring(0, 40)}..."`);
      });
    }
  }
  console.log('=== END SELECTORS ===');
}

// Expose debug functions to window
if (typeof window !== 'undefined') {
  (window as any).__snapDebug = debugMessageClassification;
  (window as any).__snapDebugChats = debugChatList;
  (window as any).__snapSelectors = debugSelectors;
}

/**
 * Export for use
 */
export {
  startSnapchatBot,
  stopSnapchatBot,
  isSnapchatBotRunning,
  getConversationMemory,
  getAllMemories,
  getCurrentSender,
  getConversationMessages,
  findUnreadChats,
  debugMessageClassification,
  SNAPCHAT_SELECTORS
};
