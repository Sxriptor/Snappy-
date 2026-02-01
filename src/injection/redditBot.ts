/**
 * Enhanced Reddit Bot Implementation
 * Handles notifications, subreddit monitoring, and private messages
 */

import { log, getConfig, markMessageSeen, isMessageSeen } from './bot';
import { Configuration } from '../types';

// Reddit-specific configuration interface
interface RedditSettings {
  watchNotifications: boolean;
  watchSubreddits: string[];
  watchPrivateMessages: boolean;
  pollIntervalMs: number;
  maxItemsPerPoll: number;
  autoReplyToComments: boolean;
  autoReplyToPMs: boolean;
  subredditKeywords: string[];
}

// Reddit selectors for different page types
const REDDIT_SELECTORS = {
  // Notifications
  notificationBell: '[data-testid="notification-bell"], .icon-notification',
  notificationDropdown: '[data-testid="notification-dropdown"], .Dropdown__content',
  notificationItems: '[data-testid="notification-item"], .notification-item',
  unreadNotification: '.unread, [data-is-unread="true"]',
  
  // Messages/Chat
  messageIcon: '[data-testid="chat-button"], .icon-message',
  messagesList: '[data-testid="messages-list"], .messages-list',
  messageItem: '[data-testid="message-item"], .message-item',
  unreadMessage: '.unread, [data-unread="true"]',
  
  // Comments and Posts
  commentReply: '[data-testid="comment-reply-button"], .reply-button',
  commentText: '[data-testid="comment-content"], .comment-content, .md',
  postTitle: '[data-testid="post-title"], .title',
  postContent: '[data-testid="post-content"], .post-content',
  
  // Subreddit navigation
  subredditLink: 'a[href*="/r/"]',
  
  // Input fields
  replyInput: '[data-testid="reply-input"], textarea[name="text"], .reply-form textarea',
  messageInput: '[data-testid="message-input"], .message-compose textarea',
  
  // Submit buttons
  submitButton: '[data-testid="submit-button"], button[type="submit"], .submit-button'
};

let isRunning = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let config: Configuration;
let redditSettings: RedditSettings;
let isProcessing = false;

// Memory for tracking processed items
const processedItems = new Set<string>();

/**
 * Log with Reddit-specific formatting
 */
