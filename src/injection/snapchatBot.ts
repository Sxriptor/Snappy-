/**
 * Snapchat-Specific Bot Implementation
 * Handles Snapchat Web's unique DOM structure with conversation memory
 */

import { log, getConfig, markMessageSeen, isMessageSeen, generateMessageId } from './bot';
import { Configuration } from '../types';

// Conversation memory - stores summaries per user
interface ConversationMemory {
  sender: string;
  messages: { text: string; timestamp: number; isIncoming: boolean }[];
  summary: string;
  lastUpdated: number;
}

const conversationMemories: Map<string, ConversationMemory> = new Map();

// Snapchat-specific selectors (updated for current Snapchat Web)
const SNAPCHAT_SELECTORS = {
  // Chat list items (conversations in sidebar)
  chatListItem: '[class*="ChatListItem"], [class*="conversationListItem"], [data-testid*="conversation"]',
  chatListContainer: '[class*="ChatList"], [class*="conversationList"]',
  
  // Unread indicator
  unreadBadge: '[class*="unread"], [class*="Unread"], [class*="badge"], [class*="Badge"]',
  
  // Active conversation
  messageContainer: '[class*="MessageList"], [class*="messageList"], [class*="ChatMessages"]',
  messageBubble: '[class*="Message"], [class*="message"], [class*="ChatMessage"]',
  messageText: '[class*="MessageContent"], [class*="messageContent"], [class*="text"]',
  
  // Sender info
  senderName: '[class*="FriendName"], [class*="friendName"], [class*="Username"], [class*="username"]',
  conversationHeader: '[class*="ConversationHeader"], [class*="chatHeader"]',
  
  // Input and send
  inputField: '[contenteditable="true"], textarea[class*="Input"], textarea[class*="input"], [class*="MessageInput"] textarea',
  sendButton: 'button[class*="Send"], button[aria-label*="Send"], [class*="sendButton"]',
  
  // Incoming vs outgoing
  incomingMessage: '[class*="received"], [class*="Received"], [class*="incoming"], [class*="other"]',
  outgoingMessage: '[class*="sent"], [class*="Sent"], [class*="outgoing"], [class*="self"]'
};

let isRunning = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let config: Configuration;

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
 * Get current conversation's sender name
 */
function getCurrentSender(): string {
  // Try to get from conversation header
  const header = findElement(SNAPCHAT_SELECTORS.conversationHeader);
  if (header) {
    const nameEl = header.querySelector(SNAPCHAT_SELECTORS.senderName.split(', ').join(', '));
    if (nameEl?.textContent) {
      return nameEl.textContent.trim();
    }
  }
  
  // Fallback: look for any visible username
  const nameEl = findElement(SNAPCHAT_SELECTORS.senderName);
  if (nameEl?.textContent) {
    return nameEl.textContent.trim();
  }
  
  return 'Unknown';
}

/**
 * Get all messages in current conversation
 */
function getConversationMessages(): { text: string; isIncoming: boolean }[] {
  const messages: { text: string; isIncoming: boolean }[] = [];
  const bubbles = findAllElements(SNAPCHAT_SELECTORS.messageBubble);
  
  for (const bubble of bubbles) {
    const text = bubble.textContent?.trim();
    if (!text || text.length < 1) continue;
    
    // Determine if incoming or outgoing
    const classList = bubble.className.toLowerCase() + ' ' + (bubble.parentElement?.className.toLowerCase() || '');
    const isIncoming = classList.includes('received') || classList.includes('incoming') || 
                       classList.includes('other') || classList.includes('left');
    const isOutgoing = classList.includes('sent') || classList.includes('outgoing') || 
                       classList.includes('self') || classList.includes('right');
    
    // If we can't determine, skip
    if (!isIncoming && !isOutgoing) continue;
    
    messages.push({ text, isIncoming });
  }
  
  return messages;
}

/**
 * Get the latest incoming message
 */
