/**
 * Preload Bridge - Secure IPC Communication
 * Exposes limited APIs to web context via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Bot API exposed to the web page context
 * Limited to only log and injectBot functions for security
 */
const botAPI = {
  /**
   * Log a message to the main process console
   */
  log: (message: string): void => {
    ipcRenderer.send('bot:log', message);
  },

  /**
   * Request manual injection of the automation script
   */
  injectBot: (): void => {
    ipcRenderer.send('bot:inject');
  },

  /**
   * Get current bot status
   */
  getStatus: async (): Promise<{ isInjected: boolean; config: unknown }> => {
    return await ipcRenderer.invoke('bot:status');
  }
};

// Expose the API to the web page via contextBridge
// This ensures context isolation while providing necessary functionality
contextBridge.exposeInMainWorld('bot', botAPI);

// Type declaration for the exposed API
declare global {
  interface Window {
    bot: typeof botAPI;
  }
}

console.log('[Preload] Bridge initialized with context isolation');