function redditLog(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  const formatted = `[${timestamp}] [Reddit] ${message}`;
  log(formatted);
  
  console.log('%c' + formatted, 'color: #FF4500; background: #000; padding: 2px 5px;');
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
 * Check if we're on a specific Reddit page type
 */
function getPageType(): 'notifications' | 'messages' | 'subreddit' | 'post' | 'unknown' {
  const url = window.location.href;
  
  if (url.includes('/message/')) return 'messages';
  if (url.includes('/notifications/')) return 'notifications';
  if (url.includes('/r/') && url.includes('/comments/')) return 'post';
  if (url.includes('/r/')) return 'subreddit';
  
  return 'unknown';
}

/**
 * Navigate to notifications page
 */
async function navigateToNotifications(): Promise<boolean> {
  try {
    const notificationBell = findElement(REDDIT_SELECTORS.notificationBell);
    if (notificationBell) {
      notificationBell.click();
      await sleep(1500);
      return true;
    }
    
    // Fallback: direct navigation
    if (!window.location.href.includes('/notifications/')) {
      window.location.href = 'https://www.reddit.com/notifications/';
      await sleep(2000);
      return true;
    }
    
    return true;
  } catch (e) {
    redditLog(`Error navigating to notifications: ${e}`);
    return false;
  }
}

/**
 * Navigate to messages page
 */
async function navigateToMessages(): Promise<boolean> {
  try {
    const messageIcon = findElement(REDDIT_SELECTORS.messageIcon);
    if (messageIcon) {
      messageIcon.click();
      await sleep(1500);
      return true;
    }
    
    // Fallback: direct navigation
    if (!window.location.href.includes('/message/')) {
      window.location.href = 'https://www.reddit.com/message/inbox/';
      await sleep(2000);
      return true;
    }
    
    return true;
  } catch (e) {
    redditLog(`Error navigating to messages: ${e}`);
    return false;
  }
}

/**
 * Navigate to a specific subreddit
 */
async function navigateToSubreddit(subreddit: string): Promise<boolean> {
  try {
    const cleanSubreddit = subreddit.replace(/^r\//, '');
    const url = `https://www.reddit.com/r/${cleanSubreddit}/new/`;
    
    if (!window.location.href.includes(`/r/${cleanSubreddit}`)) {
      window.location.href = url;
      await sleep(2000);
      return true;
    }
    
    return true;
  } catch (e) {
    redditLog(`Error navigating to r/${subreddit}: ${e}`);
    return false;
  }
}

/**
 * Find unread notifications
 */
function findUnreadNotifications(): HTMLElement[] {
  const notifications = findAllElements(REDDIT_SELECTORS.notificationItems);
  return notifications.filter(item => {
    const isUnread = item.querySelector(REDDIT_SELECTORS.unreadNotification) !== null;
    const itemId = generateItemId(item, 'notification');
    return isUnread && !processedItems.has(itemId);
  });
}

/**
 * Find unread private messages
 */
function findUnreadMessages(): HTMLElement[] {
  const messages = findAllElements(REDDIT_SELECTORS.messageItem);
  return messages.filter(item => {
    const isUnread = item.querySelector(REDDIT_SELECTORS.unreadMessage) !== null;
    const itemId = generateItemId(item, 'message');
    return isUnread && !processedItems.has(itemId);
  });
}

/**
 * Find new posts in subreddit that match keywords
 */
function findRelevantPosts(): HTMLElement[] {
  const posts: HTMLElement[] = [];
  
  // Look for post elements
  const postElements = document.querySelectorAll('[data-testid="post-container"], .Post, article');
  
  postElements.forEach(post => {
    const titleEl = post.querySelector(REDDIT_SELECTORS.postTitle);
    const contentEl = post.querySelector(REDDIT_SELECTORS.postContent);
    
    const title = titleEl?.textContent?.toLowerCase() || '';
    const content = contentEl?.textContent?.toLowerCase() || '';
    const fullText = title + ' ' + content;
    
    // Check if post matches any keywords
    const matchesKeywords = redditSettings.subredditKeywords.some(keyword => 
      fullText.includes(keyword.toLowerCase())
    );
    
    if (matchesKeywords) {
      const itemId = generateItemId(post as HTMLElement, 'post');
      if (!processedItems.has(itemId)) {
        posts.push(post as HTMLElement);
      }
    }
  });
  
  return posts;
}

/**
 * Generate unique ID for tracking processed items
 */
function generateItemId(element: HTMLElement, type: string): string {
  const text = element.textContent?.substring(0, 100) || '';
  const timestamp = Date.now();
  return `${type}-${btoa(text).substring(0, 20)}-${timestamp}`;
}

/**
 * Extract text content from Reddit elements
 */
function extractTextContent(element: HTMLElement): string {
  // Try comment content first
  const commentEl = element.querySelector(REDDIT_SELECTORS.commentText);
  if (commentEl) {
    return commentEl.textContent?.trim() || '';
  }
  
  // Try post title/content
  const titleEl = element.querySelector(REDDIT_SELECTORS.postTitle);
  const contentEl = element.querySelector(REDDIT_SELECTORS.postContent);
  
  const title = titleEl?.textContent?.trim() || '';
  const content = contentEl?.textContent?.trim() || '';
  
  return title || content || element.textContent?.trim() || '';
}

/**
 * Generate reply using rules or AI
 */
async function generateReply(text: string, context: 'notification' | 'message' | 'post'): Promise<string | null> {
  // First try rule-based matching
  const rules = config?.replyRules || [];
  const lowerText = text.toLowerCase();
  
  for (const rule of rules) {
    const matchStr = typeof rule.match === 'string' ? rule.match : '';
    const match = rule.caseSensitive ? matchStr : matchStr.toLowerCase();
    const target = rule.caseSensitive ? text : lowerText;
    
    if (match && target.includes(match)) {
      redditLog(`Rule matched: "${matchStr}" -> "${rule.reply}"`);
      return rule.reply;
    }
  }
  
  // Try AI if enabled
  const aiConfig = config?.ai;
  if (aiConfig?.enabled) {
    try {
      const contextPrompts = {
        notification: 'You are responding to a Reddit notification. Keep it brief and relevant.',
        message: 'You are responding to a Reddit private message. Be helpful and conversational.',
        post: 'You are commenting on a Reddit post. Add value to the discussion.'
      };
      
      const messages = [
        { role: 'system', content: aiConfig.systemPrompt || contextPrompts[context] },
        { role: 'user', content: text }
      ];
      
      const url = `http://${aiConfig.llmEndpoint || 'localhost'}:${aiConfig.llmPort || 8080}/v1/chat/completions`;
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
        const aiReply = data.choices?.[0]?.message?.content?.trim();
        if (aiReply) {
          redditLog(`AI reply generated for ${context}`);
          return aiReply;
        }
      }
    } catch (error: any) {
      redditLog(`AI error: ${error.message}`);
    }
  }
  
  // Fallback responses based on context
  const fallbacks = {
    notification: "Thanks for the notification!",
    message: "Thanks for reaching out! I'll get back to you soon.",
    post: "Interesting post, thanks for sharing!"
  };
  
  return fallbacks[context];
}

/**
 * Type and submit reply
 */
async function typeAndSubmitReply(text: string, inputSelector: string): Promise<boolean> {
  try {
    const input = findElement(inputSelector);
    if (!input) {
      redditLog('Reply input not found');
      return false;
    }
    
    // Focus and clear input
    input.focus();
    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = '';
      input.textContent = '';
    } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      input.value = '';
    }
    
    await sleep(200);
    
    // Type character by character
    const typingDelay = config?.typingDelayRangeMs || [50, 150];
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      if (input.getAttribute('contenteditable') === 'true') {
        input.textContent = (input.textContent || '') + char;
      } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        input.value += char;
      }
      
      // Dispatch events
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      
      const delay = Math.floor(Math.random() * (typingDelay[1] - typingDelay[0])) + typingDelay[0];
      await sleep(delay);
    }
    
    await sleep(500);
    
    // Find and click submit button
    const submitBtn = findElement(REDDIT_SELECTORS.submitButton);
    if (submitBtn) {
      submitBtn.click();
      redditLog(`Reply submitted: "${text.substring(0, 50)}..."`);
      return true;
    } else {
      // Try Enter key as fallback
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      redditLog(`Reply submitted via Enter: "${text.substring(0, 50)}..."`);
      return true;
    }
  } catch (e) {
    redditLog(`Error submitting reply: ${e}`);
    return false;
  }
}

