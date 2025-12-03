/**
 * Brain Layer - Reply Logic
 * Handles rule matching, rate limiting, and decision making
 * Now supports AI-powered replies when enabled
 */

import { IncomingMessage, ReplyRule, Configuration, DEFAULT_CONFIG } from '../types';
import { AIBrain } from './aiBrain';

let config: Configuration = DEFAULT_CONFIG;
let logCallback: ((message: string) => void) | null = null;
let aiBrain: AIBrain | null = null;

/**
 * Set the configuration for the brain layer
 */
function setConfig(newConfig: Configuration): void {
  config = newConfig;
  
  // Initialize or update AI Brain if AI config is present
  if (config.ai) {
    if (!aiBrain) {
      aiBrain = new AIBrain(config.ai);
      if (logCallback) {
        aiBrain.testConnection(); // Test connection on init
      }
    } else {
      aiBrain.updateConfig(config.ai);
    }
  }
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
 * 
 * Now supports async AI-powered replies when AI is enabled
 */
async function decideReply(message: IncomingMessage): Promise<string | null> {
  log(`Evaluating message from ${message.sender}: "${message.messageText.substring(0, 50)}..."`);
  
  // Check if AI is enabled and available
  if (config.ai && config.ai.enabled && aiBrain) {
    log('Using AI Brain for reply decision');
    
    // Check random skip before AI call
    if (shouldRandomlySkip()) {
      log('Decision: Skip (random)');
      return null;
    }
    
    try {
      const reply = await aiBrain.decideReply(message);
      if (reply) {
        log(`Decision: AI reply with "${reply.substring(0, 50)}..."`);
        return limitReplyLength(reply);
      }
      log('Decision: AI returned no reply');
      return null;
    } catch (error) {
      log(`AI Brain error: ${error}`);
      // Fall through to rule-based logic on error
    }
  }
  
  // Fall back to rule-based logic when AI is disabled or unavailable
  log('Using rule-based logic for reply decision');
  
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

/**
 * Get the AI Brain instance (for testing/debugging)
 */
function getAIBrain(): AIBrain | null {
  return aiBrain;
}

export {
  setConfig,
  setLogCallback,
  decideReply,
  evaluateRules,
  ruleMatches,
  shouldRandomlySkip,
  limitReplyLength,
  getConfig,
  getAIBrain
};
