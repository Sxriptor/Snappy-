/**
 * Message Detection and Parsing
 */

import { IncomingMessage } from '../types';
import { log, isMessageSeen, markMessageSeen, generateMessageId } from './bot';

/**
 * Generic selectors for message detection (universal mode)
 */
const UNIVERSAL_SELECTORS = {
  messageBubbles: [
    '[class*="message"]',
    '[class*="chat"]',
    '[class*="bubble"]',
    '[data-testid*="message"]'
  ],
  incomingIndicators: [
    '[class*="incoming"]',
    '[class*="received"]',
    '[class*="other"]',
    '[class*="left"]'
  ],
  outgoingIndicators: [
    '[class*="outgoing"]',
    '[class*="sent"]',
    '[class*="self"]',
    '[class*="right"]',
    '[class*="mine"]'
  ]
};

/**
 * Detect new message bubble elements from DOM mutations
 */
function detectNewMessages(mutations: MutationRecord[]): Element[] {
  const newElements: Element[] = [];
  
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          // Check if the node itself is a message
          if (isMessageElement(node)) {
            newElements.push(node);
          }
          // Check children for messages
          const childMessages = findMessageElements(node);
          newElements.push(...childMessages);
        }
      });
    }
  }
  
  return newElements;
}

/**
 * Check if an element looks like a message bubble
 */
function isMessageElement(element: Element): boolean {
  const className = element.className?.toLowerCase() || '';
  const testId = element.getAttribute('data-testid')?.toLowerCase() || '';
  
  return UNIVERSAL_SELECTORS.messageBubbles.some(selector => {
    const keyword = selector.replace(/[\[\]*="]/g, '').replace('class', '');
    return className.includes(keyword) || testId.includes(keyword);
  });
}

/**
 * Find message elements within a container
 */
function findMessageElements(container: Element): Element[] {
  const messages: Element[] = [];
  
  for (const selector of UNIVERSAL_SELECTORS.messageBubbles) {
    try {
      const elements = container.querySelectorAll(selector);
      elements.forEach(el => messages.push(el));
    } catch (e) {
      // Invalid selector, skip
    }
  }
  
  return messages;
}


/**
 * Classify a message as incoming or outgoing
 */
function classifyMessage(element: Element): 'incoming' | 'outgoing' | 'unknown' {
  const className = element.className?.toLowerCase() || '';
  const parentClassName = element.parentElement?.className?.toLowerCase() || '';
  const combined = className + ' ' + parentClassName;
  
  // Check for outgoing indicators first
  for (const selector of UNIVERSAL_SELECTORS.outgoingIndicators) {
    const keyword = selector.replace(/[\[\]*="]/g, '').replace('class', '');
    if (combined.includes(keyword)) {
      return 'outgoing';
    }
  }
  
  // Check for incoming indicators
  for (const selector of UNIVERSAL_SELECTORS.incomingIndicators) {
    const keyword = selector.replace(/[\[\]*="]/g, '').replace('class', '');
    if (combined.includes(keyword)) {
      return 'incoming';
    }
  }
  
  return 'unknown';
}

/**
 * Extract message data from an element
 */
function extractMessageData(element: Element): IncomingMessage | null {
  const messageText = element.textContent?.trim() || '';
  
  if (!messageText) {
    return null;
  }
  
  const timestamp = Date.now();
  const sender = extractSender(element) || 'unknown';
  const messageId = generateMessageId(sender, messageText, timestamp);
  
  // Skip if already seen
  if (isMessageSeen(messageId)) {
    return null;
  }
  
  return {
    messageId,
    sender,
    messageText,
    timestamp,
    conversationId: extractConversationId(element)
  };
}

/**
 * Try to extract sender information from element or ancestors
 */
function extractSender(element: Element): string | null {
  // Look for sender in nearby elements
  const senderSelectors = [
    '[class*="sender"]',
    '[class*="author"]',
    '[class*="name"]',
    '[class*="username"]'
  ];
  
  // Check siblings and parent
  const parent = element.parentElement;
  if (parent) {
    for (const selector of senderSelectors) {
      try {
        const senderEl = parent.querySelector(selector);
        if (senderEl?.textContent) {
          return senderEl.textContent.trim();
        }
      } catch (e) {
        // Invalid selector
      }
    }
  }
  
  return null;
}

/**
 * Try to extract conversation ID from element context
 */
function extractConversationId(element: Element): string | undefined {
  // Look for conversation container with ID
  let current: Element | null = element;
  while (current) {
    const id = current.getAttribute('data-conversation-id') || 
               current.getAttribute('data-chat-id') ||
               current.getAttribute('data-thread-id');
    if (id) {
      return id;
    }
    current = current.parentElement;
  }
  return undefined;
}

/**
 * Process mutations and return new incoming messages
 */
function processNewMessages(mutations: MutationRecord[]): IncomingMessage[] {
  const newElements = detectNewMessages(mutations);
  const incomingMessages: IncomingMessage[] = [];
  
  for (const element of newElements) {
    const classification = classifyMessage(element);
    
    // Only process incoming or unknown messages
    if (classification === 'outgoing') {
      continue;
    }
    
    const messageData = extractMessageData(element);
    if (messageData) {
      markMessageSeen(messageData.messageId);
      incomingMessages.push(messageData);
      log(`New message detected from ${messageData.sender}: ${messageData.messageText.substring(0, 50)}...`);
    }
  }
  
  return incomingMessages;
}

export {
  detectNewMessages,
  classifyMessage,
  extractMessageData,
  processNewMessages,
  isMessageElement,
  findMessageElements
};
