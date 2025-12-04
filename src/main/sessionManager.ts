/**
 * Session Manager
 * Manages multiple browser sessions with isolated partitions, fingerprints, and configurations
 * 
 * @module sessionManager
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
  Session,
  SessionState,
  SessionConfig,
  SerializedSession,
  SessionsFile,
  BrowserFingerprint,
  ProxyConfig,
  DEFAULT_SESSION_CONFIG,
  SESSIONS_FILE_VERSION
} from '../types';
import { FingerprintGenerator } from './fingerprintGenerator';
import { ProxyManager } from './proxyManager';

/**
 * SessionManager class
 * Handles session lifecycle, persistence, and hibernation
 */
export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private persistPath: string;
  private persistDebounceTimer: NodeJS.Timeout | null = null;
  private fingerprintGenerator: FingerprintGenerator;
  private proxyManager: ProxyManager;

  constructor(
    persistPath: string = 'sessions.json',
    fingerprintGenerator?: FingerprintGenerator,
    proxyManager?: ProxyManager
  ) {
    super();
    this.persistPath = persistPath;
    this.fingerprintGenerator = fingerprintGenerator || new FingerprintGenerator();
    this.proxyManager = proxyManager || new ProxyManager();
  }

  // ============================================================================
  // Session Lifecycle
  // ============================================================================

  /**
   * Create a new session
   */
  createSession(
    config?: Partial<SessionConfig>,
    name?: string,
    proxy?: ProxyConfig
  ): Session {
    const id = this.generateSessionId();
    const partition = `persist:session_${id}`;
    const fingerprint = this.fingerprintGenerator.generate();
    const now = Date.now();

    const session: Session = {
      id,
      name: name || `Session ${this.sessions.size + 1}`,
      partition,
      fingerprint,
      proxy: proxy || null,
      config: { ...DEFAULT_SESSION_CONFIG, ...config },
      state: 'active',
      createdAt: now,
      lastActiveAt: now
    };

    this.sessions.set(id, session);
    this.emit('sessionCreated', session);
    this.schedulePersist();

    return session;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Release fingerprint for reuse
    this.fingerprintGenerator.releaseFingerprint(session.fingerprint);

    // Unassign proxy if assigned
    if (session.proxy) {
      this.proxyManager.unassignProxy(sessionId);
    }

    this.sessions.delete(sessionId);
    this.emit('sessionDeleted', sessionId);
    this.schedulePersist();

    return true;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  // ============================================================================
  // Session Configuration
  // ============================================================================

  /**
   * Update session configuration
   */
  updateSessionConfig(sessionId: string, config: Partial<SessionConfig>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.config = { ...session.config, ...config };
    session.lastActiveAt = Date.now();
    this.emit('sessionConfigUpdated', { sessionId, config: session.config });
    this.schedulePersist();

    return true;
  }

  /**
   * Update session state
   */
  updateSessionState(sessionId: string, state: SessionState): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = state;
      session.lastActiveAt = Date.now();
      this.emit('sessionStateChanged', { sessionId, state });
    }
  }

  /**
   * Update last active timestamp
   */
  updateLastActive(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = Date.now();
    }
  }

  /**
   * Rename a session
   */
  renameSession(sessionId: string, name: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.name = name;
    this.emit('sessionRenamed', { sessionId, name });
    this.schedulePersist();

    return true;
  }

  // ============================================================================
  // Hibernation
  // ============================================================================

  /**
   * Hibernate a session (unload webview, preserve config)
   */
  hibernateSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state === 'hibernated') {
      return false;
    }

    session.state = 'hibernated';
    this.emit('sessionHibernated', sessionId);
    this.schedulePersist();

    return true;
  }

  /**
   * Restore a hibernated session
   */
  restoreSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'hibernated') {
      return false;
    }

    session.state = 'active';
    session.lastActiveAt = Date.now();
    this.emit('sessionRestored', sessionId);
    this.schedulePersist();

    return true;
  }

  /**
   * Get hibernated sessions
   */
  getHibernatedSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.state === 'hibernated');
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.state === 'active');
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Persist sessions to file
   */
  async persist(): Promise<void> {
    const data: SessionsFile = {
      version: SESSIONS_FILE_VERSION,
      sessions: this.serializeSessions(),
      proxyPool: this.proxyManager.getPool().map(entry => entry.proxy)
    };

    const json = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(this.persistPath, json, 'utf-8');
  }

  /**
   * Load sessions from file
   */
  async load(): Promise<void> {
    try {
      const json = await fs.promises.readFile(this.persistPath, 'utf-8');
      const data: SessionsFile = JSON.parse(json);

      // Clear existing sessions
      this.sessions.clear();

      // Restore sessions
      for (const serialized of data.sessions) {
        const session: Session = {
          ...serialized,
          state: 'active' // Start all sessions as active
        };
        this.sessions.set(session.id, session);
        this.fingerprintGenerator.markUsed(session.fingerprint);
      }

      // Restore proxy pool
      for (const proxy of data.proxyPool) {
        try {
          this.proxyManager.addProxy(proxy);
        } catch (e) {
          // Skip invalid proxies
        }
      }

      this.emit('sessionsLoaded', this.getAllSessions());
    } catch (error) {
      // File doesn't exist or is invalid - start fresh
      this.sessions.clear();
    }
  }

  /**
   * Schedule a debounced persist
   */
  private schedulePersist(): void {
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer);
    }

    this.persistDebounceTimer = setTimeout(() => {
      this.persist().catch(err => {
        this.emit('persistError', err);
      });
    }, 5000); // 5 second debounce
  }

  /**
   * Serialize sessions for persistence
   */
  private serializeSessions(): SerializedSession[] {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      name: session.name,
      partition: session.partition,
      fingerprint: session.fingerprint,
      proxy: session.proxy,
      config: session.config,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt
    }));
  }

  // ============================================================================
  // Duplicate Session
  // ============================================================================

  /**
   * Duplicate a session with new fingerprint
   */
  duplicateSession(sessionId: string, newName?: string): Session | null {
    const original = this.sessions.get(sessionId);
    if (!original) {
      return null;
    }

    return this.createSession(
      { ...original.config },
      newName || `${original.name} (Copy)`,
      undefined // Don't copy proxy - each session needs unique proxy
    );
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer);
      this.persistDebounceTimer = null;
    }
    this.sessions.clear();
    this.fingerprintGenerator.clearUsed();
  }

  /**
   * Get the fingerprint generator (for testing)
   */
  getFingerprintGenerator(): FingerprintGenerator {
    return this.fingerprintGenerator;
  }

  /**
   * Get the proxy manager (for testing)
   */
  getProxyManager(): ProxyManager {
    return this.proxyManager;
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();
