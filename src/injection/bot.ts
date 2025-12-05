/**
 * Injection Layer - DOM Automation Script
 * Runs inside web pages to monitor messages and simulate typing
 */

import { Configuration, IncomingMessage, DEFAULT_CONFIG } from '../types';

// Global state
let config: Configuration = DEFAULT_CONFIG;
let seenMessages: Set<string> = new Set();
let repliedMessages: Set<string> = new Set(); // Track messages we've already replied to
let isInitialized: boolean = false;
let currentSite: string = '';

/**
 * Log a message via the preload bridge
 */
function log(message: string): void {
  try {
    if (typeof window !== 'undefined' && (window as any).bot?.log) {
      (window as any).bot.log(message);
    } else {
      console.log('[Bot]', message);
    }
  } catch (error) {
    console.log('[Bot]', message);
  }
}

/**
 * Verify that document.body exists before proceeding
 */
function verifyDocumentBody(): boolean {
  if (!document || !document.body) {
    log('Error: document.body not available');
    return false;
  }
  return true;
}

/**
 * Identify the current site via location.hostname
 */
function identifySite(): string {
  try {
    currentSite = window.location.hostname;
    log(`Site identified: ${currentSite}`);
    return currentSite;
  } catch (error) {
    log('Error identifying site: ' + String(error));
    return '';
  }
}

/**
 * Load configuration from window global or use defaults
 */
function loadConfig(): Configuration {
  try {
    if (typeof window !== 'undefined' && (window as any).__SNAPPY_CONFIG__) {
      config = { ...DEFAULT_CONFIG, ...(window as any).__SNAPPY_CONFIG__ };
      log('Configuration loaded from window');
    } else {
      config = DEFAULT_CONFIG;
      log('Using default configuration');
    }
  } catch (error) {
    log('Error loading config: ' + String(error));
    config = DEFAULT_CONFIG;
  }
  return config;
}


/**
 * Check if a message has already been seen
 */
function isMessageSeen(messageId: string): boolean {
  return seenMessages.has(messageId);
}

/**
 * Mark a message as seen to prevent duplicate processing
 */
function markMessageSeen(messageId: string): void {
  seenMessages.add(messageId);
  
  // Limit set size to prevent memory growth
  if (seenMessages.size > 1000) {
    const entries = Array.from(seenMessages);
    seenMessages = new Set(entries.slice(-500));
  }
}

/**
 * Check if we've already replied to a message
 */
function hasRepliedToMessage(messageId: string): boolean {
  return repliedMessages.has(messageId);
}

/**
 * Mark a message as replied to prevent duplicate replies
 */
function markMessageReplied(messageId: string): void {
  repliedMessages.add(messageId);

  // Limit set size to prevent memory growth
  if (repliedMessages.size > 1000) {
    const entries = Array.from(repliedMessages);
    repliedMessages = new Set(entries.slice(-500));
  }
}

/**
 * Generate a unique message ID from message content
 * Note: We don't include timestamp to ensure the same message always gets the same ID,
 * preventing duplicate processing of the same message across multiple DOM mutations
 */
function generateMessageId(sender: string, text: string, timestamp: number): string {
  return `${sender}-${text.substring(0, 100)}`;
}

/**
 * Initialize the injection layer
 */
function initialize(): boolean {
  if (isInitialized) {
    log('Already initialized, skipping');
    return true;
  }

  log('Initializing Snappy Bot...');

  // Verify document.body exists
  if (!verifyDocumentBody()) {
    log('Initialization failed: document.body not available');
    return false;
  }

  // Identify the site
  identifySite();

  // Load configuration
  loadConfig();

  // Clear seen messages and replied messages
  seenMessages = new Set();
  repliedMessages = new Set();

  isInitialized = true;
  log('Snappy Bot initialized successfully');

  return true;
}

/**
 * Get current configuration
 */
function getConfig(): Configuration {
  return config;
}

/**
 * Get current site hostname
 */
function getCurrentSite(): string {
  return currentSite;
}

/**
 * Check if bot is initialized
 */
function isReady(): boolean {
  return isInitialized;
}

// Export functions for use by other modules
export {
  initialize,
  log,
  verifyDocumentBody,
  identifySite,
  loadConfig,
  isMessageSeen,
  markMessageSeen,
  hasRepliedToMessage,
  markMessageReplied,
  generateMessageId,
  getConfig,
  getCurrentSite,
  isReady,
  seenMessages,
  repliedMessages,
  config
};
