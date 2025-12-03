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

// Expose the APIs to the renderer
contextBridge.exposeInMainWorld('bot', botAPI);
contextBridge.exposeInMainWorld('updater', updaterAPI);

console.log('[Preload] Bridge initialized');
