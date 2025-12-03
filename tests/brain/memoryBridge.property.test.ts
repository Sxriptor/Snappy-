/**
 * Property-Based Tests for Memory Bridge
 * 
 * **Feature: ai-integration, Property 15: User memory inclusion in context**
 * **Validates: Requirements 8.2**
 */

import * as fc from 'fast-check';
import { ExistingUserMemory } from '../../src/types';

// Mock localStorage for testing
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

// Setup mock localStorage
const mockLocalStorage = new MockLocalStorage();
(global as any).localStorage = mockLocalStorage;

// Import after setting up localStorage mock
import { getFormattedMemory, getRecentMessages, getUserMemory, hasMemory } from '../../src/brain/memoryBridge';

describe('Memory Bridge Property Tests', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  describe('Property 15: User memory inclusion in context', () => {
    // Arbitrary for generating usernames
    const usernameArb = fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0);

    // Arbitrary for generating messages
    const messageArb = fc.record({
      text: fc.string({ minLength: 1, maxLength: 200 }),
      from: fc.constantFrom('them' as const, 'me' as const),
      timestamp: fc.integer({ min: 1000000000000, max: Date.now() })
    });

    // Arbitrary for generating user memory
    const userMemoryArb = fc.record({
      username: usernameArb,
      messages: fc.array(messageArb, { minLength: 1, maxLength: 50 }),
      firstSeen: fc.integer({ min: 1000000000000, max: Date.now() }),
      lastSeen: fc.integer({ min: 1000000000000, max: Date.now() })
    });

    it('should include username in formatted memory', () => {
      fc.assert(
        fc.property(userMemoryArb, (memory) => {
          // Setup: Store memory in localStorage
          const memories = { [memory.username]: memory };
          mockLocalStorage.setItem('snappy_memories', JSON.stringify(memories));

          // Execute
          const formatted = getFormattedMemory(memory.username);

          // Verify: Username should appear in the formatted output
          expect(formatted).toContain(memory.username);
        }),
        { numRuns: 100 }
      );
    });

    it('should include message count information', () => {
      fc.assert(
        fc.property(userMemoryArb, (memory) => {
          // Setup
          const memories = { [memory.username]: memory };
          mockLocalStorage.setItem('snappy_memories', JSON.stringify(memories));

          // Execute
          const formatted = getFormattedMemory(memory.username);

          // Verify: Should contain message count info
          const theirCount = memory.messages.filter(m => m.from === 'them').length;
          const myCount = memory.messages.filter(m => m.from === 'me').length;
          
          expect(formatted).toContain('Messages exchanged');
          expect(formatted).toContain(theirCount.toString());
          expect(formatted).toContain(myCount.toString());
        }),
        { numRuns: 100 }
      );
    });

    it('should include recent messages in formatted output', () => {
      fc.assert(
        fc.property(userMemoryArb, (memory) => {
          // Setup
          const memories = { [memory.username]: memory };
          mockLocalStorage.setItem('snappy_memories', JSON.stringify(memories));

          // Execute
          const formatted = getFormattedMemory(memory.username);

          // Verify: Should contain text from recent messages (last 5)
          const recentMessages = memory.messages.slice(-5);
          const hasRecentContent = recentMessages.some(msg => {
            const snippet = msg.text.substring(0, 80);
            return formatted.includes(snippet);
          });
          
          expect(hasRecentContent).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should return empty string when no memory exists', () => {
      fc.assert(
        fc.property(usernameArb, (username) => {
          // Setup: No memory stored
          mockLocalStorage.clear();

          // Execute
          const formatted = getFormattedMemory(username);

          // Verify: Should return empty string
          expect(formatted).toBe('');
        }),
        { numRuns: 100 }
      );
    });

    it('should format recent messages with correct roles', () => {
      fc.assert(
        fc.property(userMemoryArb, fc.integer({ min: 1, max: 20 }), (memory, limit) => {
          // Setup
          const memories = { [memory.username]: memory };
          mockLocalStorage.setItem('snappy_memories', JSON.stringify(memories));

          // Execute
          const messages = getRecentMessages(memory.username, limit);

          // Verify: All messages should have correct role mapping
          const expectedCount = Math.min(memory.messages.length, limit);
          expect(messages.length).toBeLessThanOrEqual(expectedCount);
          
          messages.forEach((msg, idx) => {
            const originalIdx = memory.messages.length - messages.length + idx;
            const originalMsg = memory.messages[originalIdx];
            
            const expectedRole = originalMsg.from === 'them' ? 'user' : 'assistant';
            expect(msg.role).toBe(expectedRole);
            expect(msg.content).toBe(originalMsg.text);
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should respect message limit in getRecentMessages', () => {
      fc.assert(
        fc.property(userMemoryArb, fc.integer({ min: 1, max: 50 }), (memory, limit) => {
          // Setup
          const memories = { [memory.username]: memory };
          mockLocalStorage.setItem('snappy_memories', JSON.stringify(memories));

          // Execute
          const messages = getRecentMessages(memory.username, limit);

          // Verify: Should not exceed limit
          expect(messages.length).toBeLessThanOrEqual(limit);
          expect(messages.length).toBeLessThanOrEqual(memory.messages.length);
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly identify when memory exists', () => {
      fc.assert(
        fc.property(userMemoryArb, (memory) => {
          // Setup
          const memories = { [memory.username]: memory };
          mockLocalStorage.setItem('snappy_memories', JSON.stringify(memories));

          // Execute & Verify
          expect(hasMemory(memory.username)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly identify when memory does not exist', () => {
      fc.assert(
        fc.property(usernameArb, (username) => {
          // Setup: Clear storage
          mockLocalStorage.clear();

          // Execute & Verify
          expect(hasMemory(username)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle empty message arrays', () => {
      fc.assert(
        fc.property(usernameArb, (username) => {
          // Setup: Memory with no messages
          const memory: ExistingUserMemory = {
            username,
            messages: [],
            firstSeen: Date.now(),
            lastSeen: Date.now()
          };
          const memories = { [username]: memory };
          mockLocalStorage.setItem('snappy_memories', JSON.stringify(memories));

          // Execute
          const formatted = getFormattedMemory(username);
          const messages = getRecentMessages(username);

          // Verify: Should handle gracefully
          expect(formatted).toBe('');
          expect(messages).toEqual([]);
          expect(hasMemory(username)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('getUserMemory', () => {
    it('should return null for non-existent users', () => {
      fc.assert(
        fc.property(fc.string(), (username) => {
          mockLocalStorage.clear();
          const memory = getUserMemory(username);
          expect(memory).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it('should return stored memory for existing users', () => {
      fc.assert(
        fc.property(
          fc.record({
            username: fc.string({ minLength: 1, maxLength: 20 }),
            messages: fc.array(
              fc.record({
                text: fc.string(),
                from: fc.constantFrom('them' as const, 'me' as const),
                timestamp: fc.integer()
              })
            ),
            firstSeen: fc.integer(),
            lastSeen: fc.integer()
          }),
          (memory) => {
            const memories = { [memory.username]: memory };
            mockLocalStorage.setItem('snappy_memories', JSON.stringify(memories));

            const retrieved = getUserMemory(memory.username);
            expect(retrieved).toEqual(memory);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
