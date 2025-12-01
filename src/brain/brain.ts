/**
 * Brain Layer - Reply Logic
 * Handles rule matching, rate limiting, and decision making
 */

import { IncomingMessage, ReplyRule, Configuration, DEFAULT_CONFIG } from '../types';

let config: Configuration = DEFAULT_CONFIG;
let logCallback: ((message: string) => void) | null = null;

/**
 * Set the configuration for the brain layer
 */
function setConfig(newConfig: Configuration): void {
  config = newConfig;
}

/**
 * Set the logging callback
 */
function setLogCallback(callback: (message: string) => void): void {
  logCallback = callback;
}

/**
 * Log a message
 */
function log(message: string): void {
  if (logCallback) {
    logCallback(message);
  } else {
    console.log('[Brain]', message);
  }
}

/**
 * Check if a rule matches the message text
 */
function ruleMatches(rule: ReplyRule, messageText: string): boolean {
  const text = rule.caseSensitive ? messageText : messageText.toLowerCase();
  
  if (rule.match instanceof RegExp) {
    return rule.match.test(messageText);
  }
  
  const matchStr = rule.caseSensitive ? rule.match : rule.match.toLowerCase();
  return text.includes(matchStr);
}

/**
 * Evaluate message against all reply rules in order
 * Returns the reply text if a rule matches, null otherwise
 */
function evaluateRules(messageText: string, rules: ReplyRule[]): string | null {
  // Sort by priority if specified (higher priority first)
  const sortedRules = [...rules].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    return priorityB - priorityA;
  });
  
  for (const rule of sortedRules) {
    if (ruleMatches(rule, messageText)) {
      log(`Rule matched: "${rule.match}" -> "${rule.reply}"`);
      return rule.reply;
    }
  }
  
  return null;
}

/**
 * Determine if we should randomly skip this reply
 * Returns true if we should skip (not reply)
 */
function shouldRandomlySkip(): boolean {
  const skipProbability = config.randomSkipProbability || 0.15;
  const random = Math.random();
  const shouldSkip = random < skipProbability;
  
  if (shouldSkip) {
    log(`Randomly skipping reply (probability: ${skipProbability})`);
  }
  
  return shouldSkip;
}


/**
 * Main decision function - determines if and what to reply
 * Returns the reply text or null if no reply should be sent
 */
function decideReply(message: IncomingMessage): string | null {
  log(`Evaluating message from ${message.sender}: "${message.messageText.substring(0, 50)}..."`);
  
  // Check random skip
  if (shouldRandomlySkip()) {
    log('Decision: Skip (random)');
    return null;
  }
  
  // Evaluate against rules
  const reply = evaluateRules(message.messageText, config.replyRules);
  
  if (reply) {
    log(`Decision: Reply with "${reply.substring(0, 50)}..."`);
    return reply;
  }
  
  log('Decision: No matching rule, no reply');
  return null;
}

/**
 * Limit reply length to configured maximum
 */
function limitReplyLength(reply: string): string {
  const maxLength = config.maxReplyLength || 500;
  if (reply.length > maxLength) {
    log(`Reply truncated from ${reply.length} to ${maxLength} characters`);
    return reply.substring(0, maxLength);
  }
  return reply;
}

/**
 * Get current configuration
 */
function getConfig(): Configuration {
  return config;
}

export {
  setConfig,
  setLogCallback,
  decideReply,
  evaluateRules,
  ruleMatches,
  shouldRandomlySkip,
  limitReplyLength,
  getConfig
};
