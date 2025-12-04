/**
 * Property-based tests for ProxyManager
 * 
 * @module proxyManager.property.test
 */

import * as fc from 'fast-check';
import { ProxyManager } from '../../src/main/proxyManager';
import { ProxyConfig, ProxyProtocol } from '../../src/types';

// Arbitraries for generating test data
const validHostArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-.'.split('')),
  { minLength: 3, maxLength: 30 }
).filter(s => !s.startsWith('-') && !s.endsWith('-') && !s.includes('..'));

const validPortArb = fc.integer({ min: 1, max: 65535 });
const invalidPortArb = fc.oneof(
  fc.integer({ min: -1000, max: 0 }),
  fc.integer({ min: 65536, max: 100000 })
);

const protocolArb = fc.constantFrom<ProxyProtocol>('http', 'https', 'socks5');

// Generate alphanumeric strings for username/password to avoid edge cases with special chars
const usernameArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
  { minLength: 1, maxLength: 20 }
);
const passwordArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
  { minLength: 1, maxLength: 20 }
);

const validProxyConfigArb = fc.record({
  host: validHostArb,
  port: validPortArb,
  protocol: protocolArb,
  username: fc.option(usernameArb, { nil: undefined }),
  password: fc.option(passwordArb, { nil: undefined })
}).map(config => {
  // Ensure username and password are both present or both absent
  if (config.username && !config.password) {
    config.password = 'pass123';
  } else if (!config.username && config.password) {
    config.username = 'user123';
  }
  return config;
});

