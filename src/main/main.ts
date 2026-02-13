/**
 * Shell Layer - Electron Main Process
 * Responsible for window management, script injection, and configuration
 */

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { Configuration, DEFAULT_CONFIG, DEFAULT_AI_CONFIG, SessionConfig, ProxyConfig, IncomingMessage, AIConfig } from '../types';
import { SessionManager } from './sessionManager';
import { ProxyManager } from './proxyManager';
import { FingerprintGenerator } from './fingerprintGenerator';
import { createFingerprintInjectorScript } from '../injection/fingerprintInjector';
import { buildSnapchatBotScript } from '../injection/snapchatBot';
import { buildInstagramBotScript } from '../injection/instagramBot';
import { buildRedditBotScript } from '../injection/redditBot';
import { AIBrain } from '../brain/aiBrain';
import { windowManager } from './windowManager';
import { trayManager } from './trayManager';

let mainWindow: BrowserWindow | null = null;
let config: Configuration = DEFAULT_CONFIG;
let injectionScript: string = '';
let isInjected: boolean = false;
let aiBrain: AIBrain | null = null;
let isProcessingReply: boolean = false;
let macManualUpdateUrl: string | null = null;

// Multi-session managers
const fingerprintGenerator = new FingerprintGenerator();
const proxyManager = new ProxyManager();
const sessionManager = new SessionManager(
  path.join(app.getPath('userData'), 'sessions.json'),
  fingerprintGenerator,
  proxyManager
);

/**
 * Load configuration from config.json or use defaults
 */
export function loadConfiguration(): Configuration {
  const configPath = path.join(process.cwd(), 'config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);
      // Merge top-level config with defaults
      config = { ...DEFAULT_CONFIG, ...loadedConfig };
      // Deep merge AI config with defaults to ensure all fields are present
      if (loadedConfig.ai) {
        config.ai = { ...DEFAULT_AI_CONFIG, ...loadedConfig.ai };
      } else {
        config.ai = DEFAULT_AI_CONFIG;
      }
      console.log('[Shell] Configuration loaded from config.json');
    } else {
      config = { ...DEFAULT_CONFIG, ai: DEFAULT_AI_CONFIG };
      console.log('[Shell] Using default configuration');
    }
  } catch (error) {
    console.error('[Shell] Error loading configuration:', error);
    config = { ...DEFAULT_CONFIG, ai: DEFAULT_AI_CONFIG };
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
 * Set up webview handling for user agent spoofing and fingerprint injection
 */
function setupWebviewHandling(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      // Get the partition to find the associated session
      const partition = contents.session.storagePath?.split('Partitions/')[1] || '';
      const sessions = sessionManager.getAllSessions();
      const matchingSession = sessions.find(s => s.partition.includes(partition));
      
      // Use session fingerprint or default Chrome UA
      const userAgent = matchingSession?.fingerprint.userAgent || CHROME_USER_AGENT;
      contents.setUserAgent(userAgent);
      
      // Allow all permissions
      contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
        callback(true);
      });

      // Spoof user agent in requests
      contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = userAgent;
        delete details.requestHeaders['X-Electron-Version'];
        callback({ requestHeaders: details.requestHeaders });
      });

      // Inject fingerprint script on DOM ready
      contents.on('dom-ready', async () => {
        if (matchingSession) {
          try {
            const fingerprintScript = createFingerprintInjectorScript({
              fingerprint: matchingSession.fingerprint,
              disableWebRTC: matchingSession.proxy !== null
            });
            await contents.executeJavaScript(fingerprintScript);
            console.log(`[Shell] Fingerprint injected for session ${matchingSession.name}`);
          } catch (error) {
            console.error('[Shell] Error injecting fingerprint:', error);
          }
        }
      });

      console.log('[Shell] Webview configured with fingerprint spoofing');
    }
  });
}

/**
 * Apply proxy to a session partition
 */
