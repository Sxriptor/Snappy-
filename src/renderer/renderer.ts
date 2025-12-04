/**
 * Renderer - Settings Panel with Activity Log
 */

interface ReplyRule {
  match: string;
  reply: string;
  priority?: number;
}

interface AIConfig {
  enabled: boolean;
  llmEndpoint: string;
  llmPort: number;
  modelName: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextHistoryEnabled: boolean;
  maxContextMessages: number;
}

interface Config {
  initialUrl: string;
  autoInject: boolean;
  replyRules: ReplyRule[];
  typingDelayRangeMs: [number, number];
  preReplyDelayRangeMs: [number, number];
  maxRepliesPerMinute: number;
  maxRepliesPerHour: number;
  randomSkipProbability: number;
  ai?: AIConfig;
}

let isPanelOpen = false;
let isBotActive = false;
let isLogCollapsed = false;

const panel = document.getElementById('settings-panel')!;
const toggleBtn = document.getElementById('settings-toggle')!;
const closeBtn = document.getElementById('panel-close')!;

// Multi-session: webview is now dynamically created per session
// Get the active webview or null if none exists
function getActiveWebview(): Electron.WebviewTag | null {
  // First try to find any webview in the container
  const container = document.getElementById('webview-container');
  if (container) {
    const webviews = container.querySelectorAll('webview:not(.hidden)');
    if (webviews.length > 0) {
      return webviews[0] as Electron.WebviewTag;
    }
    // Fall back to any webview
    const anyWebview = container.querySelector('webview');
    if (anyWebview) {
      return anyWebview as Electron.WebviewTag;
    }
  }
  // Legacy: try old single webview
  return document.getElementById('site-view') as Electron.WebviewTag | null;
}

// For backwards compatibility, get webview (may be null initially)
let webview = getActiveWebview();

// ============================================================================
// Multi-Session Tab Management
// ============================================================================

interface SessionData {
  id: string;
  name: string;
  partition: string;
  fingerprint: { userAgent: string };
  proxy: { id: string } | null;
  config: { initialUrl: string };
  state: string;
}

// Track sessions and their webviews
const sessionWebviews = new Map<string, Electron.WebviewTag>();
let activeSessionId: string | null = null;

// Create a webview for a session
function createSessionWebview(session: SessionData): Electron.WebviewTag {
  const container = document.getElementById('webview-container');
  if (!container) throw new Error('No webview container');
  
  const wv = document.createElement('webview') as Electron.WebviewTag;
  wv.id = `webview-${session.id}`;
  wv.className = 'session-webview hidden';
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('partition', session.partition);
  wv.setAttribute('useragent', session.fingerprint.userAgent);
  wv.src = session.config.initialUrl || 'https://web.snapchat.com';
  
  wv.style.width = '100%';
  wv.style.height = '100%';
  wv.style.border = 'none';
  wv.style.position = 'absolute';
  wv.style.top = '0';
  wv.style.left = '0';
  
  container.appendChild(wv);
  sessionWebviews.set(session.id, wv);
  
  // Set up listeners
  setupWebviewListeners(wv);
  setupWebviewReadyHandler(wv);
  
  return wv;
}

// Create a tab element for a session
function createSessionTab(session: SessionData): HTMLElement {
  const tab = document.createElement('div');
  tab.id = `tab-${session.id}`;
  tab.className = 'session-tab';
  tab.dataset.sessionId = session.id;
  
  const status = document.createElement('span');
  status.className = `tab-status ${session.proxy ? 'connected' : 'none'}`;
  
  const name = document.createElement('span');
  name.className = 'tab-name';
  name.textContent = session.name;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Close';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    if (confirm(`Close session "${session.name}"?`)) {
      deleteSession(session.id);
    }
  };
  
  tab.appendChild(status);
  tab.appendChild(name);
  tab.appendChild(closeBtn);
  
  tab.onclick = () => activateSession(session.id);
  
  tab.oncontextmenu = (e) => {
    e.preventDefault();
    showTabContextMenu(session.id, e.clientX, e.clientY);
  };
  
  return tab;
}

// Activate a session (show its webview, highlight tab)
function activateSession(sessionId: string) {
  // Hide all webviews
  sessionWebviews.forEach((wv, id) => {
    wv.classList.add('hidden');
    const tab = document.getElementById(`tab-${id}`);
    if (tab) tab.classList.remove('active');
  });
  
  // Show selected webview
  const wv = sessionWebviews.get(sessionId);
  if (wv) {
    wv.classList.remove('hidden');
    webview = wv; // Update global reference
  }
  
  // Highlight tab
  const tab = document.getElementById(`tab-${sessionId}`);
  if (tab) tab.classList.add('active');
  
  activeSessionId = sessionId;
  addLog(`Switched to session: ${sessionId.substring(0, 8)}...`, 'info');
}

// Delete a session
async function deleteSession(sessionId: string) {
  try {
    await (window as any).session.deleteSession(sessionId);
    
    // Remove webview
    const wv = sessionWebviews.get(sessionId);
    if (wv) {
      wv.remove();
      sessionWebviews.delete(sessionId);
    }
    
    // Remove tab
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) tab.remove();
    
    // If this was active, activate another
    if (activeSessionId === sessionId) {
      const remaining = Array.from(sessionWebviews.keys());
      if (remaining.length > 0) {
        activateSession(remaining[0]);
      } else {
        activeSessionId = null;
        webview = null;
      }
    }
    
    addLog(`Session deleted`, 'info');
  } catch (e) {
    addLog(`Failed to delete session: ${e}`, 'error');
  }
}

// Show context menu for tab
function showTabContextMenu(sessionId: string, x: number, y: number) {
  const menu = document.getElementById('tab-context-menu');
  if (!menu) return;
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');
  menu.dataset.sessionId = sessionId;
}

// Hide context menu
function hideTabContextMenu() {
  const menu = document.getElementById('tab-context-menu');
  if (menu) menu.classList.add('hidden');
}

// Handle context menu actions
function setupContextMenu() {
  const menu = document.getElementById('tab-context-menu');
  if (!menu) return;
  
  menu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = (item as HTMLElement).dataset.action;
      const sessionId = menu.dataset.sessionId;
      if (!sessionId) return;
      
      hideTabContextMenu();
      
      switch (action) {
        case 'rename':
          const newName = prompt('Enter new name:');
          if (newName) {
            await (window as any).session.renameSession(sessionId, newName);
            const tab = document.getElementById(`tab-${sessionId}`);
            const nameEl = tab?.querySelector('.tab-name');
            if (nameEl) nameEl.textContent = newName;
          }
          break;
        case 'duplicate':
          const dup = await (window as any).session.duplicateSession(sessionId);
          if (dup) addSessionToUI(dup);
          break;
        case 'hibernate':
          await (window as any).session.hibernateSession(sessionId);
          const tab = document.getElementById(`tab-${sessionId}`);
          if (tab) tab.classList.add('hibernated');
          break;
        case 'close':
          if (confirm('Close this session?')) {
            deleteSession(sessionId);
          }
          break;
      }
    });
  });
  
  // Hide on click outside
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target as Node)) {
      hideTabContextMenu();
    }
  });
}

// Add a session to the UI (tab + webview)
function addSessionToUI(session: SessionData) {
  const tabsContainer = document.getElementById('tabs-container');
  if (!tabsContainer) return;
  
  // Create tab
  const tab = createSessionTab(session);
  tabsContainer.appendChild(tab);
  
  // Create webview
  createSessionWebview(session);
  
  // Activate it
  activateSession(session.id);
}

