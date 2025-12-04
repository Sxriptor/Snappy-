/**
 * Property-based tests for SessionManager
 * 
 * @module sessionManager.property.test
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager } from '../../src/main/sessionManager';
import { FingerprintGenerator } from '../../src/main/fingerprintGenerator';
import { ProxyManager } from '../../src/main/proxyManager';
import { SessionConfig, DEFAULT_SESSION_CONFIG } from '../../src/types';

// Test file path
const TEST_PERSIST_PATH = path.join(__dirname, 'test-sessions.json');

// Cleanup helper
const cleanup = () => {
  try {
    if (fs.existsSync(TEST_PERSIST_PATH)) {
      fs.unlinkSync(TEST_PERSIST_PATH);
    }
  } catch (e) {
    // Ignore
  }
};

// Session config arbitrary
const sessionConfigArb = fc.record({
  initialUrl: fc.webUrl(),
  autoInject: fc.boolean(),
  replyRules: fc.constant([]),
  typingDelayRangeMs: fc.tuple(fc.nat(500), fc.nat(500)).map(([a, b]) => [a, a + b] as [number, number]),
  preReplyDelayRangeMs: fc.tuple(fc.nat(2000), fc.nat(2000)).map(([a, b]) => [a, a + b] as [number, number]),
  maxRepliesPerMinute: fc.integer({ min: 1, max: 60 }),
  maxRepliesPerHour: fc.integer({ min: 1, max: 100 }),
  maxReplyLength: fc.integer({ min: 50, max: 1000 }),
  siteMode: fc.constantFrom('universal', 'snapchat', 'twitter') as fc.Arbitrary<'universal' | 'snapchat' | 'twitter'>,
  randomSkipProbability: fc.float({ min: 0, max: 1 })
});

const sessionNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

describe('SessionManager Property Tests', () => {
  afterAll(cleanup);

  // **Feature: multi-session, Property 1: Session ID and Partition Uniqueness**
  // **Validates: Requirements 1.1, 1.2, 1.4**
  describe('Property 1: Session ID and Partition Uniqueness', () => {
    it('should generate unique session IDs and partitions', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 5, max: 20 }),
          (sessionCount) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            const ids = new Set<string>();
            const partitions = new Set<string>();

            for (let i = 0; i < sessionCount; i++) {
              const session = manager.createSession();
              
              // ID should be unique
              expect(ids.has(session.id)).toBe(false);
              ids.add(session.id);
              
              // Partition should be unique
              expect(partitions.has(session.partition)).toBe(false);
              partitions.add(session.partition);
              
              // Partition should follow format
              expect(session.partition).toMatch(/^persist:session_[a-f0-9]+$/);
            }

            expect(ids.size).toBe(sessionCount);
            expect(partitions.size).toBe(sessionCount);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should generate cryptographically random IDs (32 hex chars)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (_iteration) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            const session = manager.createSession();
            
            // ID should be 32 hex characters (16 bytes)
            expect(session.id).toMatch(/^[a-f0-9]{32}$/);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: multi-session, Property 8: Session Configuration Isolation**
  // **Validates: Requirements 6.2**
  describe('Property 8: Session Configuration Isolation', () => {
    it('should not affect other sessions when updating config', () => {
      fc.assert(
        fc.property(
          sessionConfigArb,
          sessionConfigArb,
          (config1, config2) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            
            // Create two sessions with different configs
            const session1 = manager.createSession(config1, 'Session 1');
            const session2 = manager.createSession(config2, 'Session 2');
            
            // Store original config2 values
            const originalConfig2 = { ...session2.config };
            
            // Update session1's config
            const newConfig: Partial<SessionConfig> = {
              initialUrl: 'https://updated.example.com',
              maxRepliesPerMinute: 99
            };
            manager.updateSessionConfig(session1.id, newConfig);
            
            // Session2's config should be unchanged
            const updatedSession2 = manager.getSession(session2.id);
            expect(updatedSession2!.config.initialUrl).toBe(originalConfig2.initialUrl);
            expect(updatedSession2!.config.maxRepliesPerMinute).toBe(originalConfig2.maxRepliesPerMinute);
            
            // Session1's config should be updated
            const updatedSession1 = manager.getSession(session1.id);
            expect(updatedSession1!.config.initialUrl).toBe('https://updated.example.com');
            expect(updatedSession1!.config.maxRepliesPerMinute).toBe(99);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // **Feature: multi-session, Property 9: Session Configuration Update Persistence**
  // **Validates: Requirements 6.3**
  describe('Property 9: Session Configuration Update Persistence', () => {
    it('should persist config updates to session object', () => {
      fc.assert(
        fc.property(
          sessionConfigArb,
          fc.webUrl(),
          fc.integer({ min: 1, max: 60 }),
          (initialConfig, newUrl, newMaxReplies) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            
            const session = manager.createSession(initialConfig);
            
            // Update config
            manager.updateSessionConfig(session.id, {
              initialUrl: newUrl,
              maxRepliesPerMinute: newMaxReplies
            });
            
            // Get session and verify update
            const updated = manager.getSession(session.id);
            expect(updated).toBeDefined();
            expect(updated!.config.initialUrl).toBe(newUrl);
            expect(updated!.config.maxRepliesPerMinute).toBe(newMaxReplies);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: multi-session, Property 10: Session Creation with Parameters**
  // **Validates: Requirements 6.4**
  describe('Property 10: Session Creation with Parameters', () => {
    it('should create sessions with specified parameters', () => {
      fc.assert(
        fc.property(
          sessionConfigArb,
          sessionNameArb,
          (config, name) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            
            const session = manager.createSession(config, name);
            
            // Verify name
            expect(session.name).toBe(name);
            
            // Verify config values
            expect(session.config.initialUrl).toBe(config.initialUrl);
            expect(session.config.autoInject).toBe(config.autoInject);
            expect(session.config.maxRepliesPerMinute).toBe(config.maxRepliesPerMinute);
            expect(session.config.siteMode).toBe(config.siteMode);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use default config when not specified', () => {
      fc.assert(
        fc.property(
          sessionNameArb,
          (name) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            
            const session = manager.createSession(undefined, name);
            
            // Should have default config values
            expect(session.config.initialUrl).toBe(DEFAULT_SESSION_CONFIG.initialUrl);
            expect(session.config.autoInject).toBe(DEFAULT_SESSION_CONFIG.autoInject);
            expect(session.config.maxRepliesPerMinute).toBe(DEFAULT_SESSION_CONFIG.maxRepliesPerMinute);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // **Feature: multi-session, Property 11: Session Persistence Round-Trip**
  // **Validates: Requirements 7.1, 7.2, 7.3**
  describe('Property 11: Session Persistence Round-Trip', () => {
    it('should preserve all session data through persist/load cycle', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              config: sessionConfigArb,
              name: sessionNameArb
            }),
            { minLength: 1, maxLength: 5 }
          ),
          async (sessionSpecs) => {
            cleanup();
            
            // Create manager and sessions
            const manager1 = new SessionManager(TEST_PERSIST_PATH);
            const originalSessions: Array<{
              id: string;
              name: string;
              partition: string;
              config: SessionConfig;
            }> = [];

            for (const spec of sessionSpecs) {
              const session = manager1.createSession(spec.config, spec.name);
              originalSessions.push({
                id: session.id,
                name: session.name,
                partition: session.partition,
                config: { ...session.config }
              });
            }

            // Persist
            await manager1.persist();

            // Create new manager and load
            const manager2 = new SessionManager(TEST_PERSIST_PATH);
            await manager2.load();

            // Verify all sessions restored
            expect(manager2.getSessionCount()).toBe(originalSessions.length);

            for (const original of originalSessions) {
              const restored = manager2.getSession(original.id);
              expect(restored).toBeDefined();
              expect(restored!.name).toBe(original.name);
              expect(restored!.partition).toBe(original.partition);
              expect(restored!.config.initialUrl).toBe(original.config.initialUrl);
              expect(restored!.config.maxRepliesPerMinute).toBe(original.config.maxRepliesPerMinute);
              expect(restored!.config.siteMode).toBe(original.config.siteMode);
            }

            manager1.clear();
            manager2.clear();
            cleanup();
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  // **Feature: multi-session, Property 16: Hibernation Round-Trip**
  // **Validates: Requirements 9.2, 9.3**
  describe('Property 16: Hibernation Round-Trip', () => {
    it('should preserve session data through hibernate/restore cycle', () => {
      fc.assert(
        fc.property(
          sessionConfigArb,
          sessionNameArb,
          (config, name) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            
            // Create session
            const session = manager.createSession(config, name);
            const originalId = session.id;
            const originalPartition = session.partition;
            const originalFingerprint = { ...session.fingerprint };
            const originalConfig = { ...session.config };
            
            // Verify initial state
            expect(session.state).toBe('active');
            
            // Hibernate
            const hibernateResult = manager.hibernateSession(session.id);
            expect(hibernateResult).toBe(true);
            
            // Verify hibernated state
            const hibernated = manager.getSession(session.id);
            expect(hibernated!.state).toBe('hibernated');
            
            // Restore
            const restoreResult = manager.restoreSession(session.id);
            expect(restoreResult).toBe(true);
            
            // Verify restored state and data preservation
            const restored = manager.getSession(session.id);
            expect(restored!.state).toBe('active');
            expect(restored!.id).toBe(originalId);
            expect(restored!.partition).toBe(originalPartition);
            expect(restored!.fingerprint.userAgent).toBe(originalFingerprint.userAgent);
            expect(restored!.fingerprint.platform).toBe(originalFingerprint.platform);
            expect(restored!.config.initialUrl).toBe(originalConfig.initialUrl);
            expect(restored!.config.maxRepliesPerMinute).toBe(originalConfig.maxRepliesPerMinute);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not allow hibernating already hibernated session', () => {
      fc.assert(
        fc.property(
          sessionNameArb,
          (name) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            
            const session = manager.createSession(undefined, name);
            
            // First hibernate should succeed
            expect(manager.hibernateSession(session.id)).toBe(true);
            
            // Second hibernate should fail
            expect(manager.hibernateSession(session.id)).toBe(false);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should not allow restoring non-hibernated session', () => {
      fc.assert(
        fc.property(
          sessionNameArb,
          (name) => {
            const manager = new SessionManager(TEST_PERSIST_PATH);
            
            const session = manager.createSession(undefined, name);
            
            // Restore on active session should fail
            expect(manager.restoreSession(session.id)).toBe(false);
            
            manager.clear();
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
