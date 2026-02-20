import { Configuration } from '../types';

/**
 * Build an injection script for Threads that:
 * - Detects new comments on the currently open post
 * - Skips our own comments and duplicates
 * - Generates replies using rule-based or AI reply flow
 * - Sends replies via the comment composer or per-comment reply action
 */
export function buildThreadsBotScript(config: Configuration): string {
  // Serialize config for use inside the injected sandbox.
  const serializedConfig = JSON.stringify(config || {});

  return `
(function() {
  if (window.__SNAPPY_RUNNING__ && window.__SNAPPY_THREADS_RUNNING__) {
    console.log('[Snappy][Threads] Already running');
    return;
  }

  window.__SNAPPY_RUNNING__ = true;
  window.__SNAPPY_THREADS_RUNNING__ = true;

  const CONFIG = ${serializedConfig};
  const SITE_SETTINGS = CONFIG?.siteSettings?.threads || {};
  const schedulerConfig = SITE_SETTINGS.postScheduler || CONFIG?.threads?.postScheduler || {};
  const seenComments = new Set();
  const seenNotifications = new Set();
  const processedScheduleSlots = new Set();
  let isRunning = true;
  let pollInterval = null;
  let schedulerInterval = null;
  let isProcessing = false;
  let refreshInterval = null;
  let isPostingScheduledContent = false;
  let replyPauseUntil = 0;
  const STARTUP_REFRESH_KEY = '__snappy_threads_startup_refresh_done__';
  const THREADS_POSTED_STATE_KEY = '__snappy_threads_scheduler_posted_v2__';

  const MIN_COMMENT_LENGTH = 3;
  const rawPollMs = Number(SITE_SETTINGS.pollIntervalMs ?? (CONFIG?.threads && CONFIG.threads.pollIntervalMs));
  const POLL_MS = Number.isFinite(rawPollMs) && rawPollMs >= 3000 ? rawPollMs : 60000;
  const MAX_PER_POLL = (SITE_SETTINGS.maxCommentsPerPoll || (CONFIG?.threads && CONFIG.threads.maxCommentsPerPoll)) || 5;
  const ACTIVITY_ENABLED = SITE_SETTINGS.watchActivityColumn !== false && (CONFIG?.threads?.activityColumnEnabled !== false);
  const ACTIVITY_PRIORITY = SITE_SETTINGS.activityPriority !== false && (CONFIG?.threads?.activityPriority !== false);
  const AUTO_REPLY_ENABLED = SITE_SETTINGS.autoReplyToComments !== false;
  const SCHEDULER_ENABLED = schedulerConfig?.enabled === true;
  const typingDelayRange = CONFIG?.typingDelayRangeMs || [50, 150];
  const preReplyDelayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];
  const SCHEDULER_JITTER_MINUTES = 0;
  const SCHEDULER_DUE_WINDOW_MINUTES = 15;
  const REPLY_PAUSE_AFTER_POST_MS = 2 * 60 * 1000;

  let activityColumnSetup = false;

  function scheduleNextRefresh() {
    try {
      if (sessionStorage.getItem(STARTUP_REFRESH_KEY) === '1') {
        log('Startup refresh already completed for this run');
        return;
      }
    } catch {}

    // Random interval between 2-8 seconds
    const refreshDelay = Math.floor(Math.random() * 6000) + 2000;
    refreshInterval = setTimeout(() => {
      if (!isRunning) {
        log('Skipping refresh - bot stopped');
        return;
      }
      if (!isProcessing && !isPostingScheduledContent) {
        try {
          sessionStorage.setItem(STARTUP_REFRESH_KEY, '1');
        } catch {}
        log('Refreshing page (startup refresh)');
        location.reload();
      } else {
        log('Delaying startup refresh - processing in progress');
        scheduleNextRefresh();
      }
    }, refreshDelay);
  }

  function log(msg) {
    const formatted = '[Snappy][Threads] ' + msg;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisibleElement(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hashString(input) {
    let hash = 0;
    const str = String(input || '');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function normalizeTime(timeValue) {
    const match = String(timeValue || '').trim().match(/^(\\d{1,2}):(\\d{2})$/);
    if (!match) return null;
    const hour = Math.max(0, Math.min(23, parseInt(match[1], 10)));
    const minute = Math.max(0, Math.min(59, parseInt(match[2], 10)));
    return { hour, minute, text: hour.toString().padStart(2, '0') + ':' + minute.toString().padStart(2, '0') };
  }

  function getDayKey(date) {
    const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return map[date.getDay()];
  }

  function getSchedulerPosts() {
    const posts = Array.isArray(schedulerConfig.posts) ? schedulerConfig.posts : [];
    return posts.filter(post =>
      post &&
      typeof post.id === 'string' &&
      typeof post.textPath === 'string' &&
      typeof post.body === 'string'
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
      const raw = localStorage.getItem(THREADS_POSTED_STATE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
    return {};
  }

  function savePostedState(state) {
    try {
      localStorage.setItem(THREADS_POSTED_STATE_KEY, JSON.stringify(state || {}));
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
    const folderPath = typeof schedulerConfig.folderPath === 'string' ? schedulerConfig.folderPath.trim() : '';
    const sorted = posts.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' }));
    for (const post of sorted) {
      if (!isPostAlreadyPublished(post, folderPath)) {
        return post;
      }
    }
    return null;
  }

  function parseThreadsScheduledText(rawText) {
    const text = String(rawText || '').replace(/^\\uFEFF/, '').replace(/\\r/g, '').trim();
    const lines = text.split('\\n').map(line => String(line || '').trim()).filter(Boolean);
    let caption = '';
    let topic = '';

    for (const line of lines) {
      const match = line.match(/^\\s*(caption|title|topic)\\s*:\\s*(.+)$/i);
      if (!match) continue;
      const key = match[1].toLowerCase();
      if (key === 'caption' || key === 'title') {
        caption = match[2].trim();
      } else if (match[1].toLowerCase() === 'topic') {
        topic = match[2].trim();
      }
    }

    if (!caption && lines.length > 0) caption = lines[0];
    if (!topic && lines.length > 1) topic = lines[1];
    if (!topic) topic = caption;

    return {
      title: caption.substring(0, 500),
      topic: topic.substring(0, 200)
    };
  }

  function getDueScheduleSlot() {
    if (!SCHEDULER_ENABLED) return null;
    const folderPath = typeof schedulerConfig.folderPath === 'string' ? schedulerConfig.folderPath.trim() : '';
    if (!folderPath) return null;

    const now = new Date();
    const dayKey = getDayKey(now);
    const dayConfig = schedulerConfig.days?.[dayKey];
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
        offsetMinutes: randomOffset
      };
    }

    return null;
  }

  function describeTodaySchedule() {
    if (!SCHEDULER_ENABLED) return 'disabled';
    const now = new Date();
    const dayKey = getDayKey(now);
    const dayConfig = schedulerConfig.days?.[dayKey];
    if (!dayConfig || dayConfig.enabled !== true || !Array.isArray(dayConfig.times) || dayConfig.times.length === 0) {
      return dayKey + ': off';
    }
    const times = dayConfig.times
      .map(item => normalizeTime(item))
      .filter(item => !!item)
      .map(item => item.text);
    return dayKey + ': ' + (times.length > 0 ? times.join(', ') : 'off');
  }

  async function requestThreadsMediaAttach(filePaths) {
    const normalizedPaths = Array.isArray(filePaths)
      ? filePaths.filter(item => typeof item === 'string' && item.trim().length > 0)
      : [];
    if (normalizedPaths.length === 0) return true;

    const requestId = 'threads-upload-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.__SNAPPY_THREADS_UPLOAD_RESPONSE__ = null;
    window.__SNAPPY_THREADS_UPLOAD_REQUEST__ = {
      id: requestId,
      filePaths: normalizedPaths,
      selector: 'input[type="file"]'
    };

    let waited = 0;
    const timeoutMs = 30000;
    while (waited < timeoutMs && isRunning) {
      await sleep(250);
      waited += 250;
      const response = window.__SNAPPY_THREADS_UPLOAD_RESPONSE__;
      if (response && response.id === requestId) {
        window.__SNAPPY_THREADS_UPLOAD_RESPONSE__ = null;
        return response.success === true;
      }
    }
    return false;
  }

  async function requestThreadsKeyboardSequence(events, timeoutMs) {
    const normalizedEvents = Array.isArray(events) ? events : [];
    if (!normalizedEvents.length) return false;

    const requestId = 'threads-kb-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.__SNAPPY_THREADS_KEYBOARD_RESPONSE__ = null;
    window.__SNAPPY_THREADS_KEYBOARD_REQUEST__ = {
      id: requestId,
      events: normalizedEvents
    };

    let waited = 0;
    const maxWait = Math.max(1200, Number(timeoutMs) || 8000);
    while (waited < maxWait && isRunning) {
      await sleep(140);
      waited += 140;
      const response = window.__SNAPPY_THREADS_KEYBOARD_RESPONSE__;
      if (response && response.id === requestId) {
        window.__SNAPPY_THREADS_KEYBOARD_RESPONSE__ = null;
        return response.success === true;
      }
    }
    return false;
  }

  async function requestThreadsPointerClickAt(x, y, timeoutMs) {
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;

    const requestId = 'threads-pointer-pt-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.__SNAPPY_THREADS_POINTER_RESPONSE__ = null;
    window.__SNAPPY_THREADS_POINTER_REQUEST__ = {
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
      const response = window.__SNAPPY_THREADS_POINTER_RESPONSE__;
      if (response && response.id === requestId) {
        window.__SNAPPY_THREADS_POINTER_RESPONSE__ = null;
        return response.success === true;
      }
    }
    return false;
  }

  async function insertTrustedText(text) {
    const value = String(text || '');
    if (!value) return true;

    const events = [{ kind: 'insertText', text: value, delayMs: 80 }];

    return await requestThreadsKeyboardSequence(events, 7000);
  }

  async function runThreadsKeyboardPostFlow(title, topic) {
    const events = [];
    const STEP_DELAY = 95;
    const TRANSITION_DELAY = 140;
    const pushTab = () => {
      events.push({ kind: 'dispatch', type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: STEP_DELAY });
      events.push({ kind: 'dispatch', type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, delayMs: TRANSITION_DELAY });
    };
    const pushShiftTab = () => {
      events.push({ kind: 'dispatch', type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, delayMs: STEP_DELAY });
      events.push({ kind: 'dispatch', type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8, delayMs: STEP_DELAY });
      events.push({ kind: 'dispatch', type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8, delayMs: STEP_DELAY });
      events.push({ kind: 'dispatch', type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, delayMs: TRANSITION_DELAY });
    };
    const pushSpace = () => {
      // Use full CDP space sequence (rawKeyDown + char + keyUp) so activation is not skipped.
      events.push({ kind: 'dispatch', type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, delayMs: 120 });
      events.push({ kind: 'dispatch', type: 'char', key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, delayMs: 130 });
      events.push({ kind: 'dispatch', type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, delayMs: 220 });
    };
    const pushArrowDown = () => {
      events.push({ kind: 'dispatch', type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, delayMs: 110 });
      events.push({ kind: 'dispatch', type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, delayMs: 160 });
    };
    const pushEnter = () => {
      events.push({ kind: 'dispatch', type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 110 });
      events.push({ kind: 'dispatch', type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, delayMs: 170 });
    };

    // Tab once, Shift+Tab x5, Space, title, Shift+Tab, topic, ArrowDown, Enter, Tab x9, Enter
    pushTab();
    for (let i = 0; i < 5; i++) pushShiftTab();
    pushSpace();
    events.push({ kind: 'insertText', text: String(title || ''), delayMs: 260 });
    pushShiftTab();
    events.push({ kind: 'insertText', text: String(topic || ''), delayMs: 260 });
    pushArrowDown();
    pushEnter();
    for (let i = 0; i < 9; i++) pushTab();
    pushEnter();

    log('Scheduler: starting key sequence (Tab x1, Shift+Tab x5, Space, title, Shift+Tab x1, topic, ArrowDown, Enter, Tab x9, Enter)');
    return await requestThreadsKeyboardSequence(events, 30000);
  }

  function isPostSubmissionLikelyConfirmed() {
    // If a prominent "Post" action is still visible/enabled, assume submit did not complete.
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a, span'));
    const visiblePostButtons = buttons.filter(node => {
      if (!(node instanceof HTMLElement)) return false;
      if (!isVisibleElement(node)) return false;
      const text = String(node.textContent || '').trim().toLowerCase();
      const aria = String(node.getAttribute('aria-label') || '').trim().toLowerCase();
      const looksLikePost = text === 'post' || aria === 'post' || text.startsWith('post ') || aria.startsWith('post ');
      return looksLikePost;
    });
    return visiblePostButtons.length === 0;
  }

  async function openCreateFromThreadsLogo() {
    const threadsIcon = document.querySelector('svg[aria-label="Threads"]');
    if (!threadsIcon) {
      log('Scheduler: Threads nav icon not found');
      return false;
    }

    const rect = threadsIcon.getBoundingClientRect();
    const cx = rect.left + (rect.width / 2);
    const cy = rect.top + (rect.height / 2);
    const clickedViaCdp = await requestThreadsPointerClickAt(cx, cy, 6000);
    if (!clickedViaCdp) {
      // Fallback to DOM click when CDP path fails.
      try {
        threadsIcon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        threadsIcon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        if (typeof threadsIcon.click === 'function') threadsIcon.click();
        threadsIcon.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      } catch {}
      const clickable = threadsIcon.closest('a, div[role="button"], button, span') || threadsIcon.parentElement;
      if (clickable) {
        try {
          clickable.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          if (typeof clickable.click === 'function') clickable.click();
          clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        } catch {}
      }
    }

    // Anchor keyboard sequence to the same nav target the user clicks manually.
    const focusTarget = threadsIcon.closest('a, button, [tabindex], div[role="button"]');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      try { focusTarget.focus(); } catch {}
    }

    log('Scheduler: clicked Threads logo target' + (clickedViaCdp ? ' via CDP' : ' via fallback'));
    await sleep(700);
    return true;
  }

  async function publishScheduledThreadPost(post) {
    if (!post || typeof post.body !== 'string') return false;
    if (isPostingScheduledContent) return false;

    isPostingScheduledContent = true;
    try {
      const parsed = parseThreadsScheduledText(post.body);
      if (!parsed.title) {
        log('Scheduler: missing title for post ' + String(post.id || 'unknown'));
        return false;
      }

      const createOpened = await openCreateFromThreadsLogo();
      if (!createOpened) return false;

      const mediaPaths = getPostMediaPaths(post);
      if (mediaPaths.length > 0) {
        const attached = await requestThreadsMediaAttach(mediaPaths);
        if (!attached) {
          log('Scheduler: media attach failed for post ' + String(post.id || 'unknown'));
          return false;
        }
        await sleep(800);
      }

      const flowed = await runThreadsKeyboardPostFlow(parsed.title, parsed.topic || parsed.title);
      if (!flowed) {
        log('Scheduler: keyboard posting flow failed');
        return false;
      }
      await sleep(1400);
      const confirmed = isPostSubmissionLikelyConfirmed();
      if (!confirmed) {
        log('Scheduler: submit not confirmed (Post control still visible)');
        return false;
      }

      log('Scheduler: Threads post submitted');
      return true;
    } catch (error) {
      log('Scheduler publish error: ' + error);
      return false;
    } finally {
      isPostingScheduledContent = false;
    }
  }

  async function processScheduledPosting() {
    if (!SCHEDULER_ENABLED || !isRunning) return;
    if (isPostingScheduledContent) return;

    const dueSlot = getDueScheduleSlot();
    if (!dueSlot) return;

    const post = getNextScheduledPost();
    if (!post) {
      log('Scheduler: no unposted .txt posts available');
      processedScheduleSlots.add(dueSlot.slotKey);
      return;
    }

    log('Scheduler due at ' + dueSlot.planned + ' with random offset ' + dueSlot.offsetMinutes + ' min');
    const posted = await publishScheduledThreadPost(post);
    // Prevent repeated retries/glitching on the same scheduled slot.
    processedScheduleSlots.add(dueSlot.slotKey);
    if (posted) {
      const folderPath = typeof schedulerConfig.folderPath === 'string' ? schedulerConfig.folderPath.trim() : '';
      markPostPublished(post, folderPath);
      replyPauseUntil = Date.now() + REPLY_PAUSE_AFTER_POST_MS;
      log('Scheduler: pausing replies for ' + Math.round(REPLY_PAUSE_AFTER_POST_MS / 60000) + ' minute(s)');
    } else {
      log('Scheduler: attempt failed for slot ' + dueSlot.planned + ', skipping retries for this slot');
    }
  }

  function detectLoggedInHandle() {
    // Try the profile link in the top nav
    const anchors = Array.from(document.querySelectorAll('a[href^="/@"]'));
    for (const a of anchors) {
      const txt = a.textContent?.trim();
      if (txt && txt.length > 1 && txt.startsWith('@')) {
        return txt.replace(/^@/, '');
      }
    }
    // Fallback to meta tag
    const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (meta?.getAttribute('content')) {
      const handle = meta.getAttribute('content');
      if (handle) return handle.replace(/^@/, '');
    }
    return null;
  }

  function getPostAuthorHandle() {
    const article = document.querySelector('main article, article');
    if (!article) return null;
    const authorLink = article.querySelector('a[href^="/@"]');
    const text = authorLink?.textContent?.trim();
    return text ? text.replace(/^@/, '') : null;
  }

  function sameHandle(a, b) {
    return (a || '').toLowerCase().trim() === (b || '').toLowerCase().trim();
  }

  function extractCommentText(commentEl) {
    // Prefer <span> or <p> text nodes
    const textNodes = [];
    commentEl.querySelectorAll('span, p').forEach(node => {
      const t = node.textContent?.trim();
      if (t) textNodes.push(t);
    });
    if (textNodes.length > 0) {
      const combined = textNodes.join(' ').trim();
      if (combined.length >= MIN_COMMENT_LENGTH) return combined.substring(0, 500);
    }
    const direct = commentEl.textContent?.trim() || '';
    return direct.substring(0, 500);
  }

  function extractCommentAuthor(commentEl) {
    const authorLink = commentEl.querySelector('a[href^="/@"]');
    const text = authorLink?.textContent?.trim();
    return text ? text.replace(/^@/, '') : null;
  }

  function extractCommentId(commentEl) {
    const dataId = commentEl.getAttribute('data-snappy-id');
    if (dataId) return dataId;
    const text = (extractCommentAuthor(commentEl) || 'unknown') + '::' + (extractCommentText(commentEl) || '');
    return 'thr-' + btoa(unescape(encodeURIComponent(text))).substring(0, 40);
  }

  function findCommentElements() {
    // On Threads, comments are rendered as article elements after the main post
    const main = document.querySelector('main') || document.body;
    if (!main) return [];
    const articles = Array.from(main.querySelectorAll('article'));
    // Skip the first article (the post itself)
    return articles.slice(1);
  }

  function findNewComments(currentUser) {
    const comments = [];
    const elements = findCommentElements();
    elements.forEach(el => {
      const author = extractCommentAuthor(el);
      const text = extractCommentText(el);
      if (!author || !text || text.length < MIN_COMMENT_LENGTH) return;
      if (sameHandle(author, currentUser)) return; // skip our own comments
      const id = extractCommentId(el);
      if (seenComments.has(id)) return;
      comments.push({ id, author, text, element: el });
    });
    return comments;
  }

  function isOnPostPage() {
    const articles = findCommentElements();
    return articles.length > 0;
  }

  function findNotificationItems() {
    // Heuristic: links to /post/ that contain "comment" text
    const links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
    const results = [];
    links.forEach(link => {
      const text = (link.textContent || '').toLowerCase();
      if (!text.includes('comment')) return;
      results.push(link);
    });
    return results;
  }

  function isActivityColumnOpen() {
    // Check if Activity column is already visible
    const activityLinks = Array.from(document.querySelectorAll('a[href="/"]'));
    return activityLinks.some(link => {
      const text = link.textContent?.trim().toLowerCase();
      return text === 'activity';
    });
  }

  function findAddColumnButton() {
    // Find the "Add a column" button with the specific SVG
    const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
    return buttons.find(btn => {
      const svg = btn.querySelector('svg[aria-label="Add a column"]');
      return svg !== null;
    });
  }

  function findActivityOption() {
    // Find the Activity option after clicking Add Column
    // Look for the specific span structure containing "Activity" text
    const spans = Array.from(document.querySelectorAll('span.x1lliihq.x193iq5w.x6ikm8r.x10wlt62.xlyipyv.xuxw1ft'));
    const activitySpan = spans.find(span => {
      const text = span.textContent?.trim().toLowerCase();
      return text === 'activity';
    });

    if (activitySpan) {
      // Return the clickable parent div that contains this span
      // Navigate up to find the clickable container
      let parent = activitySpan.parentElement;
      while (parent) {
        if (parent.getAttribute('role') === 'button' || parent.getAttribute('tabindex') === '0') {
          return parent;
        }
        // Check if parent has the clickable div characteristics
        const classes = parent.className || '';
        if (classes.includes('x78zum5') && classes.includes('xdt5ytf')) {
          return parent;
        }
        parent = parent.parentElement;
      }
      // If we can't find a specific clickable parent, return the closest interactive ancestor
      return activitySpan.closest('[role="button"], a, button') || activitySpan.parentElement;
    }

    // Fallback to original method
    const activityLinks = Array.from(document.querySelectorAll('a[href="/"]'));
    return activityLinks.find(link => {
      const text = link.textContent?.trim().toLowerCase();
      return text === 'activity';
    });
  }

  function findActivityFilterDropdown() {
    // Find the dropdown button with "All" filter
    const buttons = Array.from(document.querySelectorAll('div[role="button"][aria-expanded][aria-haspopup="menu"]'));
    return buttons.find(btn => {
      const svg = btn.querySelector('svg[aria-label="All"]');
      return svg !== null;
    });
  }

  function findRepliesOption() {
    // Find the "Replies" option in the dropdown menu
    // Target based on text content (most stable method)
    const allSpans = Array.from(document.querySelectorAll('span'));
    log('Searching through ' + allSpans.length + ' spans for "Replies"');

    const repliesSpan = allSpans.find(span => {
      const text = span.textContent?.trim();
      return text === 'Replies'; // Exact match, case-sensitive
    });

    if (repliesSpan) {
      log('Found Replies span');
      // Try clicking parents up to depth 5 to find something clickable
      let current = repliesSpan;
      for (let i = 0; i <= 5; i++) {
        const role = current.getAttribute('role');
        const tabindex = current.getAttribute('tabindex');
        log('Depth ' + i + ': tag=' + current.tagName + ', role=' + role + ', tabindex=' + tabindex);

        // Return first element that looks clickable
        if (role === 'menuitem' || role === 'button' || tabindex === '0') {
          log('Returning clickable element at depth ' + i);
          return current;
        }

        if (!current.parentElement) break;
        current = current.parentElement;
      }

      // If nothing clickable found, return the span's parent (or span itself if no parent)
      log('No explicit clickable found, returning span parent');
      return repliesSpan.parentElement || repliesSpan;
    }

    log('Replies span not found');
    return null;
  }

  async function setupActivityColumn() {
    if (!ACTIVITY_ENABLED) {
      log('Activity column disabled in config');
      return false;
    }

    log('Checking if Activity column is open...');

    if (isActivityColumnOpen()) {
      // Column is open, but check if we need to set the filter
      if (!activityColumnSetup) {
        log('Activity column already open, setting filter...');
      } else {
        return true;
      }

      // Set filter to Replies once per page load.
      const filterDropdown = findActivityFilterDropdown();
      if (filterDropdown) {
        log('Setting filter to Replies...');
        filterDropdown.click();
        await sleep(1200); // Increased wait time for dropdown to fully render

        const repliesOption = findRepliesOption();
        if (repliesOption) {
          log('Found Replies option, clicking...');
          repliesOption.click();
          await sleep(500);
          log('Filter set to Replies');
        } else {
          log('Replies option not found in dropdown');
        }
      }

      activityColumnSetup = true;
      return true;
    }

    log('Activity column not found, attempting to add it...');

    // Click "Add a column" button
    const addColumnBtn = findAddColumnButton();
    if (!addColumnBtn) {
      log('Add column button not found');
      return false;
    }

    log('Clicking Add Column button...');
    addColumnBtn.click();
    await sleep(1000);

    // Click Activity option
    const activityOption = findActivityOption();
    if (!activityOption) {
      log('Activity option not found');
      return false;
    }

    log('Clicking Activity option...');
    activityOption.click();
    await sleep(1500);

    // Set filter to Replies
    const filterDropdown = findActivityFilterDropdown();
    if (filterDropdown) {
      log('Setting filter to Replies...');
      filterDropdown.click();
      await sleep(1200); // Increased wait time for dropdown to fully render

      const repliesOption = findRepliesOption();
      if (repliesOption) {
        log('Found Replies option, clicking...');
        repliesOption.click();
        await sleep(500);
        log('Filter set to Replies');
      } else {
        log('Replies option not found in dropdown');
      }
    }

    activityColumnSetup = true;
    log('Activity column setup complete');
    return true;
  }

  function findActivityItems() {
    // Find activity items that have the blue arrow icon (replies to us)
    const activityItems = Array.from(document.querySelectorAll('div[class*="x1a2a7pz x1n2onr6"]'));
    const replyItems = [];
    
    activityItems.forEach(item => {
      // Look for the blue arrow icon indicating a reply
      const blueArrow = item.querySelector('div[style*="--x-backgroundColor: #24C3FF"]');
      if (blueArrow) {
        const arrowSvg = blueArrow.querySelector('svg path[d*="M8.62523 12.5C8.5337 12.5"]');
        if (arrowSvg) {
          replyItems.push(item);
        }
      }
    });
    
    return replyItems;
  }

  function findReplyButtonInActivity(activityItem) {
    // Find the reply button within an activity item
    const replyButton = activityItem.querySelector('div[role="button"] span');
    if (replyButton && replyButton.textContent?.includes('Reply to')) {
      return replyButton.closest('div[role="button"]');
    }
    return null;
  }

  function findNewNotification() {
    const items = findNotificationItems();
    for (const item of items) {
      const href = item.getAttribute('href') || '';
      if (!href.includes('/post/')) continue;
      const id = 'notif-' + href;
      if (seenNotifications.has(id)) continue;
      return { id, element: item, href };
    }
    return null;
  }

  async function typeIntoComposer(inputEl, text) {
    inputEl.focus();
    if (inputEl.getAttribute('contenteditable') === 'true') {
      inputEl.innerHTML = '';
      inputEl.textContent = '';
    } else if ('value' in inputEl) {
      inputEl.value = '';
    }
    await sleep(150);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inputEl.getAttribute && inputEl.getAttribute('contenteditable') === 'true') {
        inputEl.textContent = (inputEl.textContent || '') + ch;
      } else if ('value' in inputEl) {
        inputEl.value += ch;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      const delay = Math.floor(Math.random() * (typingDelayRange[1] - typingDelayRange[0])) + typingDelayRange[0];
      await sleep(delay);
    }
    return true;
  }

  function findReplyButton(commentEl) {
    const candidates = Array.from(commentEl.querySelectorAll('button, div[role="button"], span'));
    return candidates.find(btn => {
      const text = btn.textContent?.toLowerCase().trim() || '';
      return text === 'reply' || text.includes('reply');
    }) || null;
  }

  function findComposer(commentEl) {
    // First, try within the comment block (if reply UI opened inline)
    const local = commentEl.querySelector('[contenteditable="true"], textarea');
    if (local) return local;
    // Fallback to global composer at the bottom/top of the page
    const global = document.querySelector('[contenteditable="true"], textarea[placeholder*="Reply"], textarea');
    return global;
  }

  function findPostButton(scopeEl) {
    const buttons = scopeEl ? Array.from(scopeEl.querySelectorAll('button, div[role="button"]')) : [];
    const globalButtons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const combined = [...buttons, ...globalButtons];
    return combined.find(btn => {
      const text = btn.textContent?.toLowerCase().trim() || '';
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      return text === 'post' || text.includes('post') || aria.includes('post');
    }) || null;
  }

  async function clickReplyForComment(commentEl) {
    const replyBtn = findReplyButton(commentEl);
    if (replyBtn) {
      replyBtn.click();
      await sleep(500);
      return true;
    }
    return false;
  }

  async function sendReply(commentEl, replyText, mentionAuthor) {
    const composedText = mentionAuthor ? '@' + mentionAuthor + ' ' + replyText : replyText;
    const composer = findComposer(commentEl);
    if (!composer) {
      log('Reply composer not found');
      return false;
    }
    const typed = await typeIntoComposer(composer, composedText);
    if (!typed) return false;
    await sleep(400);
    const postBtn = findPostButton(commentEl);
    if (postBtn) {
      postBtn.click();
      await sleep(800);
      return true;
    }
    // Fallback: Enter key
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(800);
    return true;
  }

  async function generateReply(commentText, author) {
    const rules = CONFIG?.replyRules || [];
    const lower = (commentText || '').toLowerCase();

    for (const rule of rules) {
      const matchStr = typeof rule.match === 'string' ? rule.match : '';
      const match = rule.caseSensitive ? matchStr : matchStr.toLowerCase();
      const text = rule.caseSensitive ? commentText : lower;
      if (match && text.includes(match)) {
        log('Rule matched: ' + matchStr);
        return rule.reply;
      }
    }

    const aiConfig = CONFIG?.ai;
    if (aiConfig?.enabled) {
      try {
        log('Requesting AI reply...');
        const messages = [
          { role: 'system', content: aiConfig.systemPrompt || 'You are a friendly Threads user replying to comments on your post. Keep responses brief, relevant, and casual.' },
          { role: 'user', content: 'Reply to @' + author + ': ' + commentText }
        ];
        const url = 'http://' + (aiConfig.llmEndpoint || 'localhost') + ':' + (aiConfig.llmPort || 8080) + '/v1/chat/completions';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), aiConfig.requestTimeoutMs || 30000);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: aiConfig.modelName || 'local-model',
            messages,
            temperature: aiConfig.temperature || 0.7,
            max_tokens: aiConfig.maxTokens || 150
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          const aiReply = data?.choices?.[0]?.message?.content?.trim();
          if (aiReply) {
            log('AI reply generated');
            return aiReply;
          }
        } else {
          log('AI request failed: HTTP ' + response.status);
        }
      } catch (err) {
        if (err?.name === 'AbortError') {
          log('AI request timed out');
        } else {
          log('AI error: ' + err?.message);
        }
      }
    }

    // Fallback quick responses
    if (lower.includes('?')) return "Great question! I'll think on that.";
    if (lower.includes('thank')) return "Appreciate it!";
    if (lower.includes('love')) return "Glad you enjoyed it!";
    return null;
  }

  async function processComment(comment, currentUser) {
    const msgId = comment.id;
    seenComments.add(msgId);

    const reply = await generateReply(comment.text, comment.author);
    if (!reply) {
      log('No reply generated for ' + msgId);
      return;
    }

    // Random skip
    const skipProb = CONFIG?.randomSkipProbability || 0.15;
    if (Math.random() < skipProb) {
      log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%)');
      return;
    }

    // Pre delay
    const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
    log('Waiting ' + delay + 'ms before replying');
    await sleep(delay);

    comment.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);

    // Try to open inline reply if available
    await clickReplyForComment(comment.element);

    const sent = await sendReply(comment.element, reply, comment.author);
    if (sent) {
      log('âœ“ Replied to @' + comment.author + ': ' + reply.substring(0, 60));
    } else {
      log('Failed to send reply to @' + comment.author);
    }
  }

  async function processActivityItem(activityItem, currentUser) {
    try {
      // Extract information from the activity item
      const authorLink = activityItem.querySelector('a[href^="/@"]');
      const author = authorLink?.textContent?.trim()?.replace(/^@/, '') || 'unknown';
      
      // Get the message text from the activity item
      const textSpans = Array.from(activityItem.querySelectorAll('span'));
      let messageText = '';
      for (const span of textSpans) {
        const text = span.textContent?.trim();
        if (text && text.length > MIN_COMMENT_LENGTH && !text.includes('Reply to') && !text.includes('d ago')) {
          messageText = text;
          break;
        }
      }
      
      if (!messageText || messageText.length < MIN_COMMENT_LENGTH) {
        log('No valid message text found in activity item');
        return false;
      }
      
      if (sameHandle(author, currentUser)) {
        log('Skipping own activity item');
        return false;
      }
      
      const itemId = 'activity-' + author + '-' + messageText.substring(0, 50);
      if (seenComments.has(itemId)) {
        return false;
      }
      
      seenComments.add(itemId);
      
      log('Processing activity item from @' + author + ': ' + messageText.substring(0, 60));
      
      // Generate reply
      const reply = await generateReply(messageText, author);
      if (!reply) {
        log('No reply generated for activity item');
        return false;
      }
      
      // Random skip
      const skipProb = CONFIG?.randomSkipProbability || 0.15;
      if (Math.random() < skipProb) {
        log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%)');
        return false;
      }
      
      // Pre delay
      const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
      log('Waiting ' + delay + 'ms before replying to activity');
      await sleep(delay);
      
      // Find and click the reply button
      const replyBtn = findReplyButtonInActivity(activityItem);
      if (!replyBtn) {
        log('Reply button not found in activity item');
        return false;
      }
      
      log('Clicking reply button in activity...');
      replyBtn.click();
      await sleep(1000);
      
      // Find the composer (should appear after clicking reply)
      const composer = findComposer(activityItem);
      if (!composer) {
        log('Reply composer not found after clicking activity reply');
        return false;
      }
      
      // Type the reply
      const composedText = '@' + author + ' ' + reply;
      const typed = await typeIntoComposer(composer, composedText);
      if (!typed) {
        log('Failed to type reply in activity composer');
        return false;
      }
      
      await sleep(400);
      
      // Find and click post button
      const postBtn = findPostButton(activityItem);
      if (postBtn) {
        postBtn.click();
        await sleep(800);
        log('âœ“ Replied to activity from @' + author + ': ' + reply.substring(0, 60));
        return true;
      } else {
        // Fallback: Enter key
        composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(800);
        log('âœ“ Replied to activity from @' + author + ' (Enter key): ' + reply.substring(0, 60));
        return true;
      }
    } catch (err) {
      log('Error processing activity item: ' + err);
      return false;
    }
  }

  async function poll() {
    if (!isRunning || isProcessing || isPostingScheduledContent) return;
    isProcessing = true;
    try {
      await processScheduledPosting();

      if (Date.now() < replyPauseUntil) {
        return;
      }

      // First, ensure Activity column is set up (if enabled)
      if (ACTIVITY_ENABLED) {
        const activityReady = await setupActivityColumn();
        if (!activityReady) {
          log('Activity column setup failed, falling back to post monitoring');
        } else {
          // Check for activity items (replies/comments to us)
          const activityItems = findActivityItems();
          if (activityItems.length > 0) {
            log('Found ' + activityItems.length + ' activity item(s) with replies');
            const currentUser = detectLoggedInHandle();
            
            const toProcess = activityItems.slice(0, MAX_PER_POLL);
            for (const item of toProcess) {
              if (!isRunning) break;
              if (AUTO_REPLY_ENABLED) {
                await processActivityItem(item, currentUser);
              }
              await sleep(1200);
            }
            
            // If activity priority is enabled, skip other checks when we have activity
            if (ACTIVITY_PRIORITY) {
              isProcessing = false;
              return;
            }
          }
        }
      }
      
      // Fallback to original logic for post pages
      if (!isOnPostPage()) {
        const notif = findNewNotification();
        if (notif) {
          seenNotifications.add(notif.id);
          log('Opening notification: ' + notif.href);
          notif.element.click();
          await sleep(1500);
        } else {
          log('No new notifications or activity items');
        }
        isProcessing = false;
        return;
      }

      if (!AUTO_REPLY_ENABLED) {
        return;
      }

      const currentUser = detectLoggedInHandle();
      const postAuthor = getPostAuthorHandle();
      if (currentUser && postAuthor && !sameHandle(currentUser, postAuthor)) {
        log('Skipping - open post not authored by current user');
        isProcessing = false;
        return;
      }

      const newComments = findNewComments(currentUser);
      if (!newComments || newComments.length === 0) {
        log('No new comments');
        isProcessing = false;
        return;
      }

      log('Found ' + newComments.length + ' new comment(s)');
      const toProcess = newComments.slice(0, MAX_PER_POLL);
      for (const c of toProcess) {
        if (!isRunning) break;
        await processComment(c, currentUser);
        await sleep(1200);
      }
    } catch (err) {
      log('Poll error: ' + err);
    } finally {
      isProcessing = false;
    }
  }

  function stop() {
    isRunning = false;
    if (pollInterval) clearInterval(pollInterval);
    if (schedulerInterval) clearInterval(schedulerInterval);
    if (refreshInterval) clearTimeout(refreshInterval);
    try {
      sessionStorage.removeItem(STARTUP_REFRESH_KEY);
    } catch {}
    window.__SNAPPY_RUNNING__ = false;
    window.__SNAPPY_THREADS_RUNNING__ = false;
    log('Threads bot stopped');
  }

  // Start polling and refresh scheduler
  log('Threads bot started');
  log('Scheduler status: enabled=' + SCHEDULER_ENABLED + ', posts=' + getSchedulerPosts().length + ', now=' + new Date().toLocaleTimeString());
  log('Scheduler today: ' + describeTodaySchedule());
  poll();
  pollInterval = setInterval(poll, POLL_MS);
  if (SCHEDULER_ENABLED) {
    log('Scheduler enabled, posts=' + getSchedulerPosts().length);
    processScheduledPosting();
    schedulerInterval = setInterval(() => {
      processScheduledPosting();
    }, 30000);
  }
  scheduleNextRefresh();

  window.__SNAPPY_STOP__ = stop;
})();
`;
}



