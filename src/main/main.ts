/**
 * Shell Layer - Electron Main Process
 * Responsible for window management, script injection, and configuration
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
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
 */
export function loadInjectionScript(): string {
  const scriptPath = path.join(__dirname, '../injection/bot.js');
  
  try {
    if (fs.existsSync(scriptPath)) {
      injectionScript = fs.readFileSync(scriptPath, 'utf-8');
      console.log('[Shell] Injection script loaded');
    } else {
      console.warn('[Shell] Injection script not found at:', scriptPath);
      injectionScript = '';
    }
  } catch (error) {
    console.error('[Shell] Error loading injection script:', error);
    injectionScript = '';
  }
  
  return injectionScript;
}


// Chrome user agent to bypass browser detection on Snapchat/Twitter
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Create the main browser window with Chromium rendering
 */
export function createWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/preload.js');
  
  // Use persistent partition for session data (cookies, localStorage)
  const partition = 'persist:snappy';
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: partition
    }
  });

  // Enable session persistence for cookies and localStorage
  const ses = session.fromPartition(partition);
  
  // Spoof user agent to appear as Chrome (required for Snapchat Web)
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_USER_AGENT;
    callback({ requestHeaders: details.requestHeaders });
  });
  
  // Also set user agent on the webContents
  mainWindow.webContents.setUserAgent(CHROME_USER_AGENT);
  
  // Allow all permissions for messaging sites
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  
  // Persist cookies to disk
  ses.cookies.on('changed', () => {
    ses.cookies.flushStore();
  });

  console.log('[Shell] Window created with Chrome user agent spoofing');
  return mainWindow;
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
 * Set up IPC handlers for communication with web context
 */
export function setupIPCHandlers(): void {
  // Handle log messages from the injection script
  ipcMain.on('bot:log', (event, message: string) => {
    console.log('[Bot]', message);
  });
  
  // Handle manual injection request
  ipcMain.on('bot:inject', async () => {
    await injectAutomationScript();
  });
  
  // Handle status request
  ipcMain.handle('bot:status', () => {
    return {
      isInjected,
      config
    };
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
 * Initialize and start the application
 */
async function initializeApp(): Promise<void> {
  // Load configuration
  loadConfiguration();
  
  // Load injection script
  loadInjectionScript();
  
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
    
    // Auto-inject if configured
    if (config.autoInject) {
      await injectAutomationScript();
    }
  });
  
  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Load the target site
  await loadTargetSite(config.initialUrl);
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
