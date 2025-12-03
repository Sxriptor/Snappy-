/**
 * Shell Layer - Electron Main Process
 * Responsible for window management, script injection, and configuration
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { Configuration, DEFAULT_CONFIG } from '../types';

let mainWindow: BrowserWindow | null = null;
let config: Configuration = DEFAULT_CONFIG;
let injectionScript: string = '';
let isInjected: boolean = false;

/**
 * Load configuration from config.json or use defaults
 */
export function loadConfiguration(): Configuration {
  const configPath = path.join(process.cwd(), 'config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);
      config = { ...DEFAULT_CONFIG, ...loadedConfig };
      console.log('[Shell] Configuration loaded from config.json');
    } else {
      config = DEFAULT_CONFIG;
      console.log('[Shell] Using default configuration');
    }
  } catch (error) {
    console.error('[Shell] Error loading configuration:', error);
    config = DEFAULT_CONFIG;
  }
  
  return config;
}

/**
 * Load the injection script from file
 * NOTE: Bot injection is now handled by the renderer directly into the webview
 */
export function loadInjectionScript(): string {
  // Bot injection is now handled by renderer.ts directly into the webview
  // The old bot.js file has CommonJS exports which don't work in browser context
  console.log('[Shell] Injection script loading skipped (handled by renderer)');
  injectionScript = '';
  return injectionScript;
}


// Chrome user agent to bypass browser detection on Snapchat/Twitter
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Create the main browser window with Chromium rendering
 */
export function createWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/preload.js');
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  console.log('[Shell] Window created with webview support');
  return mainWindow;
}

/**
 * Set up webview handling for user agent spoofing
 */
function setupWebviewHandling(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      // Set Chrome user agent
      contents.setUserAgent(CHROME_USER_AGENT);
      
      // Allow all permissions
      contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
        callback(true);
      });

      // Spoof user agent in requests
      contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = CHROME_USER_AGENT;
        delete details.requestHeaders['X-Electron-Version'];
        callback({ requestHeaders: details.requestHeaders });
      });

      console.log('[Shell] Webview configured with Chrome user agent');
    }
  });
}

/**
 * Load the target site URL into the window
 */
export async function loadTargetSite(url: string): Promise<void> {
  if (!mainWindow) {
    throw new Error('Window not created');
  }
  
  console.log('[Shell] Loading target site:', url);
  await mainWindow.loadURL(url);
  console.log('[Shell] Target site loaded');
}

/**
 * Inject the automation script into the current page
 */
export async function injectAutomationScript(): Promise<void> {
  if (!mainWindow) {
    throw new Error('Window not created');
  }
  
  if (isInjected) {
    console.log('[Shell] Script already injected, skipping');
    return;
  }
  
  if (!injectionScript) {
    loadInjectionScript();
  }
  
  if (!injectionScript) {
    console.error('[Shell] No injection script available');
    return;
  }
  
  try {
    // Pass configuration to the injection script
    const configScript = `window.__SNAPPY_CONFIG__ = ${JSON.stringify(config)};`;
    await mainWindow.webContents.executeJavaScript(configScript);
    await mainWindow.webContents.executeJavaScript(injectionScript);
    isInjected = true;
    console.log('[Shell] Automation script injected successfully');
  } catch (error) {
    console.error('[Shell] Error injecting script:', error);
  }
}

/**
 * Save configuration to file
 */
export function saveConfiguration(newConfig: Configuration): void {
  const configPath = path.join(process.cwd(), 'config.json');
  
  try {
    config = { ...DEFAULT_CONFIG, ...newConfig };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('[Shell] Configuration saved');
  } catch (error) {
    console.error('[Shell] Error saving configuration:', error);
  }
}

/**
 * Set up IPC handlers for communication with web context
 */
