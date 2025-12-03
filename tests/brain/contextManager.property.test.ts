/**
 * Property-Based Tests for Context Manager
 * 
 * Tests properties 2, 7, 8, 9, 10, 11, 16
 */

import * as fc from 'fast-check';
import { ContextManager } from '../../src/brain/contextManager';
import { AIConfig, IncomingMessage, DEFAULT_AI_CONFIG } from '../../src/types';

// Mock localStorage for memory bridge
class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] || null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
  clear(): void {
    this.store = {};
  }
}

const mockLocalStorage = new MockLocalStorage();
(global as any).localStorage = mockLocalStorage;

describe('Context Manager Property Tests', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  // Arbitraries
  const conversationIdArb = fc.string({ minLength: 1, maxLength: 50 });
  const userIdArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);
  const messageTextArb = fc.string({ minLength: 1, maxLength: 200 });
  
  const incomingMessageArb = fc.record({
    messageId: fc.uuid(),
    sender: userIdArb,
    messageText: messageTextArb,
    timestamp: fc.integer({ min: 1000000000000, max: Date.now() }),
    conversationId: fc.option(conversationIdArb, { nil: undefined })
  });

  const aiConfigArb = fc.record({
    enabled: fc.boolean(),
    llmEndpoint: fc.constant('localhost'),
    llmPort: fc.integer({ min: 1, max: 65535 }),
    modelName: fc.string({ minLength: 1, maxLength: 50 }),
    systemPrompt: fc.string({ minLength: 10, maxLength: 500 }),
    temperature: fc.float({ min: Math.fround(0.1), max: Math.fround(1.5) }),
    maxTokens: fc.integer({ min: 10, max: 2000 }),
    contextHistoryEnabled: fc.boolean(),
    maxContextMessages: fc.integer({ min: 1, max: 50 }),
    requestTimeoutMs: fc.integer({ min: 1000, max: 60000 }),
    maxRetries: fc.integer({ min: 1, max: 10 }),
    retryBackoffMs: fc.integer({ min: 100, max: 5000 })
  });

  describe('Property 2: System prompt inclusion', () => {
    /**
     * **Feature: ai-integration, Property 2: System prompt inclusion**
     * **Validates: Requirements 2.3**
     * 
     * For any LLM request, the messages array SHALL contain exactly one message 
     * with role "system" containing the configured system prompt as the first message.
     */
    it('should always include system prompt as first message', () => {
      fc.assert(
        fc.property(aiConfigArb, conversationIdArb, userIdArb, (config, convId, userId) => {
          const manager = new ContextManager(config);
          const context = manager.getContext(convId, userId);

          // Should have at least one message (the system prompt)
          expect(context.length).toBeGreaterThanOrEqual(1);
          
          // First message should be system role
          expect(context[0].role).toBe('system');
          
          // Should contain the configured system prompt
          expect(context[0].content).toContain(config.systemPrompt);
        }),
        { numRuns: 100 }
      );
    });

    it('should have exactly one system message', () => {
      fc.assert(
        fc.property(aiConfigArb, conversationIdArb, userIdArb, (config, convId, userId) => {
          const manager = new ContextManager(config);
          const context = manager.getContext(convId, userId);

          const systemMessages = context.filter(msg => msg.role === 'system');
          expect(systemMessages.length).toBe(1);
        }),
        { numRuns: 100 }
      );
    });

    it('should update system prompt when config changes', () => {
      fc.assert(
        fc.property(
          aiConfigArb,
          fc.string({ minLength: 10, maxLength: 200 }),
          conversationIdArb,
          userIdArb,
          (config, newPrompt, convId, userId) => {
            const manager = new ContextManager(config);
            manager.setSystemPrompt(newPrompt);
            
            const context = manager.getContext(convId, userId);
            expect(context[0].content).toContain(newPrompt);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 7: Context history inclusion', () => {
    /**
     * **Feature: ai-integration, Property 7: Context history inclusion**
     * **Validates: Requirements 5.1**
     * 
     * For any message when context history is enabled, the LLM request messages array 
     * SHALL include previous messages from the same conversation.
     */
    it('should include previous messages when context enabled', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.array(incomingMessageArb, { minLength: 2, maxLength: 20 }),
          (convId, userId, messages) => {
            const config: AIConfig = { ...DEFAULT_AI_CONFIG, contextHistoryEnabled: true };
            const manager = new ContextManager(config);

            // Add all but last message to history
            for (let i = 0; i < messages.length - 1; i++) {
              manager.addMessage(convId, messages[i], false);
            }

            // Get context
            const context = manager.getContext(convId, userId);

            // Should include system prompt + historical messages
            // (at least 2: system + 1 historical)
            expect(context.length).toBeGreaterThanOrEqual(2);
            
            // Should have messages beyond just system prompt
            const nonSystemMessages = context.filter(msg => msg.role !== 'system');
            expect(nonSystemMessages.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 8: Context history limit', () => {
    /**
     * **Feature: ai-integration, Property 8: Context history limit**
     * **Validates: Requirements 5.2**
     * 
     * For any conversation history exceeding the configured limit, the LLM request 
     * SHALL include at most maxContextMessages previous messages (plus system prompt and current message).
     */
    it('should enforce maxContextMessages limit', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.integer({ min: 1, max: 10 }),
          fc.array(incomingMessageArb, { minLength: 15, maxLength: 50 }),
          (convId, userId, maxMessages, messages) => {
            const config: AIConfig = {
              ...DEFAULT_AI_CONFIG,
              contextHistoryEnabled: true,
              maxContextMessages: maxMessages
            };
            const manager = new ContextManager(config);

            // Add many messages
            messages.forEach(msg => {
              manager.addMessage(convId, msg, false);
            });

            // Get context
            const context = manager.getContext(convId, userId);

            // Total messages should be: 1 (system) + at most maxMessages (history)
            expect(context.length).toBeLessThanOrEqual(1 + maxMessages);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should keep most recent messages when exceeding limit', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.integer({ min: 2, max: 5 }),
          fc.array(incomingMessageArb, { minLength: 10, maxLength: 20 }),
          (convId, userId, maxMessages, messages) => {
            const config: AIConfig = {
              ...DEFAULT_AI_CONFIG,
              contextHistoryEnabled: true,
              maxContextMessages: maxMessages
            };
            const manager = new ContextManager(config);

            // Add all messages
            messages.forEach(msg => {
              manager.addMessage(convId, msg, false);
            });

            const context = manager.getContext(convId, userId);
            
            // Get non-system messages
            const historyMessages = context.filter(msg => msg.role !== 'system');
            
            // Should contain the most recent messages
            const expectedCount = Math.min(maxMessages, messages.length);
            expect(historyMessages.length).toBeLessThanOrEqual(expectedCount);
            
            // Last message in context should match last added message
            if (historyMessages.length > 0) {
              const lastContextMsg = historyMessages[historyMessages.length - 1];
              const lastAddedMsg = messages[messages.length - 1];
              expect(lastContextMsg.content).toBe(lastAddedMsg.messageText);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 9: Message role formatting', () => {
    /**
     * **Feature: ai-integration, Property 9: Message role formatting**
     * **Validates: Requirements 5.3**
     * 
     * For any message in the context history, incoming messages SHALL have role "user" 
     * and bot-sent messages SHALL have role "assistant".
     */
    it('should assign user role to incoming messages', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.array(incomingMessageArb, { minLength: 1, maxLength: 10 }),
          (convId, userId, messages) => {
            const config: AIConfig = { ...DEFAULT_AI_CONFIG, contextHistoryEnabled: true };
            const manager = new ContextManager(config);

            // Add messages as incoming (not bot)
            messages.forEach(msg => {
              manager.addMessage(convId, msg, false);
            });

            const context = manager.getContext(convId, userId);
            const userMessages = context.filter(msg => msg.role === 'user');
            
            // All non-system messages should be user role
            expect(userMessages.length).toBe(messages.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should assign assistant role to bot messages', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.array(incomingMessageArb, { minLength: 1, maxLength: 10 }),
          (convId, userId, messages) => {
            const config: AIConfig = { ...DEFAULT_AI_CONFIG, contextHistoryEnabled: true };
            const manager = new ContextManager(config);

            // Add messages as bot replies
            messages.forEach(msg => {
              manager.addMessage(convId, msg, true);
            });

            const context = manager.getContext(convId, userId);
            const assistantMessages = context.filter(msg => msg.role === 'assistant');
            
            // All non-system messages should be assistant role
            expect(assistantMessages.length).toBe(messages.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: Context reset on conversation change', () => {
    /**
     * **Feature: ai-integration, Property 10: Context reset on conversation change**
     * **Validates: Requirements 5.4**
     * 
     * For any change in conversationId, the context history for the previous conversation 
     * SHALL be cleared before processing the new message.
     */
    it('should isolate context between different conversations', () => {
      fc.assert(
        fc.property(
          fc.tuple(conversationIdArb, conversationIdArb).filter(([a, b]) => a !== b),
          userIdArb,
          fc.array(incomingMessageArb, { minLength: 3, maxLength: 10 }),
          ([convId1, convId2], userId, messages) => {
            const config: AIConfig = { ...DEFAULT_AI_CONFIG, contextHistoryEnabled: true };
            const manager = new ContextManager(config);

            // Add messages to first conversation
            messages.forEach(msg => {
              manager.addMessage(convId1, msg, false);
            });

            // Get context for second conversation (should be empty except system)
            const context2 = manager.getContext(convId2, userId);
            
            // Should only have system prompt, no history from conv1
            expect(context2.length).toBe(1);
            expect(context2[0].role).toBe('system');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should clear history when resetContext is called', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.array(incomingMessageArb, { minLength: 5, maxLength: 15 }),
          (convId, userId, messages) => {
            const config: AIConfig = { ...DEFAULT_AI_CONFIG, contextHistoryEnabled: true };
            const manager = new ContextManager(config);

            // Add messages
            messages.forEach(msg => {
              manager.addMessage(convId, msg, false);
            });

            // Reset context
            manager.resetContext(convId);

            // Get context - should only have system prompt
            const context = manager.getContext(convId, userId);
            expect(context.length).toBe(1);
            expect(context[0].role).toBe('system');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 11: Context exclusion when disabled', () => {
    /**
     * **Feature: ai-integration, Property 11: Context exclusion when disabled**
     * **Validates: Requirements 5.5**
     * 
     * For any message when context history is disabled, the LLM request messages array 
     * SHALL contain only the system prompt and the current user message.
     */
    it('should exclude history when context disabled', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.array(incomingMessageArb, { minLength: 5, maxLength: 20 }),
          messageTextArb,
          (convId, userId, messages, currentMsg) => {
            const config: AIConfig = {
              ...DEFAULT_AI_CONFIG,
              contextHistoryEnabled: false
            };
            const manager = new ContextManager(config);

            // Add many messages to history
            messages.forEach(msg => {
              manager.addMessage(convId, msg, false);
            });

            // Get context with current message
            const context = manager.getContext(convId, userId, currentMsg);

            // Should only have system prompt + current message
            expect(context.length).toBe(2);
            expect(context[0].role).toBe('system');
            expect(context[1].role).toBe('user');
            expect(context[1].content).toBe(currentMsg);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should only include system prompt when context disabled and no current message', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.array(incomingMessageArb, { minLength: 3, maxLength: 10 }),
          (convId, userId, messages) => {
            const config: AIConfig = {
              ...DEFAULT_AI_CONFIG,
              contextHistoryEnabled: false
            };
            const manager = new ContextManager(config);

            // Add messages
            messages.forEach(msg => {
              manager.addMessage(convId, msg, false);
            });

            // Get context without current message
            const context = manager.getContext(convId, userId);

            // Should only have system prompt
            expect(context.length).toBe(1);
            expect(context[0].role).toBe('system');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 16: User memory persistence round-trip', () => {
    /**
     * **Feature: ai-integration, Property 16: User memory persistence round-trip**
     * **Validates: Requirements 8.2**
     * 
     * For any user with stored memory, when building the LLM request context, 
     * the system prompt SHALL include the user's notes and facts.
     */
    it('should include user memory in system prompt when available', () => {
      fc.assert(
        fc.property(
          conversationIdArb,
          userIdArb,
          fc.array(
            fc.record({
              text: fc.string({ minLength: 1, maxLength: 100 }),
              from: fc.constantFrom('them' as const, 'me' as const),
              timestamp: fc.integer({ min: 1000000000000, max: Date.now() })
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (convId, userId, messages) => {
            // Setup: Store memory in localStorage
            const memory = {
              username: userId,
              messages: messages,
              firstSeen: Date.now() - 86400000,
              lastSeen: Date.now()
            };
            mockLocalStorage.setItem('snappy_memories', JSON.stringify({ [userId]: memory }));

            const config: AIConfig = { ...DEFAULT_AI_CONFIG };
            const manager = new ContextManager(config);

            // Get context
            const context = manager.getContext(convId, userId);

            // System prompt should contain user context
            expect(context[0].role).toBe('system');
            expect(context[0].content).toContain(userId);
            expect(context[0].content).toContain('Context about');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
