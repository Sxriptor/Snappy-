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
  const processedScheduleSlots = new Set();
  let isPostingScheduledContent = false;
  const unreadPmQueue = [];

  const MIN_SUBREDDIT_CHECK_MS = 5 * 60 * 1000;
  const MAX_SUBREDDIT_CHECK_MS = 60 * 60 * 1000;
  const PM_CHECK_DEBOUNCE_MS = 3000;
  const PM_REPLY_DEBOUNCE_MS = 1500;
  const SCHEDULER_JITTER_MINUTES = 15;
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

  function ensureRequestsTab() {
    const tabs = deepQueryAll('button, a, [role="tab"], [role="button"], faceplate-tab, [data-testid]');
    for (const tab of tabs) {
      if (!(tab instanceof HTMLElement)) continue;
      const txt = normalizeText(tab.textContent || '').toLowerCase();
      const testId = String(tab.getAttribute('data-testid') || '').toLowerCase();
      if (testId.includes('nav-item-requests') || txt === 'requests' || txt.startsWith('requests ')) {
        tab.click();
        log('Focused Requests tab');
        return true;
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

  function splitRedditPostContent(rawText) {
    const cleaned = String(rawText || '').replace(/\\r/g, '').trim();
    if (!cleaned) return null;
    const lines = cleaned.split('\\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) return null;

    let flair = '';
    let titleIndex = 0;
    const flairMatch = lines[0].match(/^flair\\s*:\\s*(.+)$/i);
    if (flairMatch && flairMatch[1]) {
      flair = flairMatch[1].trim();
      titleIndex = 1;
    }

    if (titleIndex >= lines.length) return null;

    let title = lines[titleIndex];
    if (title.length > 300) {
      title = title.substring(0, 300);
    }
    const body = lines.slice(titleIndex + 1).join('\\n\\n').trim();
    return { flair, title, body };
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

  async function navigateToRedditSubmit(subreddit) {
    const cleanSubreddit = normalizeScheduledSubreddit(subreddit);
    const targetUrl = cleanSubreddit
      ? 'https://www.reddit.com/r/' + encodeURIComponent(cleanSubreddit) + '/submit'
      : 'https://www.reddit.com/submit';

    if (window.location.href !== targetUrl) {
      window.location.assign(targetUrl);
    }

    const ready = await waitForSelector([
      'input[name="title"]',
      'textarea[name="title"]',
      '[data-testid*="post-composer" i]',
      '[role="textbox"][aria-label*="title" i]'
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

    const scheduler = getSchedulerConfig();
    const parsed = splitRedditPostContent(post.body);
    if (!parsed) {
      log('Scheduler: text file is empty for item ' + String(post.id || 'unknown'));
      return false;
    }

    isPostingScheduledContent = true;
    try {
      const mediaPaths = getPostMediaPaths(post);
      const targetSubreddit = normalizeScheduledSubreddit(scheduler.subreddit || '');
      log('Scheduler: starting Reddit publish for item ' + String(post.id || 'unknown') + (targetSubreddit ? (' in r/' + targetSubreddit) : ' on profile'));

      const ready = await navigateToRedditSubmit(targetSubreddit);
      if (!ready) return false;

      await sleep(900);
      if (mediaPaths.length > 0) {
        const mediaTabClicked = await clickButtonByText('images & video', 3000) || await clickButtonByText('image', 3000);
        if (!mediaTabClicked) {
          log('Scheduler: media tab not found, trying direct file input');
        }
        await sleep(300);
        const attached = await requestRedditMediaAttach(mediaPaths);
        if (!attached) {
          log('Scheduler: media attach failed');
          return false;
        }
        await sleep(900);
      } else {
        await clickButtonByText('post', 2500);
        await sleep(300);
      }

      const titleInput = await waitForSelector([
        'input[name="title"]',
        'textarea[name="title"]',
        'textarea[aria-label*="title" i]',
        '[role="textbox"][aria-label*="title" i]'
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
        const bodyInput = await waitForSelector([
          'textarea[name="text"]',
          'textarea[aria-label*="body" i]',
          '[role="textbox"][aria-label*="body" i]',
          '[contenteditable="true"][role="textbox"]'
        ], 4000);
        if (bodyInput) {
          setInputValue(bodyInput, parsed.body);
        }
      }

      await sleep(500);

      const posted = await clickButtonByText('post', 10000) || await clickButtonByText('publish', 10000);
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
      const windowEnd = new Date(baseTime.getTime() + SCHEDULER_JITTER_MINUTES * 60 * 1000);
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

    return false;
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
        log('AI returned empty reply for u/' + (username || 'reddit_user') + ', trying keyword fallback');
      } catch (error) {
        log('AI PM reply generation failed: ' + error);
      }
    }

    if (directRuleReply) {
      log('Using matched rule fallback for u/' + (username || 'reddit_user'));
      return directRuleReply;
    }

    const fallbackRule = findRuleReply(messageText);
    if (fallbackRule) {
      log('Using keyword fallback reply for u/' + (username || 'reddit_user'));
      return fallbackRule;
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
        if (txt === opt || txt.startsWith(opt + ' ')) {
          node.click();
          return true;
        }
      }
    }
    return false;
  }

  async function ensureConversationReadyForReply(convoEl, author) {
    if (convoEl) {
      clickConversationElement(convoEl);
      log('Re-opened conversation for u/' + (author || 'reddit_user') + ' before send');
      await sleep(900);
    }
    // Some chats/requests gate composer behind an accept CTA.
    const accepted = clickAnyButtonByText(['accept', 'approve', 'start chat']);
    if (accepted) {
      log('Clicked request acceptance button before send');
      await sleep(700);
    }
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
    ensureThreadsTab();
    await sleep(220);
    const inboxFocused = ensureInboxTab();
    if (!inboxFocused) {
      log('Inbox tab not found; scanning current chat list');
    }
    await sleep(300);

    let unreadCandidates = getUnreadConversationCandidates();
    if (unreadCandidates.length === 0) {
      const requestsFocused = ensureRequestsTab();
      if (requestsFocused) {
        await sleep(300);
        unreadCandidates = getUnreadConversationCandidates();
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

      if (settings.watchPrivateMessages) {
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

      await readUnreadPrivateMessages();
      await processUnreadPmConversations();
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
