/**
 * Configuration System
 * Handles loading, validation, and active hours support
 */

import * as fs from 'fs';
import * as path from 'path';
import { Configuration, DEFAULT_CONFIG, ReplyRule } from '../types';

/**
 * Validate a single reply rule
 */
function validateReplyRule(rule: unknown, index: number): ReplyRule | null {
  if (!rule || typeof rule !== 'object') {
    console.warn(`[Config] Invalid rule at index ${index}: not an object`);
    return null;
  }
  
  const r = rule as Record<string, unknown>;
  
  if (typeof r.match !== 'string' && !(r.match instanceof RegExp)) {
    console.warn(`[Config] Invalid rule at index ${index}: match must be string or RegExp`);
    return null;
  }
  
  if (typeof r.reply !== 'string') {
    console.warn(`[Config] Invalid rule at index ${index}: reply must be string`);
    return null;
  }
  
  return {
    match: r.match as string | RegExp,
    reply: r.reply as string,
    priority: typeof r.priority === 'number' ? r.priority : undefined,
    caseSensitive: typeof r.caseSensitive === 'boolean' ? r.caseSensitive : undefined
  };
}

/**
 * Validate configuration object
 */
function validateConfiguration(config: unknown): Configuration {
  if (!config || typeof config !== 'object') {
    console.warn('[Config] Invalid configuration, using defaults');
    return DEFAULT_CONFIG;
  }
  
  const c = config as Record<string, unknown>;
  const validated: Configuration = { ...DEFAULT_CONFIG };
  
  // Validate initialUrl
  if (typeof c.initialUrl === 'string' && c.initialUrl.startsWith('http')) {
    validated.initialUrl = c.initialUrl;
  }
  
  // Validate autoInject
  if (typeof c.autoInject === 'boolean') {
    validated.autoInject = c.autoInject;
  }
  
  // Validate replyRules
  if (Array.isArray(c.replyRules)) {
    validated.replyRules = c.replyRules
      .map((rule, i) => validateReplyRule(rule, i))
      .filter((rule): rule is ReplyRule => rule !== null);
  }
  
  // Validate timing ranges
  if (Array.isArray(c.typingDelayRangeMs) && c.typingDelayRangeMs.length === 2) {
    const [min, max] = c.typingDelayRangeMs;
    if (typeof min === 'number' && typeof max === 'number' && min > 0 && max >= min) {
      validated.typingDelayRangeMs = [min, max];
    }
  }
  
  if (Array.isArray(c.preReplyDelayRangeMs) && c.preReplyDelayRangeMs.length === 2) {
    const [min, max] = c.preReplyDelayRangeMs;
    if (typeof min === 'number' && typeof max === 'number' && min > 0 && max >= min) {
      validated.preReplyDelayRangeMs = [min, max];
    }
  }
  
  // Validate rate limits
  if (typeof c.maxRepliesPerMinute === 'number' && c.maxRepliesPerMinute > 0) {
    validated.maxRepliesPerMinute = c.maxRepliesPerMinute;
  }
  
  if (typeof c.maxRepliesPerHour === 'number' && c.maxRepliesPerHour > 0) {
    validated.maxRepliesPerHour = c.maxRepliesPerHour;
  }
  
  if (typeof c.maxReplyLength === 'number' && c.maxReplyLength > 0) {
    validated.maxReplyLength = c.maxReplyLength;
  }
  
  // Validate siteMode
  if (c.siteMode === 'universal' || c.siteMode === 'snapchat' || c.siteMode === 'twitter') {
    validated.siteMode = c.siteMode;
  }
  
  // Validate randomSkipProbability
  if (typeof c.randomSkipProbability === 'number' && 
      c.randomSkipProbability >= 0 && 
      c.randomSkipProbability <= 1) {
    validated.randomSkipProbability = c.randomSkipProbability;
  }
  
  // Validate activeHours
  if (c.activeHours && typeof c.activeHours === 'object') {
    const ah = c.activeHours as Record<string, unknown>;
    if (typeof ah.start === 'string' && typeof ah.end === 'string') {
      validated.activeHours = {
        start: ah.start,
        end: ah.end
      };
    }
  }
  
  return validated;
}


/**
 * Load configuration from file
 */
function loadConfigFromFile(configPath: string): Configuration {
  try {
    if (!fs.existsSync(configPath)) {
      console.log('[Config] No config file found, using defaults');
      return DEFAULT_CONFIG;
    }
    
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    const validated = validateConfiguration(parsed);
    
    console.log('[Config] Configuration loaded and validated');
    return validated;
  } catch (error) {
    console.error('[Config] Error loading configuration:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Check if current time is within active hours
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
    // Normal range (e.g., 09:00 - 17:00)
    return currentTime >= startTime && currentTime <= endTime;
  } else {
    // Overnight range (e.g., 22:00 - 06:00)
    return currentTime >= startTime || currentTime <= endTime;
  }
}

/**
 * Get default config path
 */
function getDefaultConfigPath(): string {
  return path.join(process.cwd(), 'config.json');
}

export {
  loadConfigFromFile,
  validateConfiguration,
  validateReplyRule,
  isWithinActiveHours,
  getDefaultConfigPath
};
