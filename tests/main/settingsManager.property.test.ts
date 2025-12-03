/**
 * Property-Based Tests for Settings Manager
 * 
 * Tests properties 3, 4, 5
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import {
  validateAISettings,
  clampTemperature,
  sanitizeAISettings,
  loadConfiguration,
  saveConfiguration,
  loadAISettings,
  saveAISettings
} from '../../src/main/settingsManager';
import { AIConfig, Configuration, DEFAULT_AI_CONFIG, DEFAULT_CONFIG } from '../../src/types';

// Mock fs for testing
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('Settings Manager Property Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Arbitraries
  const validAIConfigArb = fc.record({
    enabled: fc.boolean(),
    llmEndpoint: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
    llmPort: fc.integer({ min: 1, max: 65535 }),
    modelName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    systemPrompt: fc.string({ minLength: 1, maxLength: 500 }),
    temperature: fc.float({ min: Math.fround(0.1), max: Math.fround(1.5), noNaN: true }),
    maxTokens: fc.integer({ min: 1, max: 2000 }),
    contextHistoryEnabled: fc.boolean(),
    maxContextMessages: fc.integer({ min: 1, max: 50 }),
    requestTimeoutMs: fc.integer({ min: 1000, max: 60000 }),
    maxRetries: fc.integer({ min: 0, max: 10 }),
    retryBackoffMs: fc.integer({ min: 100, max: 5000 })
  });

  describe('Property 4: Settings validation', () => {
    /**
     * **Feature: ai-integration, Property 4: Settings validation**
     * **Validates: Requirements 3.3**
     * 
     * For any configuration input, the validation function SHALL reject invalid values 
     * (negative temperature, port out of range, empty endpoint) and accept valid values.
     */
    it('should accept all valid configurations', () => {
      fc.assert(
        fc.property(validAIConfigArb, (config) => {
          const result = validateAISettings(config);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject empty endpoint', () => {
      fc.assert(
        fc.property(validAIConfigArb, (config) => {
          const invalidConfig = { ...config, llmEndpoint: '' };
          const result = validateAISettings(invalidConfig);
          
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('endpoint'))).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject port out of range (too low)', () => {
      fc.assert(
        fc.property(validAIConfigArb, fc.integer({ min: -1000, max: 0 }), (config, invalidPort) => {
          const invalidConfig = { ...config, llmPort: invalidPort };
          const result = validateAISettings(invalidConfig);
          
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('port'))).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject port out of range (too high)', () => {
      fc.assert(
        fc.property(validAIConfigArb, fc.integer({ min: 65536, max: 100000 }), (config, invalidPort) => {
          const invalidConfig = { ...config, llmPort: invalidPort };
          const result = validateAISettings(invalidConfig);
          
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('port'))).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject temperature out of range (too low)', () => {
      fc.assert(
        fc.property(validAIConfigArb, fc.float({ min: Math.fround(-10), max: Math.fround(0.09), noNaN: true }), (config, invalidTemp) => {
          const invalidConfig = { ...config, temperature: invalidTemp };
          const result = validateAISettings(invalidConfig);
          
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('emperature'))).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject temperature out of range (too high)', () => {
      fc.assert(
        fc.property(validAIConfigArb, fc.float({ min: Math.fround(1.51), max: Math.fround(10), noNaN: true }), (config, invalidTemp) => {
          const invalidConfig = { ...config, temperature: invalidTemp };
          const result = validateAISettings(invalidConfig);
          
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('emperature'))).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject negative or zero maxTokens', () => {
      fc.assert(
        fc.property(validAIConfigArb, fc.integer({ min: -100, max: 0 }), (config, invalidTokens) => {
          const invalidConfig = { ...config, maxTokens: invalidTokens };
          const result = validateAISettings(invalidConfig);
          
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('tokens'))).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject empty model name', () => {
      fc.assert(
        fc.property(validAIConfigArb, (config) => {
          const invalidConfig = { ...config, modelName: '' };
          const result = validateAISettings(invalidConfig);
          
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('Model name'))).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 5: Temperature clamping', () => {
    /**
     * **Feature: ai-integration, Property 5: Temperature clamping**
     * **Validates: Requirements 4.3**
     * 
     * For any temperature value set via the UI, the saved value SHALL be clamped to the range [0.1, 1.5].
     */
    it('should clamp temperature to minimum 0.1', () => {
      fc.assert(
        fc.property(fc.float({ min: Math.fround(-100), max: Math.fround(0.09), noNaN: true }), (temp) => {
          const clamped = clampTemperature(temp);
          expect(clamped).toBeGreaterThanOrEqual(0.09);
          expect(clamped).toBeLessThanOrEqual(0.11);
        }),
        { numRuns: 100 }
      );
    });

    it('should clamp temperature to maximum 1.5', () => {
      fc.assert(
        fc.property(fc.float({ min: Math.fround(1.51), max: Math.fround(100), noNaN: true }), (temp) => {
          const clamped = clampTemperature(temp);
          expect(clamped).toBeGreaterThanOrEqual(1.49);
          expect(clamped).toBeLessThanOrEqual(1.51);
        }),
        { numRuns: 100 }
      );
    });

    it('should keep temperature within valid range', () => {
      fc.assert(
        fc.property(fc.float({ min: Math.fround(0.15), max: Math.fround(1.45), noNaN: true }), (temp) => {
          const clamped = clampTemperature(temp);
          // Should be in valid range
          expect(clamped).toBeGreaterThanOrEqual(0.09);
          expect(clamped).toBeLessThanOrEqual(1.51);
          // Should be close to original if within range
          expect(Math.abs(clamped - temp)).toBeLessThan(0.01);
        }),
        { numRuns: 100 }
      );
    });

    it('should clamp temperature in sanitizeAISettings', () => {
      fc.assert(
        fc.property(fc.float({ min: Math.fround(-10), max: Math.fround(10), noNaN: true }), (temp) => {
          const sanitized = sanitizeAISettings({ temperature: temp });
          expect(sanitized.temperature).toBeGreaterThanOrEqual(0.09);
          expect(sanitized.temperature).toBeLessThanOrEqual(1.51);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Settings persistence round-trip', () => {
    /**
     * **Feature: ai-integration, Property 3: Settings persistence round-trip**
     * **Validates: Requirements 2.2, 3.4, 3.5**
     * 
     * For any valid AI configuration saved to the config file, loading the configuration 
     * SHALL return equivalent values for all fields.
     */
    it('should preserve all fields through save/load cycle', () => {
      fc.assert(
        fc.property(validAIConfigArb, (aiConfig) => {
          const config: Configuration = {
            ...DEFAULT_CONFIG,
            ai: aiConfig
          };

          // Mock file system
          let savedContent: string = '';
          mockFs.existsSync.mockReturnValue(true);
          mockFs.writeFileSync.mockImplementation((path, content) => {
            savedContent = content as string;
          });
          mockFs.readFileSync.mockImplementation(() => savedContent);

          // Save configuration
          const saveResult = saveConfiguration(config);
          expect(saveResult).toBe(true);

          // Load configuration
          const loaded = loadConfiguration();

          // Verify all AI fields match
          expect(loaded.ai).toBeDefined();
          expect(loaded.ai?.enabled).toBe(aiConfig.enabled);
          expect(loaded.ai?.llmEndpoint).toBe(aiConfig.llmEndpoint);
          expect(loaded.ai?.llmPort).toBe(aiConfig.llmPort);
          expect(loaded.ai?.modelName).toBe(aiConfig.modelName);
          expect(loaded.ai?.systemPrompt).toBe(aiConfig.systemPrompt);
          expect(loaded.ai?.temperature).toBeCloseTo(aiConfig.temperature, 5);
          expect(loaded.ai?.maxTokens).toBe(aiConfig.maxTokens);
          expect(loaded.ai?.contextHistoryEnabled).toBe(aiConfig.contextHistoryEnabled);
          expect(loaded.ai?.maxContextMessages).toBe(aiConfig.maxContextMessages);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve AI settings through saveAISettings/loadAISettings cycle', () => {
      fc.assert(
        fc.property(validAIConfigArb, (aiConfig) => {
          // Mock file system with initial config
          const initialConfig = { ...DEFAULT_CONFIG, ai: DEFAULT_AI_CONFIG };
          let savedContent: string = JSON.stringify(initialConfig);
          
          mockFs.existsSync.mockReturnValue(true);
          mockFs.writeFileSync.mockImplementation((path, content) => {
            savedContent = content as string;
          });
          mockFs.readFileSync.mockImplementation(() => savedContent);

          // Save AI settings
          const saveResult = saveAISettings(aiConfig);
          expect(saveResult).toBe(true);

          // Load AI settings
          const loaded = loadAISettings();

          // Verify all fields match
          expect(loaded.enabled).toBe(aiConfig.enabled);
          expect(loaded.llmEndpoint).toBe(aiConfig.llmEndpoint);
          expect(loaded.llmPort).toBe(aiConfig.llmPort);
          expect(loaded.modelName).toBe(aiConfig.modelName);
          expect(loaded.temperature).toBeCloseTo(aiConfig.temperature, 5);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Sanitization', () => {
    it('should sanitize all out-of-range values', () => {
      fc.assert(
        fc.property(
          fc.record({
            temperature: fc.float({ min: Math.fround(-10), max: Math.fround(10), noNaN: true }),
            llmPort: fc.integer({ min: -1000, max: 100000 }),
            maxTokens: fc.integer({ min: -100, max: 100 }),
            maxContextMessages: fc.integer({ min: -50, max: 100 }),
            requestTimeoutMs: fc.integer({ min: 0, max: 100000 }),
            maxRetries: fc.integer({ min: -10, max: 20 })
          }),
          (settings) => {
            const sanitized = sanitizeAISettings(settings);

            // All values should be in valid ranges
            if (sanitized.temperature !== undefined) {
              expect(sanitized.temperature).toBeGreaterThanOrEqual(0.09);
              expect(sanitized.temperature).toBeLessThanOrEqual(1.51);
            }
            if (sanitized.llmPort !== undefined) {
              expect(sanitized.llmPort).toBeGreaterThanOrEqual(1);
              expect(sanitized.llmPort).toBeLessThanOrEqual(65535);
            }
            if (sanitized.maxTokens !== undefined) {
              expect(sanitized.maxTokens).toBeGreaterThanOrEqual(1);
            }
            if (sanitized.maxContextMessages !== undefined) {
              expect(sanitized.maxContextMessages).toBeGreaterThanOrEqual(1);
            }
            if (sanitized.requestTimeoutMs !== undefined) {
              expect(sanitized.requestTimeoutMs).toBeGreaterThanOrEqual(1000);
            }
            if (sanitized.maxRetries !== undefined) {
              expect(sanitized.maxRetries).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
