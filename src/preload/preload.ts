/**
 * Preload Bridge - Secure IPC Communication
 * Exposes limited APIs to web context via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Bot API exposed to the renderer process
 */
const botAPI = {
  /**
   * Log a message to the main process console
   */
  log: (message: string): void => {
    ipcRenderer.send('bot:log', message);
  },

  /**
   * Request injection of the automation script
   */
  injectBot: (): void => {
    ipcRenderer.send('bot:inject');
  },

  /**
   * Stop the bot
   */
  stopBot: (): void => {
    ipcRenderer.send('bot:stop');
  },

  /**
   * Get current bot status and config
   */
  getStatus: async (): Promise<{ isInjected: boolean; config: unknown }> => {
    return await ipcRenderer.invoke('bot:status');
  },

  /**
   * Save configuration
   */
  saveConfig: async (config: unknown): Promise<void> => {
    return await ipcRenderer.invoke('bot:saveConfig', config);
  },

  /**
   * Load URL in webview
   */
  loadUrl: (url: string): void => {
    ipcRenderer.send('bot:loadUrl', url);
  },

  /**
   * Get AI settings
   */
  getAISettings: async (): Promise<unknown> => {
    return await ipcRenderer.invoke('ai:getSettings');
  },

  /**
   * Save AI settings
   */
  saveAISettings: async (settings: unknown): Promise<boolean> => {
    return await ipcRenderer.invoke('ai:saveSettings', settings);
  },

  /**
   * Test LLM connection
   */
  testLLMConnection: async (): Promise<{ success: boolean; modelName?: string; error?: string }> => {
    return await ipcRenderer.invoke('ai:testConnection');
  }
};

/**
 * Updater API exposed to the renderer process
 */
const updaterAPI = {
  checkForUpdates: (): void => {
    ipcRenderer.send('update:check');
  },
  downloadUpdate: (): void => {
    ipcRenderer.send('update:download');
  },
  installUpdate: (): void => {
    ipcRenderer.send('update:install');
  },
  onUpdateAvailable: (callback: (info: unknown) => void): void => {
    ipcRenderer.on('update-available', (_, info) => callback(info));
  },
  onUpdateProgress: (callback: (progress: unknown) => void): void => {
    ipcRenderer.on('update-progress', (_, progress) => callback(progress));
  },
  onUpdateDownloaded: (callback: (info: unknown) => void): void => {
    ipcRenderer.on('update-downloaded', (_, info) => callback(info));
  }
};

/**
 * Session API for multi-session management
 */
const sessionAPI = {
  /**
   * Create a new session
   */
  createSession: async (name?: string, proxyId?: string, config?: unknown): Promise<unknown> => {
    return await ipcRenderer.invoke('session:create', { name, proxyId, config });
  },

  /**
   * Delete a session
   */
  deleteSession: async (sessionId: string): Promise<boolean> => {
    return await ipcRenderer.invoke('session:delete', sessionId);
  },

  /**
   * Get all sessions
   */
  getAllSessions: async (): Promise<unknown[]> => {
    return await ipcRenderer.invoke('session:getAll');
  },

  /**
   * Get a specific session
   */
  getSession: async (sessionId: string): Promise<unknown> => {
    return await ipcRenderer.invoke('session:get', sessionId);
  },

  /**
   * Update session configuration
   */
  updateSessionConfig: async (sessionId: string, config: unknown): Promise<boolean> => {
    return await ipcRenderer.invoke('session:updateConfig', { sessionId, config });
  },

  /**
   * Rename a session
   */
  renameSession: async (sessionId: string, name: string): Promise<boolean> => {
    return await ipcRenderer.invoke('session:rename', { sessionId, name });
  },

  /**
   * Hibernate a session
   */
  hibernateSession: async (sessionId: string): Promise<boolean> => {
    return await ipcRenderer.invoke('session:hibernate', sessionId);
  },

  /**
   * Restore a hibernated session
   */
  restoreSession: async (sessionId: string): Promise<boolean> => {
    return await ipcRenderer.invoke('session:restore', sessionId);
  },

  /**
   * Duplicate a session
   */
  duplicateSession: async (sessionId: string, newName?: string): Promise<unknown> => {
    return await ipcRenderer.invoke('session:duplicate', { sessionId, newName });
  },

  /**
   * Listen for session events
   */
  onSessionCreated: (callback: (session: unknown) => void): void => {
    ipcRenderer.on('session:created', (_, session) => callback(session));
  },

  onSessionDeleted: (callback: (sessionId: string) => void): void => {
    ipcRenderer.on('session:deleted', (_, sessionId) => callback(sessionId));
  },

  onSessionStateChanged: (callback: (data: { sessionId: string; state: string }) => void): void => {
    ipcRenderer.on('session:stateChanged', (_, data) => callback(data));
  }
};

/**
 * Proxy API for proxy pool management
 */
const proxyAPI = {
  /**
   * Get all proxies in the pool
   */
  getProxyPool: async (): Promise<unknown[]> => {
    return await ipcRenderer.invoke('proxy:getPool');
  },

  /**
   * Add a proxy to the pool
   */
  addProxy: async (proxy: unknown): Promise<unknown> => {
    return await ipcRenderer.invoke('proxy:add', proxy);
  },

  /**
   * Remove a proxy from the pool
   */
  removeProxy: async (proxyId: string): Promise<boolean> => {
    return await ipcRenderer.invoke('proxy:remove', proxyId);
  },

  /**
   * Import proxies from a list
   */
  importProxies: async (proxyList: string): Promise<unknown[]> => {
    return await ipcRenderer.invoke('proxy:import', proxyList);
  },

  /**
   * Get available (unassigned) proxies
   */
  getAvailableProxies: async (): Promise<unknown[]> => {
    return await ipcRenderer.invoke('proxy:getAvailable');
  },

  /**
   * Listen for proxy pool updates
   */
  onPoolUpdated: (callback: (data: { pool: unknown[]; unassignedCount: number }) => void): void => {
    ipcRenderer.on('proxy:poolUpdated', (_, data) => callback(data));
  },

  onPoolLow: (callback: (unassignedCount: number) => void): void => {
    ipcRenderer.on('proxy:poolLow', (_, count) => callback(count));
  }
};

// Expose the APIs to the renderer
contextBridge.exposeInMainWorld('bot', botAPI);
contextBridge.exposeInMainWorld('updater', updaterAPI);
contextBridge.exposeInMainWorld('session', sessionAPI);
contextBridge.exposeInMainWorld('proxy', proxyAPI);

console.log('[Preload] Bridge initialized with multi-session support');
