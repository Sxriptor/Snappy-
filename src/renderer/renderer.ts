/**
 * Renderer - Settings Panel
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

// Panel
function togglePanel() {
  isPanelOpen = !isPanelOpen;
  panel.classList.toggle('open', isPanelOpen);
  toggleBtn.classList.toggle('shifted', isPanelOpen);
}

toggleBtn.addEventListener('click', togglePanel);
closeBtn.addEventListener('click', togglePanel);

// URL
function loadUrl() {
  let url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  webview.src = url;
}

goBtn.addEventListener('click', loadUrl);
urlInput.addEventListener('keypress', e => { if (e.key === 'Enter') loadUrl(); });

// Bot
botBtn.addEventListener('click', () => {
  const bot = (window as any).bot;
  if (isBotActive) {
    bot.stopBot();
    isBotActive = false;
    statusDot.classList.remove('active');
    statusText.textContent = 'Inactive';
    botBtn.textContent = 'Start';
  } else {
    bot.injectBot();
    isBotActive = true;
    statusDot.classList.add('active');
    statusText.textContent = 'Active';
    botBtn.textContent = 'Stop';
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

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  if (!webview.src || webview.src === 'about:blank') {
    webview.src = 'https://web.snapchat.com';
  }
});
