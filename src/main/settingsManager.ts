/**
 * Settings Manager
 * 
 * Manages loading, saving, and validating AI configuration settings.
 * Handles persistence to config.json and provides defaults.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AIConfig, Configuration, DEFAULT_AI_CONFIG, DEFAULT_CONFIG } from '../types';

const CONFIG_FILE = 'config.json';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Load configuration from config.json
 */
export function loadConfiguration(): Configuration {
  try {
    const configPath = path.join(process.cwd(), CONFIG_FILE);
    
    if (!fs.existsSync(configPath)) {
      console.log('[SettingsManager] Config file not found, using defaults');
      return { ...DEFAULT_CONFIG, ai: DEFAULT_AI_CONFIG };
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const loadedConfig = JSON.parse(fileContent);

    // Merge with defaults to ensure all fields are present
    const config: Configuration = {
      ...DEFAULT_CONFIG,
      ...loadedConfig,
      ai: {
        ...DEFAULT_AI_CONFIG,
        ...(loadedConfig.ai || {})
      }
    };

    console.log('[SettingsManager] Configuration loaded successfully');
    return config;
  } catch (error) {
    console.error('[SettingsManager] Error loading configuration:', error);
    return { ...DEFAULT_CONFIG, ai: DEFAULT_AI_CONFIG };
  }
}

/**
 * Save configuration to config.json
 */
export function saveConfiguration(config: Configuration): boolean {
  try {
    const configPath = path.join(process.cwd(), CONFIG_FILE);
    const fileContent = JSON.stringify(config, null, 2);
    
    fs.writeFileSync(configPath, fileContent, 'utf-8');
    console.log('[SettingsManager] Configuration saved successfully');
    return true;
  } catch (error) {
    console.error('[SettingsManager] Error saving configuration:', error);
    return false;
  }
}

/**
 * Load AI settings from configuration
 */
export function loadAISettings(): AIConfig {
  const config = loadConfiguration();
  return config.ai || DEFAULT_AI_CONFIG;
}

/**
 * Save AI settings to configuration
 */
export function saveAISettings(aiConfig: Partial<AIConfig>): boolean {
  try {
    const config = loadConfiguration();
    
    // Merge with existing AI config
    config.ai = {
      ...(config.ai || DEFAULT_AI_CONFIG),
      ...aiConfig
    };

    // Validate before saving
    const validation = validateAISettings(config.ai);
    if (!validation.valid) {
      console.error('[SettingsManager] Validation failed:', validation.errors);
      return false;
    }

    return saveConfiguration(config);
  } catch (error) {
    console.error('[SettingsManager] Error saving AI settings:', error);
    return false;
  }
}

/**
 * Validate AI settings
 */
export function validateAISettings(settings: AIConfig): ValidationResult {
  const errors: string[] = [];

  // Validate endpoint
  if (!settings.llmEndpoint || settings.llmEndpoint.trim().length === 0) {
    errors.push('LLM endpoint cannot be empty');
  }

  // Validate port range
  if (settings.llmPort < 1 || settings.llmPort > 65535) {
    errors.push('LLM port must be between 1 and 65535');
  }

  // Validate model name
  if (!settings.modelName || settings.modelName.trim().length === 0) {
    errors.push('Model name cannot be empty');
  }

  // Validate temperature range
  if (settings.temperature < 0.1 || settings.temperature > 1.5) {
    errors.push('Temperature must be between 0.1 and 1.5');
  }

  // Validate maxTokens
  if (settings.maxTokens < 1) {
    errors.push('Max tokens must be positive');
  }

  // Validate maxContextMessages
  if (settings.maxContextMessages < 1) {
    errors.push('Max context messages must be at least 1');
  }

  // Validate timeout
  if (settings.requestTimeoutMs < 1000) {
    errors.push('Request timeout must be at least 1000ms');
  }

  // Validate retries
  if (settings.maxRetries < 0) {
    errors.push('Max retries cannot be negative');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Clamp temperature to valid range
 */
export function clampTemperature(temperature: number): number {
  return Math.max(0.1, Math.min(1.5, temperature));
}

/**
 * Sanitize AI settings by clamping values to valid ranges
 */
export function sanitizeAISettings(settings: Partial<AIConfig>): Partial<AIConfig> {
  const sanitized: Partial<AIConfig> = { ...settings };

  // Clamp temperature
  if (sanitized.temperature !== undefined) {
    sanitized.temperature = clampTemperature(sanitized.temperature);
  }

  // Clamp port
  if (sanitized.llmPort !== undefined) {
    sanitized.llmPort = Math.max(1, Math.min(65535, sanitized.llmPort));
  }

  // Ensure positive maxTokens
  if (sanitized.maxTokens !== undefined && sanitized.maxTokens < 1) {
    sanitized.maxTokens = 1;
  }

  // Ensure positive maxContextMessages
  if (sanitized.maxContextMessages !== undefined && sanitized.maxContextMessages < 1) {
    sanitized.maxContextMessages = 1;
  }

  // Ensure minimum timeout
  if (sanitized.requestTimeoutMs !== undefined && sanitized.requestTimeoutMs < 1000) {
    sanitized.requestTimeoutMs = 1000;
  }

  // Ensure non-negative retries
  if (sanitized.maxRetries !== undefined && sanitized.maxRetries < 0) {
    sanitized.maxRetries = 0;
  }

  return sanitized;
}

/**
 * Get default AI configuration
 */
export function getDefaultAIConfig(): AIConfig {
  return { ...DEFAULT_AI_CONFIG };
}
