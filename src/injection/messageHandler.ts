/**
 * Main Message Handler
 * Coordinates all layers: DOM monitoring → detection → Brain → typing → sending
 */

import { IncomingMessage, Configuration, DEFAULT_CONFIG } from '../types';
import { initialize, log, getConfig } from './bot';
import { attachDOMWatcher, disconnectWatcher } from './domWatcher';
import { processNewMessages } from './messageDetector';
import { decideReply, setConfig as setBrainConfig, setLogCallback as setBrainLogCallback } from '../brain/brain';
import { RateLimitTracker } from '../brain/rateLimiter';
import { typeAndSendWithRetry } from './messageSender';
import { setConfig as setTypingConfig } from './typingSimulator';
import { setSiteMode } from './siteStrategy';

/**
 * Check if current time is within active hours (browser-compatible version)
 */
function isWithinActiveHours(activeHours?: { start: string; end: string }): boolean {
  if (!activeHours) {
    return true; // No restriction
  }
  
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  
  const [startHour, startMin] = activeHours.start.split(':').map(Number);
  const [endHour, endMin] = activeHours.end.split(':').map(Number);
  
  const startTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;
  
  if (startTime <= endTime) {
    return currentTime >= startTime && currentTime <= endTime;
  } else {
    return currentTime >= startTime || currentTime <= endTime;
  }
}

let config: Configuration = DEFAULT_CONFIG;
let rateLimiter: RateLimitTracker;
let isRunning: boolean = false;

/**
 * Initialize all components with configuration
 */
function initializeComponents(): void {
  config = getConfig();
  
  // Set up rate limiter
  rateLimiter = new RateLimitTracker({
    maxRepliesPerMinute: config.maxRepliesPerMinute,
    maxRepliesPerHour: config.maxRepliesPerHour
  });
  rateLimiter.setLogCallback(log);
  
  // Configure brain layer
  setBrainConfig(config);
  setBrainLogCallback(log);
  
  // Configure typing simulator
  setTypingConfig(config);
  
  // Set site mode
  const hostname = window.location.hostname;
  setSiteMode(config.siteMode, hostname);
  
  log('All components initialized');
}

/**
 * Handle a single incoming message
 */
async function handleIncomingMessage(message: IncomingMessage): Promise<void> {
  log(`Processing message from ${message.sender}`);
  
  // Check active hours
  if (!isWithinActiveHours(config.activeHours)) {
    log('Outside active hours, skipping');
    return;
  }
  
  // Check rate limits
  if (!rateLimiter.canReply()) {
    log('Rate limit reached, skipping');
    return;
  }
  
  // Get reply decision from brain
  const reply = decideReply(message);
  
  if (!reply) {
    log('No reply decided');
    return;
  }
  
  // Send the reply
  const result = await typeAndSendWithRetry(reply, message.sender);
  
  if (result.success) {
    rateLimiter.recordReply();
    log(`Reply sent successfully to ${message.sender}`);
  } else {
    log(`Failed to send reply: ${result.error}`);
  }
}


/**
 * Process mutations and handle any new messages
 */
async function onMutations(mutations: MutationRecord[]): Promise<void> {
  if (!isRunning) return;
  
  try {
    const newMessages = processNewMessages(mutations);
    
    for (const message of newMessages) {
      await handleIncomingMessage(message);
    }
  } catch (error) {
    log(`Error processing mutations: ${error}`);
  }
}

/**
 * Start the message handling system
 */
function start(): boolean {
  if (isRunning) {
    log('Message handler already running');
    return true;
  }
  
  // Initialize bot core
  if (!initialize()) {
    log('Failed to initialize bot');
    return false;
  }
  
  // Initialize all components
  initializeComponents();
  
  // Attach DOM watcher
  const attached = attachDOMWatcher((mutations) => {
    onMutations(mutations);
  });
  
  if (!attached) {
    log('Failed to attach DOM watcher');
    return false;
  }
  
  isRunning = true;
  log('Message handler started');
  return true;
}

/**
 * Stop the message handling system
 */
function stop(): void {
  if (!isRunning) {
    log('Message handler not running');
    return;
  }
  
  disconnectWatcher();
  isRunning = false;
  log('Message handler stopped');
}

/**
 * Check if handler is running
 */
function isHandlerRunning(): boolean {
  return isRunning;
}

/**
 * Get rate limiter status
 */
function getRateLimitStatus(): { perMinute: number; perHour: number; canReply: boolean } | null {
  if (!rateLimiter) return null;
  return rateLimiter.getStatus();
}

// Auto-start when script is injected
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      start();
    });
  } else {
    start();
  }
}

export {
  start,
  stop,
  isHandlerRunning,
  handleIncomingMessage,
  getRateLimitStatus,
  initializeComponents
};