async function applyProxyToSession(sessionId: string, proxy: ProxyConfig): Promise<void> {
  const sessionData = sessionManager.getSession(sessionId);
  if (!sessionData) return;

  const ses = session.fromPartition(sessionData.partition);
  const proxyRules = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
  
  await ses.setProxy({ proxyRules });
  console.log(`[Shell] Proxy applied to session ${sessionData.name}: ${proxyRules}`);
}

/**
 * Handle proxy authentication
 */
function setupProxyAuth(): void {
  app.on('login', (event, webContents, details, authInfo, callback) => {
    if (authInfo.isProxy) {
      event.preventDefault();
      proxyManager.handleProxyAuth(
        { host: authInfo.host, port: authInfo.port },
        (username, password) => {
          if (username && password) {
            callback(username, password);
          } else {
            callback();
          }
        }
      );
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

  // Handle app version request
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  // Handle save config request
  ipcMain.handle('bot:saveConfig', (event, newConfig: Configuration) => {
    saveConfiguration(newConfig);
    return { success: true };
  });

  // Return the Snapchat bot script generated from source-of-truth module
  ipcMain.handle('bot:getSnapchatScript', (event, scriptConfig: unknown) => {
    return buildSnapchatBotScript(scriptConfig);
  });

  // Return the Instagram bot script generated from source-of-truth module
  ipcMain.handle('bot:getInstagramScript', (event, scriptConfig: unknown) => {
    return buildInstagramBotScript(scriptConfig as Configuration);
  });

  // Return the Reddit bot script generated from source-of-truth module
  ipcMain.handle('bot:getRedditScript', (event, scriptConfig: unknown) => {
    return buildRedditBotScript(scriptConfig as Configuration);
  });

  // Handle site settings update
  ipcMain.on('siteSettings:update', (event, siteSettings: unknown) => {
    try {
      // Update the global config with site settings
      config.siteSettings = siteSettings as any;
      
      // Save the updated configuration
      saveConfiguration(config);
      
      console.log('[Shell] Site settings updated:', siteSettings);
    } catch (error) {
      console.error('[Shell] Error updating site settings:', error);
    }
  });

  // Handle update actions
  ipcMain.on('update:download', () => {
    try {
      if (process.platform === 'darwin') {
        const releaseUrl = macManualUpdateUrl || getGitHubReleasesUrl();
        shell.openExternal(releaseUrl).catch(err => {
          console.error('[Updater] Failed to open macOS manual update URL:', err);
        });
        return;
      }
      console.log('[Updater] Starting download...');
      autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('[Updater] Download error:', error);
      if (mainWindow) {
        mainWindow.webContents.send('update-error', { message: 'Failed to start download' });
      }
    }
  });

  ipcMain.on('update:install', () => {
    try {
      if (process.platform === 'darwin') {
        const releaseUrl = macManualUpdateUrl || getGitHubReleasesUrl();
        shell.openExternal(releaseUrl).catch(err => {
          console.error('[Updater] Failed to open macOS manual update URL:', err);
        });
        return;
      }
      console.log('[Updater] Installing and restarting...');
      autoUpdater.quitAndInstall();
    } catch (error) {
      console.error('[Updater] Install error:', error);
      if (mainWindow) {
        mainWindow.webContents.send('update-error', { message: 'Failed to install update' });
      }
    }
  });

  ipcMain.on('update:check', () => {
    try {
      if (process.platform === 'darwin') {
        checkMacManualUpdates();
        return;
      }
      console.log('[Updater] Checking for updates...');
      autoUpdater.checkForUpdates().catch(err => {
        console.log('[Updater] Manual check failed:', err.message);
        
        // Handle 404 errors more gracefully
        if (err.message && err.message.includes('404')) {
          console.log('[Updater] No releases found - repository may not have published releases yet');
          if (mainWindow) {
            mainWindow.webContents.send('update-not-available');
          }
        } else if (mainWindow) {
          mainWindow.webContents.send('update-error', { message: 'Update check failed: ' + err.message });
        }
      });
    } catch (error) {
      console.error('[Updater] Check error:', error);
      if (mainWindow) {
        mainWindow.webContents.send('update-error', { message: 'Failed to check for updates' });
      }
    }
  });

  // AI Settings handlers
  ipcMain.handle('ai:getSettings', () => {
    return config.ai || null;
  });

  ipcMain.handle('ai:saveSettings', (event, aiSettings) => {
    try {
      config.ai = aiSettings;
      saveConfiguration(config);
      
      // Update the running AIBrain with new settings (hot reload)
      if (aiBrain) {
        aiBrain.updateConfig(aiSettings);
        console.log('[Shell] AI settings saved and applied to running AIBrain');
      } else {
        console.log('[Shell] AI settings saved (AIBrain not initialized)');
      }
      
      return true;
    } catch (error) {
      console.error('[Shell] Error saving AI settings:', error);
      return false;
    }
  });

  ipcMain.handle('ai:testConnection', async () => {
    try {
      if (!aiBrain) {
        return { success: false, error: 'AI Brain not initialized' };
      }
      return await aiBrain.testConnection();
    } catch (error: any) {
      return { success: false, error: error.message || 'Connection failed' };
    }
  });

  // AI Brain reply generation - called from injection layer via webview
  // Uses a lock to ensure only one message is processed at a time
  ipcMain.handle('ai:generateReply', async (event, messageData: { sender: string; messageText: string; conversationId?: string; aiConfig?: Partial<AIConfig> }) => {
    try {
      // Check if already processing - skip if busy
      if (isProcessingReply) {
        console.log('[Shell] Already processing a reply, skipping this request');
        return { reply: null, busy: true };
      }

      if (!aiBrain || !aiBrain.isEnabled()) {
        console.log('[Shell] AI Brain not enabled, skipping');
        return { reply: null };
      }

      // Acquire lock
      isProcessingReply = true;

      // Allow per-session/runtime AI overrides (e.g., llama port parsed from session start command).
      if (messageData.aiConfig && aiBrain) {
        aiBrain.updateConfig(messageData.aiConfig);
      }

      const message: IncomingMessage = {
        messageId: `msg-${Date.now()}`,
        sender: messageData.sender,
        messageText: messageData.messageText,
        timestamp: Date.now(),
        conversationId: messageData.conversationId || messageData.sender
      };

      console.log(`[Shell] AI generating reply for message from ${message.sender}: "${message.messageText.substring(0, 50)}..."`);
      const reply = await aiBrain.decideReply(message);
      console.log(`[Shell] AI reply: ${reply ? reply.substring(0, 50) + '...' : 'null'}`);
      
      // Release lock
      isProcessingReply = false;
      
      return { reply };
    } catch (error: any) {
      // Release lock on error
      isProcessingReply = false;
      console.error('[Shell] AI reply generation error:', error);
      return { reply: null, error: error.message };
    }
  });

  // Reset AI conversation context
  ipcMain.handle('ai:resetConversation', async (event, conversationId: string) => {
    if (aiBrain) {
      aiBrain.resetConversation(conversationId);
      return true;
    }
    return false;
  });
  
  // ============================================================================
  // Session Management IPC Handlers
  // ============================================================================

  ipcMain.handle('session:create', async (event, { name, proxyId, config: sessionConfig }) => {
    try {
      let proxy: ProxyConfig | undefined;
      if (proxyId) {
        const available = proxyManager.getAvailableProxies();
        proxy = available.find(p => p.id === proxyId);
      }
      
      const session = sessionManager.createSession(sessionConfig, name, proxy);
      
      // Assign proxy if provided
      if (proxy) {
        proxyManager.assignProxy(session.id, proxy.id);
      }
      
      // Notify renderer
      if (mainWindow) {
        mainWindow.webContents.send('session:created', session);
      }
      
      return session;
    } catch (error: any) {
      console.error('[Shell] Error creating session:', error);
      return null;
    }
  });

  ipcMain.handle('session:delete', async (event, sessionId: string) => {
    try {
      const result = sessionManager.deleteSession(sessionId);
      if (result && mainWindow) {
        mainWindow.webContents.send('session:deleted', sessionId);
      }
      return result;
    } catch (error: any) {
      console.error('[Shell] Error deleting session:', error);
      return false;
    }
  });

  ipcMain.handle('session:getAll', async () => {
    return sessionManager.getAllSessions();
  });

  ipcMain.handle('session:get', async (event, sessionId: string) => {
    return sessionManager.getSession(sessionId);
  });

  ipcMain.handle('session:updateConfig', async (event, { sessionId, config: newConfig }) => {
    return sessionManager.updateSessionConfig(sessionId, newConfig);
  });

  ipcMain.handle('session:rename', async (event, { sessionId, name }) => {
    return sessionManager.renameSession(sessionId, name);
  });

  ipcMain.handle('session:hibernate', async (event, sessionId: string) => {
    const result = sessionManager.hibernateSession(sessionId);
    if (result && mainWindow) {
      mainWindow.webContents.send('session:stateChanged', { sessionId, state: 'hibernated' });
    }
    return result;
  });

  ipcMain.handle('session:restore', async (event, sessionId: string) => {
    const result = sessionManager.restoreSession(sessionId);
    if (result && mainWindow) {
      mainWindow.webContents.send('session:stateChanged', { sessionId, state: 'active' });
    }
    return result;
  });

  ipcMain.handle('session:duplicate', async (event, { sessionId, newName }) => {
    return sessionManager.duplicateSession(sessionId, newName);
  });

  ipcMain.handle('session:updateBotStatus', async (event, { sessionId, botStatus }) => {
    sessionManager.updateSessionBotStatus(sessionId, botStatus);
    
    // Broadcast bot status change to all renderer windows
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      window.webContents.send('session:botStatusChanged', { sessionId, botStatus });
    });
    
    return true;
  });

  // ============================================================================
  // Proxy Management IPC Handlers
  // ============================================================================
  // Llama.cpp Server Management
  // ============================================================================

  ipcMain.handle('llama:getConfig', async () => {
    try {
      const configPath = path.join(app.getPath('userData'), 'llama-config.json');
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      }
      return { buildPath: '', startCommand: '', enabled: false };
    } catch (error) {
      console.error('[Shell] Error loading llama config:', error);
      return { buildPath: '', startCommand: '', enabled: false };
    }
  });

  ipcMain.handle('llama:saveConfig', async (event, llamaConfig) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'llama-config.json');
      fs.writeFileSync(configPath, JSON.stringify(llamaConfig, null, 2), 'utf-8');
      console.log('[Shell] Llama config saved');
      return { success: true };
    } catch (error) {
      console.error('[Shell] Error saving llama config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('llama:start', async () => {
    try {
      const { llamaServerManager } = await import('./llamaServerManager');
      
      // Load config first
      const configPath = path.join(app.getPath('userData'), 'llama-config.json');
      let llamaConfig = { buildPath: '', startCommand: '', enabled: false };
      
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        llamaConfig = JSON.parse(content);
      }

      llamaServerManager.setConfig(llamaConfig);
      const status = await llamaServerManager.start();
      
      console.log('[Shell] Llama server start result:', status);
      return status;
    } catch (error) {
      console.error('[Shell] Error starting llama server:', error);
      return { running: false, error: String(error) };
    }
  });

  ipcMain.handle('llama:stop', async () => {
    console.log('[Shell] llama:stop IPC handler called');
    try {
      const { llamaServerManager } = await import('./llamaServerManager');
      console.log('[Shell] llamaServerManager imported, calling stop()...');
      const status = await llamaServerManager.stop();
      console.log('[Shell] Llama server stopped, status:', status);
      return status;
    } catch (error) {
      console.error('[Shell] Error stopping llama server:', error);
      return { running: false, error: String(error) };
    }
  });

  ipcMain.handle('llama:getStatus', async () => {
    try {
      const { llamaServerManager } = await import('./llamaServerManager');
      return llamaServerManager.getStatus();
    } catch (error) {
      console.error('[Shell] Error getting llama status:', error);
      return { running: false, error: String(error) };
    }
  });

  ipcMain.handle('llama:stopByPid', async (event, pid: number) => {
    try {
      const { llamaServerManager } = await import('./llamaServerManager');
      return await llamaServerManager.stopByPid(pid);
    } catch (error) {
      console.error('[Shell] Error stopping llama server by PID:', error);
      return { running: false, error: String(error) };
    }
  });

  ipcMain.handle('llama:getTrackedPids', async () => {
    try {
      const { llamaServerManager } = await import('./llamaServerManager');
      return llamaServerManager.getTrackedPids();
    } catch (error) {
      console.error('[Shell] Error getting tracked PIDs:', error);
      return [];
    }
  });

  ipcMain.handle('llama:clearTracking', async () => {
    try {
      const { llamaServerManager } = await import('./llamaServerManager');
      llamaServerManager.clearTracking();
      return { success: true };
    } catch (error) {
      console.error('[Shell] Error clearing llama tracking:', error);
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================

  ipcMain.handle('proxy:getPool', async () => {
    return proxyManager.getPool();
  });

  ipcMain.handle('proxy:add', async (event, proxy) => {
    try {
      return proxyManager.addProxy(proxy);
    } catch (error: any) {
      console.error('[Shell] Error adding proxy:', error);
      return null;
    }
  });

  ipcMain.handle('proxy:remove', async (event, proxyId: string) => {
    return proxyManager.removeProxy(proxyId);
  });

  ipcMain.handle('proxy:import', async (event, proxyList: string) => {
    return proxyManager.importProxies(proxyList);
  });

  ipcMain.handle('proxy:getAvailable', async () => {
    return proxyManager.getAvailableProxies();
  });

  // Proxy pool events
  proxyManager.on('poolLow', ({ unassignedCount }) => {
    if (mainWindow) {
      mainWindow.webContents.send('proxy:poolLow', unassignedCount);
    }
  });

  // ============================================================================
  // Webview Transfer Handlers (for detached windows)
  // ============================================================================

  ipcMain.on('webview:sendToMain', (event, data: { sessionId: string; html: string }) => {
    // Forward webview data from detached window to main window
    if (mainWindow) {
      mainWindow.webContents.send('webview:receiveFromDetached', data);
    }
  });

  // ============================================================================
  // System Tray IPC Handlers
  // ============================================================================

  ipcMain.handle('tray:hide', async () => {
    trayManager.hideAllWindows();
    return { success: true };
  });

  ipcMain.handle('tray:show', async () => {
    trayManager.showAllWindows();
    return { success: true };
  });

  ipcMain.handle('tray:isHidden', async () => {
    return trayManager.isHidden();
  });

  ipcMain.handle('tray:quit', async () => {
    trayManager.quitApp();
    return { success: true };
  });

  console.log('[Shell] IPC handlers set up with multi-session support, window management, and system tray');
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
    if (mainWindow) {
      mainWindow.webContents.send('update-checking');
    }
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
    if (mainWindow) {
      mainWindow.webContents.send('update-not-available');
    }
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
    
    // Handle specific GitHub 404 errors more gracefully
    if (err.message && err.message.includes('404')) {
      console.log('[Updater] No releases found on GitHub - this is normal for repositories without published releases');
      // Don't show error to user for 404s - it's expected for repos without releases
      return;
    }
    
    if (mainWindow) {
      mainWindow.webContents.send('update-error', { 
        message: err.message || 'Unknown updater error' 
      });
    }
  });
  
  // Check for updates after a short delay (disabled for now since repo has no releases)
  // setTimeout(() => {
  //   autoUpdater.checkForUpdates().catch(err => {
  //     console.log('[Updater] Initial update check failed:', err.message);
  //     // Don't show error for initial check failure - it's common in development
  //   });
  // }, 3000);
}

