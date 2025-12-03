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
const webview = document.getElementById('site-view') as Electron.WebviewTag;

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
    const endpoint = aiEndpoint?.value || 'localhost';
    const port = parseInt(aiPort?.value) || 8080;
    const url = `http://${endpoint}:${port}/v1/chat/completions`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: aiModel?.value || 'local-model',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      aiStatus.textContent = '●';
      aiStatus.className = 'ai-status connected';
      addLog('AI connection successful!', 'success');
    } else {
      aiStatus.textContent = '●';
      aiStatus.className = 'ai-status disconnected';
      addLog(`AI connection failed: HTTP ${response.status}`, 'error');
    }
  } catch (e: any) {
    aiStatus.textContent = '●';
    aiStatus.className = 'ai-status disconnected';
    if (e.name === 'AbortError') {
      addLog('AI connection timed out', 'error');
    } else {
      addLog(`AI connection failed: ${e.message}`, 'error');
    }
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
  webview.src = url;
  addLog(`Navigating to: ${url}`, 'info');
}

goBtn.addEventListener('click', loadUrl);
urlInput.addEventListener('keypress', e => { if (e.key === 'Enter') loadUrl(); });

// Bot injection into webview
async function injectBotIntoWebview() {
  try {
    const { config } = await (window as any).bot.getStatus();
    
    // Inject the bot script into the webview
    const botScript = getBotScript(config);
    
    // Try injection with error details
    try {
      await webview.executeJavaScript(botScript);
      addLog('Bot injected successfully', 'success');
      
      // Verify bot is running
      setTimeout(async () => {
        try {
          const isRunning = await webview.executeJavaScript('window.__SNAPPY_RUNNING__ === true');
          addLog(`Bot running: ${isRunning}`, isRunning ? 'success' : 'error');
          
          // Force a log message
          await webview.executeJavaScript('console.log("[Snappy] Verification ping")');
        } catch (e) {
          addLog('Could not verify bot status', 'error');
        }
      }, 1000);
      
      return true;
    } catch (injErr: any) {
      addLog(`Script error: ${injErr.message || injErr}`, 'error');
      // Try a simpler test script
      try {
        await webview.executeJavaScript('console.log("[Snappy] Test injection works")');
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
  try {
    await webview.executeJavaScript('if(window.__SNAPPY_STOP__) window.__SNAPPY_STOP__();');
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
    
    if (config.initialUrl) webview.src = config.initialUrl;
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
            seen.add(text);
            // Try to determine if incoming or outgoing based on position
            const rect = el.getBoundingClientRect();
            const isLeft = rect.left < window.innerWidth * 0.4;
            const cls = (el.className || '').toLowerCase();
            const isIncoming = isLeft || cls.includes('received') || cls.includes('incoming') || cls.includes('other');
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
  
  // Find reply based on message
  function findReply(text) {
    const rules = CONFIG.replyRules || [];
    const lower = text.toLowerCase();
    
    for (const rule of rules) {
      const match = (rule.caseSensitive ? rule.match : rule.match.toLowerCase());
      if (lower.includes(match)) {
        log('Rule matched: ' + rule.match);
        return rule.reply;
      }
    }
    
    // Default responses
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
  
  // Get all text content from the main chat area
  function getAllChatText() {
    // Find the main content area (usually right side of screen)
    const mainArea = document.querySelector('main, [role="main"], [class*="main"], [class*="content"], [class*="chat"]');
    
    // Get all text elements
    const textElements = [];
    const selector = 'p, span, div';
    const elements = mainArea ? mainArea.querySelectorAll(selector) : document.querySelectorAll(selector);
    
    elements.forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length > 0 && text.length < 500) {
        // Skip if it's a timestamp or UI element
        if (!/^\\d{1,2}:\\d{2}/.test(text) && !/^(Send|Type|Message|Chat)/.test(text)) {
          textElements.push({ text, element: el });
        }
      }
    });
    
    return textElements;
  }
  
  // Process a chat
  async function processChat(chatEl, chatText) {
    // Extract username from chatText
    const username = chatText.split(/[·\\n]/)[0].trim();
    log('Opening chat with: ' + username);
    
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
      
      // Convert to messages format
      messages = allText.map((t, i) => ({
        text: t.text,
        isIncoming: i % 2 === 0 // Alternate as a guess
      }));
    }
    
    log('Total messages: ' + messages.length);
    
    if (messages.length === 0) {
      log('No messages found');
      return;
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
    
    log('Last incoming: ' + lastIncoming.substring(0, 50));
    
    // Check if already replied
    const msgId = chatText + '-' + lastIncoming.substring(0, 20);
    if (seenMessages.has(msgId)) {
      log('Already processed');
      return;
    }
    
    // Find reply
    const reply = findReply(lastIncoming);
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
      
      // Extract username from chatText (remove timestamps, etc.)
      const username = chatText.split(/[·\\n]/)[0].trim();
      
      // Save their message to memory
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
    
    // If no unread found but we have chats, try processing the first one anyway (for testing)
    if (unreadChats.length === 0 && chats.length > 0 && pollCount <= 2) {
      log('No unread detected - trying first chat for testing');
      const chat = chats[0];
      const chatText = chat.textContent?.trim().substring(0, 50) || 'Unknown';
      await processChat(chat, chatText);
      return;
    }
    
    if (unreadChats.length === 0) {
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
  
  // Initial scan
  setTimeout(scanPage, 3000);
  
  // Start polling
  poll();
  pollInterval = setInterval(poll, 5000);
  
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
webview.addEventListener('console-message', (e) => {
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

// Poll for logs from the webview (backup method)
setInterval(async () => {
  if (!isBotActive) return;
  try {
    const logs = await webview.executeJavaScript(`
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

// Webview ready handler
webview.addEventListener('dom-ready', () => {
  addLog('Page loaded: ' + webview.getURL(), 'info');
  
  // Inject compatibility fixes (wrapped in try-catch to avoid errors)
  webview.executeJavaScript(`
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
webview.addEventListener('did-fail-load', (e) => {
  addLog('Load failed: ' + e.errorDescription, 'error');
});

// Refresh memories from webview (now using localStorage)
async function refreshMemories() {
  try {
    const memories = await webview.executeJavaScript(`
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
        <div class="memory-item">
          <div class="memory-sender">${escapeHtml(m.username)}</div>
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
  } catch (e) {
    // Bot not running or no memories
  }
}

refreshMemoriesBtn.addEventListener('click', refreshMemories);

// Auto-refresh memories every 10 seconds when bot is active
setInterval(() => {
  if (isBotActive) refreshMemories();
}, 10000);

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  addLog('Snappy initialized', 'highlight');
  if (!webview.src || webview.src === 'about:blank') {
    webview.src = 'https://web.snapchat.com';
  }
});
