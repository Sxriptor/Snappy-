/**
 * Human-like Typing Simulation
 */

import { Configuration, DEFAULT_CONFIG } from '../types';
import { log } from './bot';

let config: Configuration = DEFAULT_CONFIG;

/**
 * Set configuration
 */
function setConfig(newConfig: Configuration): void {
  config = newConfig;
}

/**
 * Generate a random delay within a range
 */
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate pre-reply delay (before typing starts)
 */
function getPreReplyDelay(): number {
  const [min, max] = config.preReplyDelayRangeMs || [2000, 6000];
  return randomDelay(min, max);
}

/**
 * Generate per-character typing delay
 */
function getTypingDelay(): number {
  const [min, max] = config.typingDelayRangeMs || [50, 150];
  return randomDelay(min, max);
}

/**
 * Generate thinking pause (for longer messages)
 */
function getThinkingPause(): number {
  return randomDelay(200, 1000);
}

/**
 * Determine if we should insert a thinking pause
 * More likely for longer messages, occasional for shorter ones
 */
function shouldInsertPause(charIndex: number, totalLength: number): boolean {
  // Only consider pauses after some characters
  if (charIndex < 10) return false;
  
  // Higher chance for longer messages
  const pauseProbability = totalLength > 50 ? 0.05 : 0.02;
  
  // Only pause at word boundaries (after spaces)
  return Math.random() < pauseProbability;
}

/**
 * Limit reply length to configured maximum
 */
function limitReplyLength(text: string): string {
  const maxLength = config.maxReplyLength || 500;
  if (text.length > maxLength) {
    log(`Reply truncated from ${text.length} to ${maxLength} characters`);
    return text.substring(0, maxLength);
  }
  return text;
}


/**
 * Set text in a contenteditable element
 */
function setContentEditableText(element: HTMLElement, text: string): void {
  element.textContent = text;
  element.innerHTML = text;
  
  // Move cursor to end
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  
  // Dispatch input event
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Set text in an input/textarea element
 */
function setInputText(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Simulate typing character by character with human-like delays
 */
async function simulateTyping(element: HTMLElement, text: string): Promise<void> {
  const limitedText = limitReplyLength(text);
  const isContentEditable = element.getAttribute('contenteditable') === 'true';
  
  log(`Starting to type ${limitedText.length} characters...`);
  
  let currentText = '';
  
  for (let i = 0; i < limitedText.length; i++) {
    const char = limitedText[i];
    currentText += char;
    
    // Set the text
    if (isContentEditable) {
      setContentEditableText(element, currentText);
    } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setInputText(element, currentText);
    }
    
    // Wait for typing delay
    const delay = getTypingDelay();
    await sleep(delay);
    
    // Occasionally insert thinking pauses (after spaces)
    if (char === ' ' && shouldInsertPause(i, limitedText.length)) {
      const pause = getThinkingPause();
      log(`Thinking pause: ${pause}ms`);
      await sleep(pause);
    }
  }
  
  log('Typing complete');
}

/**
 * Wait for pre-reply delay before starting to type
 */
async function waitPreReplyDelay(): Promise<void> {
  const delay = getPreReplyDelay();
  log(`Pre-reply delay: ${delay}ms`);
  await sleep(delay);
}

export {
  setConfig,
  simulateTyping,
  waitPreReplyDelay,
  getPreReplyDelay,
  getTypingDelay,
  getThinkingPause,
  limitReplyLength,
  randomDelay,
  sleep
};
