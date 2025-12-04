/**
 * Proxy Manager
 * Manages proxy pool, assignments, authentication, and rotation
 * 
 * @module proxyManager
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { ProxyConfig, ProxyPoolEntry, ProxyProtocol, ProxyStatus } from '../types';

/**
 * ProxyManager class
 * Handles proxy pool management, assignment tracking, and rotation
 */
export class ProxyManager extends EventEmitter {
  private pool: Map<string, ProxyPoolEntry> = new Map();
  private rotationTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
  }

  // ============================================================================
  // Pool Management
  // ============================================================================

  /**
   * Add a proxy to the pool
   */
  addProxy(proxy: Omit<ProxyConfig, 'id'>): ProxyConfig {
    // Validate before adding
    if (!this.validateProxyConfig(proxy)) {
      throw new Error('Invalid proxy configuration');
    }

    const id = this.generateProxyId();
    const proxyWithId: ProxyConfig = { ...proxy, id };
    
    const entry: ProxyPoolEntry = {
      proxy: proxyWithId,
      status: 'available',
      assignedTo: null,
      lastUsed: null,
      errorCount: 0
    };

    this.pool.set(id, entry);
    this.checkPoolLow();
    
    return proxyWithId;
  }

  /**
   * Remove a proxy from the pool
   */
  removeProxy(proxyId: string): boolean {
    const entry = this.pool.get(proxyId);
    if (!entry) {
      return false;
    }

    // Stop rotation if active
    this.stopRotation(entry.assignedTo || '');
    
    this.pool.delete(proxyId);
    this.checkPoolLow();
    
    return true;
  }

  /**
   * Get all proxies in the pool
   */
  getPool(): ProxyPoolEntry[] {
    return Array.from(this.pool.values());
  }

  /**
   * Get available (unassigned) proxies
   */
  getAvailableProxies(): ProxyConfig[] {
    return Array.from(this.pool.values())
      .filter(entry => entry.status === 'available' && entry.assignedTo === null)
      .map(entry => entry.proxy);
  }

  /**
   * Get count of unassigned proxies
   */
  getUnassignedCount(): number {
    return Array.from(this.pool.values())
      .filter(entry => entry.assignedTo === null)
      .length;
  }

  /**
   * Import proxies from a list string (host:port:user:pass format)
   */
  importProxies(proxyList: string): ProxyConfig[] {
    const lines = proxyList.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const imported: ProxyConfig[] = [];

    for (const line of lines) {
      const parsed = this.parseProxyString(line);
      if (parsed) {
        try {
          const proxy = this.addProxy(parsed);
          imported.push(proxy);
        } catch (e) {
          // Skip invalid proxies
        }
      }
    }

    return imported;
  }

  // ============================================================================
  // Proxy String Parsing
  // ============================================================================

  /**
   * Parse a proxy string into ProxyConfig
   * Supports formats:
   * - host:port
   * - host:port:username:password
   * - protocol://host:port
   * - protocol://username:password@host:port
   */
  parseProxyString(proxyString: string): Omit<ProxyConfig, 'id'> | null {
    if (!proxyString || typeof proxyString !== 'string') {
      return null;
    }

    const trimmed = proxyString.trim();
    if (trimmed.length === 0) {
      return null;
    }

    // Try URL format first (protocol://...)
    if (trimmed.includes('://')) {
      return this.parseProxyUrl(trimmed);
    }

    // Try simple format (host:port or host:port:user:pass)
    return this.parseSimpleProxyString(trimmed);
  }

  private parseProxyUrl(url: string): Omit<ProxyConfig, 'id'> | null {
    try {
      // Extract protocol
      const protocolMatch = url.match(/^(https?|socks5):\/\//i);
      if (!protocolMatch) {
        return null;
      }

      const protocol = protocolMatch[1].toLowerCase() as ProxyProtocol;
      const rest = url.substring(protocolMatch[0].length);

      // Check for auth (user:pass@)
      let host: string;
      let port: number;
      let username: string | undefined;
      let password: string | undefined;

      if (rest.includes('@')) {
        const [auth, hostPort] = rest.split('@');
        const [user, pass] = auth.split(':');
        username = user;
        password = pass;
        
        const [h, p] = hostPort.split(':');
        host = h;
        port = parseInt(p, 10);
      } else {
        const [h, p] = rest.split(':');
        host = h;
        port = parseInt(p, 10);
      }

      if (!host || isNaN(port) || port < 1 || port > 65535) {
        return null;
      }

      return { host, port, protocol, username, password };
    } catch {
      return null;
    }
  }

  private parseSimpleProxyString(str: string): Omit<ProxyConfig, 'id'> | null {
    const parts = str.split(':');
    
    if (parts.length < 2) {
      return null;
    }

    const host = parts[0];
    const port = parseInt(parts[1], 10);

    if (!host || isNaN(port) || port < 1 || port > 65535) {
      return null;
    }

    const result: Omit<ProxyConfig, 'id'> = {
      host,
      port,
      protocol: 'http' // Default protocol
    };

    // Optional username and password (parts 2 and 3+)
    if (parts.length >= 4) {
      // Join remaining parts for password (in case password contains colons)
      result.username = parts[2];
      result.password = parts.slice(3).join(':');
    } else if (parts.length === 3) {
      // Could be host:port:username (no password) - treat as invalid
      return null;
    }

    return result;
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate a proxy configuration
   */
  validateProxyConfig(proxy: Omit<ProxyConfig, 'id'>): boolean {
    if (!proxy) return false;
    
    // Host validation
    if (!proxy.host || typeof proxy.host !== 'string' || proxy.host.trim().length === 0) {
      return false;
    }

    // Port validation
    if (typeof proxy.port !== 'number' || proxy.port < 1 || proxy.port > 65535) {
      return false;
    }

    // Protocol validation
    const validProtocols: ProxyProtocol[] = ['http', 'https', 'socks5'];
    if (!validProtocols.includes(proxy.protocol)) {
      return false;
    }

    // If username is provided, password should also be provided (and vice versa)
    const hasUsername = proxy.username !== undefined && proxy.username !== null && proxy.username.length > 0;
    const hasPassword = proxy.password !== undefined && proxy.password !== null && proxy.password.length > 0;
    
    if (hasUsername !== hasPassword) {
      return false;
    }

    return true;
  }

  /**
   * Validate proxy (async - could test connection in future)
   */
  async validateProxy(proxy: ProxyConfig): Promise<boolean> {
    return this.validateProxyConfig(proxy);
  }

  // ============================================================================
  // Assignment
  // ============================================================================

  /**
   * Assign a proxy to a session by proxy ID
   */
  assignProxy(sessionId: string, proxyId: string): boolean {
    const entry = this.pool.get(proxyId);
    if (!entry) {
      return false;
    }

    // Check if already assigned
    if (entry.assignedTo !== null) {
      return false;
    }

    entry.assignedTo = sessionId;
    entry.status = 'assigned';
    entry.lastUsed = Date.now();

    this.checkPoolLow();
    this.emit('proxyAssigned', { sessionId, proxy: entry.proxy });
    
    return true;
  }

  /**
   * Assign a proxy config directly to a session
   */
  assignProxyToSession(sessionId: string, proxy: ProxyConfig): boolean {
    return this.assignProxy(sessionId, proxy.id);
  }

  /**
   * Unassign proxy from a session
   */
  unassignProxy(sessionId: string): ProxyConfig | null {
    for (const [, entry] of this.pool) {
      if (entry.assignedTo === sessionId) {
        entry.assignedTo = null;
        entry.status = 'available';
        this.stopRotation(sessionId);
        return entry.proxy;
      }
    }
    return null;
  }

  /**
   * Get proxy assigned to a session
   */
  getAssignedProxy(sessionId: string): ProxyConfig | null {
    for (const [, entry] of this.pool) {
      if (entry.assignedTo === sessionId) {
        return entry.proxy;
      }
    }
    return null;
  }

  /**
   * Check if a proxy is assigned to any session
   */
  isProxyAssigned(proxyId: string): boolean {
    const entry = this.pool.get(proxyId);
    return entry ? entry.assignedTo !== null : false;
  }

  // ============================================================================
  // Rotation
  // ============================================================================

  /**
   * Start proxy rotation for a session
   */
  startRotation(sessionId: string, intervalMs: number): void {
    // Stop existing rotation
    this.stopRotation(sessionId);

    const timer = setInterval(() => {
      this.rotateProxy(sessionId);
    }, intervalMs);

    this.rotationTimers.set(sessionId, timer);
  }

  /**
   * Stop proxy rotation for a session
   */
  stopRotation(sessionId: string): void {
    const timer = this.rotationTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.rotationTimers.delete(sessionId);
    }
  }

  /**
   * Rotate to a new proxy for a session
   */
  async rotateProxy(sessionId: string): Promise<ProxyConfig | null> {
    // Unassign current proxy
    this.unassignProxy(sessionId);

    // Get available proxies
    const available = this.getAvailableProxies();
    if (available.length === 0) {
      this.emit('proxyError', { sessionId, error: 'No available proxies for rotation' });
      return null;
    }

    // Pick a random available proxy
    const newProxy = available[Math.floor(Math.random() * available.length)];
    
    if (this.assignProxy(sessionId, newProxy.id)) {
      return newProxy;
    }

    return null;
  }

  // ============================================================================
  // Electron Integration (stubs for now - will be implemented in main.ts)
  // ============================================================================

  /**
   * Apply proxy to an Electron partition
   * This is a stub - actual implementation requires Electron session API
   */
  async applyProxyToPartition(partition: string, proxy: ProxyConfig): Promise<void> {
    // Will be implemented in main.ts using:
    // const ses = session.fromPartition(partition);
    // await ses.setProxy({ proxyRules: `${proxy.protocol}://${proxy.host}:${proxy.port}` });
    
    // For now, just emit an event
    this.emit('proxyApplied', { partition, proxy });
  }

  /**
   * Handle proxy authentication
   * This is a stub - actual implementation requires Electron app.on('login')
   */
  handleProxyAuth(authInfo: { host: string; port: number }, callback: (username?: string, password?: string) => void): void {
    // Find proxy matching the auth request
    for (const [, entry] of this.pool) {
      if (entry.proxy.host === authInfo.host && entry.proxy.port === authInfo.port) {
        if (entry.proxy.username && entry.proxy.password) {
          callback(entry.proxy.username, entry.proxy.password);
          return;
        }
      }
    }
    
    // No matching proxy found, cancel auth
    callback();
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  /**
   * Record a proxy error
   */
  recordProxyError(proxyId: string, error: string): void {
    const entry = this.pool.get(proxyId);
    if (entry) {
      entry.errorCount++;
      entry.status = 'error';
      this.emit('proxyError', { proxyId, error, errorCount: entry.errorCount });
    }
  }

  /**
   * Clear proxy errors
   */
  clearProxyErrors(proxyId: string): void {
    const entry = this.pool.get(proxyId);
    if (entry) {
      entry.errorCount = 0;
      if (entry.assignedTo === null) {
        entry.status = 'available';
      }
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private generateProxyId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private checkPoolLow(): void {
    const unassigned = this.getUnassignedCount();
    if (unassigned < 2) {
      this.emit('poolLow', { unassignedCount: unassigned });
    }
  }

  /**
   * Clear all proxies and timers
   */
  clear(): void {
    // Stop all rotation timers
    for (const [sessionId] of this.rotationTimers) {
      this.stopRotation(sessionId);
    }
    this.pool.clear();
  }

  /**
   * Get pool size
   */
  getPoolSize(): number {
    return this.pool.size;
  }
}

// Export singleton instance
export const proxyManager = new ProxyManager();
