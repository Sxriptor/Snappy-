/**
 * Shell Layer - Electron Main Process
 * Responsible for window management, script injection, and configuration
 */

import { app, BrowserWindow, ipcMain, session, shell, dialog, webContents } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import { Configuration, DEFAULT_CONFIG, DEFAULT_AI_CONFIG, SessionConfig, ProxyConfig, IncomingMessage, AIConfig, Session, DiscordBotConfig } from '../types';
import { SessionManager } from './sessionManager';
import { ProxyManager } from './proxyManager';
import { FingerprintGenerator } from './fingerprintGenerator';
import { createFingerprintInjectorScript } from '../injection/fingerprintInjector';
import { buildSnapchatBotScript } from '../injection/snapchatBot';
import { buildInstagramBotScript } from '../injection/instagramBot';
import { buildRedditBotScript } from '../injection/redditBot';
import { buildThreadsBotScript } from '../injection/threadsBot';
import { AIBrain } from '../brain/aiBrain';
import { windowManager } from './windowManager';
import { trayManager } from './trayManager';
import {
  DiscordBotManager,
  DiscordBotStatus,
  DiscordCommand,
  DiscordCommandContext,
  PlatformTarget,
  DiscordCommandAttachment,
  DiscordCommandResponse,
  getDiscordCommandHelpText
} from './discordBotManager';

let mainWindow: BrowserWindow | null = null;
let config: Configuration = DEFAULT_CONFIG;
let injectionScript: string = '';
let isInjected: boolean = false;
let aiBrain: AIBrain | null = null;
let isProcessingReply: boolean = false;
let macManualUpdateUrl: string | null = null;
const sessionProcessPids = new Map<string, number>();
const trackedWebviewSessions = new Map<number, { sessionId: string; pid: number | null }>();

// Multi-session managers
const fingerprintGenerator = new FingerprintGenerator();
const proxyManager = new ProxyManager();
const sessionManager = new SessionManager(
  path.join(app.getPath('userData'), 'sessions.json'),
  fingerprintGenerator,
  proxyManager
);

interface DiscordBotCommandRequestPayload {
  requestId: string;
  action: 'start' | 'stop' | 'detach' | 'reattach' | 'logs';
  sessionIds?: string[];
  sessionId?: string;
  pid?: number;
  durationMs?: number;
  durationLabel?: string;
}

interface DiscordBotCommandResultSession {
  sessionId: string;
  status: 'success' | 'error' | 'skipped';
  message: string;
}

interface DiscordBotCommandResultPayload {
  requestId: string;
  success: boolean;
  results: DiscordBotCommandResultSession[];
  response?: string;
  error?: string;
}

interface PendingDiscordCommandRequest {
  resolve: (value: DiscordBotCommandResultPayload) => void;
  timeout: NodeJS.Timeout;
}

const pendingDiscordCommandRequests = new Map<string, PendingDiscordCommandRequest>();

function getDiscordBotConfig(): DiscordBotConfig {
  const raw = (config.discordBot || {}) as Partial<DiscordBotConfig>;
  const trustedUserIds = Array.isArray(raw.trustedUserIds)
    ? raw.trustedUserIds
        .map((value: string) => String(value || '').trim())
        .filter((value: string) => /^\d{5,25}$/.test(value))
    : [];

  return {
    enabled: raw.enabled === true,
    token: typeof raw.token === 'string' ? raw.token.trim() : '',
    trustedUserIds: Array.from(new Set(trustedUserIds))
  };
}

function detectPlatformFromSession(session: Session): PlatformTarget | 'unknown' {
  const configAny = session.config as any;
  const initialUrl = String(configAny?.initialUrl || '').toLowerCase();
  const sessionName = String(session.name || '').toLowerCase();

  if (initialUrl.includes('instagram.com') || sessionName.includes('instagram')) return 'instagram';
  if (initialUrl.includes('snapchat.com') || sessionName.includes('snapchat')) return 'snapchat';
  if (initialUrl.includes('threads.net') || initialUrl.includes('threads.com') || sessionName.includes('threads')) return 'threads';
  if (initialUrl.includes('reddit.com') || sessionName.includes('reddit')) return 'reddit';

  return 'unknown';
}

function getSessionLabel(session: Session): string {
  const shortId = session.id.substring(0, 8);
  return `${session.name} (${shortId})`;
}

