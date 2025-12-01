/**
 * Site Strategy System
 * Provides site-specific DOM selectors and parsing methods
 */

import { SiteStrategy, SiteSelectors } from '../types';
import { log } from './bot';

/**
 * Universal strategy with generic heuristics
 */
const universalStrategy: SiteStrategy = {
  name: 'universal',
  hostPatterns: ['*'],
  selectors: {
    messageContainer: '[class*="message"], [class*="chat"], [class*="conversation"]',
    messageBubble: '[class*="message"], [class*="bubble"]',
    incomingMessageClass: 'incoming,received,other,left',
    outgoingMessageClass: 'outgoing,sent,self,right,mine',
    inputField: [
      '[contenteditable="true"]',
      'textarea[class*="message"]',
      'textarea[class*="input"]',
      'textarea',
      'input[type="text"]'
    ],
    sendButton: [
      '[data-testid="send-button"]',
      '[data-testid*="send"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      'button[class*="send"]'
    ]
  }
};

/**
 * Snapchat Web strategy
 */
const snapchatStrategy: SiteStrategy = {
  name: 'snapchat',
  hostPatterns: ['web.snapchat.com', 'snapchat.com'],
  selectors: {
    messageContainer: '[class*="ConversationView"], [class*="MessageList"]',
    messageBubble: '[class*="Message"], [class*="ChatMessage"]',
    incomingMessageClass: 'received,incoming,other',
    outgoingMessageClass: 'sent,outgoing,self',
    inputField: [
      '[contenteditable="true"]',
      'textarea[class*="input"]',
      '[class*="MessageInput"] textarea'
    ],
    sendButton: [
      'button[aria-label*="Send"]',
      '[class*="SendButton"]',
      'button[type="submit"]'
    ]
  }
};

/**
 * Twitter/X strategy
 */
const twitterStrategy: SiteStrategy = {
  name: 'twitter',
  hostPatterns: ['twitter.com', 'x.com'],
  selectors: {
    messageContainer: '[data-testid="DmScrollerContainer"]',
    messageBubble: '[data-testid="messageEntry"]',
    incomingMessageClass: 'received',
    outgoingMessageClass: 'sent',
    inputField: [
      '[data-testid="dmComposerTextInput"]',
      '[contenteditable="true"]'
    ],
    sendButton: [
      '[data-testid="dmComposerSendButton"]',
      'button[aria-label*="Send"]'
    ]
  }
};

/**
 * All available strategies
 */
const strategies: SiteStrategy[] = [
  snapchatStrategy,
  twitterStrategy,
  universalStrategy
];

let currentStrategy: SiteStrategy = universalStrategy;
let siteMode: 'universal' | 'snapchat' | 'twitter' = 'universal';


/**
 * Detect site from hostname and return matching strategy
 */
function detectSiteStrategy(hostname: string): SiteStrategy {
  for (const strategy of strategies) {
    if (strategy.name === 'universal') continue;
    
    for (const pattern of strategy.hostPatterns) {
      if (hostname.includes(pattern) || pattern.includes(hostname)) {
        log(`Site detected: ${strategy.name} (${hostname})`);
        return strategy;
      }
    }
  }
  
  log(`No specific strategy for ${hostname}, using universal`);
  return universalStrategy;
}

/**
 * Set the site mode and select appropriate strategy
 */
function setSiteMode(mode: 'universal' | 'snapchat' | 'twitter', hostname?: string): void {
  siteMode = mode;
  
  if (mode === 'universal' && hostname) {
    // Auto-detect based on hostname
    currentStrategy = detectSiteStrategy(hostname);
  } else if (mode === 'snapchat') {
    currentStrategy = snapchatStrategy;
  } else if (mode === 'twitter') {
    currentStrategy = twitterStrategy;
  } else {
    currentStrategy = universalStrategy;
  }
  
  log(`Site mode set to: ${currentStrategy.name}`);
}

/**
 * Get current strategy
 */
function getCurrentStrategy(): SiteStrategy {
  return currentStrategy;
}

/**
 * Get selectors from current strategy
 */
function getSelectors(): SiteSelectors {
  return currentStrategy.selectors;
}

/**
 * Try to find element using strategy selectors with fallback
 */
function findElementWithFallback(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector) as HTMLElement;
      if (element) {
        return element;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }
  
  // Fallback to universal selectors
  if (currentStrategy.name !== 'universal') {
    log('Falling back to universal selectors');
    for (const selector of universalStrategy.selectors.inputField) {
      try {
        const element = document.querySelector(selector) as HTMLElement;
        if (element) {
          return element;
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }
  }
  
  return null;
}

/**
 * Find input field using current strategy
 */
function findInputField(): HTMLElement | null {
  return findElementWithFallback(currentStrategy.selectors.inputField);
}

/**
 * Find send button using current strategy
 */
function findSendButton(): HTMLElement | null {
  return findElementWithFallback(currentStrategy.selectors.sendButton);
}

/**
 * Find message container using current strategy
 */
function findMessageContainer(): HTMLElement | null {
  try {
    return document.querySelector(currentStrategy.selectors.messageContainer) as HTMLElement;
  } catch (e) {
    return null;
  }
}

export {
  setSiteMode,
  getCurrentStrategy,
  getSelectors,
  detectSiteStrategy,
  findInputField,
  findSendButton,
  findMessageContainer,
  findElementWithFallback,
  universalStrategy,
  snapchatStrategy,
  twitterStrategy,
  strategies
};
