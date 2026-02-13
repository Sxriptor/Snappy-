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
  },

  /**
   * Generate AI reply for a message
   */
  generateAIReply: async (
    sender: string,
    messageText: string,
    conversationId?: string,
    aiConfig?: unknown
  ): Promise<{ reply: string | null; error?: string }> => {
    return await ipcRenderer.invoke('ai:generateReply', { sender, messageText, conversationId, aiConfig });
  },

  /**
   * Reset AI conversation context
   */
  resetAIConversation: async (conversationId: string): Promise<boolean> => {
    return await ipcRenderer.invoke('ai:resetConversation', conversationId);
  },

  /**
   * Get Snapchat bot script generated in main process.
   */
  getSnapchatBotScript: async (config: unknown): Promise<string> => {
    return await ipcRenderer.invoke('bot:getSnapchatScript', config);
  },

  /**
   * Get Instagram bot script generated in main process.
   */
  getInstagramBotScript: async (config: unknown): Promise<string> => {
    return await ipcRenderer.invoke('bot:getInstagramScript', config);
  },

  /**
   * Get Reddit bot script generated in main process.
   */
  getRedditBotScript: async (config: unknown): Promise<string> => {
    return await ipcRenderer.invoke('bot:getRedditScript', config);
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
   * Update session bot status
   */
  updateBotStatus: async (sessionId: string, botStatus: 'active' | 'inactive'): Promise<boolean> => {
    return await ipcRenderer.invoke('session:updateBotStatus', { sessionId, botStatus });
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
  },

  onSessionBotStatusChanged: (callback: (data: { sessionId: string; botStatus: 'active' | 'inactive' }) => void): void => {
    ipcRenderer.on('session:botStatusChanged', (_, data) => callback(data));
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

/**
 * Llama.cpp Server API for AI server management
 */
const llamaAPI = {
  /**
   * Get llama.cpp server configuration
   */
  getConfig: async (): Promise<unknown> => {
    return await ipcRenderer.invoke('llama:getConfig');
  },

  /**
   * Save llama.cpp server configuration
   */
  saveConfig: async (config: unknown): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('llama:saveConfig', config);
  },

  /**
   * Start the llama.cpp server
   */
  start: async (): Promise<unknown> => {
    return await ipcRenderer.invoke('llama:start');
  },

  /**
   * Stop all llama.cpp servers
   */
  stop: async (): Promise<unknown> => {
    return await ipcRenderer.invoke('llama:stop');
  },

  /**
   * Stop a specific llama.cpp server by PID
   */
  stopByPid: async (pid: number): Promise<unknown> => {
    return await ipcRenderer.invoke('llama:stopByPid', pid);
  },

  /**
   * Get all tracked server PIDs
   */
  getTrackedPids: async (): Promise<number[]> => {
    return await ipcRenderer.invoke('llama:getTrackedPids');
  },

  /**
   * Get llama.cpp server status
   */
  getStatus: async (): Promise<unknown> => {
    return await ipcRenderer.invoke('llama:getStatus');
  },

  /**
   * Clear all tracking (call on app startup)
   */
  clearTracking: async (): Promise<{ success: boolean }> => {
    return await ipcRenderer.invoke('llama:clearTracking');
  }
};

/**
 * Window Management API for detached tabs
 */
const windowAPI = {
  /**
   * Detach a session to a new window
   */
  detachSession: async (sessionId: string, sessionName: string): Promise<{ success: boolean; windowId?: string; error?: string }> => {
    return await ipcRenderer.invoke('window:detach', { sessionId, sessionName });
  },

  /**
   * Reattach a session back to main window
   */
  reattachSession: async (sessionId: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('window:reattach', sessionId);
  },

  /**
   * Get list of detached windows
   */
  getDetachedWindows: async (): Promise<{ id: string; sessionId: string }[]> => {
    return await ipcRenderer.invoke('window:getDetached');
  },

  /**
   * Listen for detached window events
   */
  onDetachedWindowClosed: (callback: (data: { windowId: string; sessionId: string }) => void): void => {
    ipcRenderer.on('detached-window:closed', (_, data) => callback(data));
  },

  onSessionReattach: (callback: (data: { sessionId: string }) => void): void => {
    ipcRenderer.on('session:reattach', (_, data) => callback(data));
  }
};

/**
 * Electron API for detached windows
 */
const electronAPI = {
  /**
   * Listen for detached window initialization
   */
  onDetachedWindowInit: (callback: (data: { sessionId: string; sessionName: string; isDetachedWindow?: boolean }) => void): void => {
    ipcRenderer.on('detached-window:init', (_, data) => callback(data));
  },

  /**
   * Listen for webview transfer
   */
  onWebviewTransfer: (callback: (data: { sessionId: string; html: string }) => void): void => {
    ipcRenderer.on('webview:transfer', (_, data) => callback(data));
  },

  /**
   * Reattach window (from detached window)
   */
  reattachWindow: async (sessionId: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('window:reattach', sessionId);
  },

  /**
   * Send webview data to main window
   */
  sendWebviewToMain: (data: { sessionId: string; html: string }): void => {
    ipcRenderer.send('webview:sendToMain', data);
  },

  /**
   * Listen for webview data from detached windows
   */
  onWebviewReceiveFromDetached: (callback: (data: { sessionId: string; html: string }) => void): void => {
    ipcRenderer.on('webview:receiveFromDetached', (_, data) => callback(data));
  }
};

/**
 * System Tray API for minimize to tray functionality
 */
const trayAPI = {
  /**
   * Hide all windows to system tray
   */
  hide: async (): Promise<{ success: boolean }> => {
    return await ipcRenderer.invoke('tray:hide');
  },

  /**
   * Show all windows from system tray
   */
  show: async (): Promise<{ success: boolean }> => {
    return await ipcRenderer.invoke('tray:show');
  },

  /**
   * Check if windows are hidden
   */
  isHidden: async (): Promise<boolean> => {
    return await ipcRenderer.invoke('tray:isHidden');
  },

  /**
   * Quit the application completely
   */
  quit: async (): Promise<{ success: boolean }> => {
    return await ipcRenderer.invoke('tray:quit');
  },

  /**
   * Listen for start all servers command from tray
   */
  onStartAllServers: (callback: () => void): void => {
    ipcRenderer.on('tray:startAllServers', () => callback());
  },

  /**
   * Listen for all servers stopped notification from tray
   */
  onAllServersStopped: (callback: () => void): void => {
    ipcRenderer.on('tray:allServersStopped', () => callback());
  }
};

// Expose the APIs to the renderer
contextBridge.exposeInMainWorld('bot', botAPI);
contextBridge.exposeInMainWorld('updater', updaterAPI);
contextBridge.exposeInMainWorld('session', sessionAPI);
contextBridge.exposeInMainWorld('proxy', proxyAPI);
contextBridge.exposeInMainWorld('llama', llamaAPI);
contextBridge.exposeInMainWorld('windowManager', windowAPI);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
contextBridge.exposeInMainWorld('tray', trayAPI);

console.log('[Preload] Bridge initialized with multi-session support, llama.cpp server management, window detachment, and system tray');