function getWebContentsProcessId(contents: Electron.WebContents): number | null {
  try {
    const pid = contents.getOSProcessId();
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function getWebContentsPartitionCandidates(contents: Electron.WebContents): string[] {
  const candidates: string[] = [];
  const getLastPreferences = (contents as Electron.WebContents & {
    getLastWebPreferences?: () => { partition?: unknown } | null;
  }).getLastWebPreferences;
  const lastPreferences = typeof getLastPreferences === 'function' ? getLastPreferences.call(contents) : null;
  const preferredPartition = typeof lastPreferences?.partition === 'string' ? lastPreferences.partition.trim() : '';
  if (preferredPartition.length > 0) {
    candidates.push(preferredPartition);
  }

  const storagePath = typeof contents.session.storagePath === 'string' ? contents.session.storagePath.trim() : '';
  if (storagePath.length > 0) {
    const normalizedStoragePath = storagePath.replace(/\\/g, '/');
    const pathParts = normalizedStoragePath.split('/').filter(Boolean);
    const lastSegment = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';
    if (lastSegment.length > 0) {
      candidates.push(lastSegment);
      if (!lastSegment.startsWith('persist:')) {
        candidates.push(`persist:${lastSegment}`);
      }
    }
  }

  return Array.from(new Set(candidates));
}

function resolveSessionForWebContents(contents: Electron.WebContents): Session | undefined {
  const sessions = sessionManager.getAllSessions();
  const candidates = getWebContentsPartitionCandidates(contents);

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();
    const candidateBare = normalizedCandidate.replace(/^persist:/, '');
    const matched = sessions.find(session => {
      const partition = String(session.partition || '').toLowerCase();
      const partitionBare = partition.replace(/^persist:/, '');
      return (
        partition === normalizedCandidate ||
        partitionBare === candidateBare ||
        partition.includes(candidateBare)
      );
    });

    if (matched) {
      return matched;
    }
  }

  return undefined;
}

function trackWebviewSession(contents: Electron.WebContents, session: Session): void {
  const pid = getWebContentsProcessId(contents);
  trackedWebviewSessions.set(contents.id, { sessionId: session.id, pid });
  if (pid !== null) {
    sessionProcessPids.set(session.id, pid);
  }
}

function refreshTrackedWebviewPid(contents: Electron.WebContents): void {
  const tracked = trackedWebviewSessions.get(contents.id);
  if (!tracked) {
    return;
  }

  const pid = getWebContentsProcessId(contents);
  trackedWebviewSessions.set(contents.id, { ...tracked, pid });
  if (pid !== null) {
    sessionProcessPids.set(tracked.sessionId, pid);
  }
}

function cleanupTrackedWebviewSession(contents: Electron.WebContents): void {
  const tracked = trackedWebviewSessions.get(contents.id);
  if (!tracked) {
    return;
  }

  trackedWebviewSessions.delete(contents.id);
  const currentPid = sessionProcessPids.get(tracked.sessionId);
  if (typeof currentPid !== 'number') {
    return;
  }

  if (tracked.pid === null || currentPid === tracked.pid) {
    sessionProcessPids.delete(tracked.sessionId);
  }
}

function clearTrackedSessionPid(sessionId: string): void {
  sessionProcessPids.delete(sessionId);
  for (const [contentsId, tracked] of trackedWebviewSessions.entries()) {
    if (tracked.sessionId === sessionId) {
      trackedWebviewSessions.delete(contentsId);
    }
  }
}

function summarizeSessions(): string {
  const sessions = sessionManager.getAllSessions();
  const activeSessions = sessions.filter(session => session.state === 'active');
  const runningBots = sessions.filter(session => session.botStatus === 'active');
  const byPlatform = new Map<string, { total: number; running: number }>();

  sessions.forEach(session => {
    const platform = detectPlatformFromSession(session);
    const key = platform === 'unknown' ? 'unknown' : platform;
    const existing = byPlatform.get(key) || { total: 0, running: 0 };
    existing.total += 1;
    if (session.botStatus === 'active') existing.running += 1;
    byPlatform.set(key, existing);
  });

  const header = `Sessions: ${sessions.length} total | ${activeSessions.length} active | ${runningBots.length} bot-active`;
  const lines = Array.from(byPlatform.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([platform, stats]) => `${platform}: ${stats.total} (${stats.running} running)`);
  const sessionPidLines = sessions
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((session, index) => {
      const platform = detectPlatformFromSession(session);
      const pid = sessionProcessPids.get(session.id);
      const pidText = typeof pid === 'number' && pid > 0 ? String(pid) : '-';
      return `${index + 1}. ${session.name} [${platform}] PID: ${pidText}`;
    });

  if (sessions.length === 0) {
    return `${header}\nNo sessions configured.`;
  }

  return `${header}\n${lines.join('\n')}\nSession PIDs:\n${sessionPidLines.join('\n')}`;
}

function resolveTargetSessions(command: Extract<DiscordCommand, { type: 'start' | 'stop' | 'detach' | 'reattach' }>): { sessions: Session[]; descriptor: string; error?: string } {
  const sessions = sessionManager.getAllSessions();
  if (sessions.length === 0) {
    return { sessions: [], descriptor: 'none', error: 'No sessions available.' };
  }

  if (command.target.kind === 'all') {
    const eligible = sessions.filter(session => session.state === 'active');
    return { sessions: eligible, descriptor: 'all active sessions' };
  }

  if (command.target.kind === 'platform') {
    const platform = command.target.platform;
    const matched = sessions.filter(session => detectPlatformFromSession(session) === platform && session.state === 'active');
    return {
      sessions: matched,
      descriptor: `platform ${platform}`,
      error: matched.length === 0 ? `No active sessions found for platform ${platform}.` : undefined
    };
  }

  const ref = String(command.target.ref || '').trim().toLowerCase();
  if (!ref) {
    return { sessions: [], descriptor: 'session', error: 'Session reference is required.' };
  }

  const exactId = sessions.find(session => session.id.toLowerCase() === ref);
  if (exactId) return { sessions: [exactId], descriptor: `session ${getSessionLabel(exactId)}` };

  const prefixed = sessions.filter(session => session.id.toLowerCase().startsWith(ref));
  if (prefixed.length === 1) return { sessions: [prefixed[0]], descriptor: `session ${getSessionLabel(prefixed[0])}` };
  if (prefixed.length > 1) {
    return {
      sessions: [],
      descriptor: 'session',
      error: `Session reference is ambiguous: ${prefixed.map(session => getSessionLabel(session)).join(', ')}`
    };
  }

  const byName = sessions.filter(session => session.name.toLowerCase() === ref);
  if (byName.length === 1) return { sessions: [byName[0]], descriptor: `session ${getSessionLabel(byName[0])}` };
  if (byName.length > 1) {
    return {
      sessions: [],
      descriptor: 'session',
      error: `Session name is ambiguous: ${byName.map(session => getSessionLabel(session)).join(', ')}`
    };
  }

  const pidMatch = ref.match(/^(?:pid[:\s]*)?(\d+)$/i);
  if (pidMatch) {
    const parsedPid = parseInt(pidMatch[1], 10);
    if (Number.isFinite(parsedPid) && parsedPid > 0) {
      const sessionIdForPid = Array.from(sessionProcessPids.entries()).find(([, pid]) => pid === parsedPid)?.[0];
      if (sessionIdForPid) {
        const pidSession = sessions.find(session => session.id === sessionIdForPid);
        if (pidSession) {
          return { sessions: [pidSession], descriptor: `session ${getSessionLabel(pidSession)} (PID ${parsedPid})` };
        }
      }
    }
  }

  if (/^\d+$/.test(ref)) {
    const index = parseInt(ref, 10);
    if (index >= 1 && index <= sessions.length) {
      const sorted = sessions.slice().sort((a, b) => a.createdAt - b.createdAt);
      const session = sorted[index - 1];
      if (session) {
        return { sessions: [session], descriptor: `session ${getSessionLabel(session)}` };
      }
    }
  }

  return { sessions: [], descriptor: 'session', error: `No session matched "${command.target.ref}".` };
}

function broadcastDiscordBotStatus(status: DiscordBotStatus): void {
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(window => {
    window.webContents.send('discordBot:statusChanged', status);
  });
}

async function requestRendererBotCommand(
  payloadInput:
    | { action: 'start' | 'stop' | 'detach' | 'reattach'; sessionIds: string[] }
    | { action: 'logs'; pid: number; durationMs: number; durationLabel: string; sessionId?: string }
): Promise<DiscordBotCommandResultPayload> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      requestId: '',
      success: false,
      error: 'Main renderer window is unavailable',
      results: []
    };
  }

  const requestId = `discord-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload: DiscordBotCommandRequestPayload = {
    requestId,
    ...payloadInput
  };

  return await new Promise<DiscordBotCommandResultPayload>((resolve) => {
    const timeout = setTimeout(() => {
      pendingDiscordCommandRequests.delete(requestId);
      resolve({
        requestId,
        success: false,
        error: 'Renderer command timed out',
        results: []
      });
    }, 20000);

    pendingDiscordCommandRequests.set(requestId, { resolve, timeout });
    mainWindow?.webContents.send('discordBot:commandRequest', payload);
  });
}

function normalizeDiscordScreenshotFileToken(raw: unknown): string {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return normalized || 'window';
}

async function captureWindowScreenshot(window: BrowserWindow | null | undefined, filename: string): Promise<DiscordCommandAttachment | null> {
  if (!window || window.isDestroyed()) {
    return null;
  }

  const contents = window.webContents;
  if (!contents || contents.isDestroyed()) {
    return null;
  }

  try {
    const image = await contents.capturePage();
    if (image.isEmpty()) {
      return null;
    }

    const data = image.toPNG();
    if (!Buffer.isBuffer(data) || data.length === 0) {
      return null;
    }

    return { filename, data };
  } catch (error) {
    console.warn(`[DiscordBot] Failed to capture screenshot "${filename}":`, error);
    return null;
  }
}

async function captureDiscordScreenshots(): Promise<DiscordCommandAttachment[]> {
  const captures: DiscordCommandAttachment[] = [];
  const usedFilenames = new Set<string>();

  const mainCapture = await captureWindowScreenshot(mainWindow, 'main-ui.png');
  if (mainCapture) {
    captures.push(mainCapture);
    usedFilenames.add(mainCapture.filename);
  }

  const detachedWindows = windowManager.getDetachedWindows();
  for (const detached of detachedWindows) {
    const baseToken = normalizeDiscordScreenshotFileToken(detached.sessionId || detached.id);
    let filename = `detached-${baseToken}.png`;

    if (usedFilenames.has(filename)) {
      const fallbackToken = normalizeDiscordScreenshotFileToken(detached.id);
      filename = `detached-${baseToken}-${fallbackToken}.png`;
    }

    const detachedCapture = await captureWindowScreenshot(detached.window, filename);
    if (!detachedCapture) {
      continue;
    }

    captures.push(detachedCapture);
    usedFilenames.add(detachedCapture.filename);
  }

  return captures;
}

async function executeDiscordCommand(command: DiscordCommand, _context: DiscordCommandContext): Promise<string | DiscordCommandResponse> {
  if (command.type === 'help') {
    return getDiscordCommandHelpText();
  }

  if (command.type === 'list' || command.type === 'status') {
    return summarizeSessions();
  }

  if (command.type === 'screenshot') {
    const attachments = await captureDiscordScreenshots();
    if (attachments.length === 0) {
      return 'Unable to capture screenshots: no active main or detached windows are available.';
    }

    const hasMainScreenshot = attachments.some(item => item.filename === 'main-ui.png');
    const detachedCount = attachments.filter(item => item.filename !== 'main-ui.png').length;
    const detailParts: string[] = [];
    if (hasMainScreenshot) {
      detailParts.push('main UI');
    }
    if (detachedCount > 0) {
      detailParts.push(`${detachedCount} detached window${detachedCount === 1 ? '' : 's'}`);
    }

    const detailText = detailParts.length > 0 ? ` (${detailParts.join(' + ')})` : '';
    return {
      text: `Captured ${attachments.length} screenshot${attachments.length === 1 ? '' : 's'}${detailText}.`,
      attachments
    };
  }

  if (command.type === 'logs') {
    const sessionIdForPid = Array.from(sessionProcessPids.entries()).find(([, pid]) => pid === command.pid)?.[0];
    const rendererResult = await requestRendererBotCommand({
      action: 'logs',
      pid: command.pid,
      durationMs: command.durationMs,
      durationLabel: command.durationLabel,
      sessionId: sessionIdForPid
    });

    if (!rendererResult.success) {
      return `Failed to fetch logs for PID ${command.pid}: ${rendererResult.error || 'Unknown error'}`;
    }

    return rendererResult.response || `No logs found for PID ${command.pid} in last ${command.durationLabel}.`;
  }

  const resolved = resolveTargetSessions(command);
  if (resolved.error) {
    return resolved.error;
  }
  if (resolved.sessions.length === 0) {
    return `No sessions matched ${resolved.descriptor}.`;
  }

  const action = command.type;
  const actionPastTense =
    action === 'start' ? 'started' :
    action === 'stop' ? 'stopped' :
    action === 'detach' ? 'detached' :
    'reattached';
  const requestedSessions = resolved.sessions.map(session => session.id);
  const rendererResult = await requestRendererBotCommand({
    action,
    sessionIds: requestedSessions
  });

  if (!rendererResult.success && rendererResult.results.length === 0) {
    return `Failed to ${action} ${resolved.descriptor}: ${rendererResult.error || 'Unknown error'}`;
  }

  const successes = rendererResult.results.filter(result => result.status === 'success');
  const skipped = rendererResult.results.filter(result => result.status === 'skipped');
  const errors = rendererResult.results.filter(result => result.status === 'error');

  const summary = `${actionPastTense.charAt(0).toUpperCase() + actionPastTense.slice(1)} ${successes.length}/${resolved.sessions.length} for ${resolved.descriptor}.`;
  const detailLines: string[] = [];

  if (skipped.length > 0) {
    detailLines.push(`Skipped: ${skipped.map(item => item.message).join('; ')}`);
  }
  if (errors.length > 0) {
    detailLines.push(`Errors: ${errors.map(item => item.message).join('; ')}`);
  }

  return detailLines.length > 0 ? `${summary}\n${detailLines.join('\n')}` : summary;
}

const discordBotManager = new DiscordBotManager(executeDiscordCommand);
discordBotManager.on('statusChanged', (status: DiscordBotStatus) => {
  broadcastDiscordBotStatus(status);
});

function getRuntimeConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), 'config.json');
  } catch {
    return path.join(os.homedir(), '.snappy', 'config.json');
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}

function normalizeDiscordWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isDiscordHost = host === 'discord.com' || host.endsWith('.discord.com') || host === 'discordapp.com' || host.endsWith('.discordapp.com');
    if (parsed.protocol !== 'https:' || !isDiscordHost) {
      return null;
    }
    if (!parsed.pathname.includes('/api/webhooks/')) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function postDiscordWebhookMessage(webhookUrl: string, content: string): Promise<{ success: boolean; error?: string }> {
  const normalizedContent = String(content || '').trim();
  if (!normalizedContent) {
    return { success: false, error: 'Alert content is required' };
  }

  const payload = JSON.stringify({
    content: normalizedContent.length > 1900 ? normalizedContent.slice(0, 1900) + '...' : normalizedContent
  });

  return new Promise((resolve) => {
    try {
      const parsed = new URL(webhookUrl);
      const req = https.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 15000
        },
        (res) => {
          let responseData = '';
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          res.on('end', () => {
            const statusCode = res.statusCode || 0;
            if (statusCode >= 200 && statusCode < 300) {
              resolve({ success: true });
              return;
            }
            const shortResponse = responseData ? ` (${responseData.substring(0, 140)})` : '';
            resolve({ success: false, error: `Discord webhook request failed with HTTP ${statusCode}${shortResponse}` });
          });
        }
      );

      req.on('error', (error) => {
        resolve({ success: false, error: `Discord webhook request error: ${error.message}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Discord webhook request timed out' });
      });

      req.write(payload);
      req.end();
    } catch (error) {
      resolve({ success: false, error: `Discord webhook request failed: ${String(error)}` });
    }
  });
}