function getLatestIncomingMessage(): string | null {
  const messages = getConversationMessages();
  
  // Find the last incoming message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].isIncoming) {
      return messages[i].text;
    }
  }
  
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
  
  // Add new messages
  const now = Date.now();
  for (const msg of messages) {
    memory.messages.push({ ...msg, timestamp: now });
  }
  
  // Keep only last 50 messages
  if (memory.messages.length > 50) {
    memory.messages = memory.messages.slice(-50);
  }
  
  // Update summary
  memory.summary = generateConversationSummary(memory);
  memory.lastUpdated = now;
  
  conversationMemories.set(sender, memory);
  snapLog(`Memory updated for ${sender}: ${memory.summary}`);
}

/**
 * Get memory for a sender
 */
function getConversationMemory(sender: string): ConversationMemory | null {
  return conversationMemories.get(sender) || null;
}


/**
 * Find chats with unread messages
 */
function findUnreadChats(): HTMLElement[] {
  const chatItems = findAllElements(SNAPCHAT_SELECTORS.chatListItem);
  const unreadChats: HTMLElement[] = [];
  
  for (const item of chatItems) {
    // Check for unread indicator
    const hasUnread = item.querySelector(SNAPCHAT_SELECTORS.unreadBadge.split(', ').join(', ')) ||
                      item.className.toLowerCase().includes('unread');
    
    if (hasUnread) {
      unreadChats.push(item);
    }
  }
  
  return unreadChats;
}

/**
 * Click on a chat to open it
 */
async function openChat(chatElement: HTMLElement): Promise<boolean> {
  try {
    chatElement.click();
    snapLog('Clicked on chat to open');
    
    // Wait for conversation to load
    await sleep(1500);
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
  const input = findElement(SNAPCHAT_SELECTORS.inputField);
  
  if (!input) {
    snapLog('Error: Input field not found');
    return false;
  }
  
  // Focus the input
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
  const sendBtn = findElement(SNAPCHAT_SELECTORS.sendButton);
  
  if (!sendBtn) {
    // Try pressing Enter as fallback
    const input = findElement(SNAPCHAT_SELECTORS.inputField);
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      snapLog('Sent via Enter key');
      return true;
    }
    snapLog('Error: Send button not found');
    return false;
  }
  
  sendBtn.click();
  snapLog('Send button clicked');
  return true;
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
 */
function generateContextualReply(sender: string, latestMessage: string): string | null {
  // First try rule-based matching
  const ruleReply = findMatchingReply(latestMessage);
  if (ruleReply) return ruleReply;
  
  // Get conversation memory for context
  const memory = getConversationMemory(sender);
  
  // Default responses based on message patterns
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
  
  // Get all messages and update memory
  const messages = getConversationMessages();
  updateConversationMemory(sender, messages);
  
  // Get the latest incoming message
  const latestMessage = getLatestIncomingMessage();
  if (!latestMessage) {
    snapLog('No incoming message found');
    return;
  }
  
  // Generate message ID to avoid duplicates
  const msgId = generateMessageId(sender, latestMessage, Date.now());
  if (isMessageSeen(msgId)) {
    snapLog('Message already processed, skipping');
    return;
  }
  
  snapLog(`Latest message from ${sender}: "${latestMessage.substring(0, 50)}..."`);
  
  // Generate reply
  const reply = generateContextualReply(sender, latestMessage);
  
  if (!reply) {
    snapLog('No matching reply rule, skipping');
    markMessageSeen(msgId);
    return;
  }
  
  // Random skip check
  const skipProb = config?.randomSkipProbability || 0.15;
  if (Math.random() < skipProb) {
    snapLog(`Randomly skipping (${Math.round(skipProb * 100)}% chance)`);
    markMessageSeen(msgId);
    return;
  }
  
  // Pre-reply delay
  const preDelay = config?.preReplyDelayRangeMs || [2000, 6000];
  const delay = Math.floor(Math.random() * (preDelay[1] - preDelay[0])) + preDelay[0];
  snapLog(`Waiting ${delay}ms before replying...`);
  await sleep(delay);
  
  // Type and send
  const typed = await typeMessage(reply);
  if (!typed) return;
  
  await sleep(500); // Brief pause before sending
  
  const sent = await clickSend();
  if (sent) {
    snapLog(`✓ Reply sent to ${sender}: "${reply}"`);
    markMessageSeen(msgId);
    
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
      
      await processConversation(chat);
      
      // Wait between processing conversations
      await sleep(2000);
    }
  } catch (error) {
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
  SNAPCHAT_SELECTORS
};
