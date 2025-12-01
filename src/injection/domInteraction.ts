/**
 * DOM Interaction - Input field and button handling
 */

import { log } from './bot';

/**
 * Selectors for input fields (in order of preference)
 */
const INPUT_SELECTORS = [
  '[contenteditable="true"]',
  'textarea[class*="message"]',
  'textarea[class*="input"]',
  'textarea[class*="chat"]',
  'input[type="text"][class*="message"]',
  'input[type="text"][class*="input"]',
  'textarea',
  'input[type="text"]'
];

/**
 * Selectors for send buttons (in order of preference)
 */
const SEND_BUTTON_SELECTORS = [
  '[data-testid="send-button"]',
  '[data-testid*="send"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]',
  'button[type="submit"]',
  'button[class*="send"]',
  '[class*="send-button"]',
  '[class*="sendButton"]'
];

/**
 * Locate the message input field using multiple selector fallbacks
 */
function locateInputField(): HTMLElement | null {
  for (const selector of INPUT_SELECTORS) {
    try {
      const element = document.querySelector(selector) as HTMLElement;
      if (element && isElementVisible(element)) {
        log(`Input field found with selector: ${selector}`);
        return element;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }
  
  log('Error: Input field not found');
  return null;
}

/**
 * Locate the send button using multiple selector fallbacks
 */
function locateSendButton(): HTMLElement | null {
  for (const selector of SEND_BUTTON_SELECTORS) {
    try {
      const element = document.querySelector(selector) as HTMLElement;
      if (element && isElementVisible(element)) {
        log(`Send button found with selector: ${selector}`);
        return element;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }
  
  log('Error: Send button not found');
  return null;
}

/**
 * Check if an element is visible
 */
function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0';
}

/**
 * Focus an input field
 */
function focusField(element: HTMLElement): void {
  element.focus();
  log('Input field focused');
}

/**
 * Clear the content of an input field
 */
function clearField(element: HTMLElement): void {
  if (element.getAttribute('contenteditable') === 'true') {
    element.innerHTML = '';
    element.textContent = '';
  } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = '';
  }
  
  // Dispatch input event to trigger any listeners
  element.dispatchEvent(new Event('input', { bubbles: true }));
  log('Input field cleared');
}

/**
 * Focus and clear an input field
 */
function prepareInputField(element: HTMLElement): void {
  focusField(element);
  clearField(element);
}

/**
 * Click a button element
 */
function clickButton(element: HTMLElement): void {
  element.click();
  log('Button clicked');
}

export {
  locateInputField,
  locateSendButton,
  isElementVisible,
  focusField,
  clearField,
  prepareInputField,
  clickButton,
  INPUT_SELECTORS,
  SEND_BUTTON_SELECTORS
};