// Create new session via modal
async function createNewSession() {
  const nameInput = document.getElementById('session-name') as HTMLInputElement;
  const urlInput = document.getElementById('session-url') as HTMLInputElement;
  const proxySelect = document.getElementById('session-proxy') as HTMLSelectElement;
  
  const name = nameInput?.value || `Session ${sessionWebviews.size + 1}`;
  const url = urlInput?.value || 'https://web.snapchat.com';
  const proxyId = proxySelect?.value || undefined;
  
  try {
    const session = await (window as any).session.createSession(name, proxyId, { initialUrl: url });
    if (session) {
      addSessionToUI(session);
      hideNewSessionModal();
      addLog(`Created session: ${name}`, 'success');
    }
  } catch (e) {
    addLog(`Failed to create session: ${e}`, 'error');
  }
}

// Show/hide new session modal
function showNewSessionModal() {
  const modal = document.getElementById('new-session-modal');
  if (modal) {
    modal.classList.remove('hidden');
    // Load available proxies
    loadProxiesIntoSelect();
  }
}

function hideNewSessionModal() {
  const modal = document.getElementById('new-session-modal');
  if (modal) modal.classList.add('hidden');
}

// Load proxies into the select dropdown
async function loadProxiesIntoSelect() {
  const select = document.getElementById('session-proxy') as HTMLSelectElement;
  if (!select) return;
  
  try {
    const proxies = await (window as any).proxy.getAvailableProxies();
    select.innerHTML = '<option value="">No Proxy</option>';
    proxies.forEach((p: any) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.host}:${p.port}`;
      select.appendChild(opt);
    });
  } catch (e) {
    console.log('Could not load proxies:', e);
  }
}

// Load existing sessions on startup
async function loadExistingSessions() {
  try {
    const sessions = await (window as any).session.getAllSessions();
    if (sessions && sessions.length > 0) {
      sessions.forEach((s: SessionData) => addSessionToUI(s));
      addLog(`Loaded ${sessions.length} session(s)`, 'info');
    }
  } catch (e) {
    console.log('Could not load sessions:', e);
  }
}

// Wire up the new session button and modal
function setupMultiSessionUI() {
  // New session button
  const newBtn = document.getElementById('new-session-btn');
  if (newBtn) {
    newBtn.onclick = showNewSessionModal;
  }
  
  // Modal close buttons
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', hideNewSessionModal);
  });
  
  // Create session button
  const createBtn = document.getElementById('create-session-btn');
  if (createBtn) {
    createBtn.onclick = createNewSession;
  }
  
  // Context menu
  setupContextMenu();
  
  // Close modal on backdrop click
  const modal = document.getElementById('new-session-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideNewSessionModal();
    });
  }
  
  // Proxy import button
  const importBtn = document.getElementById('import-proxies-btn');
  if (importBtn) {
    importBtn.onclick = importProxies;
  }
  
  // Load proxy list on startup
  refreshProxyList();
}

// ============================================================================
// Proxy Pool Management
// ============================================================================

// Import proxies from textarea
async function importProxies() {
  const textarea = document.getElementById('proxy-import') as HTMLTextAreaElement;
  if (!textarea || !textarea.value.trim()) {
    addLog('No proxies to import', 'error');
    return;
  }
  
  try {
    const imported = await (window as any).proxy.importProxies(textarea.value);
    if (imported && imported.length > 0) {
      addLog(`Imported ${imported.length} proxy(ies)`, 'success');
      textarea.value = '';
      refreshProxyList();
    } else {
      addLog('No valid proxies found', 'error');
    }
  } catch (e) {
    addLog(`Import failed: ${e}`, 'error');
  }
}

// Refresh the proxy list display
async function refreshProxyList() {
  const listEl = document.getElementById('proxy-list');
  const countEl = document.getElementById('proxy-count');
  if (!listEl) return;
  
  try {
    const pool = await (window as any).proxy.getProxyPool();
    
    if (!pool || pool.length === 0) {
      listEl.innerHTML = '<div class="proxy-empty">No proxies added</div>';
      if (countEl) countEl.textContent = '0 proxies';
      return;
    }
    
    if (countEl) countEl.textContent = `${pool.length} proxy(ies)`;
    
    listEl.innerHTML = pool.map((entry: any) => `
      <div class="proxy-item" data-proxy-id="${entry.proxy.id}">
        <span class="proxy-status ${entry.status}"></span>
        <span class="proxy-info">${entry.proxy.host}:${entry.proxy.port}</span>
        <button class="proxy-delete" title="Remove">&times;</button>
      </div>
    `).join('');
    
    // Add delete handlers
    listEl.querySelectorAll('.proxy-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const item = (e.target as HTMLElement).closest('.proxy-item') as HTMLElement;
        const proxyId = item?.dataset.proxyId;
        if (proxyId) {
          await (window as any).proxy.removeProxy(proxyId);
          refreshProxyList();
          addLog('Proxy removed', 'info');
        }
      });
    });
  } catch (e) {
    console.log('Could not load proxy pool:', e);
    listEl.innerHTML = '<div class="proxy-empty">Could not load proxies</div>';
  }
}

// ============================================================================

const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const botBtn = document.getElementById('toggle-bot')!;

const urlInput = document.getElementById('url-input') as HTMLInputElement;
const goBtn = document.getElementById('go-btn')!;
const autoInject = document.getElementById('auto-inject') as HTMLInputElement;

const typingMin = document.getElementById('typing-min') as HTMLInputElement;
const typingMax = document.getElementById('typing-max') as HTMLInputElement;
const delayMin = document.getElementById('delay-min') as HTMLInputElement;
const delayMax = document.getElementById('delay-max') as HTMLInputElement;
const rateMinute = document.getElementById('rate-minute') as HTMLInputElement;
const rateHour = document.getElementById('rate-hour') as HTMLInputElement;
const skipRate = document.getElementById('skip-rate') as HTMLInputElement;

const rulesContainer = document.getElementById('rules-container')!;
const addRuleBtn = document.getElementById('add-rule')!;
const saveBtn = document.getElementById('save-btn')!;

// Log panel elements
const logContent = document.getElementById('log-content')!;
const logToggle = document.getElementById('log-toggle')!;
const logHeader = document.getElementById('log-header')!;

// Memories elements
const memoriesContainer = document.getElementById('memories-container')!;
const refreshMemoriesBtn = document.getElementById('refresh-memories')!;

// AI Settings elements
const aiEnabled = document.getElementById('ai-enabled') as HTMLInputElement;
const aiStatus = document.getElementById('ai-status')!;
const aiEndpoint = document.getElementById('ai-endpoint') as HTMLInputElement;
const aiPort = document.getElementById('ai-port') as HTMLInputElement;
const aiModel = document.getElementById('ai-model') as HTMLInputElement;
const aiTemp = document.getElementById('ai-temp') as HTMLInputElement;
const aiTempVal = document.getElementById('ai-temp-val')!;
const aiTokens = document.getElementById('ai-tokens') as HTMLInputElement;
const aiContext = document.getElementById('ai-context') as HTMLInputElement;
const aiHistory = document.getElementById('ai-history') as HTMLInputElement;
const aiPrompt = document.getElementById('ai-prompt') as HTMLTextAreaElement;
const testConnectionBtn = document.getElementById('test-connection')!;

// AI temperature slider update
aiTemp?.addEventListener('input', () => {
  aiTempVal.textContent = aiTemp.value;
});

// Test AI connection
testConnectionBtn?.addEventListener('click', async () => {
  aiStatus.textContent = '●';
  aiStatus.className = 'ai-status testing';
  addLog('Testing AI connection...', 'info');
  
  try {
    const result = await (window as any).bot.testLLMConnection();
    
    if (result.success) {
      aiStatus.textContent = '●';
      aiStatus.className = 'ai-status connected';
      addLog(`AI connection successful! Model: ${result.modelName}`, 'success');
    } else {
      aiStatus.textContent = '●';
      aiStatus.className = 'ai-status disconnected';
      addLog(`AI connection failed: ${result.error}`, 'error');
    }
  } catch (e: any) {
    aiStatus.textContent = '●';
    aiStatus.className = 'ai-status disconnected';
    addLog(`AI connection failed: ${e.message}`, 'error');
  }
});

// Log functions
function addLog(message: string, type: 'info' | 'success' | 'error' | 'highlight' = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
  
  logContent.appendChild(entry);
  logContent.scrollTop = logContent.scrollHeight;
  
  // Keep only last 100 entries
  while (logContent.children.length > 100) {
    logContent.removeChild(logContent.firstChild!);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Log panel toggle
logHeader.addEventListener('click', () => {
  isLogCollapsed = !isLogCollapsed;
  logContent.classList.toggle('collapsed', isLogCollapsed);
  logToggle.textContent = isLogCollapsed ? '▲' : '▼';
});

// Panel
function togglePanel() {
  isPanelOpen = !isPanelOpen;
  panel.classList.toggle('open', isPanelOpen);
  toggleBtn.classList.toggle('shifted', isPanelOpen);
  document.getElementById('app')!.classList.toggle('panel-open', isPanelOpen);
}

toggleBtn.addEventListener('click', togglePanel);
closeBtn.addEventListener('click', togglePanel);

// URL
function loadUrl() {
  let url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  const currentWebview = getActiveWebview();
  if (currentWebview) {
    currentWebview.src = url;
    addLog(`Navigating to: ${url}`, 'info');
  } else {
    addLog('No active webview', 'error');
  }
}

goBtn.addEventListener('click', loadUrl);
urlInput.addEventListener('keypress', e => { if (e.key === 'Enter') loadUrl(); });

// Bot injection into webview
async function injectBotIntoWebview() {
  const currentWebview = getActiveWebview();
  if (!currentWebview) {
    addLog('No active webview for injection', 'error');
    return false;
  }
  
  try {
    const { config } = await (window as any).bot.getStatus();
    
    // Inject the bot script into the webview
    const botScript = getBotScript(config);
    
    // Try injection with error details
    try {
      await currentWebview.executeJavaScript(botScript);
      addLog('Bot injected successfully', 'success');
      
      // Verify bot is running
      setTimeout(async () => {
        const wv = getActiveWebview();
        if (!wv) return;
        try {
          const isRunning = await wv.executeJavaScript('window.__SNAPPY_RUNNING__ === true');
          addLog(`Bot running: ${isRunning}`, isRunning ? 'success' : 'error');
          
          // Force a log message
          await wv.executeJavaScript('console.log("[Snappy] Verification ping")');
        } catch (e) {
          addLog('Could not verify bot status', 'error');
        }
      }, 1000);
      
      return true;
    } catch (injErr: any) {
      addLog(`Script error: ${injErr.message || injErr}`, 'error');
      // Try a simpler test script
      try {
        await currentWebview.executeJavaScript('console.log("[Snappy] Test injection works")');
        addLog('Basic injection works - bot script has syntax error', 'error');
      } catch {
        addLog('Webview not ready for injection', 'error');
      }
      return false;
    }
  } catch (e) {
    addLog(`Injection failed: ${e}`, 'error');
    return false;
  }
}

async function stopBotInWebview() {
  const currentWebview = getActiveWebview();
  if (!currentWebview) return;
  try {
    await currentWebview.executeJavaScript('if(window.__SNAPPY_STOP__) window.__SNAPPY_STOP__();');
    addLog('Bot stopped', 'info');
  } catch (e) {
    addLog(`Stop failed: ${e}`, 'error');
  }
}

// Bot toggle
botBtn.addEventListener('click', async () => {
  if (isBotActive) {
    await stopBotInWebview();
    isBotActive = false;
    statusDot.classList.remove('active');
    statusText.textContent = 'Inactive';
    botBtn.textContent = 'Start';
  } else {
    addLog('Starting bot...', 'highlight');
    const success = await injectBotIntoWebview();
    if (success) {
      isBotActive = true;
      statusDot.classList.add('active');
      statusText.textContent = 'Active';
      botBtn.textContent = 'Stop';
    }
  }
});

// Rules
function createRule(match = '', reply = ''): HTMLElement {
  const div = document.createElement('div');
  div.className = 'rule-item';
  div.innerHTML = `
    <input type="text" class="rule-match" placeholder="Match" value="${match}">
    <input type="text" class="rule-reply" placeholder="Reply" value="${reply}">
    <button class="rule-delete">Remove</button>
  `;
  div.querySelector('.rule-delete')!.addEventListener('click', () => div.remove());
  return div;
}

function addRule(match = '', reply = '') {
  rulesContainer.appendChild(createRule(match, reply));
}

addRuleBtn.addEventListener('click', () => addRule());

function getRules(): ReplyRule[] {
  const rules: ReplyRule[] = [];
  rulesContainer.querySelectorAll('.rule-item').forEach((item, i) => {
    const m = (item.querySelector('.rule-match') as HTMLInputElement).value.trim();
    const r = (item.querySelector('.rule-reply') as HTMLInputElement).value.trim();
    if (m && r) rules.push({ match: m, reply: r, priority: i });
  });
  return rules;
}

// Save
saveBtn.addEventListener('click', async () => {
  const config: Config = {
    initialUrl: urlInput.value || 'https://web.snapchat.com',
    autoInject: autoInject.checked,
    replyRules: getRules(),
    typingDelayRangeMs: [parseInt(typingMin.value) || 50, parseInt(typingMax.value) || 150],
    preReplyDelayRangeMs: [parseInt(delayMin.value) || 2000, parseInt(delayMax.value) || 6000],
    maxRepliesPerMinute: parseInt(rateMinute.value) || 5,
    maxRepliesPerHour: parseInt(rateHour.value) || 30,
    randomSkipProbability: (parseInt(skipRate.value) || 15) / 100,
    ai: {
      enabled: aiEnabled?.checked || false,
      llmEndpoint: aiEndpoint?.value || 'localhost',
      llmPort: parseInt(aiPort?.value) || 8080,
      modelName: aiModel?.value || 'local-model',
      systemPrompt: aiPrompt?.value || '',
      temperature: parseFloat(aiTemp?.value) || 0.7,
      maxTokens: parseInt(aiTokens?.value) || 150,
      contextHistoryEnabled: aiContext?.checked || true,
      maxContextMessages: parseInt(aiHistory?.value) || 10
    }
  };
  await (window as any).bot.saveConfig(config);
  saveBtn.textContent = 'Saved';
  addLog('Configuration saved', 'success');
  setTimeout(() => { saveBtn.textContent = 'Save'; }, 1000);
});

// Load
async function loadConfig() {
  try {
    const { config } = await (window as any).bot.getStatus();
    if (!config) return;
    urlInput.value = config.initialUrl || 'https://web.snapchat.com';
    autoInject.checked = config.autoInject || false;
    typingMin.value = String(config.typingDelayRangeMs?.[0] || 50);
    typingMax.value = String(config.typingDelayRangeMs?.[1] || 150);
    delayMin.value = String(config.preReplyDelayRangeMs?.[0] || 2000);
    delayMax.value = String(config.preReplyDelayRangeMs?.[1] || 6000);
    rateMinute.value = String(config.maxRepliesPerMinute || 5);
    rateHour.value = String(config.maxRepliesPerHour || 30);
    skipRate.value = String(Math.round((config.randomSkipProbability || 0.15) * 100));
    rulesContainer.innerHTML = '';
    (config.replyRules || []).forEach((r: ReplyRule) => addRule(String(r.match), r.reply));
    
    // Load AI settings
    if (config.ai) {
      if (aiEnabled) aiEnabled.checked = config.ai.enabled || false;
      if (aiEndpoint) aiEndpoint.value = config.ai.llmEndpoint || 'localhost';
      if (aiPort) aiPort.value = String(config.ai.llmPort || 8080);
      if (aiModel) aiModel.value = config.ai.modelName || 'local-model';
      if (aiPrompt) aiPrompt.value = config.ai.systemPrompt || '';
      if (aiTemp) {
        aiTemp.value = String(config.ai.temperature || 0.7);
        aiTempVal.textContent = String(config.ai.temperature || 0.7);
      }
      if (aiTokens) aiTokens.value = String(config.ai.maxTokens || 150);
      if (aiContext) aiContext.checked = config.ai.contextHistoryEnabled !== false;
      if (aiHistory) aiHistory.value = String(config.ai.maxContextMessages || 10);
    }
    
    const currentWebview = getActiveWebview();
    if (config.initialUrl && currentWebview) currentWebview.src = config.initialUrl;
  } catch (e) {
    console.error('Load failed:', e);
  }
}

// Generate the bot script to inject into webview
function getBotScript(config: Config): string {
  return `
(function() {
  if (window.__SNAPPY_RUNNING__) {
    console.log('[Snappy] Already running');
    return;
  }
  window.__SNAPPY_RUNNING__ = true;
  
  const CONFIG = ${JSON.stringify(config)};
  const seenMessages = new Set();
  let pollInterval = null;
  
  // Log storage for polling
  window.__SNAPPY_LOGS__ = window.__SNAPPY_LOGS__ || [];
  
  function log(msg) {
    console.log('[Snappy] ' + msg);
    window.__SNAPPY_LOGS__.push(msg);
    if (window.__SNAPPY_LOGS__.length > 50) {
      window.__SNAPPY_LOGS__ = window.__SNAPPY_LOGS__.slice(-50);
    }
  }
  
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  
  // ============ MEMORY SYSTEM (localStorage) ============
  const MEMORY_KEY = 'snappy_memories';
  
  // Load all memories from localStorage
  function loadAllMemories() {
    try {
      const data = localStorage.getItem(MEMORY_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      log('Error loading memories: ' + e);
      return {};
    }
  }
  
  // Save all memories to localStorage
  function saveAllMemories(memories) {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
    } catch (e) {
      log('Error saving memories: ' + e);
    }
  }
  
  // Get memory for a specific user
  function getUserMemory(username) {
    const memories = loadAllMemories();
    if (!memories[username]) {
      memories[username] = {
        username: username,
        messages: [],
        firstSeen: Date.now(),
        lastSeen: Date.now()
      };
      saveAllMemories(memories);
    }
    return memories[username];
  }
  
  // Add a message to user's memory
  function addToMemory(username, text, isFromThem) {
    const memories = loadAllMemories();
    if (!memories[username]) {
      memories[username] = {
        username: username,
        messages: [],
        firstSeen: Date.now(),
        lastSeen: Date.now()
      };
    }
    
    // Add the message
    memories[username].messages.push({
      text: text,
      from: isFromThem ? 'them' : 'me',
      timestamp: Date.now()
    });
    
    // Keep only last 100 messages per user
    if (memories[username].messages.length > 100) {
      memories[username].messages = memories[username].messages.slice(-100);
    }
    
    memories[username].lastSeen = Date.now();
    saveAllMemories(memories);
    
    log('Memory saved for ' + username + ': ' + (isFromThem ? 'THEM' : 'ME') + ' - "' + text.substring(0, 30) + '..."');
  }
  
  // Get conversation summary for a user
  function getMemorySummary(username) {
    const memory = getUserMemory(username);
    const msgCount = memory.messages.length;
    const theirMsgs = memory.messages.filter(m => m.from === 'them').length;
    const myMsgs = memory.messages.filter(m => m.from === 'me').length;
    
    // Get last few messages for context
    const recent = memory.messages.slice(-5).map(m => 
      (m.from === 'them' ? 'Them: ' : 'Me: ') + m.text.substring(0, 50)
    ).join(' | ');
    
    return {
      total: msgCount,
      fromThem: theirMsgs,
      fromMe: myMsgs,
      recent: recent,
      firstSeen: memory.firstSeen,
      lastSeen: memory.lastSeen
    };
  }
  
  // List all users in memory
  function listAllUsers() {
    const memories = loadAllMemories();
    return Object.keys(memories);
  }
  
  // Expose memory functions globally for UI access
  window.__SNAPPY_MEMORY__ = {
    getUser: getUserMemory,
    addMessage: addToMemory,
    getSummary: getMemorySummary,
    listUsers: listAllUsers,
    loadAll: loadAllMemories
  };
  
  // ============ END MEMORY SYSTEM ============
  
  // Scan the DOM to find clickable chat items
  function findClickableChats() {
    // Look for any clickable elements that look like chat items
    const candidates = [];
    
    // Method 1: Find elements with role="button" or role="listitem" in sidebar area
    document.querySelectorAll('[role="button"], [role="listitem"], [role="option"]').forEach(el => {
      if (el.textContent && el.textContent.length > 0 && el.textContent.length < 200) {
        candidates.push(el);
      }
    });
    
    // Method 2: Find divs that look like chat items (have a name-like text)
    document.querySelectorAll('div[class], span[class]').forEach(el => {
      const cls = (el.className || '').toLowerCase();
      if (cls.includes('friend') || cls.includes('chat') || cls.includes('conversation') || 
          cls.includes('contact') || cls.includes('list') || cls.includes('item')) {
        if (el.textContent && el.textContent.length > 0 && el.textContent.length < 200) {
          candidates.push(el);
        }
      }
    });
    
    return candidates;
  }
  
  // Find unread indicators
  function hasUnreadIndicator(element) {
    const cls = (element.className || '').toLowerCase();
    const allClasses = element.innerHTML.toLowerCase();
    
    // Check element and all children class names for unread-related words
    const unreadKeywords = ['unread', 'unseen', 'new', 'badge', 'notification', 'dot', 'indicator', 'pending', 'alert'];
    for (const keyword of unreadKeywords) {
      if (cls.includes(keyword) || allClasses.includes(keyword)) {
        return true;
      }
    }
    
    // Check for any small circular elements (dots/badges)
    const smallElements = element.querySelectorAll('div, span');
    for (const el of smallElements) {
      const style = window.getComputedStyle(el);
      const width = parseInt(style.width);
      const height = parseInt(style.height);
      const borderRadius = style.borderRadius;
      
      // Small circular element (likely a dot indicator)
      if (width > 0 && width < 20 && height > 0 && height < 20 && 
          (borderRadius.includes('50%') || borderRadius.includes('100%') || parseInt(borderRadius) > 5)) {
        const bgColor = style.backgroundColor;
        // Check if it has a visible background color (not transparent)
        if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
          return true;
        }
      }
    }
    
    // Check for bold/emphasized text (unread messages often have bold names)
    const boldElements = element.querySelectorAll('strong, b, [style*="font-weight"]');
    if (boldElements.length > 0) {
      // Has bold text - might be unread
      // But this is less reliable, so we'll use it as a secondary check
    }
    
    // Check for SVG icons that might indicate unread
    const svgs = element.querySelectorAll('svg');
    for (const svg of svgs) {
      const fill = svg.getAttribute('fill') || '';
      if (fill.includes('blue') || fill.includes('#0') || fill.includes('rgb(0')) {
        return true;
      }
    }
    
    return false;
  }
  
  // Debug function to analyze a chat element
  function debugChatElement(element, index) {
    const text = (element.textContent || '').substring(0, 30);
    const cls = (element.className || '').substring(0, 50);
    const childCount = element.children.length;
    log('Chat ' + index + ': "' + text + '" class="' + cls + '" children=' + childCount);
  }
  
  // Find the input field
  function findInput() {
    // Try contenteditable first
    let input = document.querySelector('[contenteditable="true"]');
    if (input) return input;
    
    // Try textarea
    input = document.querySelector('textarea');
    if (input) return input;
    
    // Try input
    input = document.querySelector('input[type="text"]');
    if (input) return input;
    
    return null;
  }
  
  // Find send button
  function findSendButton() {
    // Try various selectors
    const selectors = [
      'button[type="submit"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      '[class*="send" i]',
      '[class*="Send"]'
    ];
    
    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn) return btn;
      } catch(e) {}
    }
    
    // Look for button with send icon or text
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('send') || ariaLabel.includes('send')) {
        return btn;
      }
    }
    
    return null;
  }
  
  // Track messages we've sent to avoid replying to ourselves
  const sentMessages = new Set();
  
  // Check if text looks like a status/UI element
  function isStatusText(text) {
    const lower = text.toLowerCase().trim();
    const statusWords = [
      'typing', 'delivered', 'opened', 'received', 'sent', 'viewed',
      'new chat', 'new snap', 'streak', 'screenshot', 'tap to',
      'swipe', 'double tap', 'just now', 'today', 'yesterday',
      'spotlight', 'stories', 'discover', 'map', 'camera'
    ];
    
    // Exact matches
    if (statusWords.includes(lower)) return true;
    
    // Partial matches for short text
    if (text.length < 20) {
      for (const word of statusWords) {
        if (lower.includes(word)) return true;
      }
    }
    
    // Timestamps
    if (/^\\d{1,2}:\\d{2}/.test(text)) return true;
    if (/^\\d+[smhd]\\s*(ago)?$/i.test(text)) return true;
    
    return false;
  }
  
  // Get visible text content from chat area
  function getVisibleMessages() {
    const messages = [];
    const seen = new Set();
    
    // Try multiple selectors for messages
    const selectors = [
      '[class*="message" i]',
      '[class*="Message"]', 
      '[class*="bubble" i]',
      '[class*="Bubble"]',
      '[class*="chat-text"]',
      '[class*="ChatText"]',
      '[class*="content" i] p',
      '[class*="content" i] span'
    ];
    
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length > 1 && text.length < 1000 && !seen.has(text)) {
            // Skip status/UI text
            if (isStatusText(text)) return;
            
            seen.add(text);
            
            // Determine if incoming or outgoing
            const rect = el.getBoundingClientRect();
            const cls = (el.className || '').toLowerCase();
            const parentCls = (el.parentElement?.className || '').toLowerCase();
            const allCls = cls + ' ' + parentCls;
            
            // Check class names first (more reliable)
            const isOutgoingByClass = allCls.includes('sent') || allCls.includes('outgoing') || 
                                      allCls.includes('self') || allCls.includes('right') || allCls.includes('mine');
            const isIncomingByClass = allCls.includes('received') || allCls.includes('incoming') || 
                                      allCls.includes('other') || allCls.includes('left');
            
            // Check if we sent this message
            const normalizedText = text.toLowerCase().trim();
            const isSentByUs = sentMessages.has(normalizedText);
            
            let isIncoming;
            if (isSentByUs || isOutgoingByClass) {
              isIncoming = false;
            } else if (isIncomingByClass) {
              isIncoming = true;
            } else {
              // Fallback to position (less reliable)
              isIncoming = rect.left < window.innerWidth * 0.4;
            }
            
            messages.push({ text, isIncoming });
          }
        });
      } catch(e) {}
    }
    
    return messages;
  }
  
  // Scan page and report what we find
  function scanPage() {
    log('=== PAGE SCAN ===');
    
    // Count all interactive elements
    const buttons = document.querySelectorAll('button').length;
    const inputs = document.querySelectorAll('input, textarea, [contenteditable]').length;
    const links = document.querySelectorAll('a').length;
    log('Buttons: ' + buttons + ', Inputs: ' + inputs + ', Links: ' + links);
    
    // Find chat-like elements
    const chats = findClickableChats();
    log('Potential chat items: ' + chats.length);
    
    // Check for unread
    let unreadCount = 0;
    chats.forEach(c => {
      if (hasUnreadIndicator(c)) unreadCount++;
    });
    log('Items with unread indicators: ' + unreadCount);
    
    // Check input
    const input = findInput();
    log('Input field: ' + (input ? 'FOUND (' + input.tagName + ')' : 'NOT FOUND'));
    
    // Check send button
    const sendBtn = findSendButton();
    log('Send button: ' + (sendBtn ? 'FOUND' : 'NOT FOUND'));
    
    // Sample some class names from the page
    const classes = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      const cls = el.className;
      if (typeof cls === 'string') {
        cls.split(' ').forEach(c => {
          if (c.length > 3 && c.length < 30) classes.add(c);
        });
      }
    });
    const classArr = Array.from(classes).slice(0, 20);
    log('Sample classes: ' + classArr.join(', '));
    
    log('=== END SCAN ===');
  }
  
  // Type a message
  async function typeMessage(text) {
    const input = findInput();
    if (!input) { 
      log('ERROR: Input not found'); 
      return false; 
    }
    
    log('Typing into: ' + input.tagName);
    input.focus();
    
    // Clear first
    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = '';
    } else if ('value' in input) {
      input.value = '';
    }
    
    // Type character by character
    const delays = CONFIG.typingDelayRangeMs || [50, 150];
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      if (input.getAttribute('contenteditable') === 'true') {
        input.textContent = (input.textContent || '') + char;
      } else if ('value' in input) {
        input.value = (input.value || '') + char;
      }
      
      // Dispatch events
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      
      const delay = Math.floor(Math.random() * (delays[1] - delays[0])) + delays[0];
      await sleep(delay);
    }
    
    log('Typed: ' + text.substring(0, 30) + '...');
    return true;
  }
  
  // Send the message
  async function sendMessage() {
    const input = findInput();
    
    // Method 1: Try Enter key on input (most reliable for Snapchat)
    if (input) {
      input.focus();
      
      // Try multiple Enter key event variations
      const enterEvents = [
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
        new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
      ];
      
      for (const event of enterEvents) {
        input.dispatchEvent(event);
      }
      
      // Also try dispatching on document
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      
      log('Pressed Enter key');
      await sleep(200);
    }
    
    // Method 2: Try clicking send button as backup
    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
      log('Also clicked send button');
      return true;
    }
    
    return input !== null;
  }
  
  // Find reply based on message - now async with AI support
  async function findReply(text, username) {
    const rules = CONFIG.replyRules || [];
    const lower = text.toLowerCase();
    
    // Skip UI elements that aren't real messages
    const uiElements = ['spotlight', 'drag & drop', 'upload', 'type a message', 'send a chat', 'new chat', 'add friends'];
    if (uiElements.some(ui => lower.includes(ui))) {
      log('Skipping UI element: ' + text.substring(0, 30));
      return null;
    }
    
    // First try rule-based matching (fast path)
    for (const rule of rules) {
      const match = (rule.caseSensitive ? rule.match : rule.match.toLowerCase());
      if (lower.includes(match)) {
        log('Rule matched: ' + rule.match);
        return rule.reply;
      }
    }
    
    // Try AI if enabled - use pending request system for renderer to handle
    if (CONFIG.ai && CONFIG.ai.enabled) {
      log('Requesting AI reply for: "' + text.substring(0, 30) + '..."');
      
      // Build conversation context from memory
      const memory = getUserMemory(username);
      const messages = [];
      
      // Add system prompt
      messages.push({
        role: 'system',
        content: CONFIG.ai.systemPrompt || 'You are a friendly person chatting casually. Keep responses brief and natural.'
      });
      
      // Add conversation history from memory (last N messages)
      if (CONFIG.ai.contextHistoryEnabled && memory.messages.length > 0) {
        const historyLimit = CONFIG.ai.maxContextMessages || 10;
        const recentMsgs = memory.messages.slice(-historyLimit);
        recentMsgs.forEach(m => {
          messages.push({
            role: m.from === 'them' ? 'user' : 'assistant',
            content: m.text
          });
        });
      }
      
      // Add current message
      messages.push({ role: 'user', content: text });
      
      // Store pending AI request for renderer to pick up
      const requestId = 'ai-' + Date.now();
      window.__SNAPPY_AI_REQUEST__ = {
        id: requestId,
        username: username,
        messages: messages,
        config: CONFIG.ai
      };
      
      // Wait for response (renderer will poll and fill this)
      log('Waiting for AI response...');
      const maxWait = 30000;
      const pollInterval = 100;
      let waited = 0;
      
      while (waited < maxWait) {
        await sleep(pollInterval);
        waited += pollInterval;
        
        if (window.__SNAPPY_AI_RESPONSE__ && window.__SNAPPY_AI_RESPONSE__.id === requestId) {
          const reply = window.__SNAPPY_AI_RESPONSE__.reply;
          window.__SNAPPY_AI_RESPONSE__ = null;
          window.__SNAPPY_AI_REQUEST__ = null;
          
          if (reply) {
            log('AI reply received: "' + reply.substring(0, 30) + '..."');
            return reply;
          } else {
            log('AI returned empty reply');
            break;
          }
        }
      }
      
      window.__SNAPPY_AI_REQUEST__ = null;
      log('AI request timed out, falling back to defaults');
    }
    
    // Default responses (fallback)
    if (lower.includes('?')) return "Let me check and get back to you!";
    if (lower.includes('hi') || lower.includes('hey') || lower.includes('hello')) return "Hey! Whats up?";
    if (lower.includes('how are') || lower.includes('whats up')) return "I am good, thanks! How about you?";
    if (lower.includes('thanks') || lower.includes('thank you')) return "You are welcome!";
    if (lower.includes('bye') || lower.includes('later')) return "Talk to you later!";
    
    return null;
  }
  
  // Try to click an element properly
  function clickElement(el) {
    // Try multiple click methods
    
    // Method 1: Direct click
    el.click();
    
    // Method 2: Dispatch mouse events
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: centerX, clientY: centerY }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: centerX, clientY: centerY }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: centerX, clientY: centerY }));
    
    // Method 3: Try clicking a child button or link if exists
    const clickable = el.querySelector('button, a, [role="button"]');
    if (clickable) {
      clickable.click();
    }
  }
  
  // Check if an element is positioned on the right side (outgoing message)
  function isOutgoingMessage(el) {
    // Check class names for outgoing indicators
    const classChain = (el.className || '') + ' ' + (el.parentElement?.className || '') + ' ' + (el.parentElement?.parentElement?.className || '');
    const classLower = classChain.toLowerCase();
    
    if (classLower.includes('sent') || classLower.includes('outgoing') || 
        classLower.includes('self') || classLower.includes('right') ||
        classLower.includes('me') || classLower.includes('own')) {
      return true;
    }
    
    // Check computed style for right-alignment
    const style = window.getComputedStyle(el);
    const parentStyle = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
    
    if (style.textAlign === 'right' || style.marginLeft === 'auto' ||
        (parentStyle && (parentStyle.justifyContent === 'flex-end' || parentStyle.alignItems === 'flex-end'))) {
      return true;
    }
    
    // Check position - if element is on right half of container, likely outgoing
    const rect = el.getBoundingClientRect();
    const containerWidth = el.parentElement?.getBoundingClientRect().width || window.innerWidth;
    if (rect.left > containerWidth * 0.5) {
      return true;
    }
    
    return false;
  }

  // Get all text content from the main chat area
  function getAllChatText() {
    // Find the main content area (usually right side of screen)
    const mainArea = document.querySelector('main, [role="main"], [class*="main"], [class*="content"], [class*="chat"]');
    
    // Get all text elements - prefer leaf nodes to avoid concatenated text
    const textElements = [];
    const seen = new Set();
    const selector = 'p, span, div';
    const elements = mainArea ? mainArea.querySelectorAll(selector) : document.querySelectorAll(selector);
    
    elements.forEach(el => {
      // Skip if this element has child elements with text (to avoid duplicates)
      const hasTextChildren = Array.from(el.children).some(child => 
        child.textContent && child.textContent.trim().length > 0
      );
      if (hasTextChildren) return;
      
      const text = el.textContent?.trim();
      if (text && text.length > 2 && text.length < 300 && !seen.has(text)) {
        // Skip if it's a timestamp or UI element
        if (!/^\\d{1,2}:\\d{2}/.test(text) && !/^(Send|Type|Message|Chat)/.test(text)) {
          // Skip status text
          if (!isStatusText(text)) {
            seen.add(text);
            const isOutgoing = isOutgoingMessage(el) || sentMessages.has(text.toLowerCase().trim());
            textElements.push({ text, element: el, isOutgoing });
          }
        }
      }
    });
    
    return textElements;
  }
  
  // Clean username by removing status indicators
  function cleanUsername(rawText) {
    // Status words that get appended to usernames in Snapchat
    const statusPatterns = [
      /Typing\\.{0,3}$/i,
      /Delivered$/i,
      /Opened$/i,
      /Received$/i,
      /Sent$/i,
      /Viewed$/i,
      /New Chat$/i,
      /New Snap$/i,
      /\\d+[smhd]\\s*(ago)?$/i,  // "2m ago", "5h"
      /\\d+:\\d+\\s*(AM|PM)?$/i,  // timestamps
      /Just now$/i,
      /Today$/i,
      /Yesterday$/i
    ];
    
    let cleaned = rawText.split(/[·\\n]/)[0].trim();
    
    // Remove status suffixes
    for (const pattern of statusPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
    
    return cleaned;
  }
  
  // Process a chat
  async function processChat(chatEl, chatText) {
    // Extract and clean username from chatText
    const username = cleanUsername(chatText);
    log('Opening chat with: ' + username);
    
    // Skip if username is empty or looks like a status
    if (!username || username.length < 2) {
      log('Invalid username, skipping');
      return;
    }
    
    // Load and display memory for this user
    const memory = getUserMemory(username);
    if (memory.messages.length > 0) {
      const summary = getMemorySummary(username);
      log('MEMORY: ' + summary.total + ' previous messages with ' + username);
      log('Recent: ' + summary.recent);
    } else {
      log('No previous memory for ' + username);
    }
    
    // Try clicking
    clickElement(chatEl);
    log('Clicked, waiting for chat to load...');
    await sleep(2500);
    
    // Get messages using multiple methods
    let messages = getVisibleMessages();
    log('Method 1 found ' + messages.length + ' messages');
    
    // If no messages found, try getting all text
    if (messages.length === 0) {
      const allText = getAllChatText();
      log('Method 2 found ' + allText.length + ' text elements');
      
      // Convert to messages format, using proper outgoing detection
      messages = allText
        .filter(t => !isStatusText(t.text))
        .map(t => ({
          text: t.text,
          isIncoming: !t.isOutgoing && !sentMessages.has(t.text.toLowerCase().trim())
        }));
    }
    
    log('Total messages: ' + messages.length);
    
    if (messages.length === 0) {
      log('No messages found');
      return;
    }
    
    // Check if the LAST message is from us - if so, don't reply
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg.isIncoming) {
        log('Last message is from us, skipping (waiting for their reply)');
        return;
      }
    }
    
    // Get last incoming message
    let lastIncoming = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].isIncoming) {
        lastIncoming = messages[i].text;
        break;
      }
    }
    
    if (!lastIncoming) {
      log('No incoming message found');
      return;
    }
    
    // Skip if this is actually a message we sent
    const normalizedIncoming = lastIncoming.toLowerCase().trim();
    if (sentMessages.has(normalizedIncoming)) {
      log('Skipping - this is our own message');
      return;
    }
    
    log('Last incoming: ' + lastIncoming.substring(0, 50));
    
    // Check if already replied (use cleaned username + full normalized message for consistent ID)
    const msgId = username + '::' + normalizedIncoming;
    if (seenMessages.has(msgId)) {
      log('Already processed this exact message');
      return;
    }
    
    // Also check if we recently replied to this user (within last 30 seconds)
    const recentReplyKey = 'recent::' + username;
    if (seenMessages.has(recentReplyKey)) {
      log('Recently replied to this user, waiting...');
      return;
    }
    
    // Find reply (now async with AI support)
    const reply = await findReply(lastIncoming, username);
    if (!reply) {
      log('No matching reply');
      seenMessages.add(msgId);
      return;
    }
    
    // Random skip
    if (Math.random() < (CONFIG.randomSkipProbability || 0.15)) {
      log('Random skip');
      seenMessages.add(msgId);
      return;
    }
    
    // Pre-delay
    const preDelay = CONFIG.preReplyDelayRangeMs || [2000, 6000];
    const delay = Math.floor(Math.random() * (preDelay[1] - preDelay[0])) + preDelay[0];
    log('Waiting ' + delay + 'ms...');
    await sleep(delay);
    
    // Type and send
    const typed = await typeMessage(reply);
    if (!typed) return;
    
    await sleep(500);
    const sent = await sendMessage();
    
    if (sent) {
      log('SUCCESS: Sent reply: ' + reply);
      seenMessages.add(msgId);
      
      // Track this message as sent by us (to avoid replying to ourselves)
      sentMessages.add(reply.toLowerCase().trim());
      
      // Mark that we recently replied to this user (prevents rapid re-replies)
      const recentReplyKey = 'recent::' + username;
      seenMessages.add(recentReplyKey);
      // Clear the recent flag after 30 seconds
      setTimeout(() => seenMessages.delete(recentReplyKey), 30000);
      
      // Save their message to memory (username already cleaned above)
      addToMemory(username, lastIncoming, true);
      
      // Save our reply to memory
      addToMemory(username, reply, false);
      
      // Log memory summary
      const summary = getMemorySummary(username);
      log('Memory for ' + username + ': ' + summary.total + ' msgs (' + summary.fromThem + ' from them, ' + summary.fromMe + ' from me)');
    }
  }
  
  // Main poll function
  let pollCount = 0;
  async function poll() {
    if (!window.__SNAPPY_RUNNING__) return;
    pollCount++;
    
    log('--- Poll #' + pollCount + ' ---');
    
    const chats = findClickableChats();
    log('Found ' + chats.length + ' chat items');
    
    // Debug first 3 chats on first poll
    if (pollCount === 1 && chats.length > 0) {
      log('Debugging first 3 chats:');
      for (let i = 0; i < Math.min(3, chats.length); i++) {
        debugChatElement(chats[i], i);
      }
    }
    
    // Find chats with unread
    const unreadChats = [];
    for (const chat of chats) {
      if (hasUnreadIndicator(chat)) {
        unreadChats.push(chat);
      }
    }
    
    log('Unread chats: ' + unreadChats.length);
    
    // Only process chats with actual unread indicators
    if (unreadChats.length === 0) {
      log('No unread messages to process');
      return;
    }
    
    // Process first unread chat
    const chat = unreadChats[0];
    const chatText = chat.textContent?.trim().substring(0, 50) || 'Unknown';
    await processChat(chat, chatText);
  }
  
  // Start
  log('Bot started!');
  log('Rules: ' + (CONFIG.replyRules?.length || 0));
  
  // Initial scan after short delay
  setTimeout(scanPage, 1500);
  
  // Start polling after brief delay
  setTimeout(() => {
    log('Starting message polling...');
    poll();
    pollInterval = setInterval(poll, 5000);
  }, 2000);
  
  // Stop function
  window.__SNAPPY_STOP__ = function() {
    window.__SNAPPY_RUNNING__ = false;
    if (pollInterval) clearInterval(pollInterval);
    log('Bot stopped');
  };
})();
`;
}

// Listen for console messages from webview
function setupWebviewListeners(wv: Electron.WebviewTag) {
  wv.addEventListener('console-message', (e) => {
    const msg = e.message;
    // Log ALL messages for debugging
    console.log('[Webview Console]', msg);
    
    if (msg.includes('[Snappy]')) {
      const cleanMsg = msg.replace(/\[Snappy\]\s*/g, '');
      if (msg.includes('SUCCESS') || msg.includes('FOUND')) {
        addLog(cleanMsg, 'success');
      } else if (msg.includes('ERROR') || msg.includes('NOT FOUND')) {
        addLog(cleanMsg, 'error');
      } else {
        addLog(cleanMsg, 'info');
      }
    }
  });

}

// Set up listeners for initial webview if it exists
if (webview) {
  setupWebviewListeners(webview);
}

// Poll for logs from the webview (backup method)
setInterval(async () => {
  if (!isBotActive) return;
  const currentWebview = getActiveWebview();
  if (!currentWebview) return;
  try {
    const logs = await currentWebview.executeJavaScript(`
      (function() {
        if (!window.__SNAPPY_LOGS__) return [];
        const logs = window.__SNAPPY_LOGS__.splice(0);
        return logs;
      })();
    `);
    if (logs && logs.length > 0) {
      logs.forEach((log: string) => addLog(log, 'info'));
    }
  } catch (e) {
    // Ignore errors
  }
}, 1000);

// Track currently processing AI request to prevent duplicates
let processingAIRequest: string | null = null;

// Poll for pending AI requests from webview and handle via IPC
setInterval(async () => {
  if (!isBotActive) return;
  const currentWebview = getActiveWebview();
  if (!currentWebview) return;
  
  // Don't process if we're already handling a request
  if (processingAIRequest) return;
  
  try {
    // Check if there's a pending AI request
    const request = await currentWebview.executeJavaScript(`
      (function() {
        if (window.__SNAPPY_AI_REQUEST__) {
          const req = window.__SNAPPY_AI_REQUEST__;
          return req;
        }
        return null;
      })();
    `);
    
    if (request && request.id && request.id !== processingAIRequest) {
      // Mark as processing to prevent duplicates
      processingAIRequest = request.id;
      
      // Clear the request immediately in the webview
      await currentWebview.executeJavaScript(`window.__SNAPPY_AI_REQUEST__ = null;`);
      
      // Make the AI call via IPC (which goes through main process - no CORS)
      addLog(`Processing AI request for ${request.username}`, 'info');
      
      try {
        const result = await (window as any).bot.generateAIReply(
          request.username,
          request.messages[request.messages.length - 1].content, // last message is the user's
          request.username
        );
        
        // Send response back to webview
        await currentWebview.executeJavaScript(`
          window.__SNAPPY_AI_RESPONSE__ = {
            id: '${request.id}',
            reply: ${result?.reply ? JSON.stringify(result.reply) : 'null'}
          };
        `);
        
        if (result?.reply) {
          addLog(`AI reply: "${result.reply.substring(0, 40)}..."`, 'success');
        }
      } catch (err: any) {
        addLog(`AI IPC error: ${err.message}`, 'error');
        // Send error response
        await currentWebview.executeJavaScript(`
          window.__SNAPPY_AI_RESPONSE__ = { id: '${request.id}', reply: null };
        `);
      } finally {
        // Clear processing flag
        processingAIRequest = null;
      }
    }
  } catch (e) {
    // Ignore errors and clear processing flag
    processingAIRequest = null;
  }
}, 200); // Poll every 200ms for quick response

// Webview ready handler - set up for any webview
function setupWebviewReadyHandler(wv: Electron.WebviewTag) {
  wv.addEventListener('dom-ready', () => {
    addLog('Page loaded: ' + wv.getURL(), 'info');
  
    // Inject compatibility fixes (wrapped in try-catch to avoid errors)
    wv.executeJavaScript(`
      try {
        if (typeof window.dragEvent === 'undefined') window.dragEvent = null;
        if (!navigator.webdriver) {
          try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch(e) {}
        }
        window.chrome = window.chrome || { runtime: {} };
        console.log('[Snappy] Compatibility fixes applied');
      } catch(e) { console.log('[Snappy] Compat fix skipped'); }
    `).catch(() => {});
  });

  // Handle webview errors
  wv.addEventListener('did-fail-load', (e) => {
    addLog('Load failed: ' + e.errorDescription, 'error');
  });
}

// Set up ready handler for initial webview
if (webview) {
  setupWebviewReadyHandler(webview);
}

// Refresh memories from webview (now using localStorage)
async function refreshMemories() {
  const currentWebview = getActiveWebview();
  if (!currentWebview) {
    console.log('[Renderer] No active webview for memories');
    return;
  }
  try {
    const memories = await currentWebview.executeJavaScript(`
      (function() {
        if (!window.__SNAPPY_MEMORY__) return [];
        const allMems = window.__SNAPPY_MEMORY__.loadAll();
        const result = [];
        for (const username in allMems) {
          const mem = allMems[username];
          const fromThem = mem.messages.filter(m => m.from === 'them').length;
          const fromMe = mem.messages.filter(m => m.from === 'me').length;
          // Get last 3 messages for AI context preview
          const recentMsgs = mem.messages.slice(-3).map(m => ({
            from: m.from,
            text: m.text.substring(0, 40)
          }));
          result.push({
            username: username,
            total: mem.messages.length,
            fromThem: fromThem,
            fromMe: fromMe,
            lastSeen: mem.lastSeen,
            recent: recentMsgs
          });
        }
        // Sort by lastSeen (most recent first)
        result.sort((a, b) => b.lastSeen - a.lastSeen);
        return result;
      })();
    `);
    
    if (!memories || memories.length === 0) {
      memoriesContainer.innerHTML = '<div class="memory-empty">No conversations yet</div>';
      return;
    }
    
    const isAIEnabled = aiEnabled?.checked || false;
    
    memoriesContainer.innerHTML = memories.map((m: {username: string, total: number, fromThem: number, fromMe: number, recent: Array<{from: string, text: string}>}) => {
      let html = `
        <div class="memory-item" data-username="${escapeHtml(m.username)}">
          <div class="memory-header">
            <div class="memory-sender">${escapeHtml(m.username)}</div>
            <button class="memory-delete" title="Delete memory">&times;</button>
          </div>
          <div class="memory-summary">${m.total} msgs (${m.fromThem} them, ${m.fromMe} me)</div>`;
      
      // Show AI context preview if AI is enabled
      if (isAIEnabled && m.recent && m.recent.length > 0) {
        html += `<div class="memory-context">`;
        m.recent.forEach(msg => {
          const prefix = msg.from === 'them' ? '→' : '←';
          html += `<div class="context-msg">${prefix} ${escapeHtml(msg.text)}...</div>`;
        });
        html += `</div>`;
      }
      
      html += `</div>`;
      return html;
    }).join('');
    
    // Add delete handlers
    memoriesContainer.querySelectorAll('.memory-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = (e.target as HTMLElement).closest('.memory-item') as HTMLElement;
        const username = item?.dataset.username;
        if (username && confirm(`Delete memory for "${username}"?`)) {
          await deleteMemory(username);
        }
      });
    });
  } catch (e) {
    // Bot not running or no memories
  }
}

refreshMemoriesBtn.addEventListener('click', refreshMemories);

// Delete a specific user's memory
async function deleteMemory(username: string) {
  const currentWebview = getActiveWebview();
  if (!currentWebview) {
    addLog('No active webview', 'error');
    return;
  }
  
  try {
    await currentWebview.executeJavaScript(`
      (function() {
        const MEMORY_KEY = 'snappy_memories';
        try {
          const data = localStorage.getItem(MEMORY_KEY);
          const memories = data ? JSON.parse(data) : {};
          delete memories['${username.replace(/'/g, "\\'")}'];
          localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
          console.log('[Snappy] Deleted memory for: ${username.replace(/'/g, "\\'")}');
          return true;
        } catch (e) {
          console.error('[Snappy] Error deleting memory:', e);
          return false;
        }
      })();
    `);
    
    addLog(`Deleted memory for ${username}`, 'info');
    refreshMemories(); // Refresh the list
  } catch (e) {
    addLog(`Failed to delete memory: ${e}`, 'error');
  }
}

// Auto-refresh memories every 10 seconds when bot is active
setInterval(() => {
  if (isBotActive) refreshMemories();
}, 10000);

// Create a default webview for backwards compatibility
function createDefaultWebview(url: string = 'https://web.snapchat.com'): Electron.WebviewTag {
  const container = document.getElementById('webview-container');
  if (!container) throw new Error('No webview container');
  
  const wv = document.createElement('webview') as Electron.WebviewTag;
  wv.id = 'default-webview';
  wv.className = 'session-webview';
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('partition', 'persist:default');
  wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  wv.src = url;
  
  // Add styles to make it fill the container
  wv.style.width = '100%';
  wv.style.height = '100%';
  wv.style.border = 'none';
  
  container.appendChild(wv);
  return wv;
}

document.addEventListener('DOMContentLoaded', async () => {
  loadConfig();
  addLog('Snappy initialized', 'highlight');
  
  // Set up multi-session UI (tabs, modal, context menu)
  setupMultiSessionUI();
  
  // Try to load existing sessions from main process
  try {
    const sessions = await (window as any).session.getAllSessions();
    if (sessions && sessions.length > 0) {
      // Load saved sessions
      sessions.forEach((s: SessionData) => addSessionToUI(s));
      addLog(`Loaded ${sessions.length} session(s)`, 'info');
    } else {
      // No saved sessions - create a default one
      addLog('Creating default session...', 'info');
      const defaultSession = await (window as any).session.createSession(
        'Default Session',
        undefined,
        { initialUrl: 'https://web.snapchat.com' }
      );
      if (defaultSession) {
        addSessionToUI(defaultSession);
      } else {
        // Fallback: create local webview if IPC fails
        const wv = createDefaultWebview('https://web.snapchat.com');
        setupWebviewListeners(wv);
        setupWebviewReadyHandler(wv);
        webview = wv;
      }
    }
  } catch (e) {
    // IPC not available - create fallback webview
    console.log('Session API not available, using fallback:', e);
    const wv = createDefaultWebview('https://web.snapchat.com');
    setupWebviewListeners(wv);
    setupWebviewReadyHandler(wv);
    webview = wv;
  }
  
  // Update webview reference
  webview = getActiveWebview();
});
