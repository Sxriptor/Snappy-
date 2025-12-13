/**
 * System Tray Manager - Handles minimize to tray and background operation
 */

import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';

class TrayManager {
  private tray: Tray | null = null;
  private isQuitting: boolean = false;
  private mainWindow: BrowserWindow | null = null;
  private hiddenWindows: Set<number> = new Set();

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
    // Use the app icon or a default icon
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'build', 'icon.ico')
      : path.join(process.cwd(), 'build', 'icon.ico');

    // Create a simple icon if the file doesn't exist
    let trayIcon: Electron.NativeImage;
    try {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        // Create a simple 16x16 icon as fallback
        trayIcon = nativeImage.createEmpty();
      }
    } catch {
      trayIcon = nativeImage.createEmpty();
    }

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip('Snappy - Running in background');
    this.updateContextMenu();

    // Double-click to show windows
    this.tray.on('double-click', () => {
      this.showAllWindows();
    });
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
        label: 'Quit',
        click: () => this.quitApp()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
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