export function setupIPCHandlers(): void {
  // Handle log messages from the injection script
  ipcMain.on('bot:log', (event, message: string) => {
    console.log('[Bot]', message);
  });
  
  // Handle manual injection request (now handled by renderer directly)
  ipcMain.on('bot:inject', async () => {
    console.log('[Shell] Bot injection requested (handled by renderer)');
  });

  // Handle stop bot request
  ipcMain.on('bot:stop', () => {
    isInjected = false;
    console.log('[Shell] Bot stopped');
  });
  
  // Handle status request
  ipcMain.handle('bot:status', () => {
    return {
      isInjected,
      config
    };
  });

  // Handle save config request
  ipcMain.handle('bot:saveConfig', (event, newConfig: Configuration) => {
    saveConfiguration(newConfig);
    return { success: true };
  });

  // Handle update actions
  ipcMain.on('update:download', () => {
    autoUpdater.downloadUpdate();
  });

  ipcMain.on('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.on('update:check', () => {
    autoUpdater.checkForUpdates().catch(err => {
      console.log('[Updater] Manual check failed:', err.message);
    });
  });

  // AI Settings handlers
  ipcMain.handle('ai:getSettings', () => {
    return config.ai || null;
  });

  ipcMain.handle('ai:saveSettings', (event, aiSettings) => {
    try {
      config.ai = aiSettings;
      saveConfiguration(config);
      console.log('[Shell] AI settings saved');
      return true;
    } catch (error) {
      console.error('[Shell] Error saving AI settings:', error);
      return false;
    }
  });

  ipcMain.handle('ai:testConnection', async () => {
    try {
      const ai = config.ai;
      if (!ai) {
        return { success: false, error: 'AI not configured' };
      }

      const url = `http://${ai.llmEndpoint}:${ai.llmPort}/v1/chat/completions`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ai.modelName,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return { success: true, modelName: ai.modelName };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Connection timed out' };
      }
      return { success: false, error: error.message || 'Connection failed' };
    }
  });
  
  console.log('[Shell] IPC handlers set up');
}

/**
 * Reset injection state (for page navigation)
 */
export function resetInjectionState(): void {
  isInjected = false;
}

/**
 * Get current configuration
 */
export function getConfiguration(): Configuration {
  return config;
}

/**
 * Get main window instance
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}


/**
 * Set up auto-updater for GitHub releases
 */
function setupAutoUpdater(): void {
  // Configure logging
  autoUpdater.logger = console;
  
  // Check for updates on startup (don't auto-download)
  autoUpdater.autoDownload = false;
  
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
  });
  
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    // Notify renderer about available update
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });
  
  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] No updates available');
  });
  
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Updater] Download progress: ${progress.percent.toFixed(1)}%`);
    if (mainWindow) {
      mainWindow.webContents.send('update-progress', progress);
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });
  
  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
  });
  
  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.log('[Updater] Update check failed:', err.message);
    });
  }, 3000);
}

/**
 * Initialize and start the application
 */
async function initializeApp(): Promise<void> {
  // Load configuration
  loadConfiguration();
  
  // Load injection script
  loadInjectionScript();
  
  // Set up webview handling before creating window
  setupWebviewHandling();
  
  // Create window
  createWindow();
  
  // Set up IPC handlers
  setupIPCHandlers();
  
  if (!mainWindow) {
    throw new Error('Failed to create window');
  }
  
  // Handle page navigation - reset injection state
  mainWindow.webContents.on('did-navigate', () => {
    resetInjectionState();
  });
  
  // Handle page load completion
  mainWindow.webContents.on('did-finish-load', async () => {
    console.log('[Shell] Page finished loading');
    // Bot injection is now handled by renderer.ts directly into the webview
  });
  
  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Load the UI HTML file
  const htmlPath = path.join(__dirname, '../renderer/index.html');
  await mainWindow.loadFile(htmlPath);

  // Set up auto-updater (only in production)
  if (app.isPackaged) {
    setupAutoUpdater();
  }
}

// Application lifecycle
app.whenReady().then(initializeApp);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    initializeApp();
  }
});

// Export for testing
export {
  mainWindow,
  config,
  isInjected
};
