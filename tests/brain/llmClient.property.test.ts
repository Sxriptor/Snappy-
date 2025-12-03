/**
 * Property-based tests for LLM Client
 * Uses fast-check for property-based testing
 */

import * as fc from 'fast-check';
import { buildRequestBody, setConfig, getEndpointUrl } from '../../src/brain/llmClient';
import { ChatMessage, AIConfig, DEFAULT_AI_CONFIG } from '../../src/types';

describe('LLM Client Property Tests', () => {
  beforeEach(() => {
    setConfig(DEFAULT_AI_CONFIG);
  });

  /**
   * **Feature: ai-integration, Property 1: OpenAI-compatible request format**
   * **Validates: Requirements 1.5**
   * 
   * For any message sent to the LLM, the request body SHALL contain a valid
   * `model` string and a `messages` array where each message has a `role`
   * (system/user/assistant) and `content` string.
   */
  describe('Property 1: OpenAI-compatible request format', () => {
    // Generator for valid chat messages
    const chatMessageArb = fc.record({
      role: fc.constantFrom('system', 'user', 'assistant') as fc.Arbitrary<'system' | 'user' | 'assistant'>,
      content: fc.string({ minLength: 1, maxLength: 500 })
    });

    const messagesArrayArb = fc.array(chatMessageArb, { minLength: 1, maxLength: 20 });

    it('should always produce a request body with valid model string', () => {
      fc.assert(
        fc.property(messagesArrayArb, (messages) => {
          const body = buildRequestBody(messages);
          
          // Model must be a non-empty string
          expect(typeof body.model).toBe('string');
          expect(body.model.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should always produce a request body with messages array', () => {
      fc.assert(
        fc.property(messagesArrayArb, (messages) => {
          const body = buildRequestBody(messages);
          
          // Messages must be an array
          expect(Array.isArray(body.messages)).toBe(true);
          expect(body.messages.length).toBe(messages.length);
        }),
        { numRuns: 100 }
      );
    });


    it('should preserve message roles and content in request body', () => {
      fc.assert(
        fc.property(messagesArrayArb, (messages) => {
          const body = buildRequestBody(messages);
          
          // Each message should have role and content
          body.messages.forEach((msg, i) => {
            expect(['system', 'user', 'assistant']).toContain(msg.role);
            expect(typeof msg.content).toBe('string');
            expect(msg.role).toBe(messages[i].role);
            expect(msg.content).toBe(messages[i].content);
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should include temperature when configured', () => {
      fc.assert(
        fc.property(
          messagesArrayArb,
          fc.float({ min: Math.fround(0.1), max: Math.fround(1.5), noNaN: true }),
          (messages, temperature) => {
            setConfig({ ...DEFAULT_AI_CONFIG, temperature });
            const body = buildRequestBody(messages);
            
            expect(body.temperature).toBe(temperature);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include max_tokens when configured', () => {
      fc.assert(
        fc.property(
          messagesArrayArb,
          fc.integer({ min: 1, max: 2000 }),
          (messages, maxTokens) => {
            setConfig({ ...DEFAULT_AI_CONFIG, maxTokens });
            const body = buildRequestBody(messages);
            
            expect(body.max_tokens).toBe(maxTokens);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Endpoint URL construction
   */
  describe('Endpoint URL construction', () => {
    it('should construct valid URL from endpoint and port', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes(' ') && !s.includes(':')),
          fc.integer({ min: 1, max: 65535 }),
          (endpoint, port) => {
            setConfig({ ...DEFAULT_AI_CONFIG, llmEndpoint: endpoint, llmPort: port });
            const url = getEndpointUrl();
            
            expect(url).toBe(`http://${endpoint}:${port}/v1/chat/completions`);
            expect(url).toContain('/v1/chat/completions');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


import { ErrorTracker } from '../../src/brain/llmClient';

describe('ErrorTracker Property Tests', () => {
  /**
   * **Feature: ai-integration, Property 13: Exponential backoff**
   * **Validates: Requirements 6.5**
   * 
   * For any sequence of consecutive LLM errors, the delay before the next retry
   * SHALL increase exponentially (delay = baseDelay * 2^errorCount, capped at maxDelay).
   */
  describe('Property 13: Exponential backoff', () => {
    it('should calculate backoff delay as baseDelay * 2^(errorCount-1)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 5000 }),  // baseDelay
          fc.integer({ min: 1, max: 10 }),       // errorCount
          (baseDelay, errorCount) => {
            const tracker = new ErrorTracker(baseDelay, 60000, 20);
            
            // Record errors
            for (let i = 0; i < errorCount; i++) {
              tracker.recordError();
            }
            
            const expectedDelay = baseDelay * Math.pow(2, errorCount - 1);
            const actualDelay = tracker.getBackoffDelay();
            
            // Should match the formula (before cap)
            if (expectedDelay <= 60000) {
              expect(actualDelay).toBe(expectedDelay);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should cap backoff delay at maxDelay', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1000 }),   // baseDelay
          fc.integer({ min: 1000, max: 10000 }), // maxDelay
          fc.integer({ min: 1, max: 20 }),       // errorCount
          (baseDelay, maxDelay, errorCount) => {
            const tracker = new ErrorTracker(baseDelay, maxDelay, 30);
            
            // Record errors
            for (let i = 0; i < errorCount; i++) {
              tracker.recordError();
            }
            
            const actualDelay = tracker.getBackoffDelay();
            
            // Should never exceed maxDelay
            expect(actualDelay).toBeLessThanOrEqual(maxDelay);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reset backoff delay on success', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // errorCount before success
          (errorCount) => {
            const tracker = new ErrorTracker(1000, 60000, 20);
            
            // Record errors
            for (let i = 0; i < errorCount; i++) {
              tracker.recordError();
            }
            
            // Verify we have a backoff delay
            expect(tracker.getBackoffDelay()).toBeGreaterThan(0);
            
            // Record success
            tracker.recordSuccess();
            
            // Backoff should be reset to 0
            expect(tracker.getBackoffDelay()).toBe(0);
            expect(tracker.getErrorCount()).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return 0 delay when no errors', () => {
      const tracker = new ErrorTracker(1000, 60000, 10);
      expect(tracker.getBackoffDelay()).toBe(0);
    });

    it('should track consecutive error count correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (errorCount) => {
            const tracker = new ErrorTracker(1000, 60000, 30);
            
            for (let i = 0; i < errorCount; i++) {
              tracker.recordError();
            }
            
            expect(tracker.getErrorCount()).toBe(errorCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should stop retrying after maxErrors', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // maxErrors
          (maxErrors) => {
            const tracker = new ErrorTracker(1000, 60000, maxErrors);
            
            // Record exactly maxErrors
            for (let i = 0; i < maxErrors; i++) {
              expect(tracker.shouldRetry()).toBe(true);
              tracker.recordError();
            }
            
            // Should not retry after maxErrors
            expect(tracker.shouldRetry()).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