/**
 * Process a notification
 */
async function processNotification(notification: HTMLElement): Promise<void> {
  try {
    const itemId = generateItemId(notification, 'notification');
    const text = extractTextContent(notification);
    
    if (!text || text.length < 3) {
      redditLog('Notification text too short, skipping');
      processedItems.add(itemId);
      return;
    }
    
    redditLog(`Processing notification: "${text.substring(0, 50)}..."`);
    
    // Click on notification to open it
    notification.click();
    await sleep(1500);
    
    if (redditSettings.autoReplyToComments) {
      const reply = await generateReply(text, 'notification');
      if (reply) {
        const success = await typeAndSubmitReply(reply, REDDIT_SELECTORS.replyInput);
        if (success) {
          redditLog(`✓ Replied to notification: "${reply}"`);
        }
      }
    }
    
    processedItems.add(itemId);
  } catch (e) {
    redditLog(`Error processing notification: ${e}`);
  }
}

/**
 * Process a private message
 */
async function processMessage(message: HTMLElement): Promise<void> {
  try {
    const itemId = generateItemId(message, 'message');
    const text = extractTextContent(message);
    
    if (!text || text.length < 3) {
      redditLog('Message text too short, skipping');
      processedItems.add(itemId);
      return;
    }
    
    redditLog(`Processing message: "${text.substring(0, 50)}..."`);
    
    // Click on message to open it
    message.click();
    await sleep(1500);
    
    if (redditSettings.autoReplyToPMs) {
      const reply = await generateReply(text, 'message');
      if (reply) {
        const success = await typeAndSubmitReply(reply, REDDIT_SELECTORS.messageInput);
        if (success) {
          redditLog(`✓ Replied to message: "${reply}"`);
        }
      }
    }
    
    processedItems.add(itemId);
  } catch (e) {
    redditLog(`Error processing message: ${e}`);
  }
}

/**
 * Process a relevant post
 */
async function processPost(post: HTMLElement): Promise<void> {
  try {
    const itemId = generateItemId(post, 'post');
    const text = extractTextContent(post);
    
    if (!text || text.length < 10) {
      redditLog('Post text too short, skipping');
      processedItems.add(itemId);
      return;
    }
    
    redditLog(`Processing post: "${text.substring(0, 50)}..."`);
    
    // Click on post to open it
    post.click();
    await sleep(2000);
    
    const reply = await generateReply(text, 'post');
    if (reply) {
      const success = await typeAndSubmitReply(reply, REDDIT_SELECTORS.replyInput);
      if (success) {
        redditLog(`✓ Commented on post: "${reply}"`);
      }
    }
    
    processedItems.add(itemId);
  } catch (e) {
    redditLog(`Error processing post: ${e}`);
  }
}

