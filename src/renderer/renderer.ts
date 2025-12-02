/**
 * Renderer - Settings Panel with Activity Log
 */

interface ReplyRule {
  match: string;
  reply: string;
  priority?: number;
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
    randomSkipProbability: (parseInt(skipRate.value) || 15) / 100
  };
  await (window as any).bot.saveConfig(config);
  saveBtn.textContent = 'Saved';
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
  window.conversationMemories = new Map();
  const conversationMemories = window.conversationMemories;
  let pollInterval = null;
  
  function log(msg) {
    console.log('[Snappy] ' + msg);
  }
  
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  
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
    // Check for blue dots, badges, bold text, etc.
    const html = element.innerHTML.toLowerCase();
    const cls = (element.className || '').toLowerCase();
    
    // Check class names
    if (cls.includes('unread') || cls.includes('new') || cls.includes('badge') || cls.includes('notification')) {
      return true;
    }
    
    // Check for nested unread indicators
    const unreadEl = element.querySelector('[class*="unread"], [class*="Unread"], [class*="badge"], [class*="new"], [class*="notification"]');
    if (unreadEl) return true;
    
    // Check for blue color (common unread indicator)
    const blueElements = element.querySelectorAll('[style*="background"], [style*="color"]');
    for (const el of blueElements) {
      const style = el.getAttribute('style') || '';
      if (style.includes('rgb(0, 149, 246)') || style.includes('#0095f6') || style.includes('blue')) {
        return true;
      }
    }
    
    return false;
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
    
    // Find message-like elements
    document.querySelectorAll('[class*="message" i], [class*="Message"], [class*="chat" i], [class*="bubble" i]').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length > 0 && text.length < 1000) {
        // Try to determine if incoming or outgoing based on position/style
        const rect = el.getBoundingClientRect();
        const isLeft = rect.left < window.innerWidth / 2;
        messages.push({ text, isIncoming: isLeft });
      }
    });
    
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
    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
      log('Clicked send button');
      return true;
    }
    
    // Try Enter key
    const input = findInput();
    if (input) {
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
      });
      input.dispatchEvent(enterEvent);
      log('Pressed Enter');
      return true;
    }
    
    log('ERROR: Could not send');
    return false;
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
  
  // Process a chat
  async function processChat(chatEl, chatText) {
    log('Opening chat: ' + chatText.substring(0, 30));
    chatEl.click();
    await sleep(2000);
    
    // Get messages
    const messages = getVisibleMessages();
    log('Found ' + messages.length + ' messages in chat');
    
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
      
      // Update memory
      let mem = conversationMemories.get(chatText) || { sender: chatText, messages: [], summary: '' };
      mem.messages.push({ text: lastIncoming, isIncoming: true, timestamp: Date.now() });
      mem.messages.push({ text: reply, isIncoming: false, timestamp: Date.now() });
      mem.summary = chatText + ': ' + mem.messages.length + ' msgs';
      conversationMemories.set(chatText, mem);
    }
  }
  
  // Main poll function
  async function poll() {
    if (!window.__SNAPPY_RUNNING__) return;
    
    log('--- Polling ---');
    
    const chats = findClickableChats();
    log('Found ' + chats.length + ' chat items');
    
    // Find chats with unread
    const unreadChats = [];
    for (const chat of chats) {
      if (hasUnreadIndicator(chat)) {
        unreadChats.push(chat);
      }
    }
    
    log('Unread chats: ' + unreadChats.length);
    
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
    if (msg.includes('✓')) {
      addLog(cleanMsg, 'success');
    } else if (msg.includes('Error') || msg.includes('not found')) {
      addLog(cleanMsg, 'error');
    } else if (msg.includes('🚀') || msg.includes('🛑')) {
      addLog(cleanMsg, 'highlight');
    } else {
      addLog(cleanMsg, 'info');
    }
  }
});

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

// Refresh memories from webview
async function refreshMemories() {
  try {
    const memories = await webview.executeJavaScript(`
      (function() {
        if (!window.__SNAPPY_RUNNING__) return [];
        const mems = [];
        if (typeof conversationMemories !== 'undefined') {
          conversationMemories.forEach((v, k) => mems.push({ sender: k, summary: v.summary, count: v.messages.length }));
        }
        return mems;
      })();
    `);
    
    if (!memories || memories.length === 0) {
      memoriesContainer.innerHTML = '<div class="memory-empty">No conversations yet</div>';
      return;
    }
    
    memoriesContainer.innerHTML = memories.map((m: {sender: string, summary: string, count: number}) => `
      <div class="memory-item">
        <div class="memory-sender">${escapeHtml(m.sender)}</div>
        <div class="memory-summary">${m.count} messages</div>
      </div>
    `).join('');
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