/**
 * Load configuration from config.json or use defaults
 */
export function loadConfiguration(): Configuration {
  const configPath = getRuntimeConfigPath();
  
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
      config.discordAlerts = {
        webhookUrl: '',
        ...(loadedConfig.discordAlerts || {})
      };
      config.discordBot = {
        enabled: false,
        token: '',
        trustedUserIds: [],
        ...(loadedConfig.discordBot || {})
      };
      console.log('[Shell] Configuration loaded from user config:', configPath);
    } else {
      config = { ...DEFAULT_CONFIG, ai: DEFAULT_AI_CONFIG };
      console.log('[Shell] Using default configuration');
    }
  } catch (error) {
    console.error('[Shell] Error loading configuration:', error);
    config = { ...DEFAULT_CONFIG, ai: DEFAULT_AI_CONFIG };
  }

  config.discordBot = getDiscordBotConfig();
  discordBotManager.setConfig(config.discordBot);
  
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
      let matchingSession = resolveSessionForWebContents(contents);
      if (matchingSession) {
        trackWebviewSession(contents, matchingSession);
      }
      
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
        if (!matchingSession) {
          matchingSession = resolveSessionForWebContents(contents);
        }
        if (matchingSession) {
          trackWebviewSession(contents, matchingSession);
          refreshTrackedWebviewPid(contents);
        }

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

      contents.on('render-process-gone', () => {
        cleanupTrackedWebviewSession(contents);
      });

      contents.once('destroyed', () => {
        cleanupTrackedWebviewSession(contents);
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
  const configPath = getRuntimeConfigPath();
  
  try {
    config = { ...DEFAULT_CONFIG, ...newConfig };
    config.ai = { ...DEFAULT_AI_CONFIG, ...(newConfig.ai || {}) };
    config.discordAlerts = { webhookUrl: '', ...(newConfig.discordAlerts || {}) };
    config.discordBot = {
      enabled: false,
      token: '',
      trustedUserIds: [],
      ...(newConfig.discordBot || {})
    };
    config.discordBot = getDiscordBotConfig();
    discordBotManager.setConfig(config.discordBot);
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('[Shell] Configuration saved to user config:', configPath);
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

  ipcMain.handle('webview:getProcessId', async (_event, webContentsId: unknown) => {
    const numericId = typeof webContentsId === 'number' ? webContentsId : Number(webContentsId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      return { pid: null, error: 'Invalid webContentsId' };
    }

    const target = webContents.fromId(numericId);
    if (!target || target.isDestroyed()) {
      return { pid: null, error: 'WebContents not found' };
    }

    try {
      const pid = target.getOSProcessId();
      if (!Number.isFinite(pid) || pid <= 0) {
        return { pid: null, error: 'Process ID unavailable' };
      }
      return { pid };
    } catch (error) {
      return { pid: null, error: String(error) };
    }
  });

  ipcMain.on('discordBot:commandResult', (_event, payload: DiscordBotCommandResultPayload) => {
    const requestId = String(payload?.requestId || '');
    if (!requestId) return;

    const pending = pendingDiscordCommandRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingDiscordCommandRequests.delete(requestId);
    pending.resolve(payload);
  });

  ipcMain.handle('discordBot:getConfig', async () => {
    const discordConfig = getDiscordBotConfig();
    return {
      enabled: discordConfig.enabled,
      tokenSet: discordConfig.token.length > 0,
      trustedUserIds: [...discordConfig.trustedUserIds]
    };
  });

  ipcMain.handle('discordBot:saveConfig', async (_event, payload: unknown) => {
    const data = (payload || {}) as {
      enabled?: unknown;
      token?: unknown;
      clearToken?: unknown;
      trustedUserIds?: unknown;
    };

    const current = getDiscordBotConfig();
    const next: DiscordBotConfig = {
      enabled: data.enabled === true,
      token: current.token,
      trustedUserIds: []
    };

    if (data.clearToken === true) {
      next.token = '';
    } else if (typeof data.token === 'string' && data.token.trim().length > 0) {
      next.token = data.token.trim();
    }

    if (Array.isArray(data.trustedUserIds)) {
      next.trustedUserIds = Array.from(
        new Set(
          data.trustedUserIds
            .map(value => String(value || '').trim())
            .filter(value => /^\d{5,25}$/.test(value))
        )
      );
    } else {
      next.trustedUserIds = [...current.trustedUserIds];
    }

    config.discordBot = next;
    saveConfiguration(config);

    let lifecycleResult: { success: boolean; error?: string } = { success: true };
    if (next.enabled) {
      lifecycleResult = await discordBotManager.start();
    } else {
      lifecycleResult = await discordBotManager.stop();
    }

    return {
      success: lifecycleResult.success,
      enabled: next.enabled,
      tokenSet: next.token.length > 0,
      trustedUserIds: [...next.trustedUserIds],
      error: lifecycleResult.error
    };
  });

  ipcMain.handle('discordBot:getStatus', async () => {
    return discordBotManager.getStatus();
  });

  ipcMain.handle('discordBot:start', async () => {
    return await discordBotManager.start();
  });

  ipcMain.handle('discordBot:stop', async () => {
    return await discordBotManager.stop();
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

  // Return the Threads bot script generated from source-of-truth module
  ipcMain.handle('bot:getThreadsScript', (event, scriptConfig: unknown) => {
    return buildThreadsBotScript(scriptConfig as Configuration);
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

  ipcMain.handle('discord:getWebhook', async () => {
    return {
      webhookUrl: config.discordAlerts?.webhookUrl || ''
    };
  });

  ipcMain.handle('discord:saveWebhook', async (_event, webhookUrl: unknown) => {
    const raw = typeof webhookUrl === 'string' ? webhookUrl.trim() : '';

    if (!raw) {
      config.discordAlerts = { webhookUrl: '' };
      saveConfiguration(config);
      return { success: true, webhookUrl: '' };
    }

    const normalized = normalizeDiscordWebhookUrl(raw);
    if (!normalized) {
      return { success: false, error: 'Invalid Discord webhook URL' };
    }

    config.discordAlerts = {
      webhookUrl: normalized
    };
    saveConfiguration(config);
    return { success: true, webhookUrl: normalized };
  });

  ipcMain.handle('discord:sendAlert', async (_event, payload: unknown) => {
    const data = (payload || {}) as { content?: string };
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    if (!content) {
      return { success: false, error: 'Alert content is required' };
    }

    const webhookUrl = config.discordAlerts?.webhookUrl || '';
    const normalizedWebhook = normalizeDiscordWebhookUrl(webhookUrl);
    if (!normalizedWebhook) {
      return { success: false, error: 'Discord webhook is not configured' };
    }

    return await postDiscordWebhookMessage(normalizedWebhook, content);
  });

  ipcMain.handle('instagram:scheduler:pickFolder', async () => {
    if (!mainWindow) {
      return { canceled: true };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return {
      canceled: false,
      folderPath: result.filePaths[0]
    };
  });

  ipcMain.handle('instagram:scheduler:scanFolder', async (_event, folderPath: unknown) => {
    try {
      if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
        return { success: false, error: 'Folder path is required', posts: [] };
      }

      if (!fs.existsSync(folderPath)) {
        return { success: false, error: 'Folder does not exist', posts: [] };
      }

      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) {
        return { success: false, error: 'Path is not a directory', posts: [] };
      }

      const mediaExtensions = new Set([
        '.jpg',
        '.jpeg',
        '.png',
        '.webp',
        '.mp4',
        '.mov',
        '.webm',
        '.mkv'
      ]);

      const videoExtensions = new Set(['.mp4', '.mov', '.webm', '.mkv']);

      const getGroupKey = (baseName: string): string => {
        const trimmed = (baseName || '').trim();
        if (!trimmed) return trimmed;
        const suffixMatch = trimmed.match(/^(.*?)-(\d+)$/);
        if (suffixMatch && suffixMatch[1]) {
          return suffixMatch[1];
        }
        return trimmed;
      };

      const files = fs.readdirSync(folderPath, { withFileTypes: true }).filter(entry => entry.isFile());
      const buckets = new Map<string, { media: string[]; text: string[] }>();

      for (const file of files) {
        const ext = path.extname(file.name).toLowerCase();
        const base = path.basename(file.name, ext);
        if (!base) continue;
        const groupKey = getGroupKey(base);
        if (!groupKey) continue;

        if (!buckets.has(groupKey)) {
          buckets.set(groupKey, { media: [], text: [] });
        }

        const bucket = buckets.get(groupKey)!;
        if (mediaExtensions.has(ext)) {
          bucket.media.push(file.name);
        } else if (ext === '.txt') {
          bucket.text.push(file.name);
        }
      }

      const posts = Array.from(buckets.entries())
        .filter(([, bucket]) => bucket.media.length > 0 && bucket.text.length > 0)
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
        .map(([id, bucket]) => {
          const mediaFiles = bucket.media.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          const preferredTextName = `${id}.txt`;
          const textFile = bucket.text.find(name => name.toLowerCase() === preferredTextName.toLowerCase())
            || bucket.text.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))[0];

          const mediaPaths = mediaFiles.map(file => path.join(folderPath, file));
          const mediaPath = mediaPaths[0];
          const textPath = path.join(folderPath, textFile);
          const caption = fs.readFileSync(textPath, 'utf-8').trim();
          const mediaType = mediaFiles.some(file => videoExtensions.has(path.extname(file).toLowerCase())) ? 'video' : 'image';
          return {
            id,
            mediaPaths,
            mediaPath,
            textPath,
            caption,
            mediaType
          };
        });

      return { success: true, posts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, posts: [] };
    }
  });

  ipcMain.handle('instagram:scheduler:setFileInputFiles', async (_event, payload: unknown) => {
    let attachedHere = false;
    let targetWebContentsRef: any = null;
    try {
      const data = (payload || {}) as { webContentsId?: number; filePaths?: string[]; selector?: string };
      const targetId = typeof data.webContentsId === 'number' ? data.webContentsId : 0;
      const filePaths = Array.isArray(data.filePaths) ? data.filePaths.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
      const selector = typeof data.selector === 'string' && data.selector.trim().length > 0
        ? data.selector.trim()
        : 'input[type="file"]';

      if (!targetId || filePaths.length === 0) {
        return { success: false, error: 'Invalid webContentsId or filePaths' };
      }

      const targetWebContents = webContents.fromId(targetId);
      if (!targetWebContents || targetWebContents.isDestroyed()) {
        return { success: false, error: 'Target webContents not found' };
      }
      targetWebContentsRef = targetWebContents;

      if (!targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.attach('1.3');
        attachedHere = true;
      }

      const doc = await targetWebContents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const rootNodeId = doc?.root?.nodeId;
      if (!rootNodeId) {
        if (attachedHere && targetWebContents.debugger.isAttached()) {
          targetWebContents.debugger.detach();
        }
        return { success: false, error: 'Could not resolve DOM root node' };
      }

      const queryResult = await targetWebContents.debugger.sendCommand('DOM.querySelector', {
        nodeId: rootNodeId,
        selector
      });

      if (!queryResult?.nodeId) {
        if (attachedHere && targetWebContents.debugger.isAttached()) {
          targetWebContents.debugger.detach();
        }
        return { success: false, error: 'File input element not found' };
      }

      await targetWebContents.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId: queryResult.nodeId,
        files: filePaths
      });

      if (attachedHere && targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.detach();
      }

      return { success: true };
    } catch (error) {
      try {
        if (attachedHere && targetWebContentsRef && targetWebContentsRef.debugger.isAttached()) {
          targetWebContentsRef.debugger.detach();
        }
      } catch {}
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('reddit:scheduler:pickFolder', async () => {
    if (!mainWindow) {
      return { canceled: true };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return {
      canceled: false,
      folderPath: result.filePaths[0]
    };
  });

  ipcMain.handle('reddit:scheduler:scanFolder', async (_event, folderPath: unknown) => {
    try {
      if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
        return { success: false, error: 'Folder path is required', posts: [] };
      }

      if (!fs.existsSync(folderPath)) {
        return { success: false, error: 'Folder does not exist', posts: [] };
      }

      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) {
        return { success: false, error: 'Path is not a directory', posts: [] };
      }

      const mediaExtensions = new Set([
        '.jpg',
        '.jpeg',
        '.png',
        '.webp',
        '.gif',
        '.mp4',
        '.mov',
        '.webm',
        '.mkv'
      ]);
      const textExtensions = new Set(['.txt', '.rtd']);
      const videoExtensions = new Set(['.mp4', '.mov', '.webm', '.mkv']);

      const getGroupKey = (baseName: string): string => {
        const trimmed = (baseName || '').trim();
        if (!trimmed) return trimmed;
        const suffixMatch = trimmed.match(/^(.*?)-(\d+)$/);
        if (suffixMatch && suffixMatch[1]) {
          return suffixMatch[1];
        }
        return trimmed;
      };

      const files = fs.readdirSync(folderPath, { withFileTypes: true }).filter(entry => entry.isFile());
      const buckets = new Map<string, { media: string[]; text: string[] }>();

      for (const file of files) {
        const ext = path.extname(file.name).toLowerCase();
        const base = path.basename(file.name, ext);
        if (!base) continue;
        const groupKey = getGroupKey(base);
        if (!groupKey) continue;

        if (!buckets.has(groupKey)) {
          buckets.set(groupKey, { media: [], text: [] });
        }

        const bucket = buckets.get(groupKey)!;
        if (mediaExtensions.has(ext)) {
          bucket.media.push(file.name);
        } else if (textExtensions.has(ext)) {
          bucket.text.push(file.name);
        }
      }

      const posts = Array.from(buckets.entries())
        .filter(([, bucket]) => bucket.text.length > 0)
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
        .map(([id, bucket]) => {
          const mediaFiles = bucket.media.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          const preferredTextNames = [`${id}.txt`, `${id}.rtd`];
          const textFile = bucket.text.find(name => preferredTextNames.some(preferred => name.toLowerCase() === preferred.toLowerCase()))
            || bucket.text.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))[0];
          const textPath = path.join(folderPath, textFile);
          const body = fs.readFileSync(textPath, 'utf-8').trim();
          const mediaPaths = mediaFiles.map(file => path.join(folderPath, file));
          const mediaPath = mediaPaths.length > 0 ? mediaPaths[0] : '';
          const mediaType = mediaFiles.some(file => videoExtensions.has(path.extname(file).toLowerCase())) ? 'video' : 'image';
          return {
            id,
            textPath,
            body,
            mediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
            mediaPath: mediaPath || undefined,
            mediaType: mediaPaths.length > 0 ? mediaType : undefined
          };
        });

      return { success: true, posts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, posts: [] };
    }
  });

  ipcMain.handle('reddit:scheduler:setFileInputFiles', async (_event, payload: unknown) => {
    try {
      const data = (payload || {}) as { webContentsId?: number; filePaths?: string[]; selector?: string };
      const targetId = typeof data.webContentsId === 'number' ? data.webContentsId : 0;
      const filePaths = Array.isArray(data.filePaths) ? data.filePaths.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
      const selector = typeof data.selector === 'string' && data.selector.trim().length > 0
        ? data.selector.trim()
        : 'input[type="file"]';

      if (!targetId || filePaths.length === 0) {
        return { success: false, error: 'Invalid webContentsId or filePaths' };
      }

      const targetWebContents = webContents.fromId(targetId);
      if (!targetWebContents || targetWebContents.isDestroyed()) {
        return { success: false, error: 'Target webContents not found' };
      }

      let attachedHere = false;
      if (!targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.attach('1.3');
        attachedHere = true;
      }

      const doc = await targetWebContents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const rootNodeId = doc?.root?.nodeId;
      if (!rootNodeId) {
        if (attachedHere && targetWebContents.debugger.isAttached()) {
          targetWebContents.debugger.detach();
        }
        return { success: false, error: 'Could not resolve DOM root node' };
      }

      const queryResult = await targetWebContents.debugger.sendCommand('DOM.querySelector', {
        nodeId: rootNodeId,
        selector
      });

      if (!queryResult?.nodeId) {
        if (attachedHere && targetWebContents.debugger.isAttached()) {
          targetWebContents.debugger.detach();
        }
        return { success: false, error: 'File input element not found' };
      }

      await targetWebContents.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId: queryResult.nodeId,
        files: filePaths
      });

      if (attachedHere && targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.detach();
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('threads:scheduler:pickFolder', async () => {
    if (!mainWindow) {
      return { canceled: true };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return {
      canceled: false,
      folderPath: result.filePaths[0]
    };
  });

  ipcMain.handle('threads:scheduler:scanFolder', async (_event, folderPath: unknown) => {
    try {
      if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
        return { success: false, error: 'Folder path is required', posts: [] };
      }

      if (!fs.existsSync(folderPath)) {
        return { success: false, error: 'Folder does not exist', posts: [] };
      }

      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) {
        return { success: false, error: 'Path is not a directory', posts: [] };
      }

      const mediaExtensions = new Set([
        '.jpg',
        '.jpeg',
        '.png',
        '.webp',
        '.gif',
        '.mp4',
        '.mov',
        '.webm',
        '.mkv'
      ]);
      const textExtensions = new Set(['.txt', '.rtd', '.rtf']);
      const videoExtensions = new Set(['.mp4', '.mov', '.webm', '.mkv']);
      const decodeRtfToPlainText = (raw: string): string => {
        let text = String(raw || '').replace(/\r/g, '');
        text = text.replace(/\\par[d]?/gi, '\n').replace(/\\line/gi, '\n').replace(/\\tab/gi, '\t');
        text = text.replace(/\\u(-?\d+)\??/g, (_match, codePoint) => {
          const n = Number(codePoint);
          if (!Number.isFinite(n)) return '';
          const normalized = n < 0 ? 65536 + n : n;
          try {
            return String.fromCharCode(normalized);
          } catch {
            return '';
          }
        });
        text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
        text = text.replace(/\\([{}\\])/g, '$1');
        text = text.replace(/\\[a-zA-Z]+-?\d* ?/g, '');
        text = text.replace(/[{}]/g, '');
        return text
          .split('\n')
          .map(line => line.replace(/\\+$/g, '').trim())
          .filter(Boolean)
          .join('\n');
      };

      const getGroupKey = (baseName: string): string => {
        const trimmed = (baseName || '').trim();
        if (!trimmed) return trimmed;
        const suffixMatch = trimmed.match(/^(.*?)-(\d+)$/);
        if (suffixMatch && suffixMatch[1]) {
          return suffixMatch[1];
        }
        return trimmed;
      };

      const files = fs.readdirSync(folderPath, { withFileTypes: true }).filter(entry => entry.isFile());
      const buckets = new Map<string, { media: string[]; text: string[] }>();

      for (const file of files) {
        const ext = path.extname(file.name).toLowerCase();
        const base = path.basename(file.name, ext);
        if (!base) continue;
        const groupKey = getGroupKey(base);
        if (!groupKey) continue;

        if (!buckets.has(groupKey)) {
          buckets.set(groupKey, { media: [], text: [] });
        }

        const bucket = buckets.get(groupKey)!;
        if (mediaExtensions.has(ext)) {
          bucket.media.push(file.name);
        } else if (textExtensions.has(ext)) {
          bucket.text.push(file.name);
        }
      }

      const posts = Array.from(buckets.entries())
        .filter(([, bucket]) => bucket.text.length > 0)
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
        .map(([id, bucket]) => {
          const mediaFiles = bucket.media.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          const preferredTextNames = [`${id}.txt`, `${id}.rtd`, `${id}.rtf`];
          const textFile = bucket.text.find(name => preferredTextNames.some(preferred => name.toLowerCase() === preferred.toLowerCase()))
            || bucket.text.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))[0];
          const textPath = path.join(folderPath, textFile);
          const textExt = path.extname(textFile).toLowerCase();
          const rawBody = fs.readFileSync(textPath, 'utf-8');
          const body = (textExt === '.rtf' ? decodeRtfToPlainText(rawBody) : rawBody).trim();
          const mediaPaths = mediaFiles.map(file => path.join(folderPath, file));
          const mediaPath = mediaPaths.length > 0 ? mediaPaths[0] : '';
          const mediaType = mediaFiles.some(file => videoExtensions.has(path.extname(file).toLowerCase())) ? 'video' : 'image';
          return {
            id,
            textPath,
            body,
            mediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
            mediaPath: mediaPath || undefined,
            mediaType: mediaPaths.length > 0 ? mediaType : undefined
          };
        });

      return { success: true, posts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, posts: [] };
    }
  });

  ipcMain.handle('threads:scheduler:setFileInputFiles', async (_event, payload: unknown) => {
    try {
      const data = (payload || {}) as { webContentsId?: number; filePaths?: string[]; selector?: string };
      const targetId = typeof data.webContentsId === 'number' ? data.webContentsId : 0;
      const filePaths = Array.isArray(data.filePaths) ? data.filePaths.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
      const selector = typeof data.selector === 'string' && data.selector.trim().length > 0
        ? data.selector.trim()
        : 'input[type="file"]';

      if (!targetId || filePaths.length === 0) {
        return { success: false, error: 'Invalid webContentsId or filePaths' };
      }

      const targetWebContents = webContents.fromId(targetId);
      if (!targetWebContents || targetWebContents.isDestroyed()) {
        return { success: false, error: 'Target webContents not found' };
      }

      let attachedHere = false;
      if (!targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.attach('1.3');
        attachedHere = true;
      }

      const doc = await targetWebContents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const rootNodeId = doc?.root?.nodeId;
      if (!rootNodeId) {
        if (attachedHere && targetWebContents.debugger.isAttached()) {
          targetWebContents.debugger.detach();
        }
        return { success: false, error: 'Could not resolve DOM root node' };
      }

      const queryResult = await targetWebContents.debugger.sendCommand('DOM.querySelector', {
        nodeId: rootNodeId,
        selector
      });

      if (!queryResult?.nodeId) {
        if (attachedHere && targetWebContents.debugger.isAttached()) {
          targetWebContents.debugger.detach();
        }
        return { success: false, error: 'File input element not found' };
      }

      await targetWebContents.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId: queryResult.nodeId,
        files: filePaths
      });

      if (attachedHere && targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.detach();
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('input:playMousePath', async (_event, payload: unknown) => {
    let attachedHere = false;
    let targetWebContentsRef: any = null;
    try {
      const data = (payload || {}) as { webContentsId?: number; events?: Array<any> };
      const targetId = typeof data.webContentsId === 'number' ? data.webContentsId : 0;
      const events = Array.isArray(data.events) ? data.events : [];

      if (!targetId || events.length === 0) {
        return { success: false, error: 'Invalid webContentsId or events' };
      }

      const targetWebContents = webContents.fromId(targetId);
      if (!targetWebContents || targetWebContents.isDestroyed()) {
        return { success: false, error: 'Target webContents not found' };
      }
      targetWebContentsRef = targetWebContents;

      if (!targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.attach('1.3');
        attachedHere = true;
      }

      for (const event of events) {
        const type = String(event?.type || '');
        const x = Number(event?.x);
        const y = Number(event?.y);
        const delay = Number(event?.delayMs || 0);
        if (!type || !Number.isFinite(x) || !Number.isFinite(y)) continue;

        if (delay > 0) {
          await delayMs(delay);
        }

        const params: Record<string, any> = {
          type,
          x,
          y,
          buttons: type === 'mousePressed' ? 1 : 0
        };

        if (type === 'mousePressed' || type === 'mouseReleased') {
          params.button = 'left';
          params.clickCount = 1;
        }

        await targetWebContents.debugger.sendCommand('Input.dispatchMouseEvent', params);
      }

      if (attachedHere && targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.detach();
      }

      return { success: true };
    } catch (error) {
      try {
        if (attachedHere && targetWebContentsRef && targetWebContentsRef.debugger.isAttached()) {
          targetWebContentsRef.debugger.detach();
        }
      } catch {}
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('input:playKeyboardSequence', async (_event, payload: unknown) => {
    let attachedHere = false;
    let targetWebContentsRef: any = null;
    try {
      const data = (payload || {}) as { webContentsId?: number; events?: Array<any> };
      const targetId = typeof data.webContentsId === 'number' ? data.webContentsId : 0;
      const events = Array.isArray(data.events) ? data.events : [];

      if (!targetId || events.length === 0) {
        return { success: false, error: 'Invalid webContentsId or events' };
      }

      const targetWebContents = webContents.fromId(targetId);
      if (!targetWebContents || targetWebContents.isDestroyed()) {
        return { success: false, error: 'Target webContents not found' };
      }
      targetWebContentsRef = targetWebContents;

      if (!targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.attach('1.3');
        attachedHere = true;
      }

      // Ensure key events are routed into the target webContents/page, not host UI.
      try {
        targetWebContents.focus();
      } catch {}
      try {
        await targetWebContents.debugger.sendCommand('Page.bringToFront');
      } catch {}
      try {
        await targetWebContents.debugger.sendCommand('Runtime.evaluate', {
          expression: `
            (function() {
              try {
                window.focus();
                const active = document.activeElement;
                if (!active || active === document.body) {
                  if (document.body && typeof document.body.focus === 'function') {
                    document.body.focus();
                  }
                }
              } catch (e) {}
            })();
          `
        });
      } catch {}

      const refreshTargetFocus = async () => {
        try {
          targetWebContents.focus();
        } catch {}
        try {
          await targetWebContents.debugger.sendCommand('Page.bringToFront');
        } catch {}
        try {
          await targetWebContents.debugger.sendCommand('Runtime.evaluate', {
            expression: `
              (function() {
                try { window.focus(); } catch (e) {}
              })();
            `
          });
        } catch {}
      };

      let dispatchedEvents = 0;
      for (const event of events) {
        const delay = Number(event?.delayMs || 0);
        if (delay > 0) {
          await delayMs(delay);
        }

        const eventKind = String(event?.kind || 'dispatch');
        const eventType = String(event?.type || '');
        const eventKey = String(event?.key || '');
        const isTabKeyDispatch = eventKind !== 'insertText'
          && eventKey.toLowerCase() === 'tab'
          && (eventType === 'rawKeyDown' || eventType === 'keyDown');

        // Keep routing locked to the target webContents during long tab-heavy sequences.
        if (isTabKeyDispatch || (dispatchedEvents > 0 && dispatchedEvents % 6 === 0)) {
          await refreshTargetFocus();
        }

        const kind = eventKind;
        if (kind === 'insertText') {
          const text = String(event?.text || '');
          if (text.length > 0) {
            await targetWebContents.debugger.sendCommand('Input.insertText', { text });
          }
          dispatchedEvents++;
          continue;
        }

        const type = String(event?.type || '');
        if (!type) continue;

        const params: Record<string, any> = { type };
        const text = String(event?.text || '');
        const key = String(event?.key || '');
        const code = String(event?.code || '');
        const windowsVirtualKeyCode = Number(event?.windowsVirtualKeyCode);
        const nativeVirtualKeyCode = Number(event?.nativeVirtualKeyCode);
        const modifiers = Number(event?.modifiers);

        if (text) params.text = text;
        if (key) params.key = key;
        if (code) params.code = code;
        if (Number.isFinite(windowsVirtualKeyCode)) params.windowsVirtualKeyCode = windowsVirtualKeyCode;
        if (Number.isFinite(nativeVirtualKeyCode)) params.nativeVirtualKeyCode = nativeVirtualKeyCode;
        if (Number.isFinite(modifiers)) params.modifiers = modifiers;

        await targetWebContents.debugger.sendCommand('Input.dispatchKeyEvent', params);
        dispatchedEvents++;
      }

      if (attachedHere && targetWebContents.debugger.isAttached()) {
        targetWebContents.debugger.detach();
      }

      return { success: true };
    } catch (error) {
      try {
        if (attachedHere && targetWebContentsRef && targetWebContentsRef.debugger.isAttached()) {
          targetWebContentsRef.debugger.detach();
        }
      } catch {}
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
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
      clearTrackedSessionPid(sessionId);
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

  const discordConfig = getDiscordBotConfig();
  discordBotManager.setConfig(discordConfig);
  if (discordConfig.enabled) {
    const startResult = await discordBotManager.start();
    if (!startResult.success) {
      console.error('[DiscordBot] Auto-start failed:', startResult.error || 'unknown error');
    }
  } else {
    await discordBotManager.stop();
  }
  
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
  broadcastDiscordBotStatus(discordBotManager.getStatus());

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
  void discordBotManager.stop();
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
