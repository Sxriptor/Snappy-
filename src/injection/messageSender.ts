/**
 * Message Sending Functionality
 * Orchestrates the full typing and sending flow
 */

import { log } from './bot';
import { locateInputField, locateSendButton, prepareInputField, clickButton } from './domInteraction';
import { simulateTyping, waitPreReplyDelay } from './typingSimulator';

interface SendResult {
  success: boolean;
  error?: string;
}

/**
 * Type and send a message
 * Orchestrates: locate input → prepare → wait → type → locate send → click
 */
async function typeAndSend(replyText: string, sender: string): Promise<SendResult> {
  log(`Preparing to send reply to ${sender}: "${replyText.substring(0, 50)}..."`);
  
  // Step 1: Locate input field
  const inputField = locateInputField();
  if (!inputField) {
    log('Error: Cannot send - input field not found');
    return { success: false, error: 'Input field not found' };
  }
  
  // Step 2: Prepare input field (focus and clear)
  try {
    prepareInputField(inputField);
  } catch (error) {
    log(`Error preparing input field: ${error}`);
    return { success: false, error: 'Failed to prepare input field' };
  }
  
  // Step 3: Wait pre-reply delay
  try {
    await waitPreReplyDelay();
  } catch (error) {
    log(`Error during pre-reply delay: ${error}`);
    // Continue anyway - delay is not critical
  }
  
  // Step 4: Simulate typing
  try {
    await simulateTyping(inputField, replyText);
  } catch (error) {
    log(`Error during typing simulation: ${error}`);
    return { success: false, error: 'Failed to type message' };
  }
  
  // Step 5: Locate send button
  const sendButton = locateSendButton();
  if (!sendButton) {
    log('Error: Cannot send - send button not found');
    return { success: false, error: 'Send button not found' };
  }
  
  // Step 6: Click send button
  try {
    clickButton(sendButton);
  } catch (error) {
    log(`Error clicking send button: ${error}`);
    return { success: false, error: 'Failed to click send button' };
  }
  
  // Log success
  log(`Reply sent to ${sender}: "${replyText.substring(0, 50)}..."`);
  
  return { success: true };
}

/**
 * Attempt to send with retry logic
 */
async function typeAndSendWithRetry(
  replyText: string, 
  sender: string, 
  maxRetries: number = 2
): Promise<SendResult> {
  let lastError: string | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`Send attempt ${attempt}/${maxRetries}`);
    
    const result = await typeAndSend(replyText, sender);
    
    if (result.success) {
      return result;
    }
    
    lastError = result.error;
    
    // Wait before retry
    if (attempt < maxRetries) {
      log(`Retrying in 1 second...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  log(`Failed to send after ${maxRetries} attempts`);
  return { success: false, error: lastError };
}

export {
  typeAndSend,
  typeAndSendWithRetry,
  SendResult
};
