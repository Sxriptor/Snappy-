import { Configuration } from '../types';

export function buildRedditBotScript(config: Configuration): string {
  const serializedConfig = JSON.stringify(config || {});

  return `
(function() {
  if (window.__SNAPPY_RUNNING__ && window.__SNAPPY_REDDIT_RUNNING__) {
    console.log('[Snappy][Reddit] Already running');
    return;
  }

  window.__SNAPPY_RUNNING__ = true;
  window.__SNAPPY_REDDIT_RUNNING__ = true;

  const CONFIG = ${serializedConfig};
  const processedItems = new Set();
  const lastIncomingByAuthor = new Map();
  let isRunning = true;
  let pollTimer = null;
  let isProcessing = false;
  let threadsAnchored = false;
  let startupCheckRunning = true;
  let nextSubredditCheckAt = 0;
  let lastPmCheckAt = 0;
  let lastPmReplyRunAt = 0;
  let lastDmPauseWindowKey = '';
  const processedScheduleSlots = new Set();
  let isPostingScheduledContent = false;
  const unreadPmQueue = [];

  const MIN_SUBREDDIT_CHECK_MS = 5 * 60 * 1000;
  const MAX_SUBREDDIT_CHECK_MS = 60 * 60 * 1000;
  const PM_CHECK_DEBOUNCE_MS = 3000;
  const PM_REPLY_DEBOUNCE_MS = 1500;
  const SCHEDULER_JITTER_MINUTES = 0;
  const SCHEDULER_DUE_WINDOW_MINUTES = 5;
  const MIN_POLL_MS = 1000;
  const MAX_POLL_MS = 15000;

  const settings = {
    watchNotifications: true,
    watchPrivateMessages: true,
    readPrivateMessages: true,
    watchSubreddits: [],
    subredditKeywords: [],
    autoReplyToComments: true,
    autoReplyToPMs: true,
    autoReplyToPosts: false,
    postScheduler: {
      enabled: false,
      folderPath: '',
      subreddit: '',
      days: {},
      posts: []
    },
    authCookieString: '',
    sessionCookie: '',
    pollIntervalMs: 30000,
    maxItemsPerPoll: (CONFIG?.reddit && CONFIG.reddit.maxCommentsPerPoll) || 3,
    ...(CONFIG.reddit || {})
  };

  const SELECTORS = {
    notificationItems: '[data-testid="notification-item"], .notification-item',
    unreadNotification: '.unread, [data-is-unread="true"]',
    messageItems: '[data-testid="message-item"], .message-item',
    unreadMessage: '.unread, [data-unread="true"]'
  };

  function log(message) {
    const formatted = '[Snappy][Reddit] ' + message;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function deepQueryAll(selector) {
    const out = [];
    const visited = new Set();

    function walk(root) {
      if (!root || visited.has(root)) return;
      visited.add(root);
      try {
        root.querySelectorAll(selector).forEach(node => out.push(node));
      } catch (e) {
        // ignore selector issues
      }
      let all = [];
      try {
        all = root.querySelectorAll('*');
      } catch (e) {
        all = [];
      }
      all.forEach(node => {
        if (node.shadowRoot) walk(node.shadowRoot);
      });
    }

    walk(document);
    return out;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\\s+/g, ' ').trim();
  }

  function isVisibleElement(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function randomRange(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getPollDelayMs() {
    return randomRange(MIN_POLL_MS, MAX_POLL_MS);
  }

  function scheduleNextSubredditCheck() {
    const waitMs = randomRange(MIN_SUBREDDIT_CHECK_MS, MAX_SUBREDDIT_CHECK_MS);
    nextSubredditCheckAt = Date.now() + waitMs;
    log('Next subreddit check in ~' + Math.round(waitMs / 60000) + ' minute(s)');
  }

  function normalizeSubreddit(subreddit) {
    if (!subreddit || typeof subreddit !== 'string') return '';
    return subreddit.trim().replace(/^r\\//i, '').replace(/^\\/+|\\/+$/g, '');
  }

  function getUnreadCount(itemSelector, unreadSelector) {
    const items = Array.from(document.querySelectorAll(itemSelector));
    return items.filter(item => item.querySelector(unreadSelector)).length;
  }

  function shouldReadPrivateMessages() {
    return settings.watchPrivateMessages !== false && settings.readPrivateMessages !== false;
  }

  function shouldOpenChatOnStart() {
    return settings.watchPrivateMessages !== false;
  }

  function ensureThreadsTab() {
    const tabs = deepQueryAll('button, a, [role="tab"], [role="button"], faceplate-tab');
    for (const tab of tabs) {
      if (!(tab instanceof HTMLElement)) continue;
      const txt = String(tab.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      if (!txt) continue;
      if (txt === 'threads' || txt.startsWith('threads ')) {
        tab.click();
        log('Focused Threads tab');
        return true;
      }
    }
    return false;
  }

  function ensureInboxTab() {
    const tabs = deepQueryAll('button, a, [role="tab"], [role="button"], faceplate-tab, [data-testid]');
    for (const tab of tabs) {
      if (!(tab instanceof HTMLElement)) continue;
      const txt = normalizeText(tab.textContent || '').toLowerCase();
      const testId = String(tab.getAttribute('data-testid') || '').toLowerCase();
      if (testId.includes('nav-item-inbox') || txt === 'inbox' || txt.startsWith('inbox ')) {
        tab.click();
        log('Focused Inbox tab');
        return true;
      }
    }
    return false;
  }

  function clickElementRobust(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {}
    try {
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.click();
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      // Some Reddit controls respond better to keyboard activation on focused role=button.
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function isRequestsNavControl(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const testId = String(el.getAttribute('data-testid') || '').toLowerCase();
    if (testId.includes('requests-button') || testId.includes('nav-item-requests')) return true;
    const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
    if (aria.includes('view chat requests') || aria.includes('chat requests')) return true;
    const txt = normalizeText(el.textContent || '').toLowerCase();
    if (txt === 'requests' || txt.startsWith('requests ')) return true;
    return false;
  }

  function findVisibleRequestsTabTargets() {
    const out = [];
    const seen = new Set();
    const selectors = [
      'li[data-testid="requests-button"] [role="button"]',
      '[data-testid="requests-button"] [role="button"]',
      '[data-testid="requests-button"]',
      '[data-testid="nav-item-requests"]',
      '[aria-label="View chat requests"]',
      '[aria-label*="chat requests" i]'
    ];
    for (const selector of selectors) {
      const nodes = deepQueryAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (!isVisibleElement(node)) continue;
        let target = node;
        if (!target.matches('[role="button"]') && target.querySelector('[role="button"]')) {
          const roleButton = target.querySelector('[role="button"]');
          if (roleButton && roleButton instanceof HTMLElement) target = roleButton;
        }
        if (!target || !(target instanceof HTMLElement)) continue;
        if (!isVisibleElement(target)) continue;
        const key = String(target.tagName) + '|' + String(target.getAttribute('data-testid') || '') + '|' + normalizeText(target.textContent || '').slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(target);
      }
    }
    return out;
  }

  function ensureRequestsTab() {
    // First pass: exact requests tab selectors from Reddit chat nav.
    const strictTargets = findVisibleRequestsTabTargets();
    for (const target of strictTargets) {
      if (!(target instanceof HTMLElement)) continue;
      if (!clickElementRobust(target)) continue;
      log('Focused Requests tab (strict requests-button)');
      return true;
    }

    const tabs = deepQueryAll('button, a, [role="tab"], [role="button"], faceplate-tab, [data-testid]');
    for (const tab of tabs) {
      if (!(tab instanceof HTMLElement)) continue;
      if (!isVisibleElement(tab)) continue;
      const txt = normalizeText(tab.textContent || '').toLowerCase();
      const testId = String(tab.getAttribute('data-testid') || '').toLowerCase();
      const requestsTextMatch = /^requests(?:\\b|\\s|\\(|\\d)/.test(txt);
      const isCreateNewChat = txt.includes('create new chat') || testId.includes('create-new-chat');
      if (isCreateNewChat) continue;
      if (testId.includes('requests-button') || testId.includes('nav-item-requests') || requestsTextMatch || txt.includes('message requests') || isRequestsNavControl(tab)) {
        if (clickElementRobust(tab)) {
          log('Focused Requests tab (fallback)');
          return true;
        }
      }
    }
    return false;
  }

  async function returnToThreads(reason) {
    ensureThreadsTab();
    threadsAnchored = true;
    await sleep(180);
    if (reason) log('Returned to Threads: ' + reason);
  }

  function applyCookie(name, value) {
    if (!name) return;
    const encodedName = encodeURIComponent(String(name).trim());
    const encodedValue = encodeURIComponent(String(value || '').trim());
    if (!encodedName) return;
    const cookie = encodedName + '=' + encodedValue + '; domain=.reddit.com; path=/; secure; samesite=lax';
    document.cookie = cookie;
  }

  function applyManualAuthCookies() {
    const cookieString = String(settings.authCookieString || '').trim();
    const sessionCookie = String(settings.sessionCookie || '').trim();

    if (cookieString) {
      cookieString.split(';').forEach(part => {
        const seg = String(part || '').trim();
        if (!seg) return;
        const eqIdx = seg.indexOf('=');
        if (eqIdx <= 0) return;
        const name = seg.substring(0, eqIdx).trim();
        const value = seg.substring(eqIdx + 1).trim();
        applyCookie(name, value);
      });
    }

    if (sessionCookie) {
      applyCookie('reddit_session', sessionCookie);
    }
  }

  function buildPostId(post) {
    const name = post?.data?.name || '';
    const permalink = post?.data?.permalink || '';
    const title = post?.data?.title || '';
    const author = post?.data?.author || '';
    return [name, permalink, author, title.slice(0, 120)].join('|');
  }

  function keywordMatch(title, body) {
    const keywords = settings.subredditKeywords || [];
    if (!keywords.length) return true;
    const text = ((title || '') + ' ' + (body || '')).toLowerCase();
    return keywords.some(k => text.includes(String(k || '').toLowerCase()));
  }

  async function fetchSubredditNew(subreddit) {
    applyManualAuthCookies();
    const clean = normalizeSubreddit(subreddit);
    if (!clean) return [];
    const limit = Math.max(1, Number(settings.maxItemsPerPoll) || 3);
    const url = 'https://www.reddit.com/r/' + encodeURIComponent(clean) + '/new.json?limit=' + limit;

    try {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        log('Failed to fetch r/' + clean + ' /new (HTTP ' + response.status + ')');
        return [];
      }

      const payload = await response.json();
      const children = payload?.data?.children || [];
      const filtered = [];
      for (const child of children) {
        const post = child?.data;
        if (!post) continue;
        if (!keywordMatch(post.title, post.selftext)) continue;
        const postId = buildPostId(child);
        if (processedItems.has(postId)) continue;
        processedItems.add(postId);
        filtered.push(post);
      }
      return filtered;
    } catch (error) {
      log('Error fetching r/' + clean + ' /new: ' + error);
      return [];
    }
  }

  function tryClickNewSortForSubreddit(subreddit) {
    const currentPath = (window.location.pathname || '').toLowerCase();
    const expected = '/r/' + String(subreddit || '').toLowerCase() + '/';
    if (!currentPath.includes(expected)) return false;

    const candidates = Array.from(document.querySelectorAll('button, a, faceplate-tab, span'));
    for (const el of candidates) {
      const txt = String(el.textContent || '').trim().toLowerCase();
      if (txt !== 'new') continue;
      if (el instanceof HTMLElement) {
        el.click();
        log('Selected "New" filter in r/' + subreddit);
        return true;
      }
    }
    return false;
  }

  async function runSubredditCheck(forceAll) {
    const watchList = Array.isArray(settings.watchSubreddits) ? settings.watchSubreddits : [];
    if (!watchList.length) return;
    if (!forceAll && Date.now() < nextSubredditCheckAt) return;

    const normalized = watchList.map(normalizeSubreddit).filter(Boolean);
    if (!normalized.length) {
      scheduleNextSubredditCheck();
      return;
    }

    const targets = forceAll ? normalized : [normalized[randomRange(0, normalized.length - 1)]];

    for (const subreddit of targets) {
      const clickedNew = tryClickNewSortForSubreddit(subreddit);
      if (!clickedNew) {
        log('New filter click not available in current view for r/' + subreddit + '; using /new feed');
      }
      log('Checking r/' + subreddit + ' sorted by new');
      const posts = await fetchSubredditNew(subreddit);

      if (posts.length === 0) {
        log('No new matching posts found in r/' + subreddit);
      } else {
        log('Found ' + posts.length + ' new post(s) in r/' + subreddit);
        posts.slice(0, Math.max(1, Number(settings.maxItemsPerPoll) || 3)).forEach(post => {
          const title = String(post.title || '').replace(/\\s+/g, ' ').trim();
          log('New post: ' + title.substring(0, 120));
        });
      }
    }

    scheduleNextSubredditCheck();
  }

  function hashString(value) {
    const str = String(value || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function getDayKey(date) {
    const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return map[date.getDay()] || 'monday';
  }

  function normalizeTime(value) {
    const match = String(value || '').trim().match(/^(\\d{1,2}):(\\d{2})$/);
    if (!match) return null;
    const hour = Math.max(0, Math.min(23, parseInt(match[1], 10)));
    const minute = Math.max(0, Math.min(59, parseInt(match[2], 10)));
    return {
      hour,
      minute,
      text: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
    };
  }

  function normalizeScheduledSubreddit(raw) {
    return String(raw || '').trim().replace(/^r\\//i, '').replace(/^\\/+|\\/+$/g, '');
  }

  function getSchedulerConfig() {
    return settings.postScheduler || {};
  }

  function getSchedulerPosts() {
    const scheduler = getSchedulerConfig();
    const posts = Array.isArray(scheduler.posts) ? scheduler.posts : [];
    return posts.filter(post =>
      post &&
      typeof post.id === 'string' &&
      typeof post.body === 'string' &&
      (
        (Array.isArray(post.mediaPaths) && post.mediaPaths.length > 0) ||
        post.mediaPath === undefined ||
        typeof post.mediaPath === 'string'
      )
    );
  }

  function getPostMediaPaths(post) {
    if (!post) return [];
    if (Array.isArray(post.mediaPaths)) {
      return post.mediaPaths.filter(item => typeof item === 'string' && item.trim().length > 0);
    }
    if (typeof post.mediaPath === 'string' && post.mediaPath.trim().length > 0) {
      return [post.mediaPath];
    }
    return [];
  }

  function getPostedState() {
    try {
      const raw = localStorage.getItem('__snappy_reddit_scheduler_posted__');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
    return {};
  }

  function savePostedState(state) {
    try {
      localStorage.setItem('__snappy_reddit_scheduler_posted__', JSON.stringify(state || {}));
    } catch {}
  }

  function getPostSignature(post) {
    const mediaPaths = getPostMediaPaths(post).slice().sort();
    return mediaPaths.join('|') + '::' + String(post?.textPath || post?.id || '');
  }

  function isPostAlreadyPublished(post, folderPath) {
    const postedState = getPostedState();
    const key = String(folderPath || '');
    const signatures = Array.isArray(postedState[key]) ? postedState[key] : [];
    return signatures.includes(getPostSignature(post));
  }

  function markPostPublished(post, folderPath) {
    const postedState = getPostedState();
    const key = String(folderPath || '');
    const signatures = Array.isArray(postedState[key]) ? postedState[key] : [];
    const signature = getPostSignature(post);
    if (!signatures.includes(signature)) {
      signatures.push(signature);
    }
    postedState[key] = signatures;
    savePostedState(postedState);
  }

  function getNextScheduledPost() {
    const posts = getSchedulerPosts();
    if (posts.length === 0) return null;
    const scheduler = getSchedulerConfig();
    const folderPath = typeof scheduler.folderPath === 'string' ? scheduler.folderPath.trim() : '';
    const sorted = posts.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' }));
    for (const post of sorted) {
      if (!isPostAlreadyPublished(post, folderPath)) {
        return post;
      }
    }
    return null;
  }

  function resolveSiblingPath(baseFilePath, siblingName) {
    const base = String(baseFilePath || '').trim();
    const sibling = String(siblingName || '').trim();
    if (!sibling) return '';
    if (/^[a-zA-Z]:[\\\\/]/.test(sibling) || sibling.startsWith('\\\\') || sibling.startsWith('/')) {
      return sibling;
    }
    const separator = base.includes('\\\\') ? '\\\\' : '/';
    const lastSlash = Math.max(base.lastIndexOf('\\\\'), base.lastIndexOf('/'));
    const folder = lastSlash >= 0 ? base.slice(0, lastSlash) : '';
    const cleanSibling = sibling.replace(/^[/\\\\]+/, '');
    return folder ? (folder + separator + cleanSibling) : cleanSibling;
  }

  function normalizePostType(rawType) {
    const value = String(rawType || '').trim().toLowerCase();
    if (value === 'post' || value === 'textpost' || value === 'self') return 'text';
    if (value === 'image' || value === 'images' || value === 'video' || value === 'media') return 'image';
    if (value === 'link' || value === 'url') return 'link';
    if (value === 'poll') return 'poll';
    return 'text';
  }

  function parseScheduledRedditFileDetailed(rawText) {
    const text = String(rawText || '').replace(/^\\uFEFF/, '').replace(/\\r/g, '');
    if (!text.trim()) {
      return { parsed: null, error: 'file is empty' };
    }

    const fields = {
      community: '',
      type: 'text',
      title: '',
      flair: '',
      body: '',
      img: ''
    };

    const lines = text.split('\\n');
    let currentKey = '';

    for (const rawLine of lines) {
      const line = String(rawLine || '');
      const match = line.match(/^\\s*(community|type|title|flair|body|img)\\s*[:：]\\s*(.*)$/i);
      if (match) {
        currentKey = match[1].toLowerCase();
        const value = String(match[2] || '');
        if (currentKey === 'body') {
          fields.body = value;
        } else {
          fields[currentKey] = value.trim();
        }
        continue;
      }

      if (currentKey === 'body') {
        fields.body += (fields.body ? '\\n' : '') + line;
      }
    }

    let title = fields.title.trim().slice(0, 300);
    if (!title) {
      const fallbackTitle = text
        .split('\\n')
        .map(line => String(line || '').trim())
        .find(line => line.length > 0 && !/^\\s*(community|type|title|flair|body|img)\\s*[:：]/i.test(line));
      if (fallbackTitle) {
        title = fallbackTitle.slice(0, 300);
      }
    }

    if (!title) {
      const bodyFirstLine = fields.body
        .split('\\n')
        .map(line => String(line || '').trim())
        .find(line => line.length > 0) || '';
      if (bodyFirstLine) {
        title = bodyFirstLine.slice(0, 300);
      }
    }

    if (!title) {
      title = 'Scheduled post';
    }

    return {
      parsed: {
        community: fields.community.trim(),
        type: normalizePostType(fields.type),
        title,
        flair: fields.flair.trim(),
        body: fields.body.trim(),
        img: fields.img.trim()
      },
      error: ''
    };
  }

  function parseScheduledRedditFile(rawText) {
    return parseScheduledRedditFileDetailed(rawText).parsed;
  }

  async function requestRedditMediaAttach(filePaths) {
    const normalizedPaths = Array.isArray(filePaths)
      ? filePaths.filter(item => typeof item === 'string' && item.trim().length > 0)
      : [];
    if (normalizedPaths.length === 0) return true;
    const requestId = 'reddit-upload-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.__SNAPPY_REDDIT_UPLOAD_RESPONSE__ = null;
    window.__SNAPPY_REDDIT_UPLOAD_REQUEST__ = {
      id: requestId,
      filePaths: normalizedPaths,
      selector: 'input[type="file"]'
    };

    let waited = 0;
    const timeoutMs = 30000;
    while (waited < timeoutMs && isRunning) {
      await sleep(250);
      waited += 250;
      const response = window.__SNAPPY_REDDIT_UPLOAD_RESPONSE__;
      if (response && response.id === requestId) {
        window.__SNAPPY_REDDIT_UPLOAD_RESPONSE__ = null;
        return response.success === true;
      }
    }
    return false;
  }

  async function focusRequestsPanelWithRetry() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const focused = ensureRequestsTab();
      if (!focused) {
        await sleep(250);
        continue;
      }

      // Give Reddit time to hydrate request rows and controls.
      await sleep(650 + (attempt * 250));

      const requestCandidates = getRequestConversationCandidates();
      const acceptedDirectly = clickAnyVisibleRequestAcceptButton();
      if (acceptedDirectly) {
        log('Clicked visible request accept button in Requests tab');
        await sleep(700);
        return true;
      }
      if (requestCandidates.length > 0) {
        return true;
      }
      const navUnread = getRequestsUnreadCountFromNav();
      if (navUnread > 0) {
        log('Requests nav badge reports ' + navUnread + ' unread request(s), waiting for rows');
        const clickedRowFallback = clickFirstLikelyRequestRowFromRequestsList();
        if (clickedRowFallback) {
          log('Clicked first likely request row from Requests list fallback');
          await sleep(850);
          const acceptedAfterOpen = clickAnyVisibleRequestAcceptButton();
          if (acceptedAfterOpen) {
            log('Accepted request after fallback row click');
          }
          return true;
        }
      }
    }
    return false;
  }

  async function waitForSelector(selectors, timeoutMs) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs && isRunning) {
      for (const selector of selectors) {
        const found = document.querySelector(selector);
        if (found) return found;
      }
      await sleep(220);
    }
    return null;
  }

  async function waitForDeepSelector(selectors, timeoutMs) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs && isRunning) {
      for (const selector of selectors) {
        const found = deepQueryAll(selector).find(node => node instanceof HTMLElement && isVisibleElement(node));
        if (found) return found;
      }
      await sleep(220);
    }
    return null;
  }

  async function requestRedditPointerClickAt(x, y, timeoutMs) {
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;

    const requestId = 'reddit-pointer-pt-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.__SNAPPY_REDDIT_POINTER_RESPONSE__ = null;
    window.__SNAPPY_REDDIT_POINTER_REQUEST__ = {
      id: requestId,
      mode: 'point',
      x: px,
      y: py
    };

    let waited = 0;
    const maxWait = Math.max(1000, Number(timeoutMs) || 6000);
    while (waited < maxWait && isRunning) {
      await sleep(140);
      waited += 140;
      const response = window.__SNAPPY_REDDIT_POINTER_RESPONSE__;
      if (response && response.id === requestId) {
        window.__SNAPPY_REDDIT_POINTER_RESPONSE__ = null;
        return response.success === true;
      }
    }
    return false;
  }

  async function requestRedditPointerClickByText(buttonText, timeoutMs) {
    const text = String(buttonText || '').trim();
    if (!text) return false;

    const requestId = 'reddit-pointer-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.__SNAPPY_REDDIT_POINTER_RESPONSE__ = null;
    window.__SNAPPY_REDDIT_POINTER_REQUEST__ = {
      id: requestId,
      text
    };

    let waited = 0;
    const maxWait = Math.max(1200, Number(timeoutMs) || 7000);
    while (waited < maxWait && isRunning) {
      await sleep(180);
      waited += 180;
      const response = window.__SNAPPY_REDDIT_POINTER_RESPONSE__;
      if (response && response.id === requestId) {
        window.__SNAPPY_REDDIT_POINTER_RESPONSE__ = null;
        return response.success === true;
      }
    }
    return false;
  }

  async function requestRedditKeyboardSequence(events, timeoutMs) {
    const normalizedEvents = Array.isArray(events) ? events : [];
    if (!normalizedEvents.length) return false;

    const requestId = 'reddit-kb-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.__SNAPPY_REDDIT_KEYBOARD_RESPONSE__ = null;
    window.__SNAPPY_REDDIT_KEYBOARD_REQUEST__ = {
      id: requestId,
      events: normalizedEvents
    };

    let waited = 0;
    const maxWait = Math.max(1200, Number(timeoutMs) || 7000);
    while (waited < maxWait && isRunning) {
      await sleep(140);
      waited += 140;
      const response = window.__SNAPPY_REDDIT_KEYBOARD_RESPONSE__;
      if (response && response.id === requestId) {
        window.__SNAPPY_REDDIT_KEYBOARD_RESPONSE__ = null;
        return response.success === true;
      }
    }
    return false;
  }

  async function typeTrustedTextViaCdp(text) {
    const value = String(text || '');
    if (!value) return false;

    const events = [
      { kind: 'dispatch', type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, delayMs: 20 },
      { kind: 'dispatch', type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2, delayMs: 25 },
      { kind: 'dispatch', type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2, delayMs: 20 },
      { kind: 'dispatch', type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, delayMs: 30 },
      { kind: 'dispatch', type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, delayMs: 30 },
      { kind: 'dispatch', type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, delayMs: 35 },
      { kind: 'insertText', text: value, delayMs: 80 }
    ];

    const typed = await requestRedditKeyboardSequence(events, 7000);
    if (!typed) return false;

    const lastChar = value.slice(-1);
    if (lastChar) {
      // Nudge suggestion engine similarly to manual erase/retype behavior.
      const nudgeEvents = [
        { kind: 'dispatch', type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, delayMs: 45 },
        { kind: 'dispatch', type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, delayMs: 35 },
        { kind: 'insertText', text: lastChar, delayMs: 75 }
      ];
      await requestRedditKeyboardSequence(nudgeEvents, 4500);
    }
    return true;
  }

  async function tryCommitCommunityWithTabEnter() {
    const pressTabOnce = async () => {
      return await requestRedditKeyboardSequence([
        { kind: 'dispatch', type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: 40 },
        { kind: 'dispatch', type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: 70 }
      ], 2200);
    };
    const pressEnterOnce = async () => {
      return await requestRedditKeyboardSequence([
        { kind: 'dispatch', type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 40 },
        { kind: 'dispatch', type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 80 }
      ], 2200);
    };

    const tabOne = await pressTabOnce();
    await sleep(520);
    const tabTwo = await pressTabOnce();
    await sleep(560);
    const enter = await pressEnterOnce();
    const ok = tabOne && tabTwo && enter;
    if (ok) {
      log('Scheduler: attempted community commit via Tab, Tab, Enter');
    }
    return ok;
  }

  async function tryCommitCommunityViaRefocusCycle() {
    // User-validated flow:
    // Shift+Tab -> Tab -> Space -> Tab -> Tab -> Enter
    const ok = await requestRedditKeyboardSequence([
      { kind: 'dispatch', type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, delayMs: 60 },
      { kind: 'dispatch', type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8, delayMs: 55 },
      { kind: 'dispatch', type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8, delayMs: 75 },
      { kind: 'dispatch', type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, delayMs: 220 },
      { kind: 'dispatch', type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: 65 },
      { kind: 'dispatch', type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: 260 },
      { kind: 'dispatch', type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, delayMs: 80 },
      { kind: 'dispatch', type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, delayMs: 260 },
      { kind: 'dispatch', type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: 65 },
      { kind: 'dispatch', type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: 260 },
      { kind: 'dispatch', type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: 65 },
      { kind: 'dispatch', type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: 300 },
      { kind: 'dispatch', type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 90 },
      { kind: 'dispatch', type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 180 }
    ], 9000);
    if (ok) {
      log('Scheduler: attempted community commit via Shift+Tab, Tab, Space, Tab, Tab, Enter');
    }
    return ok;
  }

  async function clickElementHuman(el, timeoutMs) {
    if (!el || !(el instanceof HTMLElement)) return false;
    try {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + (rect.width / 2);
      const cy = rect.top + (rect.height / 2);
      const clickedByPointer = await requestRedditPointerClickAt(cx, cy, timeoutMs || 5000);
      if (clickedByPointer) return true;
    } catch {}

    hardClickElement(el);
    return true;
  }

  async function clickButtonByTextHuman(buttonText, timeoutMs) {
    const text = String(buttonText || '').trim();
    if (!text) return false;
    const pointerClicked = await requestRedditPointerClickByText(text, timeoutMs || 6000);
    if (pointerClicked) return true;
    return await clickButtonByText(text, timeoutMs || 3500);
  }

  async function typeCharacterByCharacter(inputEl, value) {
    if (!inputEl || !(inputEl instanceof HTMLElement)) return;
    const text = String(value || '');
    setInputValue(inputEl, '');
    for (const char of text) {
      if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
        inputEl.value += char;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (inputEl.getAttribute('contenteditable') === 'true' || inputEl.getAttribute('contenteditable') === 'plaintext-only') {
        inputEl.textContent = (inputEl.textContent || '') + char;
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
      }
      await sleep(35 + randomRange(0, 40));
    }
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizeCommunityToken(value) {
    let text = String(value || '').toLowerCase().replace(/\\s+/g, '');
    if (text.startsWith('https://www.reddit.com/')) {
      text = text.slice('https://www.reddit.com/'.length);
    } else if (text.startsWith('https://reddit.com/')) {
      text = text.slice('https://reddit.com/'.length);
    } else if (text.startsWith('http://www.reddit.com/')) {
      text = text.slice('http://www.reddit.com/'.length);
    } else if (text.startsWith('http://reddit.com/')) {
      text = text.slice('http://reddit.com/'.length);
    }

    while (text.startsWith('/')) {
      text = text.slice(1);
    }

    if (text.startsWith('r/')) return 'r/' + text.slice(2);
    if (text.startsWith('u/')) return 'u/' + text.slice(2);
    return text;
  }

  function isCommunitySuggestionMatch(optionText, communityRaw) {
    const wanted = normalizeCommunityToken(communityRaw);
    const cleanWanted = wanted.startsWith('r/') || wanted.startsWith('u/') ? wanted.slice(2) : wanted;
    let text = normalizeCommunityToken(optionText);
    while (text.startsWith('/')) {
      text = text.slice(1);
    }
    if (!text) return false;
    if (text.includes(wanted)) return true;
    if (text.includes('r/' + cleanWanted)) return true;
    if (text.includes('u/' + cleanWanted)) return true;
    return false;
  }

  async function clickCommunitySuggestion(communityRaw) {
    const start = Date.now();
    while ((Date.now() - start) < 6000 && isRunning) {
      const options = deepQueryAll('[role="option"], li[role="option"], faceplate-menu-item, button, a, div')
        .filter(node => node instanceof HTMLElement && isVisibleElement(node));

      for (const option of options) {
        const optionText = normalizeText(option.textContent || '');
        if (!optionText) continue;
        if (isCommunitySuggestionMatch(optionText, communityRaw)) {
          await clickElementHuman(option, 4500);
          await sleep(280);
          return true;
        }
      }

      const firstOption = options.find(option => {
        const txt = normalizeText(option.textContent || '').toLowerCase();
        return txt.startsWith('r/') || txt.startsWith('u/') || txt.includes(' members');
      });
      if (firstOption) {
        await clickElementHuman(firstOption, 4500);
        await sleep(280);
        return true;
      }

      await sleep(200);
    }
    return false;
  }

  async function clickSuggestionJustBelowInput(inputEl) {
    if (!inputEl || !(inputEl instanceof HTMLElement)) return false;
    try {
      const rect = inputEl.getBoundingClientRect();
      if (!rect || rect.width < 8 || rect.height < 8) return false;
      const targetX = rect.left + Math.min(Math.max(26, rect.width * 0.28), rect.width - 10);
      const targetY = rect.bottom + 3;
      const clicked = await requestRedditPointerClickAt(targetX, targetY, 4500);
      if (!clicked) return false;
      await sleep(220);
      await requestRedditKeyboardSequence([
        { kind: 'dispatch', type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 25 },
        { kind: 'dispatch', type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 65 }
      ], 2200);
      return true;
    } catch {
      return false;
    }
  }

  async function clickNearestSuggestionRowBelowInput(inputEl, communityRaw) {
    if (!inputEl || !(inputEl instanceof HTMLElement)) return false;
    const inputRect = inputEl.getBoundingClientRect();
    if (!inputRect || inputRect.width < 8 || inputRect.height < 8) return false;

    const candidates = deepQueryAll('[role="option"], li[role="option"], [role="listbox"] [role="button"], [role="menu"] [role="menuitem"], faceplate-menu-item, button, a, div')
      .filter(node => node instanceof HTMLElement && isVisibleElement(node));

    let best = null;
    let bestScore = -1;
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      if (node === inputEl || inputEl.contains(node) || node.contains(inputEl)) continue;

      const rect = node.getBoundingClientRect();
      if (!rect || rect.width < 6 || rect.height < 6) continue;
      if (rect.top < (inputRect.bottom - 2)) continue;
      if (rect.top > (inputRect.bottom + 280)) continue;
      if (Math.abs(rect.left - inputRect.left) > 260 && Math.abs((rect.left + rect.width) - (inputRect.left + inputRect.width)) > 260) continue;

      const txt = normalizeText(node.textContent || '');
      if (!txt) continue;
      const lowered = txt.toLowerCase();
      if (lowered.includes('create') && lowered.includes('community')) continue;

      let score = 1000 - Math.abs(rect.top - inputRect.bottom) - Math.abs(rect.left - inputRect.left) * 0.15;
      if (isCommunitySuggestionMatch(txt, communityRaw)) score += 220;
      if (lowered.startsWith('r/') || lowered.startsWith('u/')) score += 90;
      if (lowered.includes(' members') || lowered.includes('member')) score += 35;

      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }

    if (!best || !(best instanceof HTMLElement)) return false;
    await clickElementHuman(best, 5000);
    await sleep(260);
    return true;
  }

  async function nudgeCommunitySearchInput(inputEl) {
    if (!inputEl || !(inputEl instanceof HTMLElement)) return;

    let current = '';
    if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
      current = String(inputEl.value || '');
    } else if (inputEl.getAttribute('contenteditable') === 'true' || inputEl.getAttribute('contenteditable') === 'plaintext-only') {
      current = String(inputEl.textContent || '');
    }
    if (!current) return;

    const trimmed = current.trim();
    if (!trimmed) return;
    const withoutLast = trimmed.slice(0, -1);
    const lastChar = trimmed.slice(-1);

    setInputValue(inputEl, withoutLast);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(260);

    setInputValue(inputEl, trimmed);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(320);

    if (lastChar) {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: lastChar, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: lastChar, bubbles: true }));
    }
  }

  function hardClickElement(el) {
    if (!el || !(el instanceof HTMLElement)) return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    const events = [
      ['pointerover', { bubbles: true }],
      ['mouseover', { bubbles: true }],
      ['pointerdown', { bubbles: true, cancelable: true }],
      ['mousedown', { bubbles: true, cancelable: true }],
      ['pointerup', { bubbles: true, cancelable: true }],
      ['mouseup', { bubbles: true, cancelable: true }],
      ['click', { bubbles: true, cancelable: true }]
    ];
    for (const [name, opts] of events) {
      try {
        const Evt = name.startsWith('pointer') ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Evt(name, opts));
      } catch {}
    }
    try { el.click(); } catch {}
  }

  async function appendCharWithTypingEvents(inputEl, char) {
    if (!inputEl || !(inputEl instanceof HTMLElement)) return;
    const key = String(char || '');
    if (!key) return;

    try { inputEl.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); } catch {}
    try { inputEl.dispatchEvent(new KeyboardEvent('keypress', { key, bubbles: true, cancelable: true })); } catch {}

    if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
      const current = String(inputEl.value || '');
      inputEl.value = current + key;
      try {
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: key }));
      } catch {
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if (inputEl.getAttribute('contenteditable') === 'true' || inputEl.getAttribute('contenteditable') === 'plaintext-only') {
      inputEl.textContent = (inputEl.textContent || '') + key;
      try {
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: key }));
      } catch {
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    try { inputEl.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true })); } catch {}
  }

  async function clickButtonByText(buttonText, timeoutMs) {
    const matchText = String(buttonText || '').trim().toLowerCase();
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs && isRunning) {
      const buttons = deepQueryAll('button, [role="button"], faceplate-tracker, a');
      for (const button of buttons) {
        if (!(button instanceof HTMLElement)) continue;
        const txt = normalizeText(button.textContent || '').toLowerCase();
        const aria = normalizeText(button.getAttribute('aria-label') || '').toLowerCase();
        if (txt === matchText || txt.includes(matchText) || aria === matchText || aria.includes(matchText)) {
          button.click();
          return true;
        }
      }
      await sleep(220);
    }
    return false;
  }

  function isClickableEnabledButton(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (!isVisibleElement(el)) return false;
    const maybeDisabled = Object.prototype.hasOwnProperty.call(el, 'disabled') ? el.disabled : false;
    if (maybeDisabled === true) return false;
    const ariaDisabled = String(el.getAttribute('aria-disabled') || '').toLowerCase();
    if (ariaDisabled === 'true') return false;
    return true;
  }

  async function clickPublishButton(timeoutMs) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs && isRunning) {
      const candidates = deepQueryAll('button, [role="button"], faceplate-button')
        .filter(node => node instanceof HTMLElement && isClickableEnabledButton(node));

      for (const node of candidates) {
        const txt = normalizeText(node.textContent || '').toLowerCase();
        const aria = normalizeText(node.getAttribute('aria-label') || '').toLowerCase();
        const testId = String(node.getAttribute('data-testid') || '').toLowerCase();
        const id = String(node.getAttribute('id') || '').toLowerCase();
        if (
          txt === 'post' || txt.startsWith('post ') || txt === 'publish' || txt.startsWith('publish ') ||
          aria.includes('post') || aria.includes('publish') ||
          testId.includes('post-submit') || testId.includes('submit-post') || testId.includes('post-button') ||
          id.includes('post-button') || id.includes('submit-post')
        ) {
          node.click();
          await sleep(300);
          return true;
        }
      }

      await sleep(220);
    }
    return false;
  }

  async function selectRedditFlair(flairText) {
    const targetFlair = normalizeText(flairText || '');
    if (!targetFlair) return true;

    const openedFlairModal =
      await clickButtonByText('add flair', 4000) ||
      await clickButtonByText('flair', 4000) ||
      await clickButtonByText('select flair', 4000);

    if (!openedFlairModal) {
      log('Scheduler: flair selector button not found for "' + targetFlair + '"');
      return false;
    }

    await sleep(500);

    const wanted = targetFlair.toLowerCase();
    const start = Date.now();
    let selected = false;

    while ((Date.now() - start) < 10000 && isRunning) {
      const candidates = deepQueryAll('button, [role="button"], [role="option"], label, span, div, li');
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement)) continue;
        if (!isVisibleElement(candidate)) continue;
        const txt = normalizeText(candidate.textContent || '').toLowerCase();
        if (!txt) continue;
        if (txt === wanted || txt.includes(wanted)) {
          candidate.click();
          selected = true;
          break;
        }
      }

      if (selected) break;
      await sleep(220);
    }

    if (!selected) {
      log('Scheduler: flair option not found: "' + targetFlair + '"');
      return false;
    }

    await sleep(350);
    await clickButtonByText('apply', 3000) ||
      await clickButtonByText('save', 3000) ||
      await clickButtonByText('done', 3000) ||
      await clickButtonByText('confirm', 3000);
    await sleep(350);
    return true;
  }

  function setInputValue(inputEl, value) {
    if (!inputEl || !(inputEl instanceof HTMLElement)) return;
    if ('focus' in inputEl) inputEl.focus();
    const text = String(value || '');

    if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (inputEl.getAttribute('contenteditable') === 'true' || inputEl.getAttribute('contenteditable') === 'plaintext-only') {
      inputEl.textContent = text;
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  async function openCreatePostComposer() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const clickedCreate =
        await clickButtonByTextHuman('create post', 5500) ||
        await clickButtonByTextHuman('create', 5000);

      if (!clickedCreate) {
        await sleep(450);
        continue;
      }

      const composerSurface = await waitForDeepSelector([
        'input[name="title"]',
        'textarea[name="title"]',
        'input[aria-label*="title" i]',
        '[data-testid*="post-composer" i]',
        '[role="dialog"]',
        'shreddit-post-composer',
        'button[aria-label*="community" i]',
        '[role="button"][aria-label*="community" i]'
      ], 5500 + (attempt * 900));

      if (composerSurface) return true;
      log('Scheduler: create clicked but composer not ready (attempt ' + (attempt + 1) + '), retrying');
      await sleep(550);
    }

    log('Scheduler: could not open Create Post composer');
    return false;
  }

  async function waitForAnyComposerSurface(timeoutMs) {
    const found = await waitForDeepSelector([
      'input[name="title"]',
      'textarea[name="title"]',
      'input[aria-label*="title" i]',
      'textarea[aria-label*="title" i]',
      'button[aria-label*="community" i]',
      '[role="button"][aria-label*="community" i]',
      '[data-testid*="community" i]',
      '[data-testid*="post-composer" i]',
      'shreddit-post-composer',
      '[role="dialog"]'
    ], timeoutMs);
    return !!found;
  }

  async function selectCommunityByTyping(communityRaw) {
    const community = String(communityRaw || '').trim();
    if (!community) return true;

    let selectorOpened = false;
    const explicitCommunityButtons = deepQueryAll('button, [role="button"], [data-testid]')
      .filter(node => node instanceof HTMLElement && isVisibleElement(node));
    for (const node of explicitCommunityButtons) {
      const aria = normalizeText(node.getAttribute('aria-label') || '').toLowerCase();
      const txt = normalizeText(node.textContent || '').toLowerCase();
      const testId = normalizeText(node.getAttribute('data-testid') || '').toLowerCase();
      if (aria.includes('community') || txt.includes('community') || testId.includes('community')) {
        const clicked = await clickElementHuman(node, 5000);
        if (clicked) {
          selectorOpened = true;
          break;
        }
      }
    }
    if (!selectorOpened) {
      selectorOpened =
        await clickButtonByText('choose a community', 4000) ||
        await clickButtonByText('select a community', 2500) ||
        await clickButtonByText('community', 2500);
    }

    if (!selectorOpened) {
      log('Scheduler: community selector button not found');
      return false;
    }

    const inputSelectors = [
      'input[aria-label*="community" i]',
      'input[placeholder*="community" i]',
      'input[placeholder*="choose" i]',
      'input[data-testid*="community" i]',
      'faceplate-search-input input[type="text"]',
      'faceplate-search-input input[placeholder*="select a community" i]'
    ];

    const input = await waitForDeepSelector(inputSelectors, 6000);

    if (!input) {
      log('Scheduler: community search input not found');
      return false;
    }

    await clickElementHuman(input, 4500);
    try { input.focus(); } catch {}
    await sleep(180);

    let prefix = '';
    let remainder = community;
    if (community.toLowerCase().startsWith('u/')) {
      prefix = 'u/';
      remainder = community.slice(2);
    } else if (community.toLowerCase().startsWith('r/')) {
      prefix = 'r/';
      remainder = community.slice(2);
    }

    const communityToType = prefix + remainder;
    const typedViaCdp = await typeTrustedTextViaCdp(communityToType);
    if (!typedViaCdp) {
      if (prefix) {
        await typeCharacterByCharacter(input, prefix);
        await sleep(1000);
      }

      for (const char of remainder) {
        await appendCharWithTypingEvents(input, char);
        await sleep(140 + randomRange(40, 140));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      log('Scheduler: community typed via trusted CDP keyboard events');
    }
    await sleep(320);

    // Reddit sometimes only shows community suggestions after a trusted re-focus click
    // on the currently mounted search input, even when text is already present.
    const liveInput = await waitForDeepSelector(inputSelectors, 2500);
    if (liveInput && liveInput instanceof HTMLElement) {
      await clickElementHuman(liveInput, 4500);
      try { liveInput.focus(); } catch {}
      await sleep(480);
    } else {
      await clickElementHuman(input, 3500);
      try { input.focus(); } catch {}
      await sleep(480);
    }

    const committedViaRefocusCycle = await tryCommitCommunityViaRefocusCycle();
    if (!committedViaRefocusCycle) {
      await tryCommitCommunityWithTabEnter();
    }
    await sleep(220);

    const clickedSuggestion = await clickCommunitySuggestion(community);
    if (clickedSuggestion) {
      await requestRedditKeyboardSequence([
        { kind: 'dispatch', type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 30 },
        { kind: 'dispatch', type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 60 }
      ], 2200);
      return true;
    }

    const clickedByOffset = await clickSuggestionJustBelowInput(liveInput && liveInput instanceof HTMLElement ? liveInput : input);
    if (clickedByOffset) {
      await sleep(260);
      const clickedAfterOffset = await clickCommunitySuggestion(community);
      if (clickedAfterOffset) return true;
      const clickedNearestAfterOffset = await clickNearestSuggestionRowBelowInput(liveInput && liveInput instanceof HTMLElement ? liveInput : input, community);
      if (clickedNearestAfterOffset) return true;
    }

    const clickedNearest = await clickNearestSuggestionRowBelowInput(liveInput && liveInput instanceof HTMLElement ? liveInput : input, community);
    if (clickedNearest) return true;

    const liveInputBeforeNudge = await waitForDeepSelector(inputSelectors, 2000);
    if (liveInputBeforeNudge && liveInputBeforeNudge instanceof HTMLElement) {
      await clickElementHuman(liveInputBeforeNudge, 3500);
      try { liveInputBeforeNudge.focus(); } catch {}
      await sleep(260);
    }

    await nudgeCommunitySearchInput(input);
    const clickedAfterNudge = await clickCommunitySuggestion(community);
    if (clickedAfterNudge) {
      return true;
    }

    // Fallback: use trusted keyboard selection if suggestion menu is present but not clickable by selector.
    await requestRedditKeyboardSequence([
      { kind: 'dispatch', type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, delayMs: 35 },
      { kind: 'dispatch', type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, delayMs: 50 },
      { kind: 'dispatch', type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 40 },
      { kind: 'dispatch', type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 75 }
    ], 3200);
    await sleep(250);
    const pickedByKeyboard = await clickCommunitySuggestion(community);
    if (pickedByKeyboard) return true;

    log('Scheduler: community option not found for ' + community);
    return false;
  }

  async function selectPostType(postType) {
    const normalized = normalizePostType(postType);
    if (normalized === 'text') {
      await clickButtonByText('post', 3000) || await clickButtonByText('text', 1500);
      return true;
    }
    if (normalized === 'image') {
      return await clickButtonByText('images & video', 4000) || await clickButtonByText('image', 3000) || await clickButtonByText('media', 3000);
    }
    if (normalized === 'link') {
      return await clickButtonByText('link', 4000);
    }
    if (normalized === 'poll') {
      return await clickButtonByText('poll', 4000);
    }
    return true;
  }

  async function navigateToRedditSubmit(subreddit) {
    const cleanSubreddit = normalizeScheduledSubreddit(subreddit);
    const targetUrl = cleanSubreddit
      ? 'https://www.reddit.com/r/' + encodeURIComponent(cleanSubreddit) + '/submit'
      : 'https://www.reddit.com/submit';

    if (window.location.href !== targetUrl) {
      window.location.assign(targetUrl);
    }

    const ready = await waitForDeepSelector([
      'input[name="title"]',
      'textarea[name="title"]',
      '[data-testid*="post-composer" i]',
      '[role="textbox"][aria-label*="title" i]',
      'faceplate-textarea-input textarea[name="title"]',
      '#post-composer__title textarea[name="title"]',
      'faceplate-search-input input[type="text"]'
    ], 15000);

    if (!ready) {
      log('Scheduler: Reddit submit composer not found');
      return false;
    }

    return true;
  }

  async function publishScheduledRedditPost(post) {
    if (!post || typeof post.body !== 'string') {
      log('Scheduler: invalid scheduled Reddit post payload');
      return false;
    }

    if (isPostingScheduledContent) {
      return false;
    }

    const parseResult = parseScheduledRedditFileDetailed(post.body);
    const parsed = parseResult.parsed;
    if (!parsed) {
      log('Scheduler: scheduled file parse failed for item ' + String(post.id || 'unknown') + ' (' + (parseResult.error || 'unknown parse error') + ')');
      return false;
    }

    isPostingScheduledContent = true;
    try {
      const mediaPaths = getPostMediaPaths(post);
      const targetCommunity = parsed.community || '';
      log('Scheduler: parsed file -> community="' + (targetCommunity || '(empty)') + '", type="' + parsed.type + '", title="' + parsed.title.substring(0, 80) + '", flair="' + (parsed.flair || '(none)') + '", bodyLen=' + parsed.body.length + ', img="' + (parsed.img || '(none)') + '"');
      log('Scheduler: starting Reddit publish for item ' + String(post.id || 'unknown') + (targetCommunity ? (' to ' + targetCommunity) : ''));

      const opened = await openCreatePostComposer();
      if (!opened) {
        const fallbackReady = await navigateToRedditSubmit('');
        if (!fallbackReady) return false;
      }

      const surfaceReady = await waitForAnyComposerSurface(10000);
      if (!surfaceReady) {
        log('Scheduler: post composer surface not available after Create');
        return false;
      }
      await sleep(450);

      const communitySelected = await selectCommunityByTyping(targetCommunity);
      if (!communitySelected) {
        return false;
      }

      const typeSelected = await selectPostType(parsed.type);
      if (!typeSelected) {
        log('Scheduler: failed selecting post type "' + parsed.type + '"');
        return false;
      }

      await sleep(400);
      if (parsed.type === 'image') {
        const imgFromFile = parsed.img ? resolveSiblingPath(post.textPath || '', parsed.img) : '';
        const filesToAttach = imgFromFile ? [imgFromFile] : mediaPaths;
        if (filesToAttach.length === 0) {
          log('Scheduler: type=image but no img file found');
          return false;
        }
        await sleep(300);
        const attached = await requestRedditMediaAttach(filesToAttach);
        if (!attached) {
          log('Scheduler: media attach failed');
          return false;
        }
        await sleep(900);
      }

      const titleInput = await waitForDeepSelector([
        'input[name="title"]',
        'textarea[name="title"]',
        'input[aria-label*="title" i]',
        'textarea[aria-label*="title" i]',
        '[role="textbox"][aria-label*="title" i]',
        'faceplate-textarea-input textarea[name="title"]',
        '#post-composer__title textarea[name="title"]'
      ], 10000);

      if (!titleInput) {
        log('Scheduler: title input not found');
        return false;
      }
      setInputValue(titleInput, parsed.title);

      if (parsed.flair) {
        const flairSet = await selectRedditFlair(parsed.flair);
        if (!flairSet) {
          log('Scheduler: required flair could not be set for item ' + String(post.id || 'unknown'));
          return false;
        }
      }

      if (parsed.body) {
        const bodyInput = await waitForDeepSelector([
          'textarea[name="text"]',
          'textarea[name="body"]',
          'textarea[aria-label*="body" i]',
          'textarea[aria-label*="text" i]',
          '[role="textbox"][aria-label*="body" i]',
          '[contenteditable="true"][role="textbox"]',
          'shreddit-composer [slot="rte"][name="body"][contenteditable="true"]',
          '#post-composer_bodytext [slot="rte"][contenteditable="true"]',
          'shreddit-composer div[name="body"][contenteditable="true"]'
        ], 7000);
        if (bodyInput) {
          setInputValue(bodyInput, parsed.body);
        } else if (parsed.type === 'text' || parsed.type === 'poll') {
          log('Scheduler: body input not found');
          return false;
        }
      }

      await sleep(500);

      const posted = await clickPublishButton(12000) || await clickButtonByText('post', 6000) || await clickButtonByText('publish', 6000);
      if (!posted) {
        log('Scheduler: post submit button not found');
        return false;
      }

      log('Scheduler: Reddit post submitted');
      return true;
    } catch (error) {
      log('Scheduler publish error: ' + error);
      return false;
    } finally {
      isPostingScheduledContent = false;
    }
  }

  function getDueScheduleSlot() {
    const scheduler = getSchedulerConfig();
    if (scheduler.enabled !== true) return null;
    const folderPath = typeof scheduler.folderPath === 'string' ? scheduler.folderPath.trim() : '';
    if (!folderPath) return null;

    const now = new Date();
    const dayKey = getDayKey(now);
    const dayConfig = scheduler.days?.[dayKey];
    if (!dayConfig || dayConfig.enabled !== true || !Array.isArray(dayConfig.times) || dayConfig.times.length === 0) {
      return null;
    }

    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();

    for (const timeValue of dayConfig.times) {
      const normalized = normalizeTime(timeValue);
      if (!normalized) continue;

      const baseTime = new Date(year, month, day, normalized.hour, normalized.minute, 0, 0);
      const slotKeyBase = year + '-' + (month + 1) + '-' + day + '-' + dayKey + '-' + normalized.text;
      const randomOffset = (hashString(slotKeyBase) % (SCHEDULER_JITTER_MINUTES * 2 + 1)) - SCHEDULER_JITTER_MINUTES;
      const runAt = new Date(baseTime.getTime() + randomOffset * 60 * 1000);
      const windowEnd = new Date(baseTime.getTime() + SCHEDULER_DUE_WINDOW_MINUTES * 60 * 1000);
      const slotKey = slotKeyBase + '-off-' + randomOffset;

      if (processedScheduleSlots.has(slotKey)) continue;
      if (now < runAt) continue;
      if (now > windowEnd) continue;

      return {
        slotKey,
        planned: normalized.text,
        runAt,
        offsetMinutes: randomOffset
      };
    }

    return null;
  }

  function getActiveDmPauseWindow() {
    const scheduler = getSchedulerConfig();
    if (scheduler.enabled !== true) return null;
    const folderPath = typeof scheduler.folderPath === 'string' ? scheduler.folderPath.trim() : '';
    if (!folderPath) return null;

    const now = new Date();
    const dayOffsets = [-1, 0, 1];

    for (const dayOffset of dayOffsets) {
      const dateRef = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0, 0);
      const dayKey = getDayKey(dateRef);
      const dayConfig = scheduler.days?.[dayKey];
      if (!dayConfig || dayConfig.enabled !== true || !Array.isArray(dayConfig.times) || dayConfig.times.length === 0) {
        continue;
      }

      const year = dateRef.getFullYear();
      const month = dateRef.getMonth();
      const day = dateRef.getDate();

      for (const timeValue of dayConfig.times) {
        const normalized = normalizeTime(timeValue);
        if (!normalized) continue;

        const baseTime = new Date(year, month, day, normalized.hour, normalized.minute, 0, 0);
        const slotKeyBase = year + '-' + (month + 1) + '-' + day + '-' + dayKey + '-' + normalized.text;
        const randomOffset = (hashString(slotKeyBase) % (SCHEDULER_JITTER_MINUTES * 2 + 1)) - SCHEDULER_JITTER_MINUTES;
        const runAt = new Date(baseTime.getTime() + randomOffset * 60 * 1000);
        const pauseStart = new Date(runAt.getTime() - SCHEDULER_JITTER_MINUTES * 60 * 1000);
        const pauseEnd = new Date(runAt.getTime() + SCHEDULER_JITTER_MINUTES * 60 * 1000);

        if (now >= pauseStart && now <= pauseEnd) {
          return {
            dayKey,
            planned: normalized.text,
            offsetMinutes: randomOffset,
            runAt,
            pauseStart,
            pauseEnd
          };
        }
      }
    }

    return null;
  }

  function shouldPauseDmAroundScheduledPost() {
    const activeWindow = getActiveDmPauseWindow();
    if (!activeWindow) {
      lastDmPauseWindowKey = '';
      return false;
    }

    const pauseKey = String(activeWindow.runAt.getTime()) + ':' + String(activeWindow.pauseStart.getTime());
    if (lastDmPauseWindowKey !== pauseKey) {
      lastDmPauseWindowKey = pauseKey;
      log('Scheduler: pausing DM reading from ' + activeWindow.pauseStart.toLocaleTimeString() + ' to ' + activeWindow.pauseEnd.toLocaleTimeString() + ' around ' + activeWindow.planned);
    }
    return true;
  }

  async function processScheduledPosting() {
    const scheduler = getSchedulerConfig();
    if (scheduler.enabled !== true || !isRunning) return;
    if (isPostingScheduledContent) return;

    const dueSlot = getDueScheduleSlot();
    if (!dueSlot) return;

    const post = getNextScheduledPost();
    if (!post) {
      log('Scheduler: no unposted .txt posts available to publish');
      processedScheduleSlots.add(dueSlot.slotKey);
      return;
    }

    log('Scheduler due at ' + dueSlot.planned + ' with random offset ' + dueSlot.offsetMinutes + ' min');
    const posted = await publishScheduledRedditPost(post);
    if (posted) {
      const folderPath = typeof scheduler.folderPath === 'string' ? scheduler.folderPath.trim() : '';
      markPostPublished(post, folderPath);
      processedScheduleSlots.add(dueSlot.slotKey);
      threadsAnchored = false;
    }
  }

  function buildPmId(item) {
    return String(item?.data?.name || item?.data?.id || item?.data?.first_message_name || '');
  }

  function extractPmSummary(item) {
    const data = item?.data || {};
    const author = String(data.author || data.dest || 'unknown');
    const subject = String(data.subject || '').trim();
    const body = String(data.body || '').replace(/\\s+/g, ' ').trim();
    const preview = body.substring(0, 120);
    return { author, subject, preview };
  }

  function enqueueUnreadPm(entry) {
    if (!entry || !entry.id) return;
    const idx = unreadPmQueue.findIndex(pm => pm.id === entry.id);
    if (idx >= 0) unreadPmQueue[idx] = entry;
    else unreadPmQueue.push(entry);
  }

  async function readUnreadPrivateMessages() {
    if (!shouldReadPrivateMessages()) return;
    if ((Date.now() - lastPmCheckAt) < PM_CHECK_DEBOUNCE_MS) return;
    applyManualAuthCookies();
    lastPmCheckAt = Date.now();

    const limit = Math.max(1, Number(settings.maxItemsPerPoll) || 3);
    const url = 'https://www.reddit.com/message/inbox.json?limit=' + limit;

    try {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        log('Failed to read PM inbox (HTTP ' + response.status + ')');
        return;
      }

      const payload = await response.json();
      const children = payload?.data?.children || [];
      const unreadInboxItems = children.filter(item => item?.data?.new === true);
      const unreadPrivateMessages = unreadInboxItems.filter(item => String(item?.kind || '').toLowerCase() === 't4');
      if (!unreadPrivateMessages.length) {
        if (unreadInboxItems.length > 0) {
          log('Unread inbox items found, but no unread private messages');
        }
        return;
      }

      log('Unread PMs: ' + unreadPrivateMessages.length);
      unreadPrivateMessages.slice(0, limit).forEach(item => {
        const pmId = buildPmId(item);
        if (!pmId) return;
        const summary = extractPmSummary(item);
        const seenKey = 'pm-seen:' + pmId;
        if (!processedItems.has(seenKey)) {
          processedItems.add(seenKey);
          const subjectPart = summary.subject ? ' [' + summary.subject + ']' : '';
          log('PM from u/' + summary.author + subjectPart + ': ' + summary.preview);
        }
        enqueueUnreadPm({
          id: pmId,
          author: summary.author,
          subject: summary.subject,
          body: summary.preview
        });
      });
    } catch (error) {
      log('Error reading PM inbox: ' + error);
    }
  }

  function sanitizeAuthor(author) {
    return String(author || '').replace(/^u\\//i, '').trim();
  }

  function extractConversationAuthor(container) {
    if (!container || !(container instanceof HTMLElement)) return '';
    const aria = String(container.getAttribute('aria-label') || '');
    const directChatMatch = aria.match(/direct\\s+chat\\s+with\\s+(.+)$/i);
    if (directChatMatch && directChatMatch[1]) {
      return sanitizeAuthor(directChatMatch[1]);
    }

    const roomName = container.querySelector('.room-name');
    if (roomName) {
      const roomText = sanitizeAuthor(roomName.textContent || '');
      if (roomText) return roomText;
    }

    const directHref = String(container.getAttribute('href') || '');
    const directMatch = directHref.match(/\\/message\\/messages\\/([^/?#]+)/i);
    if (directMatch && directMatch[1]) return decodeURIComponent(directMatch[1]);

    const profileLink = container.querySelector('a[href*="/user/"]');
    if (profileLink) {
      const href = String(profileLink.getAttribute('href') || '');
      const match = href.match(/\\/user\\/([^/?#]+)/i);
      if (match && match[1]) return decodeURIComponent(match[1]);
    }

    const txt = String(container.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!txt || /^\\d+$/.test(txt)) return '';
    const first = txt.split(' ')[0] || '';
    return sanitizeAuthor(first);
  }

  function hasUnreadSignal(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const text = normalizeText(el.textContent || '').toLowerCase();
    if (/\\bunread\\b|\\bnew\\s+message\\b/.test(text)) return true;
    if (el.matches('[data-unread="true"], [data-is-unread="true"], [aria-label*="unread" i], [class*="unread" i]')) return true;
    if (el.classList.contains('has-notifications')) return true;
    if (String(el.className || '').toLowerCase().includes('has-notifications')) return true;
    const notifHost = el.querySelector('rs-notifications-badge');
    if (notifHost) {
      const cnt = Number(notifHost.getAttribute('count') || '0');
      if (Number.isFinite(cnt) && cnt > 0) return true;
      const badgeRoot = notifHost.shadowRoot || null;
      if (badgeRoot) {
        const badgeText = normalizeText((badgeRoot.textContent || '').trim());
        if (badgeText) return true;
      }
    }
    // Reddit room cards place unread marker in the trailing badges slot.
    if (el.querySelector('.badges rs-notifications-badge')) return true;
    if (el.querySelector('.notifications-badge.count')) return true;
    const ariaUnreadNode = el.querySelector('[aria-label*="unread" i]');
    if (ariaUnreadNode) return true;

    return false;
  }

  function getRequestsUnreadCountFromNav() {
    const requestHosts = deepQueryAll('[data-testid="requests-button"], [data-testid="nav-item-requests"], [aria-label="View chat requests"]')
      .filter(node => node instanceof HTMLElement && isVisibleElement(node));
    for (const requestsHost of requestHosts) {
      if (!(requestsHost instanceof HTMLElement)) continue;
      const badgeCandidates = [];
      if (requestsHost.matches('rs-notifications-badge')) badgeCandidates.push(requestsHost);
      requestsHost.querySelectorAll('rs-notifications-badge, .notifications-badge.count, [aria-label*="unread" i]').forEach(node => badgeCandidates.push(node));

      for (const badgeEl of badgeCandidates) {
        if (!(badgeEl instanceof HTMLElement)) continue;
        if (badgeEl.matches('rs-notifications-badge')) {
          const cnt = Number(badgeEl.getAttribute('count') || '0');
          if (Number.isFinite(cnt) && cnt > 0) return cnt;
          const badgeRoot = badgeEl.shadowRoot || null;
          if (badgeRoot) {
            const txt = normalizeText(badgeRoot.textContent || '');
            const txtMatch = txt.match(/\\d+/);
            if (txtMatch) return parseInt(txtMatch[0], 10) || 0;
          }
        }
        const aria = String(badgeEl.getAttribute('aria-label') || '');
        const ariaMatch = aria.match(/(\\d+)\\s+unread/i);
        if (ariaMatch) return parseInt(ariaMatch[1], 10) || 0;
        const txt = normalizeText(badgeEl.textContent || '');
        const txtMatch = txt.match(/\\d+/);
        if (txtMatch) return parseInt(txtMatch[0], 10) || 0;
      }
    }
    return 0;
  }

  function isLikelyDirectChat(linkEl, rowEl) {
    const linkAria = String(linkEl?.getAttribute?.('aria-label') || '').toLowerCase();
    const rowAria = String(rowEl?.getAttribute?.('aria-label') || '').toLowerCase();
    const combined = (linkAria + ' ' + rowAria).trim();
    if (combined.includes('direct chat')) return true;
    if (combined.includes('chat with')) return true;
    if (combined.includes('invitation to moderate')) return false;
    if (combined.includes('modmail')) return false;
    return true;
  }

  function getUnreadConversationCandidates() {
    const candidates = [];
    const seenKeys = new Set();

    const links = deepQueryAll('a[href*="/room/"], a[href*="/message/messages/"]').filter(el => el instanceof HTMLElement);
    for (const link of links) {
      if (!isVisibleElement(link)) continue;
      const href = String(link.getAttribute('href') || '').toLowerCase();
      const linkTextLower = normalizeText(link.textContent || '').toLowerCase();
      if (href.includes('/room/create') || href.includes('/room/new') || href.includes('/new-chat') || href.includes('/compose')) continue;
      if (linkTextLower.includes('create new chat') || linkTextLower.includes('new chat')) continue;
      if (link.closest('[data-testid="requests-button"]') || link.closest('[data-testid="nav-item-requests"]')) continue;

      const row =
        link.closest('rs-rooms-nav-room, li, [role="listitem"], [role="row"], [data-testid*="thread"], [data-testid*="conversation"], [class*="thread" i], [class*="conversation" i], [class*="room" i]') ||
        link.parentElement ||
        link;
      if (!row || !(row instanceof HTMLElement)) continue;
      if (!isLikelyDirectChat(link, row)) continue;

      const rowText = normalizeText(row.textContent || '');
      if (!rowText || /^\\d+$/.test(rowText)) continue;

      const linkAuthor = extractConversationAuthor(link);
      const rowAuthor = extractConversationAuthor(row);
      const author = sanitizeAuthor(linkAuthor || rowAuthor);
      const key = String(link.getAttribute('href') || '') + '|' + author + '|' + rowText.substring(0, 160);
      if (!key.trim() || seenKeys.has(key)) continue;

      const hasUnreadByClass =
        link.classList.contains('has-notifications') ||
        row.classList.contains('has-notifications') ||
        String(link.className || '').toLowerCase().includes('has-notifications') ||
        String(row.className || '').toLowerCase().includes('has-notifications');
      const hasUnread = hasUnreadByClass || hasUnreadSignal(row) || hasUnreadSignal(link);
      if (!hasUnread) continue;
      seenKeys.add(key);
      candidates.push(link);
    }

    const roomLinks = links.filter(link => String(link.getAttribute('href') || '').includes('/room/')).length;
    log('PM scan: links=' + links.length + ' (roomLinks=' + roomLinks + '), unreadCandidates=' + candidates.length);
    return candidates;
  }

  function getRequestConversationCandidates() {
    const candidates = [];
    const seenKeys = new Set();
    const links = deepQueryAll('a[href*="/room/"], a[href*="/message/messages/"]').filter(el => el instanceof HTMLElement);
    for (const link of links) {
      if (!isVisibleElement(link)) continue;
      const href = String(link.getAttribute('href') || '').toLowerCase();
      const linkTextLower = normalizeText(link.textContent || '').toLowerCase();
      if (href.includes('/room/create') || href.includes('/room/new') || href.includes('/new-chat') || href.includes('/compose')) continue;
      if (linkTextLower.includes('create new chat') || linkTextLower.includes('new chat')) continue;
      if (link.closest('[data-testid="requests-button"]') || link.closest('[data-testid="nav-item-requests"]')) continue;
      const row =
        link.closest('rs-rooms-nav-room, li, [role="listitem"], [role="row"], [data-testid*="thread"], [data-testid*="conversation"], [class*="thread" i], [class*="conversation" i], [class*="room" i]') ||
        link.parentElement ||
        link;
      if (!row || !(row instanceof HTMLElement)) continue;
      if (!isLikelyDirectChat(link, row)) continue;

      const rowText = normalizeText(row.textContent || '');
      if (!rowText || /^\\d+$/.test(rowText)) continue;
      const lowered = rowText.toLowerCase();
      if (lowered.includes('hidden request') || lowered.includes('invitation to moderate') || lowered.includes('modmail') || lowered.includes('create new chat')) continue;

      const linkAuthor = extractConversationAuthor(link);
      const rowAuthor = extractConversationAuthor(row);
      const author = sanitizeAuthor(linkAuthor || rowAuthor);
      const key = String(link.getAttribute('href') || '') + '|' + (author || 'unknown') + '|' + rowText.substring(0, 160);
      if (!key.trim() || seenKeys.has(key)) continue;
      seenKeys.add(key);
      candidates.push(link);
    }

    // Fallback for UIs where requests are rendered as rows/buttons without room/message href.
    if (candidates.length === 0) {
      const rows = deepQueryAll('rs-rooms-nav-room, [role="button"], li, [role="listitem"], [role="row"]');
      for (const row of rows) {
        if (!(row instanceof HTMLElement)) continue;
        if (!isVisibleElement(row)) continue;
        if (row.closest('[data-testid="requests-button"]') || row.matches('[data-testid="requests-button"]')) continue;
        if (row.closest('[data-testid="nav-item-requests"]') || row.matches('[data-testid="nav-item-requests"]')) continue;

        const rowText = normalizeText(row.textContent || '');
        if (!rowText || /^\\d+$/.test(rowText)) continue;
        const lowered = rowText.toLowerCase();
        if (lowered.includes('create new chat') || lowered.includes('new chat')) continue;
        if (lowered === 'requests' || lowered.startsWith('requests ')) continue;
        if (lowered === 'threads' || lowered.startsWith('threads ')) continue;
        if (lowered.includes('hidden request') || lowered.includes('modmail')) continue;
        const hasAcceptControl = !!row.querySelector('button, [role="button"]') && /(accept|approve|start chat|join chat)/i.test(normalizeText(row.textContent || ''));
        const containsUserHint = lowered.includes('u/') || lowered.includes('chat with') || lowered.includes('direct chat');
        if (!hasUnreadSignal(row) && !lowered.includes('request') && !hasAcceptControl && !containsUserHint) continue;

        const key = 'row|' + rowText.substring(0, 180);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        candidates.push(row);
      }
    }

    log('PM scan: requestsCandidates=' + candidates.length);
    return candidates;
  }

  function clickFirstLikelyRequestRowFromRequestsList() {
    const rows = deepQueryAll('rs-rooms-nav-room, [role="row"], [role="listitem"], li, a[href*="/room/"], a[href*="/message/messages/"]');
    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      if (!isVisibleElement(row)) continue;
      if (row.closest('[data-testid="requests-button"]') || row.matches('[data-testid="requests-button"]')) continue;
      if (row.closest('[data-testid="nav-item-requests"]') || row.matches('[data-testid="nav-item-requests"]')) continue;

      const txt = normalizeText(row.textContent || '').toLowerCase();
      if (!txt || txt.length < 2) continue;
      if (txt === 'requests' || txt.startsWith('requests ')) continue;
      if (txt === 'threads' || txt.startsWith('threads ')) continue;
      if (txt === 'inbox' || txt.startsWith('inbox ')) continue;
      if (txt.includes('create new chat') || txt === 'new chat') continue;
      if (txt.includes('invitation to moderate') || txt.includes('modmail')) continue;

      const inMainArea = !!row.closest('main, [role="main"], rs-chatroom, rs-rooms-pane, rs-rooms-nav');
      const looksLikeConversation = txt.includes('u/') || txt.includes('chat with') || txt.includes('direct chat') || hasUnreadSignal(row);
      if (!inMainArea && !looksLikeConversation) continue;

      if (clickConversationElement(row)) return true;
    }
    return false;
  }

  function findConversationElementForAuthor(author) {
    const cleanAuthor = sanitizeAuthor(author).toLowerCase();
    if (!cleanAuthor) return null;

    const roomCandidates = deepQueryAll('a[href*="/room/"]');
    for (const room of roomCandidates) {
      if (!(room instanceof HTMLElement)) continue;
      const roomAuthor = sanitizeAuthor(extractConversationAuthor(room)).toLowerCase();
      if (roomAuthor && roomAuthor === cleanAuthor) return room;
      const aria = String(room.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('direct chat with ' + cleanAuthor)) return room;
    }

    const hrefCandidates = deepQueryAll('a[href*="/message/messages/"]');
    for (const hrefNode of hrefCandidates) {
      if (!(hrefNode instanceof HTMLElement)) continue;
      const href = String(hrefNode.getAttribute('href') || '').toLowerCase();
      if (href.includes('/message/messages/' + cleanAuthor)) return hrefNode;
    }

    const candidates = deepQueryAll('a, button, [role="button"], li, div').slice(0, 700);
    for (const node of candidates) {
      const text = String(node.textContent || '').replace(/\\s+/g, ' ').toLowerCase();
      if (!text) continue;
      if (text.includes('u/' + cleanAuthor) || text.includes(cleanAuthor)) {
        if (node instanceof HTMLElement) return node;
      }
    }
    return null;
  }

  function detectOwnUsername() {
    const selectors = [
      'a[href^="/user/"]',
      '[data-testid="user-drawer-button"]',
      'a[href*="/user/"]'
    ];
    for (const selector of selectors) {
      const nodes = deepQueryAll(selector);
      for (const node of nodes) {
        const href = node.getAttribute ? (node.getAttribute('href') || '') : '';
        const match = href.match(/\\/user\\/([^/?#]+)/i);
        if (match && match[1]) return decodeURIComponent(match[1]).toLowerCase();
        const txt = normalizeText(node.textContent || '').replace(/^u\\//i, '');
        if (txt && txt.length > 1 && !txt.includes('open')) return txt.toLowerCase();
      }
    }
    return '';
  }

  function isMessageTextNoise(text) {
    const clean = normalizeText(text).toLowerCase();
    if (!clean) return true;
    return clean === 'send a message' || clean === 'message' || clean === 'reply';
  }

  function collectConversationMessages() {
    const ownUser = detectOwnUsername();
    const mainCandidates = deepQueryAll('main, [role="main"]').filter(el => el instanceof HTMLElement && isVisibleElement(el));
    let root = null;
    let bestScore = -1;
    for (const candidate of mainCandidates) {
      const score = candidate.querySelectorAll('.room-message').length;
      if (score > bestScore) {
        bestScore = score;
        root = candidate;
      }
    }
    const scanRoot = root || document;
    const nodes = Array.from(scanRoot.querySelectorAll('.room-message[aria-label], .room-message'));
    const out = [];

    nodes.forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      if (!isVisibleElement(node)) return;

      const row = node.closest('.room-message[aria-label*=" said "]') || node;
      const aria = String(row.getAttribute('aria-label') || '');
      const ariaLower = aria.toLowerCase();

      let author = '';
      let forceOutgoing = false;

      const saidMatch = aria.match(/^(.+?)\\s+said\\s+/i);
      if (saidMatch && saidMatch[1]) {
        author = sanitizeAuthor(saidMatch[1]);
      } else if (/^you\\s+(said|sent)\\s+/i.test(aria) || /^me\\s+(said|sent)\\s+/i.test(aria)) {
        author = 'you';
        forceOutgoing = true;
      } else if (ariaLower.includes('you said') || ariaLower.includes('you sent') || ariaLower.startsWith('you:')) {
        author = 'you';
        forceOutgoing = true;
      } else {
        // If we can't resolve sender from aria, skip to avoid false incoming classification.
        return;
      }

      let text = '';
      const textNodes = row.querySelectorAll('.room-message-text, [class*="message-text" i], p, span');
      textNodes.forEach(n => {
        const t = normalizeText(n.textContent || '');
        if (!t || isMessageTextNoise(t)) return;
        text = t;
      });

      if (!text) {
        const fallback = normalizeText(row.textContent || '');
        if (!fallback || isMessageTextNoise(fallback)) return;
        text = fallback;
      }

      if (text.length < 2) return;
      const authorLower = author.toLowerCase();
      const isSelfAlias = authorLower === 'you' || authorLower === 'me';
      const incoming = !!author && !forceOutgoing && !isSelfAlias && (!ownUser || authorLower !== ownUser);
      out.push({
        author: author || 'reddit_user',
        text: text.substring(0, 500),
        isIncoming: incoming
      });
    });

    return out;
  }

  function extractLatestIncomingConversationBatch(authorHint) {
    const allMessages = collectConversationMessages();
    // Only consider tail of active conversation to avoid replaying old history.
    const messages = allMessages.slice(-14);
    if (!messages.length) return null;

    const incomingCount = messages.filter(msg => msg.isIncoming).length;
    const outgoingCount = messages.length - incomingCount;
    log('PM message breakdown: ' + incomingCount + ' incoming, ' + outgoingCount + ' outgoing');

    const batch = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.isIncoming) {
        batch.push(msg);
      } else if (batch.length > 0) {
        break;
      } else {
        break;
      }
    }
    batch.reverse();
    if (!batch.length) return null;
    // Keep only the most recent inbound burst.
    const bounded = batch.slice(-3);

    const joined = bounded.map(msg => msg.text).join('\\n').trim();
    if (!joined) return null;
    const author = sanitizeAuthor(bounded[bounded.length - 1].author || authorHint || 'reddit_user') || 'reddit_user';
    return {
      author,
      text: joined.substring(0, 800),
      normalized: bounded.map(msg => msg.text.toLowerCase().trim()).join(' || ')
    };
  }

  function extractConversationPreviewFromCard(convoEl, authorHint) {
    if (!convoEl || !(convoEl instanceof HTMLElement)) return null;
    const previewEl = convoEl.querySelector('.last-message');
    const raw = normalizeText(previewEl ? previewEl.textContent || '' : convoEl.textContent || '');
    if (!raw) return null;

    const lower = raw.toLowerCase();
    if (lower.startsWith('you:') || lower.startsWith('me:')) return null;

    let author = sanitizeAuthor(authorHint || '');
    let text = raw;
    const colonIdx = raw.indexOf(':');
    if (colonIdx > 0 && colonIdx < 40) {
      const prefix = sanitizeAuthor(raw.slice(0, colonIdx));
      if (prefix) author = prefix;
      text = normalizeText(raw.slice(colonIdx + 1));
    }
    if (!text) return null;
    return {
      author: author || 'reddit_user',
      text: text.substring(0, 500),
      normalized: text.toLowerCase().trim()
    };
  }

  function nudgeConversationToLatest() {
    const scrollables = deepQueryAll('main [role="log"], main [role="list"], main [class*="scroll" i], main [class*="message" i]')
      .filter(el => el instanceof HTMLElement);
    scrollables.forEach(el => {
      try {
        el.scrollTop = el.scrollHeight;
      } catch (e) {
        // ignore
      }
    });
  }

  async function extractLatestIncomingWithRetries(authorHint, convoEl) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const batch = extractLatestIncomingConversationBatch(authorHint);
      if (batch) return batch;
      nudgeConversationToLatest();
      await sleep(350 + (attempt * 180));
    }
    return extractConversationPreviewFromCard(convoEl, authorHint);
  }

  async function waitForAiReply(requestId, timeoutMs) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
      const response = window.__SNAPPY_AI_RESPONSE__;
      if (response && response.id === requestId) {
        window.__SNAPPY_AI_RESPONSE__ = null;
        return response.reply || null;
      }
      await sleep(150);
    }
    return null;
  }

  async function generatePmReply(messageText, username) {
    const ruleSources = [];
    if (Array.isArray(CONFIG?.replyRules)) ruleSources.push(...CONFIG.replyRules);
    if (Array.isArray(CONFIG?.reddit?.replyRules)) ruleSources.push(...CONFIG.reddit.replyRules);
    const rules = ruleSources;

    function normalizeForMatch(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\\s]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }

    function findRuleReply(text) {
      const normalizedText = normalizeForMatch(text);
      for (const rule of rules) {
        const matchStr = typeof rule.match === 'string' ? rule.match : '';
        const matchRaw = String(matchStr || '').trim();
        if (!matchRaw) continue;
        const normalized = normalizeForMatch(matchRaw);
        if (!normalized) continue;
        const target = normalizedText;
        if (normalized === '*' || normalized === 'default' || normalized === 'fallback') {
          return String(rule.reply || '').trim() || null;
        }
        const boundaryPattern = new RegExp('(^|\\\\s)' + normalized.replace(/[.*+?^()|[\]{}$\\\\]/g, '\\\\$&') + '(\\\\s|$)', 'i');
        if (target.includes(normalized) || boundaryPattern.test(target)) {
          log('Rule matched for u/' + (username || 'reddit_user') + ': "' + matchRaw + '"');
          return String(rule.reply || '').trim() || null;
        }
      }
      return null;
    }

    const directRuleReply = findRuleReply(messageText);
    if (directRuleReply) {
      log('Using matched rule reply for u/' + (username || 'reddit_user'));
      return directRuleReply;
    }

    if (CONFIG?.ai?.enabled) {
      try {
        const reqId = 'rd-pm-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
        window.__SNAPPY_AI_REQUEST__ = {
          id: reqId,
          username: username || 'reddit_user',
          messages: [{ role: 'user', content: String(messageText || '').trim() }]
        };
        const timeoutMs = Number(CONFIG?.ai?.requestTimeoutMs) || 30000;
        const reply = await waitForAiReply(reqId, timeoutMs);
        if (reply && String(reply).trim()) return String(reply).trim();
        log('AI returned empty reply for u/' + (username || 'reddit_user') + ', trying configured fallback');
      } catch (error) {
        log('AI PM reply generation failed: ' + error);
      }
    }

    // If rules exist but nothing matched, use first non-empty reply as final fallback.
    for (const rule of rules) {
      const reply = String(rule?.reply || '').trim();
      if (reply) {
        log('Using first configured rule reply as fallback for u/' + (username || 'reddit_user'));
        return reply;
      }
    }

    return 'Thanks for your message.';
  }

  async function sendPmReply(text) {
    log('Preparing to send PM reply (' + String(text || '').length + ' chars)');
    const inputSelectors = [
      'main textarea[name="message"]',
      'textarea[name="message"]',
      'main textarea[aria-label*="write message" i]',
      'textarea[aria-label*="write message" i]',
      'main textarea[placeholder*="message" i]',
      'textarea[placeholder*="message" i]',
      'main [contenteditable="true"][role="textbox"]',
      'main [role="textbox"][contenteditable="true"]',
      'main [contenteditable="plaintext-only"][role="textbox"]',
      'main [data-testid*="composer" i] [contenteditable="true"]',
      'main textarea[name="text"]',
      'main textarea',
      'textarea[name="text"]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'rs-message-composer'
    ];

    function findWritableInsideHost(host) {
      if (!host) return null;
      const candidateSelectors = [
        'textarea[name="message"]',
        'textarea[aria-label*="write message" i]',
        'textarea[placeholder*="message" i]',
        'textarea',
        '[role="textbox"][contenteditable="true"]',
        '[contenteditable="true"]'
      ];

      const visited = new Set();
      function walk(root) {
        if (!root || visited.has(root)) return null;
        visited.add(root);

        for (const sel of candidateSelectors) {
          let found = null;
          try {
            found = root.querySelector(sel);
          } catch (e) {}
          if (found && found instanceof HTMLElement) return found;
        }

        let all = [];
        try {
          all = root.querySelectorAll('*');
        } catch (e) {
          all = [];
        }
        for (const node of all) {
          if (node && node.shadowRoot) {
            const nested = walk(node.shadowRoot);
            if (nested) return nested;
          }
        }
        return null;
      }

      const direct = walk(host);
      if (direct) return direct;
      if (host.shadowRoot) {
        const viaShadow = walk(host.shadowRoot);
        if (viaShadow) return viaShadow;
      }
      return null;
    }

    function isWritableComposer(el) {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'rs-message-composer') return true;
      if (Object.prototype.hasOwnProperty.call(el, 'disabled') && el.disabled) return false;
      if (Object.prototype.hasOwnProperty.call(el, 'readOnly') && el.readOnly) return false;
      const nameAttr = String(el.getAttribute('name') || '').toLowerCase();
      if (!isVisibleElement(el) && !(tag === 'textarea' && (nameAttr === 'message' || nameAttr === 'text'))) return false;
      const ce = String(el.getAttribute('contenteditable') || '').toLowerCase();
      if (ce === 'true' || ce === 'plaintext-only') return true;
      if ('value' in el) return true;
      return false;
    }

    function scoreComposer(el) {
      if (!el || !(el instanceof HTMLElement)) return -1;
      if (!isWritableComposer(el)) return -1;
      let score = 0;
      const name = String(el.getAttribute('name') || '').toLowerCase();
      const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = String(el.getAttribute('placeholder') || '').toLowerCase();
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'textarea') score += 3;
      if (name === 'message') score += 6;
      if (name === 'text') score += 3;
      if (aria.includes('write message')) score += 6;
      if (aria.includes('message')) score += 2;
      if (placeholder.includes('message')) score += 3;
      if (isVisibleElement(el)) score += 2;
      return score;
    }

    async function findComposerWithRetries() {
      for (let attempt = 0; attempt < 6; attempt++) {
        let best = null;
        let bestScore = -1;

        for (const selector of inputSelectors) {
          const nodes = deepQueryAll(selector);
          for (const el of nodes) {
            const score = scoreComposer(el);
            if (score > bestScore) {
              best = el;
              bestScore = score;
            }
          }
          if (bestScore >= 8) break;
        }

        // Broad fallback scan in case selectors miss Reddit variant.
        if (!best) {
          const broad = deepQueryAll('textarea, [role="textbox"], [contenteditable="true"], [contenteditable="plaintext-only"]');
          for (const el of broad) {
            const score = scoreComposer(el);
            if (score > bestScore) {
              best = el;
              bestScore = score;
            }
          }
        }

        // Dedicated web-component fallback for Reddit chat composer.
        if (!best) {
          const hosts = deepQueryAll('rs-message-composer');
          for (const host of hosts) {
            if (!(host instanceof HTMLElement)) continue;
            const nested = findWritableInsideHost(host);
            if (nested) {
              best = nested;
              bestScore = Math.max(bestScore, 10);
              break;
            }
            if (isVisibleElement(host)) {
              best = host;
              bestScore = Math.max(bestScore, 6);
            }
          }
        }

        if (best && bestScore >= 0) {
          log('Composer found (attempt ' + (attempt + 1) + ', score ' + bestScore + ')');
          return best;
        }

        await sleep(220 + (attempt * 120));
      }
      return null;
    }

    let input = await findComposerWithRetries();
    if (!input) {
      log('No writable message composer found');
      return false;
    }

    function getInputTextValue(el) {
      if (!el) return '';
      if (String(el.tagName || '').toLowerCase() === 'rs-message-composer') return '';
      if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === 'plaintext-only') {
        const v = normalizeText(el.innerText || el.textContent || '');
        return v;
      }
      if ('value' in el) {
        return String(el.value || '');
      }
      return '';
    }

    function setInputValue(el, value) {
      if (!el) return;
      const proto = Object.getPrototypeOf(el);
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (desc && typeof desc.set === 'function') {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function isEnabledButton(el) {
      if (!el || !(el instanceof HTMLElement) || !isVisibleElement(el)) return false;
      if (Object.prototype.hasOwnProperty.call(el, 'disabled') && el.disabled) return false;
      const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
      const txt = normalizeText(el.textContent || '').toLowerCase();
      const iconName = String(el.getAttribute('icon-name') || '').toLowerCase();
      if (aria.includes('send') || txt === 'send' || txt.startsWith('send ') || iconName.includes('send')) return true;
      if (aria.includes('message')) return true;
      if (el.matches('button[type="submit"], button[data-testid*="send" i], button[aria-label*="send" i]')) return true;
      return false;
    }

    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    if (typeof input.click === 'function') input.click();
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    input.focus();
    await sleep(80);

    const active = document.activeElement;
    if (active && active instanceof HTMLElement && isWritableComposer(active)) {
      input = active;
    }
    if (String(input.tagName || '').toLowerCase() === 'rs-message-composer') {
      const nested = findWritableInsideHost(input);
      if (nested) {
        input = nested;
        input.focus();
      }
    }
    log('Active composer: ' + String(input.tagName || '').toLowerCase() + ' name=' + String(input.getAttribute('name') || ''));

    const isEditable = input.getAttribute('contenteditable') === 'true' || input.getAttribute('contenteditable') === 'plaintext-only';
    if (isEditable) {
      input.textContent = '';
    } else if ('value' in input) {
      setInputValue(input, '');
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const delays = CONFIG?.typingDelayRangeMs || [10, 35];
    const minDelay = Number(delays[0]) || 10;
    const maxDelay = Number(delays[1]) || 35;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true, cancelable: true }));

      if (isEditable) {
        if (document.execCommand) {
          try { document.execCommand('insertText', false, char); } catch (e) { input.innerText = (input.innerText || '') + char; }
        } else {
          input.innerText = (input.innerText || '') + char;
        }
      } else if ('value' in input) {
        setInputValue(input, String(getInputTextValue(input) || '') + char);
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true, cancelable: true }));
      const delay = Math.floor(Math.random() * Math.max(1, (maxDelay - minDelay + 1))) + minDelay;
      await sleep(delay);
    }
    await sleep(180);
    const typedLength = getInputTextValue(input).length;
    log('Typed length in composer: ' + typedLength);
    if (typedLength < Math.min(2, text.length)) {
      log('Reply text was not applied to input; send aborted');
      return false;
    }

    const buttonSelectors = [
      'button[aria-label*="send" i]',
      'button[data-testid*="send" i]',
      'button[type="submit"]',
      'button[icon-name*="send" i]'
    ];
    const localScope = input.closest('form, main, [role="main"], [class*="composer" i], [class*="message" i]') || document;
    for (const selector of buttonSelectors) {
      const localBtns = Array.from(localScope.querySelectorAll(selector));
      for (const btn of localBtns) {
        if (!isEnabledButton(btn)) continue;
        btn.click();
        log('Clicked local send button');
        await sleep(220);
        if (getInputTextValue(input).length === 0) return true;
      }
    }
    for (const selector of buttonSelectors) {
      const btns = deepQueryAll(selector);
      for (const btn of btns) {
        if (!isEnabledButton(btn)) continue;
        btn.click();
        log('Clicked global send button');
        await sleep(220);
        if (getInputTextValue(input).length === 0) return true;
      }
    }

    const form = input.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit();
        log('Triggered form.requestSubmit()');
        await sleep(220);
        if (getInputTextValue(input).length === 0) return true;
      } catch (e) {}
    }

    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    log('Triggered Enter submit fallback');
    await sleep(200);
    const remainingLength = getInputTextValue(input).length;
    if (remainingLength > 0) {
      log('Send attempt exhausted; composer still contains text');
    }
    return remainingLength === 0;
  }

  function clickConversationElement(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const clickTarget = el.querySelector('a[href*="/room/"], a[href*="/message/messages/"]') || el;
    try {
      clickTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      // ignore
    }
    try {
      clickTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      clickTarget.click();
      clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clickAnyButtonByText(textOptions) {
    const buttons = deepQueryAll('button, [role="button"], faceplate-button');
    for (const node of buttons) {
      if (!(node instanceof HTMLElement) || !isVisibleElement(node)) continue;
      const txt = normalizeText(node.textContent || '').toLowerCase();
      if (!txt) continue;
      for (const opt of textOptions) {
        if (txt === opt || txt.startsWith(opt + ' ') || txt.includes(' ' + opt) || txt.includes(opt + ' ')) {
          node.click();
          return true;
        }
      }
    }
    return false;
  }

  function clickAnyVisibleRequestAcceptButton() {
    return clickAnyButtonByText(['accept', 'approve', 'start chat', 'join chat']);
  }

  async function handleRequestGateFlow(reason) {
    let acted = false;
    for (let step = 0; step < 5; step++) {
      let clickedSomething = false;
      const viewed = clickAnyButtonByText(['view request', 'view requests']);
      if (viewed) {
        log('Clicked "View request" gate' + (reason ? ' (' + reason + ')' : ''));
        clickedSomething = true;
      }
      const accepted = clickAnyVisibleRequestAcceptButton();
      if (accepted) {
        log('Clicked request acceptance gate' + (reason ? ' (' + reason + ')' : ''));
        clickedSomething = true;
      }
      if (!clickedSomething) break;
      acted = true;
      await sleep(750);
    }
    return acted;
  }

  async function ensureConversationReadyForReply(convoEl, author) {
    if (convoEl) {
      clickConversationElement(convoEl);
      log('Re-opened conversation for u/' + (author || 'reddit_user') + ' before send');
      await sleep(900);
    }
    await handleRequestGateFlow('pre-send');
  }

  async function processUnreadPmConversations() {
    if (!shouldReadPrivateMessages()) {
      log('PM scan skipped: PM watch/read disabled');
      return;
    }
    if (!threadsAnchored) {
      log('PM scan skipped: waiting for initial Threads anchor');
      return;
    }
    const allowAutoReply = settings.autoReplyToPMs !== false;
    if (!allowAutoReply) {
      log('PM scan active: auto-reply to PMs is disabled');
    }
    if ((Date.now() - lastPmReplyRunAt) < PM_REPLY_DEBOUNCE_MS) return;
    lastPmReplyRunAt = Date.now();

    const limit = Math.max(1, Number(settings.maxItemsPerPoll) || 3);
    // Keep current panel context unless we need to switch.
    await sleep(220);
    const inboxFocused = ensureInboxTab();
    if (!inboxFocused) {
      log('Inbox tab not found; scanning current chat list');
    }
    await sleep(300);

    let unreadCandidates = getUnreadConversationCandidates();
    if (unreadCandidates.length === 0) {
      const requestsFocused = await focusRequestsPanelWithRetry();
      if (requestsFocused) {
        await sleep(350);
        unreadCandidates = getUnreadConversationCandidates();
        if (unreadCandidates.length === 0) {
          unreadCandidates = getRequestConversationCandidates();
          if (unreadCandidates.length === 0) {
            const navUnread = getRequestsUnreadCountFromNav();
            if (navUnread > 0) {
              log('Requests badge > 0 but no row candidates yet; keeping Requests tab context');
              await sleep(800);
              unreadCandidates = getRequestConversationCandidates();
            }
          }
        }
      }
    }
    if (unreadCandidates.length > 0) {
      log('Unread conversations detected: ' + unreadCandidates.length);
      const convoEl = unreadCandidates[0];
      try {
        const author = sanitizeAuthor(extractConversationAuthor(convoEl)) || 'reddit_user';

        const clicked = clickConversationElement(convoEl);
        if (!clicked) {
          await returnToThreads('failed to click unread conversation');
          return;
        }
        log('Clicked unread conversation for u/' + author);
        await sleep(900);

        await handleRequestGateFlow('post-open');

        const latestIncoming = await extractLatestIncomingWithRetries(author, convoEl);
        if (!latestIncoming) {
          await returnToThreads('no incoming message batch');
          return;
        }
        if (lastIncomingByAuthor.get(author.toLowerCase()) === latestIncoming.normalized) {
          log('No new incoming PM content for u/' + author);
          await returnToThreads('message already handled');
          return;
        }

        const latestMessage = latestIncoming.text;
        const messageKey = 'pm-msg:' + author + ':' + latestIncoming.normalized.substring(0, 220);
        if (processedItems.has(messageKey)) {
          await returnToThreads('message key already processed');
          return;
        }
        if (!allowAutoReply) {
          log('Captured unread PM from u/' + author + ' (auto-reply disabled)');
          lastIncomingByAuthor.set(author.toLowerCase(), latestIncoming.normalized);
          await returnToThreads('auto-reply disabled');
          return;
        }

        const reply = await generatePmReply(latestMessage, author);
        if (!reply) {
          await returnToThreads('no reply generated');
          return;
        }
        let sent = await sendPmReply(reply);
        if (!sent) {
          await ensureConversationReadyForReply(convoEl, author);
          sent = await sendPmReply(reply);
        }
        if (sent) {
          lastIncomingByAuthor.set(author.toLowerCase(), latestIncoming.normalized);
          processedItems.add(messageKey);
          log('Replied to PM from u/' + author + ': ' + reply.substring(0, 80));
          await returnToThreads('reply sent');
          return;
        }

        log('Reply send failed in current conversation for u/' + author);
        await returnToThreads('send failed');
        return;
      } catch (error) {
        log('Error processing unread PM conversation (UI path): ' + error);
        await returnToThreads('error');
        return;
      }
    }

    log('No unread conversation candidates in Threads UI');

    if (!unreadPmQueue.length) return;
    const toProcess = unreadPmQueue.slice(0, limit);
    log('Unread PM threads queued: ' + toProcess.length);

    for (const pm of toProcess) {
      try {
        const repliedKey = 'pm-replied:' + pm.id;
        if (processedItems.has(repliedKey)) continue;
        const author = sanitizeAuthor(pm.author);
        if (!author) continue;

        const convoEl = findConversationElementForAuthor(author);
        if (convoEl) {
          clickConversationElement(convoEl);
          log('Opened PM thread for u/' + author);
          await sleep(1200);
        } else {
          log('Could not find PM thread in UI for u/' + author + ', using latest inbox text');
        }

        const latestIncoming = await extractLatestIncomingWithRetries(author, convoEl);
        const latestMessage = (latestIncoming && latestIncoming.text) || String(pm.body || '').trim();
        if (!latestMessage) {
          await returnToThreads('queued PM missing latest message');
          return;
        }
        const normalizedIncoming = latestIncoming ? latestIncoming.normalized : latestMessage.toLowerCase().trim();
        if (lastIncomingByAuthor.get(author.toLowerCase()) === normalizedIncoming) {
          await returnToThreads('queued PM already handled');
          return;
        }

        const messageKey = 'pm-msg:' + author + ':' + normalizedIncoming.substring(0, 220);
        if (processedItems.has(messageKey)) {
          await returnToThreads('queued PM message key already processed');
          return;
        }
        if (!allowAutoReply) {
          log('Queued unread PM from u/' + author + ' (auto-reply disabled)');
          lastIncomingByAuthor.set(author.toLowerCase(), normalizedIncoming);
          await returnToThreads('auto-reply disabled');
          continue;
        }

        const reply = await generatePmReply(latestMessage, author);
        if (!reply) {
          await returnToThreads('no reply generated');
          return;
        }

        let sent = await sendPmReply(reply);
        if (!sent) {
          await ensureConversationReadyForReply(convoEl, author);
          sent = await sendPmReply(reply);
        }
        if (sent) {
          lastIncomingByAuthor.set(author.toLowerCase(), normalizedIncoming);
          processedItems.add(repliedKey);
          processedItems.add(messageKey);
          log('Replied to PM from u/' + author + ': ' + reply.substring(0, 80));
          const qIdx = unreadPmQueue.findIndex(item => item.id === pm.id);
          if (qIdx >= 0) unreadPmQueue.splice(qIdx, 1);
          await returnToThreads('reply sent');
          return;
        } else {
          log('Reply send failed in queued PM conversation for u/' + author);
          await returnToThreads('send failed');
          return;
        }
      } catch (error) {
        log('Error processing unread PM conversation: ' + error);
        await returnToThreads('error');
      }
    }
  }

  async function openChatAndCheckUnread() {
    if (!shouldOpenChatOnStart()) return;

    const chatButtonSelectors = [
      '#header-action-item-chat-button',
      '[data-testid="chat-button"]',
      'button[id*="chat-button"]',
      'a[href*="/message/inbox"]',
      'a[href*="/message/messages"]',
      'a[href*="/chat"]',
      'button[aria-label*="open chat" i]',
      'button[aria-label*="chat" i]'
    ];

    let clicked = false;
    for (const selector of chatButtonSelectors) {
      const el = document.querySelector(selector);
      if (el && el instanceof HTMLElement) {
        el.click();
        clicked = true;
        log('Opened Reddit chat/messages area');
        break;
      }
    }

    if (!clicked) {
      log('Chat/messages button not found, checking PM inbox directly');
    } else {
      await sleep(1000);
      ensureThreadsTab();
      threadsAnchored = true;
      await sleep(220);
      ensureInboxTab();
      await sleep(300);
      const unreadEls = Array.from(document.querySelectorAll('.unread, [data-unread="true"], .message.unread'));
      if (unreadEls.length > 0) {
        log('Unread messages in UI: ' + unreadEls.length);
      }
    }

    if (!threadsAnchored) {
      ensureThreadsTab();
      threadsAnchored = true;
      await sleep(180);
    }

    if (shouldPauseDmAroundScheduledPost()) {
      return;
    }

    await readUnreadPrivateMessages();
    await processUnreadPmConversations();
  }

  async function poll() {
    if (!isRunning || isProcessing || startupCheckRunning) return;
    isProcessing = true;
    try {
      if (settings.watchNotifications) {
        const unreadNotifications = getUnreadCount(SELECTORS.notificationItems, SELECTORS.unreadNotification);
        if (unreadNotifications > 0) {
          log('Unread notifications: ' + unreadNotifications);
        }
      }

      const pauseDm = shouldPauseDmAroundScheduledPost();

      if (settings.watchPrivateMessages && !pauseDm) {
        const unreadMessages = getUnreadCount(SELECTORS.messageItems, SELECTORS.unreadMessage);
        if (unreadMessages > 0) {
          log('Unread messages: ' + unreadMessages);
        }
      }

      if (!threadsAnchored) {
        ensureThreadsTab();
        threadsAnchored = true;
        await sleep(150);
      }

      if (!pauseDm) {
        await readUnreadPrivateMessages();
        await processUnreadPmConversations();
      }
      await runSubredditCheck(false);
      await processScheduledPosting();
    } catch (error) {
      log('Poll error: ' + error);
    } finally {
      isProcessing = false;
    }
  }

  function scheduleNextPoll() {
    if (!isRunning) return;
    const delay = getPollDelayMs();
    pollTimer = setTimeout(async () => {
      await poll();
      scheduleNextPoll();
    }, delay);
  }

  function stop() {
    isRunning = false;
    if (pollTimer) clearTimeout(pollTimer);
    window.__SNAPPY_RUNNING__ = false;
    window.__SNAPPY_REDDIT_RUNNING__ = false;
    log('Reddit bot stopped');
  }

  log('Reddit bot started');
  log('Watch list size: ' + ((settings.watchSubreddits && settings.watchSubreddits.length) || 0));
  log('PM settings: watch=' + (settings.watchPrivateMessages !== false) + ', read=' + (settings.readPrivateMessages !== false) + ', autoReply=' + (settings.autoReplyToPMs !== false));
  log('Scheduler: enabled=' + ((settings.postScheduler && settings.postScheduler.enabled) === true) + ', posts=' + getSchedulerPosts().length);
  log('Poll interval: random ' + MIN_POLL_MS + '-' + MAX_POLL_MS + 'ms');
  if (String(settings.authCookieString || '').trim() || String(settings.sessionCookie || '').trim()) {
    log('Manual Reddit auth cookies configured');
  }
  applyManualAuthCookies();
  scheduleNextSubredditCheck();
  openChatAndCheckUnread().then(async () => {
    await runSubredditCheck(true);
    startupCheckRunning = false;
    await poll();
    scheduleNextPoll();
  }).catch(async error => {
    log('Startup Reddit checks error: ' + error);
    startupCheckRunning = false;
    await poll();
    scheduleNextPoll();
  });
  window.__SNAPPY_STOP__ = stop;
})();
`;
}
