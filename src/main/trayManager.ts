/**
 * System Tray Manager - Handles minimize to tray and background operation
 */

import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';
import { llamaServerManager } from './llamaServerManager';

class TrayManager {
  private tray: Tray | null = null;
  private isQuitting: boolean = false;
  private mainWindow: BrowserWindow | null = null;
  private hiddenWindows: Set<number> = new Set();
  private serverStartCallback: (() => Promise<void>) | null = null;

  /**
   * Initialize the system tray
   */
  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.createTray();
    this.setupWindowBehavior();
    console.log('[TrayManager] System tray initialized');
  }

  /**
   * Create the system tray icon and menu
   */
  private createTray(): void {
    const trayIcon = this.loadTrayIcon();

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip('Snappy - Running in background');
    this.updateContextMenu();

    // Single-click is the expected interaction on macOS menu bar items.
    this.tray.on('click', () => {
      this.showAllWindows();
    });

    // Double-click to show windows
    this.tray.on('double-click', () => {
      this.showAllWindows();
    });
  }

  /**
   * Load a platform-appropriate tray icon
   */
  private loadTrayIcon(): Electron.NativeImage {
    const isMac = process.platform === 'darwin';
    const iconCandidates = app.isPackaged
      ? (isMac
          ? [
              path.join(process.resourcesPath, 'build', 'icon.png'),
              path.join(process.resourcesPath, 'icon.png')
            ]
          : [
              path.join(process.resourcesPath, 'build', 'icon.ico'),
              path.join(process.resourcesPath, 'build', 'icon.png')
            ])
      : (isMac
          ? [
              path.join(process.cwd(), 'build', 'icon.png')
            ]
          : [
              path.join(process.cwd(), 'build', 'icon.ico'),
              path.join(process.cwd(), 'build', 'icon.png')
            ]);

    for (const iconPath of iconCandidates) {
      try {
        const image = nativeImage.createFromPath(iconPath);
        if (!image.isEmpty()) {
          if (isMac) {
            // macOS menu bar prefers template images.
            image.setTemplateImage(true);
          }
          return image.resize({ width: 18, height: 18 });
        }
      } catch {
        // Try next candidate
      }
    }

    return nativeImage.createEmpty();
  }

  /**
   * Set callback for starting all servers
   */
  setServerStartCallback(callback: () => Promise<void>): void {
    this.serverStartCallback = callback;
  }

  /**
   * Update the tray context menu
   */
  private updateContextMenu(): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Snappy',
        click: () => this.showAllWindows()
      },
      {
        label: 'Hide to Tray',
        click: () => this.hideAllWindows()
      },
      { type: 'separator' },
      {
        label: 'Start All Bots',
        click: () => this.startAllServers()
      },
      {
        label: 'Stop All Bots',
        click: () => this.killAllServers()
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => this.quitApp()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Start all llama.cpp servers - sends message to renderer to start servers for all sessions
   */
  private async startAllServers(): Promise<void> {
    console.log('[TrayManager] Requesting start of all servers...');
    
    // Send message to all windows to start their servers
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('tray:startAllServers');
      }
    });
  }

  /**
   * Kill all llama.cpp servers
   */
  private async killAllServers(): Promise<void> {
    console.log('[TrayManager] Killing all servers...');
    const status = await llamaServerManager.stop();
    console.log(`[TrayManager] All servers stopped. Running: ${status.running}`);
    
    // Notify renderer to update UI
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('tray:allServersStopped');
      }
    });
  }

  /**
   * Set up window close behavior to minimize to tray instead of quitting
   */
  private setupWindowBehavior(): void {
    if (!this.mainWindow) return;

    // Intercept close event on main window
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.hideAllWindows();
      }
    });
  }

  /**
   * Hide all windows to system tray
   */
  hideAllWindows(): void {
    const allWindows = BrowserWindow.getAllWindows();
    
    allWindows.forEach(window => {
      if (!window.isDestroyed()) {
        this.hiddenWindows.add(window.id);
        window.hide();
      }
    });

    if (this.tray) {
      this.tray.setToolTip('Snappy - Running in background');
    }

    console.log(`[TrayManager] Hidden ${allWindows.length} window(s) to tray`);
  }

  /**
   * Show all windows from system tray
   */
  showAllWindows(): void {
    const allWindows = BrowserWindow.getAllWindows();
    
    allWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
        this.hiddenWindows.delete(window.id);
      }
    });

    // If no windows exist, recreate main window
    if (allWindows.length === 0 && this.mainWindow === null) {
      // Emit activate event to recreate window
      app.emit('activate');
    }

    if (this.tray) {
      this.tray.setToolTip('Snappy');
    }

    console.log(`[TrayManager] Restored ${allWindows.length} window(s) from tray`);
  }

  /**
   * Check if windows are currently hidden
   */
  isHidden(): boolean {
    return this.hiddenWindows.size > 0;
  }

  /**
   * Quit the application completely
   */
  quitApp(): void {
    this.isQuitting = true;
    
    // Destroy tray
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    app.quit();
  }

  /**
   * Set quitting state (called before app quit)
   */
  setQuitting(quitting: boolean): void {
    this.isQuitting = quitting;
  }

  /**
   * Check if app is quitting
   */
  getIsQuitting(): boolean {
    return this.isQuitting;
  }

  /**
   * Destroy the tray (cleanup)
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export const trayManager = new TrayManager();