function getGitHubReleasesUrl(): string {
  try {
    const packageJsonPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'package.json')
      : path.join(process.cwd(), 'package.json');

    const packageJsonRaw = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonRaw);
    const owner = packageJson?.build?.publish?.owner;
    const repo = packageJson?.build?.publish?.repo;

    if (owner && repo && owner !== 'OWNER') {
      return `https://github.com/${owner}/${repo}/releases/latest`;
    }
  } catch (error) {
    console.log('[Updater] Could not resolve GitHub releases URL from package.json:', error);
  }

  return 'https://github.com';
}

function parseComparableVersion(version: string): number[] {
  const cleaned = version.replace(/^v/i, '').split('-')[0];
  return cleaned.split('.').map(part => {
    const n = parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function isVersionNewer(candidate: string, current: string): boolean {
  const a = parseComparableVersion(candidate);
  const b = parseComparableVersion(current);
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Snappy-Updater',
          Accept: 'application/vnd.github+json'
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function checkMacManualUpdates(): Promise<void> {
  try {
    const latestUrl = getGitHubReleasesUrl();
    const match = latestUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest$/);
    if (!match) {
      console.log('[Updater] macOS manual update check skipped: GitHub owner/repo not configured');
      return;
    }

    const [, owner, repo] = match;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const release = await fetchJson(apiUrl);
    const latestVersion = String(release?.tag_name || release?.name || '').replace(/^v/i, '').trim();
    const currentVersion = app.getVersion();

    if (!latestVersion) {
      console.log('[Updater] macOS manual update check: could not determine latest version');
      return;
    }

    if (!isVersionNewer(latestVersion, currentVersion)) {
      console.log(`[Updater] macOS manual update check: no update (${currentVersion})`);
      return;
    }

    macManualUpdateUrl = release?.html_url || latestUrl;

    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: latestVersion,
        releaseNotes: release?.body || '',
        manual: true,
        downloadUrl: macManualUpdateUrl,
        platform: 'darwin'
      });
    }

    console.log(`[Updater] macOS manual update available: ${latestVersion}`);
  } catch (error) {
    console.error('[Updater] macOS manual update check failed:', error);
  }
}