describe('ProxyManager Property Tests', () => {
  // Create fresh manager for each test to ensure isolation
  const createManager = () => new ProxyManager();

  // **Feature: multi-session, Property 15: Proxy String Parsing**
  // **Validates: Requirements 8.5**
  describe('Property 15: Proxy String Parsing', () => {
    it('should parse host:port format correctly', () => {
      fc.assert(
        fc.property(
          validHostArb,
          validPortArb,
          (host, port) => {
            const manager = createManager();
            const proxyString = `${host}:${port}`;
            const result = manager.parseProxyString(proxyString);
            
            expect(result).not.toBeNull();
            expect(result!.host).toBe(host);
            expect(result!.port).toBe(port);
            expect(result!.protocol).toBe('http'); // Default protocol
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should parse host:port:username:password format correctly', () => {
      fc.assert(
        fc.property(
          validHostArb,
          validPortArb,
          usernameArb,
          passwordArb,
          (host, port, username, password) => {
            const manager = createManager();
            const proxyString = `${host}:${port}:${username}:${password}`;
            const result = manager.parseProxyString(proxyString);
            
            expect(result).not.toBeNull();
            expect(result!.host).toBe(host);
            expect(result!.port).toBe(port);
            expect(result!.username).toBe(username);
            expect(result!.password).toBe(password);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null for invalid proxy strings', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(''),
            fc.constant('invalid'),
            fc.constant('host:'),
            fc.constant(':1234'),
            fc.constant('host:abc'),
            fc.constant('host:-1'),
            fc.constant('host:99999')
          ),
          (invalidString) => {
            const manager = createManager();
            const result = manager.parseProxyString(invalidString);
            expect(result).toBeNull();
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // **Feature: multi-session, Property 12: Proxy Validation**
  // **Validates: Requirements 8.2**
  describe('Property 12: Proxy Validation', () => {
    it('should accept valid proxy configurations', () => {
      fc.assert(
        fc.property(
          validProxyConfigArb,
          (config) => {
            const manager = createManager();
            const isValid = manager.validateProxyConfig(config);
            expect(isValid).toBe(true);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject configurations with invalid ports', () => {
      fc.assert(
        fc.property(
          validHostArb,
          invalidPortArb,
          protocolArb,
          (host, port, protocol) => {
            const manager = createManager();
            const config = { host, port, protocol };
            const isValid = manager.validateProxyConfig(config);
            expect(isValid).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject configurations with empty host', () => {
      fc.assert(
        fc.property(
          validPortArb,
          protocolArb,
          (port, protocol) => {
            const manager = createManager();
            const config = { host: '', port, protocol };
            const isValid = manager.validateProxyConfig(config);
            expect(isValid).toBe(false);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should reject configurations with username but no password', () => {
      fc.assert(
        fc.property(
          validHostArb,
          validPortArb,
          protocolArb,
          usernameArb,
          (host, port, protocol, username) => {
            const manager = createManager();
            const config = { host, port, protocol, username, password: undefined };
            const isValid = manager.validateProxyConfig(config);
            expect(isValid).toBe(false);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // **Feature: multi-session, Property 6: Proxy Protocol Support**
  // **Validates: Requirements 3.3**
  describe('Property 6: Proxy Protocol Support', () => {
    it('should support http, https, and socks5 protocols', () => {
      fc.assert(
        fc.property(
          validHostArb,
          validPortArb,
          protocolArb,
          (host, port, protocol) => {
            const manager = createManager();
            const config = { host, port, protocol };
            const isValid = manager.validateProxyConfig(config);
            expect(isValid).toBe(true);
            
            // Should be able to add to pool
            const proxy = manager.addProxy(config);
            expect(proxy.protocol).toBe(protocol);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject invalid protocols', () => {
      const manager = createManager();
      const invalidProtocols = ['ftp', 'tcp', 'udp', '', 'HTTP', 'HTTPS'];
      
      for (const protocol of invalidProtocols) {
        const config = { host: 'test.com', port: 8080, protocol: protocol as ProxyProtocol };
        const isValid = manager.validateProxyConfig(config);
        expect(isValid).toBe(false);
      }
    });
  });

  // **Feature: multi-session, Property 13: Proxy Assignment Tracking**
  // **Validates: Requirements 8.3**
  describe('Property 13: Proxy Assignment Tracking', () => {
    it('should not allow assigning same proxy to multiple sessions', () => {
      fc.assert(
        fc.property(
          validProxyConfigArb,
          fc.string({ minLength: 5, maxLength: 20 }),
          fc.string({ minLength: 5, maxLength: 20 }),
          (config, sessionId1, sessionId2) => {
            const manager = createManager();
            // Ensure different session IDs
            if (sessionId1 === sessionId2) {
              sessionId2 = sessionId2 + '_different';
            }
            
            const proxy = manager.addProxy(config);
            
            // First assignment should succeed
            const firstAssign = manager.assignProxy(sessionId1, proxy.id);
            expect(firstAssign).toBe(true);
            
            // Second assignment to different session should fail
            const secondAssign = manager.assignProxy(sessionId2, proxy.id);
            expect(secondAssign).toBe(false);
            
            // Proxy should still be assigned to first session
            const assigned = manager.getAssignedProxy(sessionId1);
            expect(assigned).not.toBeNull();
            expect(assigned!.id).toBe(proxy.id);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove assigned proxy from available list', () => {
      fc.assert(
        fc.property(
          validProxyConfigArb,
          fc.string({ minLength: 5, maxLength: 20 }),
          (config, sessionId) => {
            const manager = createManager();
            const proxy = manager.addProxy(config);
            
            // Before assignment, proxy should be available
            let available = manager.getAvailableProxies();
            expect(available.some(p => p.id === proxy.id)).toBe(true);
            
            // Assign proxy
            manager.assignProxy(sessionId, proxy.id);
            
            // After assignment, proxy should not be available
            available = manager.getAvailableProxies();
            expect(available.some(p => p.id === proxy.id)).toBe(false);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow reassignment after unassignment', () => {
      fc.assert(
        fc.property(
          validProxyConfigArb,
          fc.string({ minLength: 5, maxLength: 20 }),
          fc.string({ minLength: 5, maxLength: 20 }),
          (config, sessionId1, sessionId2) => {
            const manager = createManager();
            if (sessionId1 === sessionId2) {
              sessionId2 = sessionId2 + '_different';
            }
            
            const proxy = manager.addProxy(config);
            
            // Assign to first session
            manager.assignProxy(sessionId1, proxy.id);
            
            // Unassign
            manager.unassignProxy(sessionId1);
            
            // Should now be assignable to second session
            const reassign = manager.assignProxy(sessionId2, proxy.id);
            expect(reassign).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: multi-session, Property 14: Proxy Pool Count Accuracy**
  // **Validates: Requirements 8.4**
  describe('Property 14: Proxy Pool Count Accuracy', () => {
    it('should accurately count unassigned proxies', () => {
      fc.assert(
        fc.property(
          fc.array(validProxyConfigArb, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 10 }),
          (configs, assignCount) => {
            const manager = createManager();
            // Add all proxies
            const proxies: ProxyConfig[] = [];
            for (const config of configs) {
              proxies.push(manager.addProxy(config));
            }
            
            // Assign some proxies
            const toAssign = Math.min(assignCount, proxies.length);
            for (let i = 0; i < toAssign; i++) {
              manager.assignProxy(`session_${i}`, proxies[i].id);
            }
            
            // Count should be accurate
            const expectedUnassigned = proxies.length - toAssign;
            const actualUnassigned = manager.getUnassignedCount();
            
            expect(actualUnassigned).toBe(expectedUnassigned);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should emit poolLow event when fewer than 2 unassigned', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          (proxyCount) => {
            const manager = createManager();
            let poolLowEmitted = false;
            manager.on('poolLow', () => {
              poolLowEmitted = true;
            });
            
            // Add proxies
            const proxies: ProxyConfig[] = [];
            for (let i = 0; i < proxyCount; i++) {
              proxies.push(manager.addProxy({
                host: `proxy${i}.test.com`,
                port: 8080 + i,
                protocol: 'http'
              }));
            }
            
            // Assign all but one (or all if only 1)
            const toAssign = Math.max(0, proxyCount - 1);
            for (let i = 0; i < toAssign; i++) {
              manager.assignProxy(`session_${i}`, proxies[i].id);
            }
            
            // If unassigned < 2, poolLow should have been emitted
            const unassigned = manager.getUnassignedCount();
            if (unassigned < 2) {
              expect(poolLowEmitted).toBe(true);
            }
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
