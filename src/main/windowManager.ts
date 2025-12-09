/**
 * Window Manager - Handles multiple windows for detached tabs
 */

import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

interface DetachedWindow {
  id: string;
  sessionId: string;
  window: BrowserWindow;
}

class WindowManager {
  private detachedWindows: Map<string, DetachedWindow> = new Map();
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Create a new detached window for a session
   */
  async createDetachedWindow(sessionId: string, sessionName: string): Promise<string> {
    const preloadPath = path.join(__dirname, '../preload/preload.js');
    
    const detachedWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: `Snappy - ${sessionName}`,
      frame: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true
      }
    });

    const windowId = `detached-${Date.now()}`;
    
    // Store the window reference
    this.detachedWindows.set(windowId, {
      id: windowId,
      sessionId,
      window: detachedWindow
    });

    // Handle window close
    detachedWindow.on('closed', () => {
      this.detachedWindows.delete(windowId);
      // Notify main window that this detached window was closed
      if (this.mainWindow) {
        this.mainWindow.webContents.send('detached-window:closed', { windowId, sessionId });
      }
    });

    // Load the main app HTML with URL parameters to indicate detached mode
    const htmlPath = path.join(__dirname, '../renderer/index.html');
    const detachedUrl = `file://${htmlPath}?detached=true&sessionId=${encodeURIComponent(sessionId)}&sessionName=${encodeURIComponent(sessionName)}`;
    await detachedWindow.loadURL(detachedUrl);

    console.log(`[WindowManager] Created detached window for session ${sessionName}`);
    return windowId;
  }

  /**
   * Close a detached window
   */
  closeDetachedWindow(windowId: string): boolean {
    const detached = this.detachedWindows.get(windowId);
    if (detached) {
      detached.window.close();
      return true;
    }
    return false;
  }

  /**
   * Get all detached windows
   */
  getDetachedWindows(): DetachedWindow[] {
    return Array.from(this.detachedWindows.values());
  }

  /**
   * Find detached window by session ID
   */
  findWindowBySessionId(sessionId: string): DetachedWindow | undefined {
    return Array.from(this.detachedWindows.values()).find(w => w.sessionId === sessionId);
  }

  /**
   * Reattach a session back to main window
   */
  async reattachSession(sessionId: string): Promise<boolean> {
    const detached = this.findWindowBySessionId(sessionId);
    if (detached && this.mainWindow) {
      // Notify main window to reattach the session
      this.mainWindow.webContents.send('session:reattach', { sessionId });
      
      // Close the detached window after a short delay to allow for cleanup
      setTimeout(() => {
        detached.window.close();
      }, 100);
      
      return true;
    }
    return false;
  }

  /**
   * Set up IPC handlers for window management
   */
  setupIPCHandlers(): void {
    // Handle detach request from main window
    ipcMain.handle('window:detach', async (event, { sessionId, sessionName }) => {
      try {
        const windowId = await this.createDetachedWindow(sessionId, sessionName);
        return { success: true, windowId };
      } catch (error) {
        console.error('[WindowManager] Error creating detached window:', error);
        return { success: false, error: String(error) };
      }
    });

    // Handle reattach request from detached window
    ipcMain.handle('window:reattach', async (event, sessionId: string) => {
      try {
        const success = await this.reattachSession(sessionId);
        return { success };
      } catch (error) {
        console.error('[WindowManager] Error reattaching session:', error);
        return { success: false, error: String(error) };
      }
    });

    // Handle get detached windows
    ipcMain.handle('window:getDetached', async () => {
      return this.getDetachedWindows().map(w => ({
        id: w.id,
        sessionId: w.sessionId
      }));
    });

    console.log('[WindowManager] IPC handlers set up');
  }
}

export const windowManager = new WindowManager();