/**
 * Initialize and start the application
 */
async function initializeApp(): Promise<void> {
  // Load configuration
  loadConfiguration();
  
  // Initialize AI Brain if configured
  if (config.ai) {
    aiBrain = new AIBrain(config.ai);
    console.log(`[Shell] AI Brain initialized (enabled: ${config.ai.enabled})`);
  }
  
  // Load injection script
  loadInjectionScript();
  
  // Load saved sessions
  try {
    await sessionManager.load();
    console.log(`[Shell] Loaded ${sessionManager.getSessionCount()} sessions`);
  } catch (error) {
    console.log('[Shell] No saved sessions found, starting fresh');
  }
  
  // Set up webview handling before creating window
  setupWebviewHandling();
  
  // Set up proxy authentication
  setupProxyAuth();
  
  // Create window
  createWindow();
  
  // Set up IPC handlers
  setupIPCHandlers();
  
  // Set up window manager
  if (mainWindow) {
    windowManager.setMainWindow(mainWindow);
  }
  windowManager.setupIPCHandlers();
  
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
  
  // Initialize system tray (must be before window close handler)
  trayManager.initialize(mainWindow);
  
  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Load the UI HTML file
  const htmlPath = path.join(__dirname, '../renderer/index.html');
  await mainWindow.loadFile(htmlPath);

  // Set up updater checks (only in production)
  if (app.isPackaged) {
    if (process.platform === 'darwin') {
      setTimeout(() => {
        checkMacManualUpdates();
      }, 3000);
    } else {
      setupAutoUpdater();
    }
  }
}

// Application lifecycle
app.whenReady().then(initializeApp);

app.on('window-all-closed', () => {
  // Don't quit when windows are closed - keep running in tray
  // Only quit on macOS if explicitly quitting
  if (process.platform === 'darwin' && trayManager.getIsQuitting()) {
    app.quit();
  }
  // On Windows/Linux, the tray keeps the app alive
});

app.on('before-quit', () => {
  trayManager.setQuitting(true);
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