/**
 * Main polling function
 */
async function pollForActivity(): Promise<void> {
  if (!isRunning || isProcessing) return;
  
  isProcessing = true;
  
  try {
    redditLog('Scanning for Reddit activity...');
    
    // Check notifications
    if (redditSettings.watchNotifications) {
      await navigateToNotifications();
      const notifications = findUnreadNotifications();
      
      if (notifications.length > 0) {
        redditLog(`Found ${notifications.length} unread notification(s)`);
        const toProcess = notifications.slice(0, redditSettings.maxItemsPerPoll);
        
        for (const notification of toProcess) {
          if (!isRunning) break;
          await processNotification(notification);
          await sleep(2000);
        }
      }
    }
    
    // Check private messages
    if (redditSettings.watchPrivateMessages) {
      await navigateToMessages();
      const messages = findUnreadMessages();
      
      if (messages.length > 0) {
        redditLog(`Found ${messages.length} unread message(s)`);
        const toProcess = messages.slice(0, redditSettings.maxItemsPerPoll);
        
        for (const message of toProcess) {
          if (!isRunning) break;
          await processMessage(message);
          await sleep(2000);
        }
      }
    }
    
    // Check subreddits for relevant posts
    if (redditSettings.watchSubreddits.length > 0) {
      for (const subreddit of redditSettings.watchSubreddits) {
        if (!isRunning) break;
        
        await navigateToSubreddit(subreddit);
        const posts = findRelevantPosts();
        
        if (posts.length > 0) {
          redditLog(`Found ${posts.length} relevant post(s) in r/${subreddit}`);
          const toProcess = posts.slice(0, Math.ceil(redditSettings.maxItemsPerPoll / redditSettings.watchSubreddits.length));
          
          for (const post of toProcess) {
            if (!isRunning) break;
            await processPost(post);
            await sleep(3000);
          }
        }
        
        await sleep(1000);
      }
    }
    
  } catch (error) {
    redditLog(`Error in poll loop: ${error}`);
  } finally {
    isProcessing = false;
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start the Reddit bot
 */
function startRedditBot(): void {
  if (isRunning) {
    redditLog('Bot already running');
    return;
  }
  
  config = getConfig();
  
  // Load Reddit-specific settings (with defaults)
  redditSettings = {
    watchNotifications: true,
    watchSubreddits: [],
    watchPrivateMessages: true,
    pollIntervalMs: 30000, // 30 seconds
    maxItemsPerPoll: 3,
    autoReplyToComments: true,
    autoReplyToPMs: true,
    subredditKeywords: [],
    ...(config as any).reddit // Override with actual settings
  };
  
  isRunning = true;
  
  redditLog('🚀 Reddit Bot started!');
  redditLog(`Watching: ${redditSettings.watchNotifications ? 'notifications' : ''} ${redditSettings.watchPrivateMessages ? 'messages' : ''} ${redditSettings.watchSubreddits.length} subreddits`);
  
  // Initial scan
  pollForActivity();
  
  // Set up polling interval
  pollInterval = setInterval(() => {
    pollForActivity();
  }, redditSettings.pollIntervalMs);
}

/**
 * Stop the Reddit bot
 */
function stopRedditBot(): void {
  if (!isRunning) {
    redditLog('Bot not running');
    return;
  }
  
  isRunning = false;
  
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  
  redditLog('🛑 Reddit Bot stopped');
}

/**
 * Check if bot is running
 */
function isRedditBotRunning(): boolean {
  return isRunning;
}

/**
 * Get current Reddit settings
 */
function getRedditSettings(): RedditSettings {
  return redditSettings;
}

/**
 * Update Reddit settings
 */
function updateRedditSettings(newSettings: Partial<RedditSettings>): void {
  redditSettings = { ...redditSettings, ...newSettings };
  redditLog('Settings updated');
}

export {
  startRedditBot,
  stopRedditBot,
  isRedditBotRunning,
  getRedditSettings,
  updateRedditSettings,
  RedditSettings,
  REDDIT_SELECTORS
};