/**
 * Renderer - Settings Panel with Activity Log
 */

// Inline essential functions to avoid CommonJS imports in browser
function detectSiteFromHost(hostname: string | null | undefined): string {
  if (!hostname) return 'unknown';
  const host = hostname.toLowerCase();
  if (host.includes('threads.net') || host.includes('threads.com')) return 'threads';
  if (host.includes('reddit.com')) return 'reddit';
  if (host.includes('snapchat.com')) return 'snapchat';
  if (host.includes('instagram.com')) return 'instagram';
  return 'unknown';
}

// Inlined Threads bot script (avoiding ES6 imports in browser context)
function buildThreadsBotScript(config: any): string {
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
  const seenComments = new Set();
  const seenNotifications = new Set();
  let isRunning = true;
  let pollTimer = null;
  let isProcessing = false;
  let refreshInterval = null;
  const MIN_COMMENT_LENGTH = 3;
  const POLL_MS = (CONFIG?.threads && CONFIG.threads.pollIntervalMs) || 60000;
  const MAX_PER_POLL = (CONFIG?.threads && CONFIG.threads.maxCommentsPerPoll) || 5;
  const ACTIVITY_ENABLED = (CONFIG?.threads && CONFIG.threads.activityColumnEnabled) !== false;
  const ACTIVITY_PRIORITY = (CONFIG?.threads && CONFIG.threads.activityPriority) !== false;
  const typingDelayRange = CONFIG?.typingDelayRangeMs || [50, 150];
  const preReplyDelayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];
  let activityColumnSetup = false;
  function scheduleNextRefresh() {
    const refreshDelay = Math.floor(Math.random() * 6000) + 2000;
    refreshInterval = setTimeout(() => {
      if (!isRunning) {
        log('Skipping refresh - bot stopped');
        return;
      }
      if (!isProcessing) {
        log('Refreshing page (no processing in progress)');
        location.reload();
      } else {
        log('Skipping refresh - processing in progress');
        scheduleNextRefresh();
      }
    }, refreshDelay);
  }
  function log(msg) {
    const formatted = '[Snappy][Threads] ' + msg;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function detectLoggedInHandle() {
    const anchors = Array.from(document.querySelectorAll('a[href^="/@"]'));
    for (const a of anchors) {
      const txt = a.textContent?.trim();
      if (txt && txt.length > 1 && txt.startsWith('@')) return txt.replace(/^@/, '');
    }
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
  function sameHandle(a, b) { return (a || '').toLowerCase().trim() === (b || '').toLowerCase().trim(); }
  function extractCommentText(commentEl) {
    const textNodes = [];
    commentEl.querySelectorAll('span, p').forEach(node => {
      const t = node.textContent?.trim();
      if (t) textNodes.push(t);
    });
    if (textNodes.length > 0) {
      const combined = textNodes.join(' ').trim();
      if (combined.length >= MIN_COMMENT_LENGTH) return combined.substring(0, 500);
    }
    return (commentEl.textContent?.trim() || '').substring(0, 500);
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
    const main = document.querySelector('main') || document.body;
    if (!main) return [];
    return Array.from(main.querySelectorAll('article')).slice(1);
  }
  function findNewComments(currentUser) {
    const comments = [];
    findCommentElements().forEach(el => {
      const author = extractCommentAuthor(el);
      const text = extractCommentText(el);
      if (!author || !text || text.length < MIN_COMMENT_LENGTH) return;
      if (sameHandle(author, currentUser)) return;
      const id = extractCommentId(el);
      if (seenComments.has(id)) return;
      comments.push({ id, author, text, element: el });
    });
    return comments;
  }
  function isOnPostPage() { return findCommentElements().length > 0; }
  function findNotificationItems() {
    const links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
    return links.filter(link => (link.textContent || '').toLowerCase().includes('comment'));
  }
  function isActivityColumnOpen() {
    return Array.from(document.querySelectorAll('a[href="/"]')).some(link =>
      link.textContent?.trim().toLowerCase() === 'activity'
    );
  }
  function findAddColumnButton() {
    return Array.from(document.querySelectorAll('div[role="button"]')).find(btn =>
      btn.querySelector('svg[aria-label="Add a column"]')
    );
  }
  function findActivityOption() {
    const spans = Array.from(document.querySelectorAll('span.x1lliihq.x193iq5w.x6ikm8r.x10wlt62.xlyipyv.xuxw1ft'));
    const activitySpan = spans.find(span => span.textContent?.trim().toLowerCase() === 'activity');
    if (activitySpan) {
      let parent = activitySpan.parentElement;
      while (parent) {
        if (parent.getAttribute('role') === 'button' || parent.getAttribute('tabindex') === '0') return parent;
        const classes = parent.className || '';
        if (classes.includes('x78zum5') && classes.includes('xdt5ytf')) return parent;
        parent = parent.parentElement;
      }
      return activitySpan.closest('[role="button"], a, button') || activitySpan.parentElement;
    }
    return Array.from(document.querySelectorAll('a[href="/"]')).find(link =>
      link.textContent?.trim().toLowerCase() === 'activity'
    );
  }
  function findActivityFilterDropdown() {
    const buttons = Array.from(document.querySelectorAll('div[role="button"][aria-expanded][aria-haspopup="menu"]'));
    return buttons.find(btn => {
      const svg = btn.querySelector('svg[aria-label="All"]');
      return svg !== null;
    });
  }
  function findRepliesOption() {
    const allSpans = Array.from(document.querySelectorAll('span'));
    log('Searching through ' + allSpans.length + ' spans for "Replies"');
    const repliesSpan = allSpans.find(span => span.textContent?.trim() === 'Replies');
    if (repliesSpan) {
      log('Found Replies span');
      let current = repliesSpan;
      for (let i = 0; i <= 5; i++) {
        const role = current.getAttribute('role');
        const tabindex = current.getAttribute('tabindex');
        log('Depth ' + i + ': tag=' + current.tagName + ', role=' + role + ', tabindex=' + tabindex);
        if (role === 'menuitem' || role === 'button' || tabindex === '0') {
          log('Returning clickable element at depth ' + i);
          return current;
        }
        if (!current.parentElement) break;
        current = current.parentElement;
      }
      log('No explicit clickable found, returning span parent');
      return repliesSpan.parentElement || repliesSpan;
    }
    log('Replies span not found');
    return null;
  }
  async function setupActivityColumn() {
    if (!ACTIVITY_ENABLED) { log('Activity column disabled in config'); return false; }
    log('Checking if Activity column is open...');
    if (isActivityColumnOpen()) {
      if (!activityColumnSetup) { log('Activity column already open, setting filter...'); }
      else { log('Activity column open, ensuring filter is set...'); }
      const filterDropdown = findActivityFilterDropdown();
      if (filterDropdown) {
        log('Setting filter to Replies...');
        filterDropdown.click();
        await sleep(1200);
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
    const addColumnBtn = findAddColumnButton();
    if (!addColumnBtn) { log('Add column button not found'); return false; }
    log('Clicking Add Column button...'); addColumnBtn.click(); await sleep(1000);
    const activityOption = findActivityOption();
    if (!activityOption) { log('Activity option not found'); return false; }
    log('Clicking Activity option...'); activityOption.click(); await sleep(1500);
    const filterDropdown = findActivityFilterDropdown();
    if (filterDropdown) {
      log('Setting filter to Replies...');
      filterDropdown.click();
      await sleep(800);
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
    activityColumnSetup = true; log('Activity column setup complete'); return true;
  }
  function findActivityItems() {
    const activityItems = Array.from(document.querySelectorAll('div[class*="x1a2a7pz x1n2onr6"]'));
    const replyItems = [];
    activityItems.forEach(item => {
      const blueArrow = item.querySelector('div[style*="--x-backgroundColor: #24C3FF"]');
      if (blueArrow && blueArrow.querySelector('svg path[d*="M8.62523 12.5C8.5337 12.5"]')) {
        replyItems.push(item);
      }
    });
    return replyItems;
  }
  function findReplyButtonInActivity(activityItem) {
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
    if (inputEl.getAttribute('contenteditable') === 'true') { inputEl.innerHTML = ''; inputEl.textContent = ''; }
    else if ('value' in inputEl) { inputEl.value = ''; }
    await sleep(150);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inputEl.getAttribute && inputEl.getAttribute('contenteditable') === 'true') {
        inputEl.textContent = (inputEl.textContent || '') + ch;
      } else if ('value' in inputEl) { inputEl.value += ch; }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      const delay = Math.floor(Math.random() * (typingDelayRange[1] - typingDelayRange[0])) + typingDelayRange[0];
      await sleep(delay);
    }
    return true;
  }
  function findReplyButton(commentEl) {
    return Array.from(commentEl.querySelectorAll('button, div[role="button"], span')).find(btn => {
      const text = btn.textContent?.toLowerCase().trim() || '';
      return text === 'reply' || text.includes('reply');
    }) || null;
  }
  function findComposer(commentEl) {
    const local = commentEl.querySelector('[contenteditable="true"], textarea');
    if (local) return local;
    return document.querySelector('[contenteditable="true"], textarea[placeholder*="Reply"], textarea');
  }
  function findPostButton(scopeEl) {
    const buttons = scopeEl ? Array.from(scopeEl.querySelectorAll('button, div[role="button"]')) : [];
    const globalButtons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    return [...buttons, ...globalButtons].find(btn => {
      const text = btn.textContent?.toLowerCase().trim() || '';
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      return text === 'post' || text.includes('post') || aria.includes('post');
    }) || null;
  }
  async function clickReplyForComment(commentEl) {
    const replyBtn = findReplyButton(commentEl);
    if (replyBtn) { replyBtn.click(); await sleep(500); return true; }
    return false;
  }
  async function sendReply(commentEl, replyText, mentionAuthor) {
    const composedText = mentionAuthor ? '@' + mentionAuthor + ' ' + replyText : replyText;
    const composer = findComposer(commentEl);
    if (!composer) { log('Reply composer not found'); return false; }
    const typed = await typeIntoComposer(composer, composedText);
    if (!typed) return false;
    await sleep(400);
    const postBtn = findPostButton(commentEl);
    if (postBtn) { postBtn.click(); await sleep(800); return true; }
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
      if (match && text.includes(match)) { log('Rule matched: ' + matchStr); return rule.reply; }
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
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: aiConfig.modelName || 'local-model', messages, temperature: aiConfig.temperature || 0.7, max_tokens: aiConfig.maxTokens || 150 }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          const aiReply = data?.choices?.[0]?.message?.content?.trim();
          if (aiReply) { log('AI reply generated'); return aiReply; }
        } else { log('AI request failed: HTTP ' + response.status); }
      } catch (err) {
        if (err?.name === 'AbortError') { log('AI request timed out'); }
        else { log('AI error: ' + err?.message); }
      }
    }
    if (lower.includes('?')) return "Great question! I'll think on that.";
    if (lower.includes('thank')) return "Appreciate it!";
    if (lower.includes('love')) return "Glad you enjoyed it!";
    return null;
  }
  async function processComment(comment, currentUser) {
    seenComments.add(comment.id);
    const reply = await generateReply(comment.text, comment.author);
    if (!reply) { log('No reply generated for ' + comment.id); return; }
    const skipProb = CONFIG?.randomSkipProbability || 0.15;
    if (Math.random() < skipProb) { log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%)'); return; }
    const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
    log('Waiting ' + delay + 'ms before replying'); await sleep(delay);
    comment.element.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(400);
    await clickReplyForComment(comment.element);
    const sent = await sendReply(comment.element, reply, comment.author);
    if (sent) { log('✓ Replied to @' + comment.author + ': ' + reply.substring(0, 60)); }
    else { log('Failed to send reply to @' + comment.author); }
  }
  async function processActivityItem(activityItem, currentUser) {
    try {
      const authorLink = activityItem.querySelector('a[href^="/@"]');
      const author = authorLink?.textContent?.trim()?.replace(/^@/, '') || 'unknown';
      const textSpans = Array.from(activityItem.querySelectorAll('span'));
      let messageText = '';
      for (const span of textSpans) {
        const text = span.textContent?.trim();
        if (text && text.length > MIN_COMMENT_LENGTH && !text.includes('Reply to') && !text.includes('d ago')) {
          messageText = text; break;
        }
      }
      if (!messageText || messageText.length < MIN_COMMENT_LENGTH) { log('No valid message text found in activity item'); return false; }
      if (sameHandle(author, currentUser)) { log('Skipping own activity item'); return false; }
      const itemId = 'activity-' + author + '-' + messageText.substring(0, 50);
      if (seenComments.has(itemId)) return false;
      seenComments.add(itemId);
      log('Processing activity item from @' + author + ': ' + messageText.substring(0, 60));
      const reply = await generateReply(messageText, author);
      if (!reply) { log('No reply generated for activity item'); return false; }
      const skipProb = CONFIG?.randomSkipProbability || 0.15;
      if (Math.random() < skipProb) { log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%)'); return false; }
      const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
      log('Waiting ' + delay + 'ms before replying to activity'); await sleep(delay);
      const replyBtn = findReplyButtonInActivity(activityItem);
      if (!replyBtn) { log('Reply button not found in activity item'); return false; }
      log('Clicking reply button in activity...'); replyBtn.click(); await sleep(1000);
      const composer = findComposer(activityItem);
      if (!composer) { log('Reply composer not found after clicking activity reply'); return false; }
      const composedText = '@' + author + ' ' + reply;
      const typed = await typeIntoComposer(composer, composedText);
      if (!typed) { log('Failed to type reply in activity composer'); return false; }
      await sleep(400);
      const postBtn = findPostButton(activityItem);
      if (postBtn) {
        postBtn.click(); await sleep(800);
        log('✓ Replied to activity from @' + author + ': ' + reply.substring(0, 60));
        return true;
      } else {
        composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(800);
        log('✓ Replied to activity from @' + author + ' (Enter key): ' + reply.substring(0, 60));
        return true;
      }
    } catch (err) { log('Error processing activity item: ' + err); return false; }
  }
  async function poll() {
    if (!isRunning) return;
    if (isProcessing) return;
    isProcessing = true;
    try {
      if (ACTIVITY_ENABLED) {
        const activityReady = await setupActivityColumn();
        if (!activityReady) { log('Activity column setup failed, falling back to post monitoring'); }
        else {
          const activityItems = findActivityItems();
          if (activityItems.length > 0) {
            log('Found ' + activityItems.length + ' activity item(s) with replies');
            const currentUser = detectLoggedInHandle();
            const toProcess = activityItems.slice(0, MAX_PER_POLL);
            for (const item of toProcess) {
              if (!isRunning) break;
              await processActivityItem(item, currentUser);
              await sleep(1200);
            }
            if (ACTIVITY_PRIORITY) { isProcessing = false; return; }
          }
        }
      }
      if (!isOnPostPage()) {
        const notif = findNewNotification();
        if (notif) { seenNotifications.add(notif.id); log('Opening notification: ' + notif.href); notif.element.click(); await sleep(1500); }
        else { log('No new notifications or activity items'); }
        isProcessing = false; return;
      }
      const currentUser = detectLoggedInHandle();
      const postAuthor = getPostAuthorHandle();
      if (currentUser && postAuthor && !sameHandle(currentUser, postAuthor)) {
        log('Skipping - open post not authored by current user'); isProcessing = false; return;
      }
      const newComments = findNewComments(currentUser);
      if (!newComments || newComments.length === 0) { log('No new comments'); isProcessing = false; return; }
      log('Found ' + newComments.length + ' new comment(s)');
      const toProcess = newComments.slice(0, MAX_PER_POLL);
      for (const c of toProcess) {
        if (!isRunning) break;
        await processComment(c, currentUser);
        await sleep(1200);
      }
    } catch (err) { log('Poll error: ' + err); }
    finally { isProcessing = false; }
  }
  function stop() {
    isRunning = false;
    if (pollInterval) clearInterval(pollInterval);
    if (refreshInterval) clearTimeout(refreshInterval);
    window.__SNAPPY_RUNNING__ = false;
    window.__SNAPPY_THREADS_RUNNING__ = false;
    log('Threads bot stopped');
  }
  log('🚀 Threads bot started');
  poll();
  pollInterval = setInterval(poll, POLL_MS);
  scheduleNextRefresh();
  window.__SNAPPY_STOP__ = stop;
})();
`;
}

function buildRedditFallbackBotScript(config: any): string {
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
  let isRunning = true;
  let pollInterval = null;
  let isProcessing = false;
  let nextSubredditCheckAt = 0;
  let lastPmCheckAt = 0;
  const seen = new Set();

  const MIN_SUBREDDIT_CHECK_MS = 5 * 60 * 1000;
  const MAX_SUBREDDIT_CHECK_MS = 60 * 60 * 1000;
  const PM_CHECK_DEBOUNCE_MS = 15000;
  const MIN_POLL_MS = 1000;
  const MAX_POLL_MS = 60000;

  const settings = {
    watchPrivateMessages: true,
    readPrivateMessages: true,
    watchSubreddits: [],
    subredditKeywords: [],
    authCookieString: '',
    sessionCookie: '',
    pollIntervalMs: 30000,
    maxItemsPerPoll: (CONFIG?.reddit && CONFIG.reddit.maxCommentsPerPoll) || 3,
    ...(CONFIG?.reddit || {})
  };

  function log(msg) {
    const formatted = '[Snappy][Reddit] ' + msg;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomRange(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function scheduleNextSubredditCheck() {
    const waitMs = randomRange(MIN_SUBREDDIT_CHECK_MS, MAX_SUBREDDIT_CHECK_MS);
    nextSubredditCheckAt = Date.now() + waitMs;
    log('Next subreddit check in ~' + Math.round(waitMs / 60000) + ' minute(s)');
  }

  function normalizeSubreddit(name) {
    if (!name || typeof name !== 'string') return '';
    return name.trim().replace(/^r\\//i, '').replace(/^\\/+|\\/+$/g, '');
  }

  function matchesKeywords(title, selftext) {
    const keywords = settings.subredditKeywords || [];
    if (!keywords.length) return true;
    const text = ((title || '') + ' ' + (selftext || '')).toLowerCase();
    return keywords.some(k => text.includes(String(k || '').toLowerCase()));
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

  function shouldReadPrivateMessages() {
    return settings.watchPrivateMessages !== false && settings.readPrivateMessages !== false;
  }

  function shouldOpenChatOnStart() {
    return settings.watchPrivateMessages !== false && settings.autoReplyToPMs !== false;
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
        const key = 'pm:' + pmId;
        if (!pmId || seen.has(key)) return;
        seen.add(key);
        const summary = extractPmSummary(item);
        const subjectPart = summary.subject ? ' [' + summary.subject + ']' : '';
        log('PM from u/' + summary.author + subjectPart + ': ' + summary.preview);
      });
    } catch (e) {
      log('Error reading PM inbox: ' + e);
    }
  }

  function deepQueryAll(selector) {
    const out = [];
    const seenNodes = new Set();

    function walk(root) {
      if (!root || seenNodes.has(root)) return;
      seenNodes.add(root);

      try {
        root.querySelectorAll(selector).forEach(node => out.push(node));
      } catch (e) {
        // ignore invalid selector cases
      }

      let all = [];
      try {
        all = root.querySelectorAll('*');
      } catch (e) {
        all = [];
      }
      all.forEach(node => {
        if (node.shadowRoot) {
          walk(node.shadowRoot);
        }
      });
    }

    walk(document);
    return out;
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
        const txt = String(node.textContent || '').trim().replace(/^u\\//i, '');
        if (txt && txt.length > 1 && !txt.includes('open')) return txt.toLowerCase();
      }
    }
    return '';
  }

  function getLatestIncomingChatMessage() {
    const own = detectOwnUsername();
    const messageNodes = deepQueryAll('.room-message[aria-label*=" said "]');
    if (!messageNodes.length) return null;

    for (let i = messageNodes.length - 1; i >= 0; i--) {
      const node = messageNodes[i];
      const aria = String(node.getAttribute('aria-label') || '');
      const match = aria.match(/^(.+?)\\s+said\\s+/i);
      const authorRaw = match ? match[1] : '';
      const author = String(authorRaw || '').trim().replace(/^u\\//i, '');
      if (!author) continue;
      if (own && author.toLowerCase() === own) continue;

      let text = '';
      const textEls = node.querySelectorAll('.room-message-text');
      textEls.forEach(el => {
        const t = String(el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t) text = t;
      });
      if (!text) {
        const t = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
        text = t;
      }
      if (!text || text.length < 2) continue;
      return { author, text: text.substring(0, 500) };
    }

    return null;
  }

  async function waitForAiReply(requestId, timeoutMs) {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
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
    const rules = Array.isArray(CONFIG?.replyRules) ? CONFIG.replyRules : [];
    const lower = String(messageText || '').toLowerCase();
    for (const rule of rules) {
      const matchStr = typeof rule.match === 'string' ? rule.match : '';
      const match = rule.caseSensitive ? matchStr : matchStr.toLowerCase();
      const target = rule.caseSensitive ? messageText : lower;
      if (match && target.includes(match)) {
        return String(rule.reply || '').trim() || null;
      }
    }

    if (CONFIG?.ai?.enabled) {
      try {
        const reqId = 'rd-chat-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
        window.__SNAPPY_AI_REQUEST__ = {
          id: reqId,
          username: username || 'reddit_user',
          messages: [{ role: 'user', content: String(messageText || '').trim() }]
        };
        const timeoutMs = Number(CONFIG?.ai?.requestTimeoutMs) || 30000;
        const reply = await waitForAiReply(reqId, timeoutMs);
        if (reply && String(reply).trim()) return String(reply).trim();
      } catch (e) {
        log('AI chat reply generation failed: ' + e);
      }
    }

    return 'Thanks for the message.';
  }

  async function sendChatReply(text) {
    const inputSelectors = [
      'textarea[name="text"]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]'
    ];

    let input = null;
    for (const selector of inputSelectors) {
      const nodes = deepQueryAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (!node.offsetParent && node.getAttribute('contenteditable') !== 'true') continue;
        input = node;
        break;
      }
      if (input) break;
    }
    if (!input) {
      log('Chat input not found for reply');
      return false;
    }

    input.focus();
    if (input.getAttribute('contenteditable') === 'true') {
      input.textContent = '';
    } else if (Object.prototype.hasOwnProperty.call(input, 'value')) {
      input.value = '';
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const delays = CONFIG?.typingDelayRangeMs || [10, 35];
    const minDelay = Number(delays[0]) || 10;
    const maxDelay = Number(delays[1]) || 35;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true, cancelable: true }));

      if (input.getAttribute('contenteditable') === 'true') {
        if (document.execCommand) {
          try { document.execCommand('insertText', false, char); } catch (e) { input.textContent = (input.textContent || '') + char; }
        } else {
          input.textContent = (input.textContent || '') + char;
        }
      } else if (Object.prototype.hasOwnProperty.call(input, 'value')) {
        input.value += char;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true, cancelable: true }));
      const delay = Math.floor(Math.random() * Math.max(1, (maxDelay - minDelay + 1))) + minDelay;
      await sleep(delay);
    }
    await sleep(180);

    const buttonSelectors = [
      'button[aria-label*="send" i]',
      'button[data-testid*="send"]',
      'button[type="submit"]'
    ];
    for (const selector of buttonSelectors) {
      const btns = deepQueryAll(selector);
      for (const btn of btns) {
        if (!(btn instanceof HTMLElement)) continue;
        btn.click();
        return true;
      }
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  }

  function getUnreadConversationCandidates() {
    const candidates = [];
    const seenKeys = new Set();

    // Primary path: conversation links with nearby unread badge/marker.
    const convoLinks = deepQueryAll('a[href*="/message/messages/"]');
    convoLinks.forEach(link => {
      if (!(link instanceof HTMLElement)) return;
      let container = link;
      for (let i = 0; i < 5; i++) {
        if (!container.parentElement) break;
        container = container.parentElement;
      }

      const hasUnreadBadge =
        !!link.querySelector('.notifications-badge') ||
        !!container.querySelector('.notifications-badge') ||
        /unread/i.test(String(link.getAttribute('aria-label') || '')) ||
        /unread/i.test(String(container.getAttribute('aria-label') || ''));

      if (!hasUnreadBadge) return;
      const txt = String(link.textContent || container.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!txt || /^\\d+$/.test(txt)) return;
      const key = (link.getAttribute('href') || '') + '|' + txt.substring(0, 160);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      candidates.push(link);
    });

    if (candidates.length > 0) return candidates;

    const markers = [
      '.notifications-badge',
      '[aria-label*="unread" i]',
      '[data-unread="true"]',
      '[data-is-unread="true"]',
      '[class*="unread"]'
    ];

    markers.forEach(selector => {
      const nodes = deepQueryAll(selector);
      nodes.forEach(node => {
        let container =
          node.closest('a[href*="/message/messages/"]') ||
          node.closest('[role="button"]') ||
          node.closest('button') ||
          node.closest('li') ||
          node.closest('div');
        if (!container || !(container instanceof HTMLElement)) return;

        // Prefer a direct conversation link target if present inside the resolved container.
        const convoLink = container.querySelector('a[href*="/message/messages/"]');
        if (convoLink && convoLink instanceof HTMLElement) {
          container = convoLink;
        }

        const txt = String(container.textContent || '').replace(/\\s+/g, ' ').trim();
        // Avoid badge-only candidates like "1".
        if (!txt || /^\\d+$/.test(txt)) return;

        const key = (container.getAttribute('href') || '') + '|' + txt.substring(0, 160);
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        candidates.push(container);
      });
    });

    return candidates;
  }

  function extractConversationAuthor(container) {
    const profileAnchor = container.querySelector('a[href*="/user/"]');
    if (profileAnchor) {
      const href = String(profileAnchor.getAttribute('href') || '');
      const match = href.match(/\\/user\\/([^/?#]+)/i);
      if (match && match[1]) return decodeURIComponent(match[1]).replace(/^u\\//i, '');
      const label = String(profileAnchor.getAttribute('aria-label') || '');
      const labelMatch = label.match(/view profile of user\\s+(.+)$/i);
      if (labelMatch && labelMatch[1]) return labelMatch[1].trim().replace(/^u\\//i, '');
    }

    const nameSelectors = ['.user-name', '[class*="user-name"]', '[aria-label*="View profile of user"]'];
    for (const selector of nameSelectors) {
      const node = container.querySelector(selector);
      const txt = String(node?.textContent || '').replace(/\\s+/g, ' ').trim();
      if (txt && !/^\\d+$/.test(txt)) return txt.replace(/^u\\//i, '');
    }
    const text = String(container.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) return '';
    const parts = text.split(' ').filter(p => p && !/^\\d+$/.test(p));
    return parts[0] ? parts[0].replace(/^u\\//i, '') : '';
  }

  function clickConversationElement(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      // ignore
    }
    try {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.click();
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function ensureThreadsTab() {
    const candidates = deepQueryAll('button, a, [role="tab"], [role="button"], faceplate-tab');
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const txt = String(node.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      if (!txt) continue;
      if (txt === 'threads' || txt.startsWith('threads ')) {
        node.click();
        log('Focused Threads tab');
        return true;
      }
    }
    return false;
  }

  async function processUnreadChatMessage() {
    if (!shouldReadPrivateMessages()) return;
    if (settings.autoReplyToPMs === false) return;

    ensureThreadsTab();
    await sleep(250);

    const unreadConversations = getUnreadConversationCandidates();
    if (unreadConversations.length > 0) {
      log('Unread conversations detected: ' + unreadConversations.length);
    }
    if (!unreadConversations.length) return;

    const conversation = unreadConversations[0];
    const convoAuthor = extractConversationAuthor(conversation) || 'reddit_user';
    const convoKey = 'chat-thread:' + convoAuthor.toLowerCase() + ':' + String(conversation.textContent || '').substring(0, 120);
    if (seen.has(convoKey)) return;

    const clicked = clickConversationElement(conversation);
    if (!clicked) {
      log('Failed to click unread conversation candidate');
      return;
    }
    const preview = String(conversation.textContent || '').replace(/\\s+/g, ' ').trim().substring(0, 80);
    log('Clicked unread conversation for u/' + convoAuthor + ' [' + preview + ']');
    await sleep(900);

    const latest = getLatestIncomingChatMessage();
    if (!latest) return;

    const messageKey = 'chat-msg:' + latest.author.toLowerCase() + ':' + latest.text.substring(0, 200);
    if (seen.has(messageKey)) return;

    const reply = await generatePmReply(latest.text, latest.author);
    if (!reply) return;

    const sent = await sendChatReply(reply);
    if (sent) {
      seen.add(convoKey);
      seen.add(messageKey);
      log('Replied to chat from u/' + latest.author + ': ' + reply.substring(0, 80));
      await sleep(300);
      ensureThreadsTab();
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
        log('Selected \"New\" filter in r/' + subreddit);
        return true;
      }
    }
    return false;
  }

  async function checkRandomSubreddit(forceAll) {
    applyManualAuthCookies();
    const list = Array.isArray(settings.watchSubreddits) ? settings.watchSubreddits : [];
    const subreddits = list.map(normalizeSubreddit).filter(Boolean);
    if (!subreddits.length || (!forceAll && Date.now() < nextSubredditCheckAt)) return;

    const targets = forceAll ? subreddits : [subreddits[randomRange(0, subreddits.length - 1)]];
    const limit = Math.max(1, Number(settings.maxItemsPerPoll) || 3);

    try {
      for (const subreddit of targets) {
        const clickedNew = tryClickNewSortForSubreddit(subreddit);
        if (!clickedNew) {
          log('New filter click not available in current view for r/' + subreddit + '; using /new feed');
        }
        const url = 'https://www.reddit.com/r/' + encodeURIComponent(subreddit) + '/new.json?limit=' + limit;
        log('Checking r/' + subreddit + ' sorted by new');
        const response = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } });
        if (!response.ok) {
          log('Subreddit check failed (HTTP ' + response.status + ')');
          continue;
        }
        const payload = await response.json();
        const children = payload?.data?.children || [];
        const matches = [];
        for (const child of children) {
          const post = child?.data;
          if (!post || !matchesKeywords(post.title, post.selftext)) continue;
          const id = (post.name || post.permalink || post.title || '').toString();
          if (seen.has(id)) continue;
          seen.add(id);
          matches.push(post);
        }

        if (matches.length > 0) {
          log('Found ' + matches.length + ' new post(s) in r/' + subreddit);
        } else {
          log('No new matching posts in r/' + subreddit);
        }
      }
    } catch (e) {
      log('Subreddit check error: ' + e);
    } finally {
      scheduleNextSubredditCheck();
    }
  }

  async function openChatAndCheckUnread() {
    if (!shouldOpenChatOnStart()) return;

    const chatButtonSelectors = [
      '#header-action-item-chat-button',
      '[data-testid=\"chat-button\"]',
      'button[id*=\"chat-button\"]',
      'a[href*=\"/message/inbox\"]',
      'a[href*=\"/message/messages\"]',
      'a[href*=\"/chat\"]',
      'button[aria-label*=\"open chat\" i]',
      'button[aria-label*=\"chat\" i]'
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
      const unreadEls = Array.from(document.querySelectorAll('.unread, [data-unread=\"true\"], .message.unread'));
      if (unreadEls.length > 0) {
        log('Unread messages in UI: ' + unreadEls.length);
      }
    }

    await processUnreadChatMessage();
  }

  async function poll() {
    if (!isRunning || isProcessing) return;
    isProcessing = true;
    try {
      await processUnreadChatMessage();
      await checkRandomSubreddit(false);
    } finally {
      isProcessing = false;
    }
  }

  function scheduleNextPoll() {
    if (!isRunning) return;
    const delay = randomRange(MIN_POLL_MS, MAX_POLL_MS);
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

  log('Reddit bot started (fallback)');
  if (String(settings.authCookieString || '').trim() || String(settings.sessionCookie || '').trim()) {
    log('Manual Reddit auth cookies configured');
  }
  applyManualAuthCookies();
  scheduleNextSubredditCheck();
  openChatAndCheckUnread().then(() => checkRandomSubreddit(true)).catch(e => {
    log('Startup Reddit checks error: ' + e);
  });
  poll();
  scheduleNextPoll();
  window.__SNAPPY_STOP__ = stop;
})();
`;
}

function buildRedditBotScript(config: any): string {
  const req = (window as any).require;
  if (typeof req !== 'function') {
    return `
(function() {
  console.error('[Snappy][Reddit] Module load failed: window.require is unavailable');
  window.dispatchEvent(new CustomEvent('snappy-log', {
    detail: { message: '[Snappy][Reddit] Module load failed: window.require is unavailable', timestamp: Date.now() }
  }));
})();
`;
  }

  try {
    const redditModule = req('../injection/redditBot');
    if (redditModule && typeof redditModule.buildRedditBotScript === 'function') {
      return redditModule.buildRedditBotScript(config);
    }
    return `
(function() {
  console.error('[Snappy][Reddit] Module load failed: buildRedditBotScript export missing');
  window.dispatchEvent(new CustomEvent('snappy-log', {
    detail: { message: '[Snappy][Reddit] Module load failed: buildRedditBotScript export missing', timestamp: Date.now() }
  }));
})();
`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `
(function() {
  console.error('[Snappy][Reddit] Module load failed: ${message}');
  window.dispatchEvent(new CustomEvent('snappy-log', {
    detail: { message: '[Snappy][Reddit] Module load failed: ${message}', timestamp: Date.now() }
  }));
})();
`;
  }
}
function buildInstagramBotScript(config: any): string {
  const serializedConfig = JSON.stringify(config || {});
  return `
(function() {
  if (window.__SNAPPY_RUNNING__ && window.__SNAPPY_INSTAGRAM_RUNNING__) {
    console.log('[Snappy][Instagram] Already running');
    return;
  }

  window.__SNAPPY_RUNNING__ = true;
  window.__SNAPPY_INSTAGRAM_RUNNING__ = true;

  const CONFIG = ${serializedConfig};
  const seenMessages = new Set();
  let isRunning = true;
  let pollInterval = null;
  let isProcessing = false;

  const MIN_MESSAGE_LENGTH = 2;
  const BASE_POLL_MS = (CONFIG?.instagram && CONFIG.instagram.pollIntervalMs) || 3000;
  const POLL_VARIANCE_MS = 2000; // Random variance for more natural scanning
  const typingDelayRange = CONFIG?.typingDelayRangeMs || [50, 150];
  const preReplyDelayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];

  function getRandomPollInterval() {
    return BASE_POLL_MS + Math.floor(Math.random() * POLL_VARIANCE_MS);
  }

  function log(msg) {
    const formatted = '[Snappy][Instagram] ' + msg;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract message text from a row element
   * Instagram wraps each message in many divs, but the real message is always 
   * the innermost div with dir="auto" that contains readable text.
   */
  function getMessageText(row) {
    // Look for div with dir="auto" which contains the actual message text
    const messageDiv = row.querySelector('div[dir="auto"]');
    if (messageDiv) {
      const text = messageDiv.innerText.trim();
      if (text) {
        log('Extracted text from dir="auto": "' + text.substring(0, 50) + '..."');
        return text;
      }
    }
    
    // If this element IS a dir="auto" div, get its text directly
    if (row.getAttribute('dir') === 'auto') {
      const text = row.innerText.trim();
      if (text) {
        log('Extracted text from dir="auto" element: "' + text.substring(0, 50) + '..."');
        return text;
      }
    }
    
    // Fallback to span if dir="auto" not found
    const span = row.querySelector('span');
    if (span) {
      const text = span.innerText.trim();
      if (text) {
        log('Extracted text from span: "' + text.substring(0, 50) + '..."');
        return text;
      }
    }
    
    log('No text found in element');
    return null;
  }

  /**
   * Detect if a message is incoming (not sent by us)
   * Instagram doesn't label this cleanly, but here's the reliable heuristic:
   * Incoming messages are left aligned and do NOT have "Seen" or "Delivered" nearby
   */
  function isIncoming(row) {
    return !row.innerText.includes('Seen') && !row.innerText.includes('Delivered');
  }

  /**
   * Check for new incoming messages and process them
   */
  function checkForNewMessages() {
    const messages = document.querySelectorAll('div[role="row"]');
    
    for (const row of messages) {
      const messageText = getMessageText(row);
      
      // Skip if no text, empty text, or too short
      if (!messageText || messageText.length < MIN_MESSAGE_LENGTH) {
        continue;
      }
      
      // Skip if not incoming message
      if (!isIncoming(row)) {
        continue;
      }
      
      // Create unique message ID
      const messageId = 'msg-' + messageText.substring(0, 100).replace(/\s+/g, '-');
      
      // Skip if we've already seen this message
      if (seenMessages.has(messageId)) {
        continue;
      }
      
      // Mark as seen immediately to prevent duplicate processing
      seenMessages.add(messageId);
      
      log('New incoming message detected: "' + messageText.substring(0, 50) + '..."');
      
      // Process this message
      processNewMessage(messageText);
      
      // Only process one message per scan to avoid overwhelming
      break;
    }
  }

  /**
   * Process a new incoming message
   */
  async function processNewMessage(messageText) {
    try {
      // Generate reply
      const reply = await generateReply(messageText);
      if (!reply) {
        log('No reply generated for message');
        return;
      }

      // Random skip
      const skipProb = CONFIG?.randomSkipProbability || 0.15;
      if (Math.random() < skipProb) {
        log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%)');
        return;
      }

      // Pre-reply delay (simulate thinking time)
      const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
      log('Waiting ' + delay + 'ms before replying');
      await sleep(delay);

      // Type and send reply
      const typed = await typeMessage(reply);
      if (!typed) {
        log('Failed to type message');
        return;
      }

      await sleep(500);

      const sent = await sendMessage();
      if (sent) {
        log('✓ Reply sent: "' + reply.substring(0, 60) + '..."');
      } else {
        log('Failed to send message');
      }
    } catch (err) {
      log('Error processing message: ' + err);
    }
  }

  async function generateReply(messageText) {
    const rules = CONFIG?.replyRules || [];
    const lower = messageText.toLowerCase();

    for (const rule of rules) {
      const matchStr = typeof rule.match === 'string' ? rule.match : '';
      const match = rule.caseSensitive ? matchStr : matchStr.toLowerCase();
      const text = rule.caseSensitive ? messageText : lower;

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
          { role: 'system', content: aiConfig.systemPrompt || 'You are a friendly person responding to Instagram DMs. Keep responses brief and casual.' },
          { role: 'user', content: messageText }
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

    if (lower.includes('?')) return "That's a good question! Let me get back to you on that.";
    if (lower.includes('thank')) return "You're welcome! 😊";
    if (lower.includes('hi') || lower.includes('hey') || lower.includes('hello')) return "Hey! What's up?";

    return null;
  }

  async function typeMessage(text) {
    // Find the message input - Instagram typically uses a contenteditable div or textarea
    const input = document.querySelector('[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"], textarea, [data-testid="message-input"]');

    if (!input) {
      log('Input field not found');
      return false;
    }

    log('Found input field: ' + input.tagName + (input.getAttribute('role') ? '[role="' + input.getAttribute('role') + '"]' : ''));
    
    input.focus();
    await sleep(500); // Longer wait for focus

    // Clear existing content more thoroughly
    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = '';
      input.textContent = '';
      // Trigger events to ensure Instagram knows content changed
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (input.value !== undefined) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await sleep(200);

    // Type character by character
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (input.getAttribute('contenteditable') === 'true') {
        input.textContent = (input.textContent || '') + char;
        // Trigger input events after each character
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (input.value !== undefined) {
        input.value += char;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const delay = Math.floor(Math.random() * (typingDelayRange[1] - typingDelayRange[0])) + typingDelayRange[0];
      await sleep(delay);
    }

    // Final events to ensure Instagram recognizes the complete message
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));

    log('Typed message: "' + text.substring(0, 30) + '..." - Final content: "' + (input.textContent || input.value || '').substring(0, 30) + '..."');
    return true;
  }

  async function sendMessage() {
    // Wait a moment for typing to settle
    await sleep(300);
    
    // Find the send button - try multiple approaches
    let sendBtn = null;
    
    // Method 1: Look for button with "Send" text or aria-label
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    sendBtn = buttons.find(btn => {
      const text = btn.textContent?.toLowerCase();
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
      return (text && text.includes('send')) || (ariaLabel && ariaLabel.includes('send'));
    });

    // Method 2: Look for SVG send icons (paper plane, arrow, etc.)
    if (!sendBtn) {
      sendBtn = buttons.find(btn => {
        const svg = btn.querySelector('svg');
        return svg && (svg.innerHTML.includes('M2.01') || svg.innerHTML.includes('plane') || svg.innerHTML.includes('arrow'));
      });
    }

    // Method 3: Look for buttons near the input field
    if (!sendBtn) {
      const input = document.querySelector('[contenteditable="true"][role="textbox"], textarea');
      if (input) {
        const parent = input.closest('form, div');
        if (parent) {
          sendBtn = parent.querySelector('button, div[role="button"]');
        }
      }
    }

    if (sendBtn) {
      log('Found send button: ' + sendBtn.tagName + ' - clicking...');
      sendBtn.click();
      await sleep(1000); // Wait longer for message to send
      
      // Verify message was sent by checking if input is cleared
      const input = document.querySelector('[contenteditable="true"][role="textbox"], textarea');
      const inputEmpty = !input || !(input.textContent || input.value || '').trim();
      
      if (inputEmpty) {
        log('✓ Message sent successfully (input cleared)');
        return true;
      } else {
        log('⚠ Send button clicked but input not cleared - message may not have sent');
        return false;
      }
    }

    // Fallback: Try Enter key
    const input = document.querySelector('[contenteditable="true"][role="textbox"], textarea');
    if (input) {
      log('No send button found, trying Enter key...');
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(1000);
      
      // Check if input cleared
      const inputEmpty = !(input.textContent || input.value || '').trim();
      if (inputEmpty) {
        log('✓ Message sent via Enter key');
        return true;
      } else {
        log('⚠ Enter key pressed but input not cleared');
        return false;
      }
    }

    log('❌ Could not send message - no send button or input found');
    return false;
  }

  function navigateToDMs() {
    const links = Array.from(document.querySelectorAll('a[href*="/direct/"]'));
    if (links.length > 0) {
      const dmLink = links[0];
      if (!window.location.href.includes('/direct/')) {
        log('Navigating to DMs...');
        dmLink.click();
        return true;
      }
    }
    return false;
  }

  function isOnDMsPage() {
    return window.location.href.includes('/direct/');
  }

  /**
   * Check if we're in a specific conversation (not the main DMs list)
   */
  function isInConversation() {
    return window.location.href.includes('/direct/t/');
  }

  /**
   * Navigate back to the main DMs page (leave current conversation)
   */
  function navigateBackToDMs() {
    // Look for the DM/Messages tab/link to go back to main DMs page
    const dmLinks = Array.from(document.querySelectorAll('a[href*="/direct/"], a[href="/direct/inbox/"]'));
    for (const link of dmLinks) {
      // Skip if this is a specific conversation link
      if (link.href.includes('/direct/t/')) continue;
      
      log('Navigating back to main DMs page');
      link.click();
      return true;
    }
    
    // Alternative: look for back button or inbox button
    const backButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(btn => {
      const text = btn.textContent?.toLowerCase();
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
      return (text && (text.includes('back') || text.includes('inbox'))) || 
             (ariaLabel && (ariaLabel.includes('back') || ariaLabel.includes('inbox')));
    });
    
    if (backButtons.length > 0) {
      log('Clicking back button to return to DMs');
      backButtons[0].click();
      return true;
    }
    
    log('Could not find way to navigate back to DMs');
    return false;
  }

  function findConversations() {
    const conversations = [];

    let items = Array.from(document.querySelectorAll('[role="listitem"]'));

    if (items.length === 0) {
      log('No [role="listitem"] found, trying alternative selectors...');

      items = Array.from(document.querySelectorAll('a[href*="/direct/t/"]'));
      log('Found ' + items.length + ' direct message links');

      if (items.length === 0) {
        const unreadDivs = Array.from(document.querySelectorAll('div')).filter(div =>
          div.textContent?.includes('Unread') && div.textContent.length < 200
        );
        log('Found ' + unreadDivs.length + ' elements with "Unread" text');

        items = unreadDivs.map(div => {
          let parent = div.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            if (parent.tagName === 'A' || parent.getAttribute('role') === 'button') {
              return parent;
            }
            parent = parent.parentElement;
          }
          return div.parentElement;
        }).filter(el => el !== null);
      }
    }

    log('Found ' + items.length + ' total conversation items to check');

    for (const item of items) {
      const hasUnread = hasUnreadIndicator(item);

      const text = item.textContent?.substring(0, 80) || '';
      if (text.length > 0) {
        const hasUnreadText = text.includes('Unread');
        log('Item: "' + text + '" - hasUnread=' + hasUnread + ', hasUnreadText=' + hasUnreadText);
      }

      if (!hasUnread) continue;

      const fullText = item.textContent || '';
      const convId = 'conv-' + fullText.substring(0, 50).replace(/\\\\s+/g, '-');

      if (!seenMessages.has(convId)) {
        log('✓ Found unread conversation: ' + convId.substring(0, 60));
        conversations.push({ id: convId, element: item });
      } else {
        log('Skipping already seen conversation: ' + convId.substring(0, 60));
      }
    }

    return conversations;
  }

  function hasUnreadIndicator(element) {
    const unreadDiv = element.querySelector('div.x9f619.x1ja2u2z.xzpqnlu.x1hyvwdk.x14bfe9o.xjm9jq1.x6ikm8r.x10wlt62.x10l6tqk.x1i1rx1s');
    if (unreadDiv && unreadDiv.textContent?.includes('Unread')) {
      return true;
    }

    const allDivs = element.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.textContent?.trim() === 'Unread') {
        return true;
      }
    }

    const badge = element.querySelector('[role="status"], [aria-label*="unread"], [aria-label*="notification"]');
    if (badge) return true;

    const spans = element.querySelectorAll('span, div');
    for (const el of spans) {
      const weight = window.getComputedStyle(el).fontWeight;
      if ((weight === 'bold' || weight === '700' || parseInt(weight) >= 600) && el.textContent && el.textContent.length > 3) {
        return true;
      }
    }

    return false;
  }

  async function openConversation(conversation) {
    try {
      log('Opening conversation: ' + conversation.id);

      let clickTarget = conversation.element;

      if (conversation.element.tagName === 'A') {
        clickTarget = conversation.element;
      } else {
        const link = conversation.element.querySelector('a[href*="/direct/t/"]');
        if (link) {
          clickTarget = link;
          log('Found direct message link within element');
        } else {
          const clickable = conversation.element.querySelector('[role="button"], a, button');
          if (clickable) {
            clickTarget = clickable;
            log('Found clickable element within container');
          }
        }
      }

      log('Clicking element: ' + clickTarget.tagName);
      clickTarget.click();
      
      // Wait longer for conversation to fully load
      await sleep(3000);
      
      // Additional wait if we're still loading
      let retries = 0;
      while (retries < 3) {
        const messageRows = document.querySelectorAll('div[role="row"], div[dir="auto"]');
        if (messageRows.length > 0) {
          log('Conversation loaded with ' + messageRows.length + ' potential message elements');
          break;
        }
        log('Waiting for conversation to load... (retry ' + (retries + 1) + ')');
        await sleep(1000);
        retries++;
      }
      
      return true;
    } catch (err) {
      log('Error opening conversation: ' + err);
      return false;
    }
  }

  /**
   * Get messages from the current open conversation using improved detection
   */
  function getConversationMessages() {
    const messages = [];
    
    // Try multiple selectors to find message elements
    let messageElements = Array.from(document.querySelectorAll('div[role="row"]'));
    log('Found ' + messageElements.length + ' message rows with role="row"');
    
    // If no role="row" found, try alternative selectors
    if (messageElements.length === 0) {
      // Try looking for divs with dir="auto" directly (message content)
      messageElements = Array.from(document.querySelectorAll('div[dir="auto"]'));
      log('Found ' + messageElements.length + ' elements with dir="auto"');
      
      // If still nothing, try common message selectors
      if (messageElements.length === 0) {
        messageElements = Array.from(document.querySelectorAll('[data-testid*="message"], [class*="message"], [class*="Message"]'));
        log('Found ' + messageElements.length + ' elements with message-related attributes');
      }
      
      // Last resort: look for any div containing text that might be messages
      if (messageElements.length === 0) {
        const allDivs = Array.from(document.querySelectorAll('div'));
        messageElements = allDivs.filter(div => {
          const text = div.innerText?.trim();
          return text && text.length > 2 && text.length < 1000 && 
                 !text.includes('Unread') && !text.includes('Active') &&
                 div.querySelector('div[dir="auto"]'); // Must contain a dir="auto" child
        });
        log('Found ' + messageElements.length + ' potential message containers');
      }
    }

    for (const element of messageElements) {
      const text = getMessageText(element);
      if (!text || text.length < MIN_MESSAGE_LENGTH) continue;

      // Use the reliable heuristic for incoming messages
      const isIncomingMsg = !element.innerText.includes('Seen') && !element.innerText.includes('Delivered');
      
      log('Message found: "' + text.substring(0, 30) + '..." - Incoming: ' + isIncomingMsg);

      messages.push({ text: text, isIncoming: isIncomingMsg, element: element });
    }

    return messages;
  }

  function getLatestIncomingMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.isIncoming) {
        const msgId = 'msg-' + msg.text.substring(0, 100).replace(/\\\\s+/g, '-');
        if (!seenMessages.has(msgId)) {
          return { text: msg.text, id: msgId };
        }
      }
    }
    return null;
  }

  async function processConversation(conversation) {
    try {
      const opened = await openConversation(conversation);
      if (!opened) {
        // Mark as seen even if we couldn't open it
        seenMessages.add(conversation.id);
        return;
      }

      const messages = getConversationMessages();
      log('Found ' + messages.length + ' messages in conversation');

      if (messages.length === 0) {
        log('No messages found - marking conversation as seen and navigating back to DMs');
        seenMessages.add(conversation.id);
        await sleep(1000);
        navigateBackToDMs();
        return;
      }

      const latestMsg = getLatestIncomingMessage(messages);
      if (!latestMsg) {
        log('No new incoming messages - marking conversation as seen and navigating back to DMs');
        seenMessages.add(conversation.id);
        await sleep(1000);
        navigateBackToDMs();
        return;
      }

      log('Latest incoming message: "' + latestMsg.text.substring(0, 50) + '..."');

      // Mark both message and conversation as seen
      seenMessages.add(latestMsg.id);
      seenMessages.add(conversation.id);

      const reply = await generateReply(latestMsg.text);
      if (!reply) {
        log('No reply generated - navigating back to DMs');
        await sleep(1000);
        navigateBackToDMs();
        return;
      }

      const skipProb = CONFIG?.randomSkipProbability || 0.15;
      if (Math.random() < skipProb) {
        log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%) - navigating back to DMs');
        await sleep(1000);
        navigateBackToDMs();
        return;
      }

      const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
      log('Waiting ' + delay + 'ms before replying');
      await sleep(delay);

      const typed = await typeMessage(reply);
      if (!typed) {
        log('Failed to type message - navigating back to DMs');
        await sleep(1000);
        navigateBackToDMs();
        return;
      }

      await sleep(500);

      const sent = await sendMessage();
      if (sent) {
        log('✓ Reply sent: "' + reply.substring(0, 60) + '..." - navigating back to DMs');
      } else {
        log('Failed to send message - navigating back to DMs');
      }
      
      // Always navigate back to DMs after processing
      await sleep(2000); // Wait longer to ensure message is sent/processed
      navigateBackToDMs();
      
    } catch (err) {
      log('Error processing conversation: ' + err + ' - marking as seen and navigating back to DMs');
      seenMessages.add(conversation.id);
      await sleep(1000);
      navigateBackToDMs();
    }
  }

  /**
   * Main polling loop - keep navigation but use new message detection
   */
  async function poll() {
    if (!isRunning || isProcessing) return;
    isProcessing = true;

    try {
      // If we're not on the DMs page at all, navigate there
      if (!isOnDMsPage()) {
        const navigated = navigateToDMs();
        if (navigated) {
          await sleep(2000);
        }
        isProcessing = false;
        return;
      }
      
      // If we're in a specific conversation, navigate back to main DMs first
      if (isInConversation()) {
        log('Currently in conversation, navigating back to main DMs');
        navigateBackToDMs();
        await sleep(2000);
        isProcessing = false;
        return;
      }

      log('Polling for new messages...');

      const conversations = findConversations();
      if (conversations.length === 0) {
        log('No unread conversations');
        isProcessing = false;
        return;
      }

      log('Found ' + conversations.length + ' unread conversation(s)');

      for (const conv of conversations) {
        if (!isRunning) break;
        await processConversation(conv);
        await sleep(2000);
      }
    } catch (err) {
      log('Poll error: ' + err);
    } finally {
      isProcessing = false;
    }
  }

  function scheduleNextPoll() {
    if (!isRunning) return;
    const delay = getRandomPollInterval();
    log('Next scan in ' + Math.round(delay / 1000) + 's');
    pollInterval = setTimeout(() => {
      poll();
      scheduleNextPoll();
    }, delay);
  }

  function stop() {
    isRunning = false;
    if (pollInterval) {
      clearTimeout(pollInterval);
      clearInterval(pollInterval);
    }
    window.__SNAPPY_RUNNING__ = false;
    window.__SNAPPY_INSTAGRAM_RUNNING__ = false;
    log('Instagram bot stopped');
  }

  log('🚀 Instagram DM bot started - monitoring for new messages');
  poll();
  scheduleNextPoll();

  window.__SNAPPY_STOP__ = stop;
})();
`;
}

interface ReplyRule {
  match: string;
  reply: string;
  priority?: number;
}

interface AIConfig {
  enabled: boolean;
  provider: 'local' | 'chatgpt';
  llmEndpoint: string;
  llmPort: number;
  modelName: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextHistoryEnabled: boolean;
  maxContextMessages: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  chatgptApiKey: string;
  chatgptModel: string;
  chatgptBaseUrl?: string;
}

interface LlamaConfig {
  buildPath: string;
  startCommand: string;
  enabled: boolean;
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
  llama?: LlamaConfig;
  threads?: {
    pollIntervalMs?: number;
    maxCommentsPerPoll?: number;
  };
  reddit?: {
    pollIntervalMs?: number;
    maxCommentsPerPoll?: number;
    maxItemsPerPoll?: number;
    watchNotifications?: boolean;
    watchPrivateMessages?: boolean;
    watchSubreddits?: string[];
    subredditKeywords?: string[];
    autoReplyToComments?: boolean;
    autoReplyToPMs?: boolean;
    autoReplyToPosts?: boolean;
    minPostScore?: number;
    maxPostAge?: number;
    skipOwnPosts?: boolean;
    skipOwnComments?: boolean;
    authCookieString?: string;
    sessionCookie?: string;
  };
}

let isPanelOpen = false;
let isBotActive = false;
let isLogCollapsed = false;

const panel = document.getElementById('settings-panel')!;
const toggleBtn = document.getElementById('settings-toggle')!;
const closeBtn = document.getElementById('panel-close')!;
const minimizeToTrayBtn = document.getElementById('minimize-to-tray');

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
  config: { initialUrl: string } | Config;
  state: string;
  botStatus?: 'active' | 'inactive';
}

// Track sessions and their webviews
const sessionWebviews = new Map<string, Electron.WebviewTag>();
let activeSessionId: string | null = null;

// Per-tab configuration storage
const sessionConfigs = new Map<string, Config>();

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
  
  const botStatus = document.createElement('span');
  botStatus.className = `tab-bot-status ${session.botStatus || 'inactive'}`;
  botStatus.textContent = '●';
  botStatus.title = `Bot Status: ${session.botStatus || 'inactive'}`;
  
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
  tab.appendChild(botStatus);
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
function activateSession(sessionId: string, suppressLog: boolean = false) {
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
  
  // Switch to this session's log view
  switchToLogSession(sessionId);
  
  // Load configuration for this session
  loadSessionConfig(sessionId);
  updateSettingsPanelTitle(sessionId);
  updateTabSettingsButtons();
  
  // Sync bot status UI with the active session's bot status
  syncBotStatusUI(sessionId);
  
  // Refresh site settings UI for the new session
  refreshSiteSettingsForSession();
  
  if (!suppressLog) {
    const hasCustomConfig = sessionConfigs.has(sessionId);
    const configStatus = hasCustomConfig ? 'custom settings' : 'default settings';
    addLog(`Switched to ${getSessionName(sessionId)} (${configStatus})`, 'info', sessionId);
  }
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
    
    // Remove session configuration
    sessionConfigs.delete(sessionId);
    
    // Remove tab
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) tab.remove();
    
    // Remove log tab
    removeLogTab(sessionId);
    
    // If this was active, activate another
    if (activeSessionId === sessionId) {
      const remaining = Array.from(sessionWebviews.keys());
      if (remaining.length > 0) {
        activateSession(remaining[0]);
      } else {
        activeSessionId = null;
        webview = null;
        // Clear settings panel
        const indicator = document.getElementById('settings-session-indicator');
        if (indicator) indicator.style.display = 'none';
        updateTabSettingsButtons();
      }
    }
    
    addLog(`Session deleted`, 'info', sessionId);
  } catch (e) {
    addLog(`Failed to delete session: ${e}`, 'error');
  }
}

// Detach a session to a new window
async function detachSession(sessionId: string) {
  try {
    const sessionName = getSessionName(sessionId);
    
    // Get webview before detaching
    const wv = sessionWebviews.get(sessionId);
    if (!wv) {
      addLog('No webview found for session', 'error', sessionId);
      return;
    }
    
    // Create detached window
    const result = await (window as any).windowManager.detachSession(sessionId, sessionName);
    if (!result.success) {
      addLog(`Failed to detach session: ${result.error}`, 'error', sessionId);
      return;
    }
    
    // Remove the session from main window completely
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) {
      tab.remove();
    }
    
    // Remove webview from main window
    if (wv) {
      wv.remove();
      sessionWebviews.delete(sessionId);
    }
    
    // Remove session configuration
    sessionConfigs.delete(sessionId);
    
    // If this was the active session, activate another one
    if (activeSessionId === sessionId) {
      const remaining = Array.from(sessionWebviews.keys());
      if (remaining.length > 0) {
        activateSession(remaining[0]);
      } else {
        activeSessionId = null;
        webview = null;
        // Clear settings panel
        const indicator = document.getElementById('settings-session-indicator');
        if (indicator) indicator.style.display = 'none';
        updateTabSettingsButtons();
      }
    }
    
    addLog(`Session "${sessionName}" detached to new window`, 'success');
    
  } catch (e) {
    addLog(`Failed to detach session: ${e}`, 'error');
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
            // Also update the log tab name
            renameLogTab(sessionId, newName);
          }
          break;
        case 'duplicate':
          const dup = await (window as any).session.duplicateSession(sessionId);
          if (dup) addSessionToUI(dup);
          break;
        case 'copy-settings':
          showCopySettingsModal(sessionId);
          break;
        case 'detach':
          await detachSession(sessionId);
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

// Add a session to the UI without activating it (for startup)
function addSessionToUIWithoutActivation(session: SessionData) {
  const tabsContainer = document.getElementById('tabs-container');
  if (!tabsContainer) return;
  
  // Create tab
  const tab = createSessionTab(session);
  tabsContainer.appendChild(tab);
  
  // Create webview
  createSessionWebview(session);
  
  // Create log tab (don't auto-activate during startup)
  createLogTab(session.id, session.name, false);
  
  // Initialize session config if it has one
  if (session.config) {
    sessionConfigs.set(session.id, session.config as Config);
  }
  
  // Update tab bot status indicator if available
  if (session.botStatus) {
    const tabElement = document.getElementById(`tab-${session.id}`);
    if (tabElement) {
      const botStatusEl = tabElement.querySelector('.tab-bot-status');
      if (botStatusEl) {
        botStatusEl.className = `tab-bot-status ${session.botStatus}`;
        botStatusEl.setAttribute('title', `Bot Status: ${session.botStatus}`);
      }
    }
  }
  
  // Update button states since we now have a new tab
  updateTabSettingsButtons();
}

// Add a session to the UI (tab + webview) and activate it
function addSessionToUI(session: SessionData) {
  addSessionToUIWithoutActivation(session);
  
  // Activate it
  activateSession(session.id);
}

// Update settings panel title to show which session is active
function updateSettingsPanelTitle(sessionId: string) {
  const panelTitle = document.querySelector('#settings-panel .panel-header h3');
  if (panelTitle) {
    const sessionName = getSessionName(sessionId);
    panelTitle.textContent = `Settings - ${sessionName}`;
  }
  
  // Add visual indicator to show per-tab settings
  const settingsIndicator = document.getElementById('settings-session-indicator');
  if (settingsIndicator) {
    settingsIndicator.textContent = `Session: ${getSessionName(sessionId)}`;
    settingsIndicator.style.display = 'block';
  }
}

// Get session name by ID
function getSessionName(sessionId: string): string {
  const tab = document.getElementById(`tab-${sessionId}`);
  if (tab) {
    const nameEl = tab.querySelector('.tab-name');
    if (nameEl) {
      return nameEl.textContent || sessionId.substring(0, 8);
    }
  }
  return sessionId.substring(0, 8);
}

// Copy configuration from one session to another
function copySessionConfig(fromSessionId: string, toSessionId: string) {
  const config = sessionConfigs.get(fromSessionId);
  if (config) {
    // Deep clone the config
    const clonedConfig = JSON.parse(JSON.stringify(config));
    sessionConfigs.set(toSessionId, clonedConfig);
    
    // If the target session is active, reload the UI
    if (toSessionId === activeSessionId) {
      loadConfigIntoUI(clonedConfig);
    }
    
    // Update visual indicators
    updateTabCustomSettingsIndicator(toSessionId);
    
    addLog(`Configuration copied from ${getSessionName(fromSessionId)} to ${getSessionName(toSessionId)}`, 'info');
  }
}

// Show copy settings modal
function showCopySettingsModal(targetSessionId: string) {
  const modal = document.getElementById('copy-settings-modal');
  const sessionsList = document.getElementById('source-sessions-list');
  const copyBtn = document.getElementById('copy-settings-btn');
  
  if (!modal || !sessionsList || !copyBtn) return;
  
  // Clear previous selections
  sessionsList.innerHTML = '';
  let selectedSourceId: string | null = null;
  
  // Populate with available sessions (excluding target)
  sessionWebviews.forEach((_, sessionId) => {
    if (sessionId === targetSessionId) return;
    
    const sessionName = getSessionName(sessionId);
    const hasConfig = sessionConfigs.has(sessionId);
    
    const option = document.createElement('div');
    option.className = 'session-option';
    option.dataset.sessionId = sessionId;
    
    option.innerHTML = `
      <span class="session-option-status ${hasConfig ? 'connected' : 'none'}"></span>
      <span>${sessionName}</span>
      <span style="margin-left: auto; font-size: 10px; color: #666;">
        ${hasConfig ? 'Has settings' : 'Default settings'}
      </span>
    `;
    
    option.addEventListener('click', () => {
      // Remove previous selection
      sessionsList.querySelectorAll('.session-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      
      // Select this option
      option.classList.add('selected');
      selectedSourceId = sessionId;
      (copyBtn as HTMLButtonElement).disabled = false;
    });
    
    sessionsList.appendChild(option);
  });
  
  // Disable copy button initially
  (copyBtn as HTMLButtonElement).disabled = true;
  
  // Set up copy button handler
  (copyBtn as HTMLButtonElement).onclick = () => {
    if (selectedSourceId) {
      copySessionConfig(selectedSourceId, targetSessionId);
      hideCopySettingsModal();
    }
  };
  
  // Show modal
  modal.classList.remove('hidden');
}

// Hide copy settings modal
function hideCopySettingsModal() {
  const modal = document.getElementById('copy-settings-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Set up copy settings modal event listeners
function setupCopySettingsModal() {
  const modal = document.getElementById('copy-settings-modal');
  if (!modal) return;
  
  // Close buttons
  modal.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', hideCopySettingsModal);
  });
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideCopySettingsModal();
    }
  });
}

// Set up detached window handlers
function setupDetachedWindowHandlers() {
  // Listen for detached window initialization
  (window as any).electronAPI?.onDetachedWindowInit?.((data: { sessionId: string; sessionName: string; isDetachedWindow: boolean }) => {
    if (data.isDetachedWindow) {
      // Set the flag immediately to prevent session loading
      (window as any).isDetachedWindow = true;
      (window as any).detachedSessionId = data.sessionId;
      setupDetachedWindowMode(data.sessionId, data.sessionName);
    }
  });
  
  // Listen for detached window closed events
  (window as any).windowManager.onDetachedWindowClosed((data: { windowId: string; sessionId: string }) => {
    // Mark tab as reattached
    const tab = document.getElementById(`tab-${data.sessionId}`);
    if (tab) {
      tab.classList.remove('detached');
      tab.title = '';
    }
    
    // Show webview in main window again
    const wv = sessionWebviews.get(data.sessionId);
    if (wv) {
      wv.classList.remove('detached');
      if (activeSessionId === data.sessionId) {
        wv.classList.remove('hidden');
      }
    }
    
    addLog(`Session reattached from closed window`, 'info');
  });
  
  // Listen for session reattach requests
  (window as any).windowManager.onSessionReattach((data: { sessionId: string }) => {
    reattachSession(data.sessionId);
  });
  
  // Listen for webview data from detached windows
  (window as any).electronAPI?.onWebviewReceiveFromDetached?.((webviewData: { sessionId: string; html: string }) => {
    receiveWebviewFromDetached(webviewData);
  });
}

// Set up detached window mode - only show the detached session
function setupDetachedWindowMode(sessionId: string, sessionName: string) {
  // Mark this as a detached window
  (window as any).isDetachedWindow = true;
  (window as any).detachedSessionId = sessionId;
  
  // Clear existing sessions and only load the detached one
  sessionWebviews.clear();
  sessionConfigs.clear();
  
  // Clear tabs container
  const tabsContainer = document.getElementById('tabs-container');
  if (tabsContainer) {
    tabsContainer.innerHTML = '';
  }
  
  // Clear log tabs and create one for this session
  const logTabsContainer = document.getElementById('log-tabs-container');
  if (logTabsContainer) {
    logTabsContainer.innerHTML = '';
  }
  createLogTab(sessionId, sessionName);
  
  // Load only the detached session
  loadDetachedSession(sessionId, sessionName);
  
  // Hide new session button
  const newSessionBtn = document.getElementById('new-session-btn');
  if (newSessionBtn) {
    newSessionBtn.style.display = 'none';
  }
  
  // Add reattach button to the tab bar
  const tabBar = document.getElementById('tab-bar');
  if (tabBar) {
    const reattachBtn = document.createElement('button');
    reattachBtn.id = 'reattach-btn';
    reattachBtn.className = 'btn btn-secondary';
    reattachBtn.textContent = '↩ Reattach to Main';
    reattachBtn.title = 'Reattach this session to the main window';
    reattachBtn.style.marginLeft = 'auto';
    reattachBtn.style.fontSize = '10px';
    reattachBtn.style.padding = '4px 8px';
    
    reattachBtn.onclick = async () => {
      try {
        const result = await (window as any).windowManager.reattachSession(sessionId);
        if (result.success) {
          addLog(`Reattaching session "${sessionName}" to main window`, 'info');
          // Window will be closed by the main process
        } else {
          addLog(`Failed to reattach: ${result.error}`, 'error');
        }
      } catch (error) {
        addLog(`Error during reattach: ${error}`, 'error');
      }
    };
    
    tabBar.appendChild(reattachBtn);
  }
  
  // Update window title
  document.title = `Snappy - ${sessionName}`;
  
  // Update settings panel title
  const panelTitle = document.querySelector('#settings-panel .panel-header h1');
  if (panelTitle) {
    panelTitle.textContent = `SNAPPY - ${sessionName.toUpperCase()}`;
  }
  
  addLog(`Detached window mode: ${sessionName}`, 'highlight');
}

// Load only the detached session in the detached window
async function loadDetachedSession(sessionId: string, sessionName: string) {
  try {
    // Get the session data from the main process
    const session = await (window as any).session.getSession(sessionId);
    if (session) {
      // Add only this session to the UI
      addSessionToUI(session);
      addLog(`Loaded detached session: ${sessionName}`, 'info');
    } else {
      addLog(`Could not load detached session: ${sessionName}`, 'error');
    }
  } catch (e) {
    addLog(`Error loading detached session: ${e}`, 'error');
  }
}

// Reattach a session from detached window
async function reattachSession(sessionId: string) {
  try {
    // Get the session data and recreate it in the main window
    const session = await (window as any).session.getSession(sessionId);
    if (session) {
      addSessionToUI(session);
      addLog(`Session "${session.name}" reattached to main window`, 'success');
    } else {
      addLog(`Could not reattach session: ${sessionId}`, 'error');
    }
  } catch (e) {
    addLog(`Error reattaching session: ${e}`, 'error');
  }
}

// Receive webview from detached window
function receiveWebviewFromDetached(webviewData: { sessionId: string; html: string }) {
  const existingWebview = sessionWebviews.get(webviewData.sessionId);
  
  if (existingWebview) {
    // Remove the placeholder webview
    existingWebview.remove();
    sessionWebviews.delete(webviewData.sessionId);
  }
  
  // Create new webview from transferred HTML
  const container = document.getElementById('webview-container');
  if (!container) return;
  
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = webviewData.html;
  const webview = tempDiv.querySelector('webview') as Electron.WebviewTag;
  
  if (webview) {
    webview.classList.remove('detached');
    webview.classList.add('hidden'); // Start hidden
    container.appendChild(webview);
    
    // Store reference
    sessionWebviews.set(webviewData.sessionId, webview);
    
    // Set up listeners
    setupWebviewListeners(webview);
    setupWebviewReadyHandler(webview);
    
    // If this session is active, show the webview
    if (activeSessionId === webviewData.sessionId) {
      webview.classList.remove('hidden');
      // Update global reference
      (window as any).webview = webview;
    }
    
    addLog(`Webview restored for session`, 'success');
  }
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
  // Skip loading sessions if this is a detached window
  if ((window as any).isDetachedWindow) {
    return;
  }
  
  // Create a global log tab for system messages (auto-activate)
  createLogTab('global', 'System', true);
  
  try {
    const sessions = await (window as any).session.getAllSessions();
    if (sessions && sessions.length > 0) {
      // Add all sessions to UI without activating them
      sessions.forEach((s: SessionData) => addSessionToUIWithoutActivation(s));
      
      // Now activate the first session (suppress log during startup)
      if (sessions.length > 0) {
        activateSession(sessions[0].id, true);
      }
      
      addLog(`Loaded ${sessions.length} session(s)`, 'info', 'global');
    } else {
      addLog('No existing sessions found', 'info', 'global');
    }
  } catch (e) {
    console.log('Could not load sessions:', e);
    addLog('Could not load sessions', 'error', 'global');
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
  
  // Set up copy settings modal
  setupCopySettingsModal();
  
  // Set up detached window handlers
  setupDetachedWindowHandlers();
  
  // Initialize log tabs container
  initializeLogTabs();
  
  // Set up cross-session bot status synchronization
  setupBotStatusSync();
}

function initializeLogTabs() {
  // Ensure log tabs container exists
  const logTabsContainer = document.getElementById('log-tabs-container');
  if (!logTabsContainer) {
    console.error('Log tabs container not found');
    return;
  }
  
  // Add some initial styling if needed
  logTabsContainer.style.display = 'flex';
}

// Sync bot status UI with a specific session's status
async function syncBotStatusUI(sessionId: string) {
  try {
    const session = await (window as any).session.getSession(sessionId);
    if (session && session.botStatus) {
      const wasActive = isBotActive;
      isBotActive = session.botStatus === 'active';
      
      // Update UI elements
      if (isBotActive) {
        statusDot.classList.add('active');
        statusText.textContent = 'Active';
        botBtn.textContent = 'Stop';
      } else {
        statusDot.classList.remove('active');
        statusText.textContent = 'Inactive';
        botBtn.textContent = 'Start';
      }
      
      // Log if status changed
      if (wasActive !== isBotActive) {
        const sessionName = getSessionName(sessionId);
        addLog(`Bot status synced: ${session.botStatus}`, 'info', sessionId);
      }
    }
  } catch (e) {
    console.log('Could not sync bot status:', e);
  }
}

// Set up cross-session bot status synchronization
function setupBotStatusSync() {
  // Listen for bot status changes from other sessions/windows
  (window as any).session.onSessionBotStatusChanged((data: { sessionId: string; botStatus: 'active' | 'inactive' }) => {
    const { sessionId, botStatus } = data;
    
    // Update tab visual indicator
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) {
      const botStatusEl = tab.querySelector('.tab-bot-status');
      if (botStatusEl) {
        botStatusEl.className = `tab-bot-status ${botStatus}`;
        botStatusEl.setAttribute('title', `Bot Status: ${botStatus}`);
      }
    }
    
    // If this is the active session, update the main UI
    if (sessionId === activeSessionId) {
      const wasActive = isBotActive;
      isBotActive = botStatus === 'active';
      
      // Update UI elements
      if (isBotActive) {
        statusDot.classList.add('active');
        statusText.textContent = 'Active';
        botBtn.textContent = 'Stop';
      } else {
        statusDot.classList.remove('active');
        statusText.textContent = 'Inactive';
        botBtn.textContent = 'Start';
      }
      
      // Log the status change if it actually changed
      if (wasActive !== isBotActive) {
        const sessionName = getSessionName(sessionId);
        addLog(`Bot ${botStatus} in ${sessionName}`, botStatus === 'active' ? 'success' : 'info', sessionId);
      }
    }
    
    // Log status change for other sessions
    if (sessionId !== activeSessionId) {
      const sessionName = getSessionName(sessionId);
      addLog(`Bot ${botStatus} in ${sessionName}`, botStatus === 'active' ? 'success' : 'info', 'global');
    }
  });
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
const aiProvider = document.getElementById('ai-provider') as HTMLSelectElement;
const aiStatus = document.getElementById('ai-status')!;
const aiTemp = document.getElementById('ai-temp') as HTMLInputElement;
const aiTempVal = document.getElementById('ai-temp-val')!;
const aiTokens = document.getElementById('ai-tokens') as HTMLInputElement;
const aiContext = document.getElementById('ai-context') as HTMLInputElement;
const aiHistory = document.getElementById('ai-history') as HTMLInputElement;
const aiPrompt = document.getElementById('ai-prompt') as HTMLTextAreaElement;
const testConnectionBtn = document.getElementById('test-connection')!;

// ChatGPT Settings elements
const chatgptApiKey = document.getElementById('chatgpt-api-key') as HTMLInputElement;
const chatgptModel = document.getElementById('chatgpt-model') as HTMLSelectElement;
const chatgptBaseUrl = document.getElementById('chatgpt-base-url') as HTMLInputElement;
const localSettings = document.getElementById('local-settings')!;
const chatgptSettings = document.getElementById('chatgpt-settings')!;
const llamaServerSection = document.getElementById('llama-server-section')!;

// AI provider change handler
aiProvider?.addEventListener('change', () => {
  const provider = aiProvider.value;
  if (provider === 'chatgpt') {
    localSettings.style.display = 'none';
    chatgptSettings.style.display = 'block';
    llamaServerSection.style.display = 'none';
  } else {
    localSettings.style.display = 'block';
    chatgptSettings.style.display = 'none';
    llamaServerSection.style.display = 'block';
  }
});

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

// ============================================================================
// Per-Session Activity Logs
// ============================================================================

interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'error' | 'highlight';
  timestamp: Date;
}

// Store logs per session
const sessionLogs = new Map<string, LogEntry[]>();
let activeLogSessionId: string | null = null;

// Log functions
function addLog(message: string, type: 'info' | 'success' | 'error' | 'highlight' = 'info', targetSessionId?: string) {
  const sessionId = targetSessionId || activeSessionId || 'global';
  
  // Create log entry
  const logEntry: LogEntry = {
    message,
    type,
    timestamp: new Date()
  };
  
  // Store in session logs
  if (!sessionLogs.has(sessionId)) {
    sessionLogs.set(sessionId, []);
  }
  
  const logs = sessionLogs.get(sessionId)!;
  logs.push(logEntry);
  
  // Keep only last 100 entries per session
  if (logs.length > 100) {
    logs.shift();
  }
  
  // Update UI if this is the active log session
  if (activeLogSessionId === sessionId) {
    renderLogEntry(logEntry);
  }
  
  // Update log tab indicator
  updateLogTabIndicator(sessionId);
}

function renderLogEntry(logEntry: LogEntry) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${logEntry.type}`;
  
  const time = logEntry.timestamp.toLocaleTimeString();
  entry.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(logEntry.message)}`;
  
  logContent.appendChild(entry);
  logContent.scrollTop = logContent.scrollHeight;
}

function switchToLogSession(sessionId: string) {
  activeLogSessionId = sessionId;
  
  // Clear current log content
  logContent.innerHTML = '';
  
  // Render logs for this session
  const logs = sessionLogs.get(sessionId) || [];
  logs.forEach(logEntry => renderLogEntry(logEntry));
  
  // Update active log tab
  updateActiveLogTab(sessionId);
}

function updateLogTabIndicator(sessionId: string) {
  const logTab = document.getElementById(`log-tab-${sessionId}`);
  if (logTab) {
    const logs = sessionLogs.get(sessionId) || [];
    const hasNewLogs = logs.length > 0;
    
    // Add indicator if there are logs and this isn't the active session
    if (hasNewLogs && activeLogSessionId !== sessionId) {
      logTab.classList.add('has-logs');
    }
  }
}

function updateActiveLogTab(sessionId: string) {
  // Remove active class from all log tabs
  document.querySelectorAll('.log-tab').forEach(tab => {
    tab.classList.remove('active');
    tab.classList.remove('has-logs'); // Clear indicator when viewing
  });
  
  // Add active class to current tab
  const activeTab = document.getElementById(`log-tab-${sessionId}`);
  if (activeTab) {
    activeTab.classList.add('active');
  }
}

function createLogTab(sessionId: string, sessionName: string, autoActivate: boolean = true) {
  const logTabsContainer = document.getElementById('log-tabs-container');
  if (!logTabsContainer) return;
  
  const logTab = document.createElement('div');
  logTab.id = `log-tab-${sessionId}`;
  logTab.className = 'log-tab';
  logTab.textContent = sessionName;
  logTab.title = `Activity log for ${sessionName}`;
  
  logTab.addEventListener('click', () => {
    switchToLogSession(sessionId);
  });
  
  logTabsContainer.appendChild(logTab);
  
  // If this is the first tab and auto-activate is enabled, make it active
  if (autoActivate && logTabsContainer.children.length === 1) {
    switchToLogSession(sessionId);
  }
}

function removeLogTab(sessionId: string) {
  const logTab = document.getElementById(`log-tab-${sessionId}`);
  if (logTab) {
    logTab.remove();
  }
  
  // Remove session logs
  sessionLogs.delete(sessionId);
  
  // Switch to another tab if this was active
  if (activeLogSessionId === sessionId) {
    const logTabsContainer = document.getElementById('log-tabs-container');
    if (logTabsContainer && logTabsContainer.children.length > 0) {
      const firstTab = logTabsContainer.children[0] as HTMLElement;
      const firstSessionId = firstTab.id.replace('log-tab-', '');
      switchToLogSession(firstSessionId);
    } else {
      activeLogSessionId = null;
      logContent.innerHTML = '';
    }
  }
}

function renameLogTab(sessionId: string, newName: string) {
  const logTab = document.getElementById(`log-tab-${sessionId}`);
  if (logTab) {
    logTab.textContent = newName;
    logTab.title = `Activity log for ${newName}`;
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
  if (minimizeToTrayBtn) {
    minimizeToTrayBtn.classList.toggle('shifted', isPanelOpen);
  }
  document.getElementById('app')!.classList.toggle('panel-open', isPanelOpen);
}

// Override the original togglePanel function to handle both panels
function togglePanelWithSiteSupport() {
  togglePanel();
  
  // Initialize site settings when panel opens
  if (isPanelOpen) {
    initializeSiteSettings();
  }
}

toggleBtn.addEventListener('click', togglePanelWithSiteSupport);
closeBtn.addEventListener('click', togglePanelWithSiteSupport);

// ============================================================================
// Site-Specific Settings (Integrated)
// ============================================================================

let isSiteSettingsCollapsed = false;
const siteSettingsSection = document.getElementById('site-settings-section')!;
const siteSettingsHeader = document.querySelector('.site-settings-header')!;
const siteCollapseBtn = document.getElementById('site-settings-collapse')!;
const sitePlatformSelect = document.getElementById('site-platform-select') as HTMLSelectElement;
const saveSiteSettingsBtn = document.getElementById('save-site-settings-btn')!;

// Site settings storage
let currentSiteSettings: any = {};

function toggleSiteSettingsCollapse() {
  isSiteSettingsCollapsed = !isSiteSettingsCollapsed;
  siteSettingsSection.classList.toggle('collapsed', isSiteSettingsCollapsed);
  
  // Save collapse state
  localStorage.setItem('siteSettingsCollapsed', isSiteSettingsCollapsed.toString());
}

function detectCurrentPlatform(): string {
  const currentWebview = getActiveWebview();
  if (!currentWebview) {
    // Fallback to reddit if no webview
    sitePlatformSelect.value = 'reddit';
    switchPlatformSettings('reddit');
    updateSiteSettingsIndicator('reddit');
    return 'reddit';
  }
  
  try {
    // Try to get hostname from webview synchronously first
    const src = currentWebview.src || '';
    let platform = detectPlatformFromUrl(src);
    
    if (platform !== 'unknown') {
      sitePlatformSelect.value = platform;
      switchPlatformSettings(platform);
      updateSiteSettingsIndicator(platform);
      return platform;
    }
    
    // If URL detection fails, try async hostname detection
    currentWebview.executeJavaScript('location.hostname').then((hostname: string) => {
      const detectedPlatform = detectPlatformFromHostname(hostname);
      
      // Only update if we got a valid platform and it's different from current
      if (detectedPlatform !== 'unknown' && detectedPlatform !== sitePlatformSelect.value) {
        sitePlatformSelect.value = detectedPlatform;
        switchPlatformSettings(detectedPlatform);
        updateSiteSettingsIndicator(detectedPlatform);
      }
    }).catch(() => {
      // If async detection fails, keep current selection or default to reddit
      if (!sitePlatformSelect.value) {
        sitePlatformSelect.value = 'reddit';
        switchPlatformSettings('reddit');
        updateSiteSettingsIndicator('reddit');
      }
    });
    
    // Return current value or reddit as fallback
    return sitePlatformSelect.value || 'reddit';
    
  } catch (e) {
    // Fallback to reddit on any error
    sitePlatformSelect.value = 'reddit';
    switchPlatformSettings('reddit');
    updateSiteSettingsIndicator('reddit');
    return 'reddit';
  }
}

function detectPlatformFromUrl(url: string): string {
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('reddit.com')) return 'reddit';
  if (lowerUrl.includes('instagram.com')) return 'instagram';
  if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) return 'twitter';
  if (lowerUrl.includes('snapchat.com')) return 'snapchat';
  if (lowerUrl.includes('threads.net')) return 'threads';
  
  return 'unknown';
}

function detectPlatformFromHostname(hostname: string): string {
  const lowerHostname = hostname.toLowerCase();
  
  if (lowerHostname.includes('reddit.com')) return 'reddit';
  if (lowerHostname.includes('instagram.com')) return 'instagram';
  if (lowerHostname.includes('twitter.com') || lowerHostname.includes('x.com')) return 'twitter';
  if (lowerHostname.includes('snapchat.com')) return 'snapchat';
  if (lowerHostname.includes('threads.net')) return 'threads';
  
  return 'unknown';
}

function switchPlatformSettings(platform: string) {
  // Hide all platform settings
  const allPlatformSettings = document.querySelectorAll('.platform-settings');
  allPlatformSettings.forEach(el => el.classList.add('hidden'));
  
  // Show selected platform settings
  const selectedSettings = document.getElementById(`${platform}-settings`);
  if (selectedSettings) {
    selectedSettings.classList.remove('hidden');
  }
  
  updateSiteSettingsIndicator(platform);
}

function updateSiteSettingsIndicator(platform: string) {
  const indicator = document.getElementById('site-settings-indicator');
  if (indicator) {
    const platformNames: { [key: string]: string } = {
      reddit: 'Reddit',
      instagram: 'Instagram',
      twitter: 'Twitter/X',
      snapchat: 'Snapchat',
      threads: 'Threads'
    };
    indicator.textContent = `Platform: ${platformNames[platform] || platform}`;
  }
}

function loadSiteSettingsForCurrentPlatform() {
  const platform = detectCurrentPlatform();
  loadSiteSettingsFromStorage(platform);
}

function refreshSiteSettingsForSession() {
  // Only refresh if the settings panel is open
  if (!isPanelOpen) return;
  
  // Store the current platform to detect changes
  const previousPlatform = sitePlatformSelect.value;
  
  // Detect platform for the new session and update UI
  setTimeout(() => {
    // Small delay to ensure webview is ready
    const newPlatform = detectCurrentPlatform();
    
    // Always switch platform settings and load settings, even if platform is the same
    // (because different sessions might have different settings for the same platform)
    switchPlatformSettings(newPlatform);
    loadSiteSettingsFromStorage(newPlatform);
    
    // Log the platform change if it's different
    if (previousPlatform !== newPlatform) {
      addLog(`Site settings switched from ${previousPlatform} to ${newPlatform}`, 'info');
    } else {
      // Even if platform is the same, we might have different settings for this session
      addLog(`Site settings refreshed for ${newPlatform}`, 'info');
    }
  }, 500);
}

function loadSiteSettingsFromStorage(platform: string) {
  try {
    const stored = localStorage.getItem('siteSettings');
    const allSettings = stored ? JSON.parse(stored) : {};
    const platformSettings = allSettings[platform] || {};
    
    currentSiteSettings = platformSettings;
    populateSettingsUI(platform, platformSettings);
  } catch (e) {
    console.error('Error loading site settings:', e);
    currentSiteSettings = {};
  }
}

function populateSettingsUI(platform: string, settings: any) {
  // Reddit settings
  if (platform === 'reddit') {
    setCheckboxValue('reddit-watch-notifications', settings.watchNotifications ?? true);
    setCheckboxValue('reddit-watch-pms', settings.watchPrivateMessages ?? true);
    setTextValue('reddit-subreddits', (settings.watchSubreddits || []).join(', '));
    setTextValue('reddit-keywords', (settings.subredditKeywords || []).join(', '));
    setCheckboxValue('reddit-auto-reply-comments', settings.autoReplyToComments ?? true);
    setCheckboxValue('reddit-auto-reply-pms', settings.autoReplyToPMs ?? true);
    setCheckboxValue('reddit-auto-reply-posts', settings.autoReplyToPosts ?? false);
    setNumberValue('reddit-poll-interval', settings.pollIntervalMs ?? 30000);
    setNumberValue('reddit-max-items', settings.maxItemsPerPoll ?? 3);
    setNumberValue('reddit-min-score', settings.minPostScore ?? 1);
    setNumberValue('reddit-max-age', settings.maxPostAge ?? 24);
    setCheckboxValue('reddit-skip-own-posts', settings.skipOwnPosts ?? true);
    setTextValue('reddit-cookie-string', settings.authCookieString ?? '');
    setTextValue('reddit-session-cookie', settings.sessionCookie ?? '');
  }
  
  // Instagram settings
  if (platform === 'instagram') {
    setCheckboxValue('instagram-watch-dms', settings.watchDirectMessages ?? true);
    setCheckboxValue('instagram-watch-requests', settings.watchMessageRequests ?? true);
    setCheckboxValue('instagram-auto-accept', settings.autoAcceptRequests ?? false);
    setNumberValue('instagram-poll-interval', settings.pollIntervalMs ?? 15000);
    setNumberValue('instagram-max-messages', settings.maxMessagesPerPoll ?? 5);
  }
  
  // Twitter settings
  if (platform === 'twitter') {
    setCheckboxValue('twitter-watch-dms', settings.watchDirectMessages ?? true);
    setCheckboxValue('twitter-watch-mentions', settings.watchMentions ?? true);
    setCheckboxValue('twitter-auto-reply-mentions', settings.autoReplyToMentions ?? true);
    setNumberValue('twitter-poll-interval', settings.pollIntervalMs ?? 20000);
    setNumberValue('twitter-max-tweets', settings.maxTweetsPerPoll ?? 3);
  }
  
  // Snapchat settings
  if (platform === 'snapchat') {
    setCheckboxValue('snapchat-watch-chats', settings.watchChats ?? true);
    setCheckboxValue('snapchat-auto-open', settings.autoOpenSnaps ?? true);
    setCheckboxValue('snapchat-skip-groups', settings.skipGroupChats ?? false);
    setNumberValue('snapchat-poll-interval', settings.pollIntervalMs ?? 10000);
    setNumberValue('snapchat-max-chats', settings.maxChatsPerPoll ?? 3);
  }
  
  // Threads settings
  if (platform === 'threads') {
    setCheckboxValue('threads-watch-activity', settings.watchActivityColumn ?? true);
    setCheckboxValue('threads-activity-priority', settings.activityPriority ?? true);
    setCheckboxValue('threads-auto-reply', settings.autoReplyToComments ?? true);
    setNumberValue('threads-poll-interval', settings.pollIntervalMs ?? 60000);
    setNumberValue('threads-max-comments', settings.maxCommentsPerPoll ?? 5);
  }
}

function setCheckboxValue(id: string, value: boolean) {
  const checkbox = document.getElementById(id) as HTMLInputElement;
  if (checkbox) checkbox.checked = value;
}

function setTextValue(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  if (input) input.value = value;
}

function setNumberValue(id: string, value: number) {
  const input = document.getElementById(id) as HTMLInputElement;
  if (input) input.value = value.toString();
}

function getCheckboxValue(id: string): boolean {
  const checkbox = document.getElementById(id) as HTMLInputElement;
  return checkbox ? checkbox.checked : false;
}

function getTextValue(id: string): string {
  const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  return input ? input.value.trim() : '';
}

function getNumberValue(id: string): number {
  const input = document.getElementById(id) as HTMLInputElement;
  return input ? parseInt(input.value) || 0 : 0;
}

function collectCurrentSettings(platform: string): any {
  const settings: any = {};
  
  if (platform === 'reddit') {
    settings.watchNotifications = getCheckboxValue('reddit-watch-notifications');
    settings.watchPrivateMessages = getCheckboxValue('reddit-watch-pms');
    settings.watchSubreddits = getTextValue('reddit-subreddits').split(',').map(s => s.trim()).filter(s => s);
    settings.subredditKeywords = getTextValue('reddit-keywords').split(',').map(s => s.trim()).filter(s => s);
    settings.autoReplyToComments = getCheckboxValue('reddit-auto-reply-comments');
    settings.autoReplyToPMs = getCheckboxValue('reddit-auto-reply-pms');
    settings.autoReplyToPosts = getCheckboxValue('reddit-auto-reply-posts');
    settings.pollIntervalMs = getNumberValue('reddit-poll-interval');
    settings.maxItemsPerPoll = getNumberValue('reddit-max-items');
    settings.minPostScore = getNumberValue('reddit-min-score');
    settings.maxPostAge = getNumberValue('reddit-max-age');
    settings.skipOwnPosts = getCheckboxValue('reddit-skip-own-posts');
    settings.authCookieString = getTextValue('reddit-cookie-string');
    settings.sessionCookie = getTextValue('reddit-session-cookie');
  }
  
  if (platform === 'instagram') {
    settings.watchDirectMessages = getCheckboxValue('instagram-watch-dms');
    settings.watchMessageRequests = getCheckboxValue('instagram-watch-requests');
    settings.autoAcceptRequests = getCheckboxValue('instagram-auto-accept');
    settings.pollIntervalMs = getNumberValue('instagram-poll-interval');
    settings.maxMessagesPerPoll = getNumberValue('instagram-max-messages');
  }
  
  if (platform === 'twitter') {
    settings.watchDirectMessages = getCheckboxValue('twitter-watch-dms');
    settings.watchMentions = getCheckboxValue('twitter-watch-mentions');
    settings.autoReplyToMentions = getCheckboxValue('twitter-auto-reply-mentions');
    settings.pollIntervalMs = getNumberValue('twitter-poll-interval');
    settings.maxTweetsPerPoll = getNumberValue('twitter-max-tweets');
  }
  
  if (platform === 'snapchat') {
    settings.watchChats = getCheckboxValue('snapchat-watch-chats');
    settings.autoOpenSnaps = getCheckboxValue('snapchat-auto-open');
    settings.skipGroupChats = getCheckboxValue('snapchat-skip-groups');
    settings.pollIntervalMs = getNumberValue('snapchat-poll-interval');
    settings.maxChatsPerPoll = getNumberValue('snapchat-max-chats');
  }
  
  if (platform === 'threads') {
    settings.watchActivityColumn = getCheckboxValue('threads-watch-activity');
    settings.activityPriority = getCheckboxValue('threads-activity-priority');
    settings.autoReplyToComments = getCheckboxValue('threads-auto-reply');
    settings.pollIntervalMs = getNumberValue('threads-poll-interval');
    settings.maxCommentsPerPoll = getNumberValue('threads-max-comments');
  }
  
  return settings;
}

function saveSiteSettings() {
  try {
    const platform = sitePlatformSelect.value;
    const settings = collectCurrentSettings(platform);
    
    // Load existing settings
    const stored = localStorage.getItem('siteSettings');
    const allSettings = stored ? JSON.parse(stored) : {};
    
    // Update settings for current platform
    allSettings[platform] = settings;
    
    // Save back to storage
    localStorage.setItem('siteSettings', JSON.stringify(allSettings));
    
    currentSiteSettings = settings;
    
    addLog(`Site settings saved for ${platform}`, 'success');
    
    // TODO: Send settings to main process for bot configuration
    // await (window as any).siteSettings.updateSettings(platform, settings);
    
  } catch (e) {
    console.error('Error saving site settings:', e);
    addLog('Failed to save site settings', 'error');
  }
}

function getStoredPlatformSiteSettings(platform: string): any {
  try {
    const raw = localStorage.getItem('siteSettings');
    const allSettings = raw ? JSON.parse(raw) : {};
    return allSettings[platform] || {};
  } catch (error) {
    console.error('Error reading site settings from storage:', error);
    return {};
  }
}

function applySiteSettingsToConfig(baseConfig: Config, hostname: string): Config {
  const site = detectSiteFromHost(hostname);
  const mergedConfig: Config = { ...(baseConfig || ({} as Config)) };

  if (site === 'reddit') {
    const storedRedditSettings = getStoredPlatformSiteSettings('reddit');
    const mergedReddit = {
      ...(mergedConfig.reddit || {}),
      ...storedRedditSettings
    };

    // Keep both keys in sync for backward compatibility.
    if (mergedReddit.maxItemsPerPoll !== undefined && mergedReddit.maxCommentsPerPoll === undefined) {
      mergedReddit.maxCommentsPerPoll = mergedReddit.maxItemsPerPoll;
    }
    if (mergedReddit.maxCommentsPerPoll !== undefined && mergedReddit.maxItemsPerPoll === undefined) {
      mergedReddit.maxItemsPerPoll = mergedReddit.maxCommentsPerPoll;
    }

    mergedConfig.reddit = mergedReddit;
  }

  return mergedConfig;
}

// Initialize site settings when panel opens
function initializeSiteSettings() {
  // Restore collapse state
  const savedCollapsed = localStorage.getItem('siteSettingsCollapsed');
  if (savedCollapsed === 'true') {
    isSiteSettingsCollapsed = true;
    siteSettingsSection.classList.add('collapsed');
  }
  
  // Load settings for current platform
  loadSiteSettingsForCurrentPlatform();
}

// Event listeners for site settings
siteSettingsHeader.addEventListener('click', toggleSiteSettingsCollapse);
siteCollapseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSiteSettingsCollapse();
});

// Add refresh button listener
const siteRefreshBtn = document.getElementById('site-settings-refresh')!;
siteRefreshBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  refreshSiteSettingsForSession();
  addLog('Site settings manually refreshed', 'info');
});

sitePlatformSelect.addEventListener('change', (e) => {
  const platform = (e.target as HTMLSelectElement).value;
  switchPlatformSettings(platform);
  loadSiteSettingsFromStorage(platform);
});

saveSiteSettingsBtn.addEventListener('click', saveSiteSettings);

// Keyboard shortcut: Arrow Up to collapse site settings
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && isPanelOpen && !isSiteSettingsCollapsed) {
    e.preventDefault();
    toggleSiteSettingsCollapse();
  }
});

// ============================================================================
// End Site-Specific Settings
// ============================================================================

// Minimize to tray
if (minimizeToTrayBtn) {
  minimizeToTrayBtn.addEventListener('click', async () => {
    try {
      await (window as any).tray.hide();
      addLog('Minimized to system tray', 'info');
    } catch (e) {
      console.error('Failed to minimize to tray:', e);
    }
  });
}

// URL
function loadUrl() {
  let url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  const currentWebview = getActiveWebview();
  if (currentWebview) {
    const webviewSessionId = getSessionIdForWebview(currentWebview) || activeSessionId;
    currentWebview.src = url;
    addLog(`Navigating to: ${url}`, 'info', webviewSessionId || undefined);
  } else {
    addLog('No active webview', 'error');
  }
}

goBtn.addEventListener('click', loadUrl);
urlInput.addEventListener('keypress', e => { if (e.key === 'Enter') loadUrl(); });

// Bot injection into webview
async function injectBotIntoWebview() {
  const currentWebview = getActiveWebview();
  if (!currentWebview || !activeSessionId) {
    addLog('No active webview or session for injection', 'error');
    return false;
  }
  
  // Get the session ID for this specific webview
  const webviewSessionId = getSessionIdForWebview(currentWebview) || activeSessionId;
  
  try {
    // Use session-specific configuration
    let config = sessionConfigs.get(activeSessionId);
    if (!config) {
      // Fallback to global config
      const { config: globalConfig } = await (window as any).bot.getStatus();
      config = globalConfig || {
        initialUrl: 'https://web.snapchat.com',
        autoInject: false,
        replyRules: [],
        typingDelayRangeMs: [50, 150],
        preReplyDelayRangeMs: [2000, 6000],
        maxRepliesPerMinute: 5,
        maxRepliesPerHour: 30,
        randomSkipProbability: 0.15
      };
    }
    let hostname = '';
    try {
      hostname = await currentWebview.executeJavaScript('location.hostname || ""');
    } catch {
      hostname = '';
    }
    
    addLog(`Injecting bot for host: ${hostname || 'unknown'}`, 'info', webviewSessionId);

    const resolvedConfig = applySiteSettingsToConfig(config as Config, hostname);

    // Inject the bot script into the webview
    const botScript = await getBotScript(resolvedConfig, hostname);
    
    // Try injection with error details
    try {
      await currentWebview.executeJavaScript(botScript);
      addLog('Bot injected successfully', 'success', webviewSessionId);
      
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
          addLog('Could not verify bot status', 'error', webviewSessionId);
        }
      }, 1000);
      
      return true;
    } catch (injErr: any) {
      addLog(`Script error: ${injErr.message || injErr}`, 'error', webviewSessionId);
      // Try a simpler test script
      try {
        await currentWebview.executeJavaScript('console.log("[Snappy] Test injection works")');
        addLog('Basic injection works - bot script has syntax error', 'error', webviewSessionId);
      } catch {
        addLog('Webview not ready for injection', 'error', webviewSessionId);
      }
      return false;
    }
  } catch (e) {
    addLog(`Injection failed: ${e}`, 'error', webviewSessionId);
    return false;
  }
}

async function stopBotInWebview() {
  const currentWebview = getActiveWebview();
  if (!currentWebview) return;
  
  const webviewSessionId = getSessionIdForWebview(currentWebview) || activeSessionId;
  
  try {
    await currentWebview.executeJavaScript('if(window.__SNAPPY_STOP__) window.__SNAPPY_STOP__();');
    addLog('Bot stopped', 'info', webviewSessionId || undefined);
  } catch (e) {
    addLog(`Stop failed: ${e}`, 'error', webviewSessionId || undefined);
  }
}

// Bot toggle
botBtn.addEventListener('click', async () => {
  if (!activeSessionId) {
    addLog('No active session', 'error');
    return;
  }

  if (isBotActive) {
    await stopBotInWebview();
    isBotActive = false;
    statusDot.classList.remove('active');
    statusText.textContent = 'Inactive';
    botBtn.textContent = 'Start';
    
    // Stop llama server if this session had one running
    if (activeSessionId) {
      const serverInfo = sessionServerPids.get(activeSessionId);
      console.log(`[Bot Stop] Session ${activeSessionId}, serverInfo:`, serverInfo);
      if (serverInfo) {
        addLog(`Stopping Llama.cpp server (PID: ${serverInfo.pid})...`, 'info');
        try {
          const stopResult = await (window as any).llama.stopByPid(serverInfo.pid);
          console.log(`[Bot Stop] stopByPid result:`, stopResult);
          if (!stopResult.error) {
            sessionServerPids.delete(activeSessionId);
            addLog('Llama.cpp server stopped', 'success');
          } else {
            addLog(`Warning: ${stopResult.error}`, 'error');
          }
          updateLlamaUI();
        } catch (e) {
          addLog(`Error stopping Llama server: ${e}`, 'error');
        }
      } else {
        addLog('No Llama server tracked for this session', 'info');
      }
    }
    
    // Update session bot status across all windows
    await (window as any).session.updateBotStatus(activeSessionId, 'inactive');
  } else {
    addLog('Starting bot...', 'highlight');
    
    // Start llama server only if using local AI provider and server is enabled
    const currentAIProvider = aiProvider?.value || 'local';
    if (currentAIProvider === 'local' && llamaServerConfig.enabled && activeSessionId) {
      addLog('Starting Llama.cpp server...', 'info');
      console.log(`[Bot Start] Starting llama for session ${activeSessionId}`);
      await (window as any).llama.saveConfig(llamaServerConfig);
      const startResult = await (window as any).llama.start();
      console.log(`[Bot Start] Result:`, startResult);
      if (startResult.running && startResult.pid) {
        // Track PID for this session
        sessionServerPids.set(activeSessionId, { pid: startResult.pid, startTime: startResult.startTime || Date.now() });
        console.log(`[Bot Start] Tracked PID ${startResult.pid} for session ${activeSessionId}`);
        addLog(`Llama.cpp server started (PID: ${startResult.pid})`, 'success');
        updateLlamaUI();
      } else {
        addLog(`Warning: Failed to start Llama.cpp server: ${startResult.error}`, 'error');
        // Continue with bot startup anyway
      }
    } else if (currentAIProvider === 'chatgpt') {
      addLog('Using ChatGPT API (no local server needed)', 'info');
    }
    
    const success = await injectBotIntoWebview();
    if (success) {
      isBotActive = true;
      statusDot.classList.add('active');
      statusText.textContent = 'Active';
      botBtn.textContent = 'Stop';
      
      // Update session bot status across all windows
      await (window as any).session.updateBotStatus(activeSessionId, 'active');
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

// Save configuration for active session
saveBtn.addEventListener('click', async () => {
  if (!activeSessionId) {
    addLog('No active session to save configuration for', 'error');
    return;
  }

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
      provider: aiProvider?.value as 'local' | 'chatgpt' || 'local',
      llmEndpoint: '127.0.0.1', // Configured via llama server
      llmPort: 8081, // Configured via llama server start command
      modelName: 'llama', // Configured via llama server start command
      systemPrompt: aiPrompt?.value || '',
      temperature: parseFloat(aiTemp?.value) || 0.7,
      maxTokens: parseInt(aiTokens?.value) || 150,
      contextHistoryEnabled: aiContext?.checked || true,
      maxContextMessages: parseInt(aiHistory?.value) || 10,
      requestTimeoutMs: 30000,
      maxRetries: 3,
      retryBackoffMs: 1000,
      chatgptApiKey: chatgptApiKey?.value || '',
      chatgptModel: chatgptModel?.value || 'gpt-3.5-turbo',
      chatgptBaseUrl: chatgptBaseUrl?.value || 'https://api.openai.com/v1'
    },
    llama: {
      buildPath: llamaBuildPathInput?.value || '',
      startCommand: llamaStartCommandInput?.value || '',
      enabled: llamaEnabledCheckbox?.checked || false
    }
  };

  // Save to session-specific storage
  sessionConfigs.set(activeSessionId, config);
  
  // Also save via session manager for persistence
  try {
    await (window as any).session.updateSessionConfig(activeSessionId, config);
  } catch (e) {
    console.log('Session API not available, using local storage only');
  }

  saveBtn.textContent = 'Saved';
  addLog(`Configuration saved for session: ${activeSessionId.substring(0, 8)}...`, 'success');
  
  // Add visual indicator to tab that it has custom settings
  updateTabCustomSettingsIndicator(activeSessionId);
  
  setTimeout(() => { saveBtn.textContent = 'Save'; }, 1000);
});

// Load global default configuration (fallback)
async function loadConfig() {
  try {
    const { config } = await (window as any).bot.getStatus();
    if (!config) return;
    
    // Store as default config for new sessions
    const defaultConfig: Config = {
      initialUrl: config.initialUrl || 'https://web.snapchat.com',
      autoInject: config.autoInject || false,
      replyRules: config.replyRules || [],
      typingDelayRangeMs: config.typingDelayRangeMs || [50, 150],
      preReplyDelayRangeMs: config.preReplyDelayRangeMs || [2000, 6000],
      maxRepliesPerMinute: config.maxRepliesPerMinute || 5,
      maxRepliesPerHour: config.maxRepliesPerHour || 30,
      randomSkipProbability: config.randomSkipProbability || 0.15,
      ai: config.ai || {
        enabled: false,
        llmEndpoint: 'localhost',
        llmPort: 8080,
        modelName: 'local-model',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 150,
        contextHistoryEnabled: true,
        maxContextMessages: 10
      },
      llama: {
        buildPath: '',
        startCommand: '',
        enabled: false
      }
    };
    
    // If no active session, load into UI as default
    if (!activeSessionId) {
      loadConfigIntoUI(defaultConfig);
    }
  } catch (e) {
    console.error('Load failed:', e);
  }
}

// Load session-specific configuration
function loadSessionConfig(sessionId: string) {
  let config = sessionConfigs.get(sessionId);
  
  if (!config) {
    // Create default config for new session
    config = {
      initialUrl: 'https://web.snapchat.com',
      autoInject: false,
      replyRules: [],
      typingDelayRangeMs: [50, 150],
      preReplyDelayRangeMs: [2000, 6000],
      maxRepliesPerMinute: 5,
      maxRepliesPerHour: 30,
      randomSkipProbability: 0.15,
      ai: {
        enabled: false,
        provider: 'local' as 'local' | 'chatgpt',
        llmEndpoint: 'localhost',
        llmPort: 8080,
        modelName: 'local-model',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 150,
        contextHistoryEnabled: true,
        maxContextMessages: 10,
        requestTimeoutMs: 30000,
        maxRetries: 3,
        retryBackoffMs: 1000,
        chatgptApiKey: '',
        chatgptModel: 'gpt-3.5-turbo',
        chatgptBaseUrl: 'https://api.openai.com/v1'
      },
      llama: {
        buildPath: '',
        startCommand: '',
        enabled: false
      }
    };
    sessionConfigs.set(sessionId, config!);
  }
  
  loadConfigIntoUI(config!);
}

// Load configuration into UI elements
function loadConfigIntoUI(config: Config) {
  urlInput.value = config.initialUrl || 'https://web.snapchat.com';
  autoInject.checked = config.autoInject || false;
  typingMin.value = String(config.typingDelayRangeMs?.[0] || 50);
  typingMax.value = String(config.typingDelayRangeMs?.[1] || 150);
  delayMin.value = String(config.preReplyDelayRangeMs?.[0] || 2000);
  delayMax.value = String(config.preReplyDelayRangeMs?.[1] || 6000);
  rateMinute.value = String(config.maxRepliesPerMinute || 5);
  rateHour.value = String(config.maxRepliesPerHour || 30);
  skipRate.value = String(Math.round((config.randomSkipProbability || 0.15) * 100));
  
  // Load reply rules
  rulesContainer.innerHTML = '';
  (config.replyRules || []).forEach((r: ReplyRule) => addRule(String(r.match), r.reply));
  
  // Load AI settings
  if (config.ai) {
    if (aiEnabled) aiEnabled.checked = config.ai.enabled || false;
    if (aiProvider) {
      aiProvider.value = config.ai.provider || 'local';
      // Trigger provider change to show/hide appropriate settings
      const event = new Event('change');
      aiProvider.dispatchEvent(event);
    }
    if (aiPrompt) aiPrompt.value = config.ai.systemPrompt || '';
    if (aiTemp) {
      aiTemp.value = String(config.ai.temperature || 0.7);
      aiTempVal.textContent = String(config.ai.temperature || 0.7);
    }
    if (aiTokens) aiTokens.value = String(config.ai.maxTokens || 150);
    if (aiContext) aiContext.checked = config.ai.contextHistoryEnabled !== false;
    if (aiHistory) aiHistory.value = String(config.ai.maxContextMessages || 10);
    
    // Load ChatGPT settings
    if (chatgptApiKey) chatgptApiKey.value = config.ai.chatgptApiKey || '';
    if (chatgptModel) chatgptModel.value = config.ai.chatgptModel || 'gpt-3.5-turbo';
    if (chatgptBaseUrl) chatgptBaseUrl.value = config.ai.chatgptBaseUrl || 'https://api.openai.com/v1';
  }
  
  // Load Llama settings
  if (config.llama) {
    if (llamaBuildPathInput) llamaBuildPathInput.value = config.llama.buildPath || '';
    if (llamaStartCommandInput) llamaStartCommandInput.value = config.llama.startCommand || '';
    if (llamaEnabledCheckbox) llamaEnabledCheckbox.checked = config.llama.enabled || false;
    
    // Update the global llamaServerConfig for this session
    llamaServerConfig = {
      buildPath: config.llama.buildPath || '',
      startCommand: config.llama.startCommand || '',
      enabled: config.llama.enabled || false
    };
  }
}

// Generate the Snapchat bot script to inject into webview
async function getSnapchatBotScript(config: Config): Promise<string> {
  try {
    const bridgedScript = await (window as any).bot?.getSnapchatBotScript?.(config);
    if (typeof bridgedScript === 'string' && bridgedScript.length > 0) {
      return bridgedScript;
    }
  } catch {
    // Fall back to inlined script below if IPC/preload path is unavailable.
  }

  return `
(function() {
  if (window.__SNAPPY_RUNNING__) {
    console.log('[Snappy] Already running');
    return;
  }
  window.__SNAPPY_RUNNING__ = true;
  
  const CONFIG = ${JSON.stringify(config)};
  const seenMessages = new Set();
  const lastRepliedMessage = new Map(); // Track last message we replied to per user: username -> messageText
  let pollInterval = null;
  let isProcessing = false; // Lock to prevent concurrent processing

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
  // SNAPCHAT USES: .O4POs for each chat row
  function findClickableChats() {
    // EXACT SELECTOR: .O4POs = every chat row in sidebar
    const chatRows = Array.from(document.querySelectorAll('.O4POs'));
    log('Found ' + chatRows.length + ' chat rows (.O4POs)');
    return chatRows;
  }
  
  // Check if a chat has a new INCOMING message (not our outgoing "Delivered" messages)
  // SNAPCHAT USES:
  //   .qFDXZ class on .O4POs = unread message
  //   .GQKvA span = message status ("Received", "Sent", "Delivered", etc.)
  function isNewIncomingChat(element) {
    // STEP 0: Block Snapchat official accounts
    const username = getUsernameFromChatRow(element);
    if (username) {
      const usernameLower = username.toLowerCase();

      // Block list: Snapchat official accounts
      const blockedAccounts = [
        'my ai',
        'team snapchat',
        'snapchat',
        'snapchat support',
        'snapchat team'
      ];

      for (const blocked of blockedAccounts) {
        if (usernameLower.includes(blocked)) {
          log('Skipping blocked account: "' + username + '"');
          return false;
        }
      }
    }

    // STEP 1: MUST have unread indicator - this is the PRIMARY requirement
    // .qFDXZ = unread class on chat row
    const isUnread = element.classList.contains('qFDXZ');

    // STEP 2: Check for "New Chat" or "New Snap" status text (also indicates unread)
    const chatText = (element.textContent || '').toLowerCase();
    const hasNewChatText = chatText.includes('new chat') || chatText.includes('new snap');

    // STEP 3: Check for unread badge/indicator element
    const hasUnreadBadge = element.querySelector('.HEkDJ') !== null ||
                          element.querySelector('[class*="badge"]') !== null;

    // MUST have at least one unread indicator
    if (!isUnread && !hasNewChatText && !hasUnreadBadge) {
      return false;
    }

    if (isUnread) {
      log('Chat has unread indicator (.qFDXZ)');
    }
    if (hasNewChatText) {
      log('Chat has "new chat" text');
    }
    if (hasUnreadBadge) {
      log('Chat has unread badge element');
    }

    // STEP 4: Check the message status - must NOT be an outgoing status or already-handled status
    const statusSpan = element.querySelector('.GQKvA .tGtEY .nonIntl') || element.querySelector('.GQKvA');
    if (statusSpan) {
      const status = statusSpan.textContent.trim().toLowerCase();
      log('Message status: "' + status + '"');

      // CRITICAL: Skip BOTH outgoing statuses AND already-received statuses
      // Outgoing = we sent it to them
      // Received/Delivered = either we got their message OR they got ours (ambiguous!)
      const skipStatuses = [
        'delivered',   // Message was delivered (either direction - skip to be safe)
        'sent',        // We sent a message
        'opened',      // They opened our message
        'viewed',      // They viewed our message
        'screenshot',  // They screenshotted
        'replayed',    // They replayed
        'received'     // Message received (either direction - skip to be safe)
      ];

      if (skipStatuses.includes(status)) {
        log('Skipping - status "' + status + '" indicates already-handled or outgoing message');
        return false;
      }

      // ONLY accept clearly new/incoming statuses
      const acceptedStatuses = [
        'typing',
        'typing...',
        'typing…',
        'new chat',
        'new snap'
      ];

      if (acceptedStatuses.some(s => status.includes(s))) {
        log('Status "' + status + '" with unread indicator = NEW incoming message');
        return true;
      }

      // If status is not in skip list OR accept list, log and skip to be safe
      log('Unknown status "' + status + '" - skipping to be safe');
      return false;
    }

    // Has unread indicator but no status - accept as incoming (might be a new message loading)
    log('Has unread indicator but no status - assuming incoming');
    return true;
  }
  
  // Debug function to analyze a chat element
  function debugChatElement(element, index) {
    const text = (element.textContent || '').substring(0, 50);
    const cls = (element.className || '').substring(0, 50);

    // Check key indicators
    const hasQFDXZ = element.classList.contains('qFDXZ');
    const username = getUsernameFromChatRow(element);
    const statusSpan = element.querySelector('.GQKvA');
    const status = statusSpan ? statusSpan.textContent.trim() : 'none';

    log('Chat ' + index + ': user="' + (username || 'unknown') + '" status="' + status + '" unread=' + hasQFDXZ);
    log('  Text: "' + text + '"');
    log('  Classes: "' + cls + '"');
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
  // expectedSender: The username we expect to see (to verify we're not reading stale cache)
  function getVisibleMessages(expectedSender) {
    const messages = [];
    let detectedSender = null;

    // SNAPCHAT MESSAGE STRUCTURE:
    // <ul class="MibAa"> (main container)
    //   <li class="T1yt2"> (date group - e.g. "December 4")
    //     <div>
    //       <ul class="ujRzj"> (messages for that date)
    //   <li class="T1yt2"> (LAST = most recent date!)
    //     <div>
    //       <ul class="ujRzj"> (NEWEST messages - this is what we want!)

    // STEP 1: Find the main container (ul.MibAa)
    const mainContainer = document.querySelector('ul.MibAa');
    let messageList = null;

    if (mainContainer) {
      log('Found main container (ul.MibAa)');

      // STEP 2: Get ALL <li class="T1yt2"> (these can be date headers OR message groups)
      const allDateGroups = Array.from(mainContainer.querySelectorAll(':scope > li.T1yt2'));
      log('Found ' + allDateGroups.length + ' li.T1yt2 elements');

      // Filter to only those that have ul.ujRzj (actual message groups, not just date headers)
      const messageGroups = allDateGroups.filter(li => li.querySelector('ul.ujRzj') !== null);
      log('Filtered to ' + messageGroups.length + ' groups with messages');

      if (messageGroups.length > 0) {
        // Get the LAST message group
        const lastGroup = messageGroups[messageGroups.length - 1];
        log('Using LAST message group (index ' + (messageGroups.length - 1) + ')');

        // DEBUG: Show what's in this group
        const header = lastGroup.querySelector('header.R1ne3 span.nonIntl');
        const sender = header ? header.textContent.trim() : 'unknown';
        log('  Sender in last group: "' + sender + '"');

        // STEP 3: Find ul.ujRzj inside this last group
        const nestedUl = lastGroup.querySelector('ul.ujRzj');
        if (nestedUl) {
          messageList = nestedUl;
          const msgCount = nestedUl.querySelectorAll(':scope > li').length;
          log('  Found ul.ujRzj with ' + msgCount + ' messages');
        } else {
          log('WARNING: No ul.ujRzj found in last group!');
        }
      }
    } else {
      log('Main container (ul.MibAa) not found, trying fallback...');

      // FALLBACK: Find largest visible ul.ujRzj (old method)
      const allMessageLists = Array.from(document.querySelectorAll('ul.ujRzj'));
      log('Found ' + allMessageLists.length + ' ul.ujRzj elements (fallback)');

      let maxArea = 0;
      for (const ul of allMessageLists) {
        const rect = ul.getBoundingClientRect();
        const area = rect.width * rect.height;

        if (rect.width > 0 && rect.height > 200 && area > maxArea) {
          const isInViewport = rect.top < window.innerHeight && rect.bottom > 0 &&
                              rect.left < window.innerWidth && rect.right > 0;
          if (isInViewport) {
            messageList = ul;
            maxArea = area;
          }
        }
      }
    }

    if (!messageList) {
      log('ERROR: Could not find any visible message list');
      return messages;
    }

    // DEBUG: Log details about the selected message list
    const listItemCount = messageList.querySelectorAll(':scope > li').length;
    log('Selected message list with ' + listItemCount + ' message items');

    // The messageList is now always a ul.ujRzj (nested), so process its direct <li> children
    let messagesToProcess = [];
    const messageItems = Array.from(messageList.querySelectorAll(':scope > li'));

    for (const item of messageItems) {
      messagesToProcess.push({
        group: messageList.closest('li.T1yt2') || messageList.parentElement,
        item: item,
        index: messagesToProcess.length
      });
    }

    // OLD FALLBACK CODE (kept for reference, but shouldn't be needed now)
    if (messagesToProcess.length === 0) {
      // messageList is the main container, need to find nested ul.ujRzj inside <li class="T1yt2">
      const allTopLevelLis = Array.from(messageList.querySelectorAll(':scope > li.T1yt2, :scope > li'));
      log('Found ' + allTopLevelLis.length + ' top-level message groups');
      
      if (allTopLevelLis.length === 0) {
        log('No message groups found');
        return messages;
      }

      // ONLY process the LAST 2 top-level groups (most recent messages)
      // Each group is usually a date section (e.g., "December 5")
      const groupsToCheck = Math.min(2, allTopLevelLis.length);
      log('Processing last ' + groupsToCheck + ' message groups (most recent)');

      for (let i = allTopLevelLis.length - 1; i >= allTopLevelLis.length - groupsToCheck; i--) {
        const group = allTopLevelLis[i];
        
        // Within each group, find the nested <ul class="ujRzj"> inside a <div>
        // Structure: <li class="T1yt2"> -> <div> -> <ul class="ujRzj"> -> <li> (messages)
        let nestedUl = null;
        
        // Look for divs that contain ul.ujRzj
        const divs = group.querySelectorAll('div');
        for (const div of divs) {
          // Check if this div has a direct child ul.ujRzj
          const directUl = Array.from(div.children).find(child => 
            child.tagName === 'UL' && child.classList.contains('ujRzj')
          );
          if (directUl) {
            nestedUl = directUl;
            log('Group ' + i + ': Found nested ul.ujRzj as direct child of div');
            break;
          }
        }
        
        // If not found, look for any ul.ujRzj within the group
        if (!nestedUl) {
          const allUls = Array.from(group.querySelectorAll('ul.ujRzj'));
          for (const ul of allUls) {
            // Verify it's nested (inside a div within the group)
            const parentDiv = ul.closest('div');
            if (parentDiv && group.contains(parentDiv)) {
              nestedUl = ul;
              log('Group ' + i + ': Found nested ul.ujRzj via querySelector');
              break;
            }
          }
        }
        
        if (nestedUl) {
          const nestedLis = Array.from(nestedUl.querySelectorAll(':scope > li'));
          log('Group ' + i + ': Found nested ul.ujRzj with ' + nestedLis.length + ' message items');
          
          // Process each nested <li> in this group
          for (const nestedLi of nestedLis) {
            messagesToProcess.push({ group: group, item: nestedLi, index: messagesToProcess.length });
          }
        } else {
          // Check if this group has a direct message bubble (no nested ul)
          const directBubble = group.querySelector('div.KB4Aq');
          if (directBubble) {
            log('Group ' + i + ': Found direct message bubble (no nested ul)');
            messagesToProcess.push({ group: group, item: group, index: messagesToProcess.length, isDirect: true });
          }
        }
      }
    }
    
    log('Total messages to process: ' + messagesToProcess.length);

    // PRIORITY: Process ONLY the LAST group (most recent messages) first
    // If the user just sent a message, we want to see their LATEST message, not old cached ones
    if (messagesToProcess.length > 0) {
      log('Prioritizing LAST message group (index ' + (messagesToProcess.length - 1) + ') as most recent');
    }

    // Process the last few messages (keep in chronological order: oldest -> newest)
    messagesToProcess = messagesToProcess.slice(-5); // Get last 5 messages

    for (const msgData of messagesToProcess) {
      const messageItem = msgData.item;
      const parentGroup = msgData.group;
      
      // Check if this message item or its parent group has a header (indicates sender)
      const header = messageItem.querySelector('header.R1ne3') || parentGroup.querySelector('header.R1ne3');
      
      let isOutgoing = false;
      let isIncoming = false;

      if (header) {
        // Has header - determine sender from header color and text
        const headerStyle = window.getComputedStyle(header);
        const headerColor = headerStyle.color || header.getAttribute('style') || '';
        
        // Check header color: blue typically means incoming, red might mean outgoing
        // Also check the text content
        const meSpan = header.querySelector('span.nonIntl');
        const senderName = meSpan ? meSpan.textContent.trim() : '';
        
        // If sender is exactly "Me", it's our message (outgoing)
        if (senderName === 'Me') {
          isOutgoing = true;
          isIncoming = false;
          log('Message from header: "Me" [OUTGOING] color=' + headerColor);
        } else if (senderName && senderName.length > 0) {
          // Has a sender name that's not "Me", so it's incoming
          isOutgoing = false;
          isIncoming = true;

          // Track the detected sender name
          if (!detectedSender) {
            detectedSender = senderName;
          }

          log('Message from header: "' + senderName + '" [INCOMING] color=' + headerColor);
        } else {
          // No sender name, use color as fallback
          // Blue (rgb(14, 173, 255) or similar) usually means incoming
          // Red (rgb(242, 60, 87)) means outgoing
          const isBlue = headerColor.includes('rgb(14, 173, 255)') || headerColor.includes('rgb(14,173,255)') || 
                        headerColor.includes('blue') || headerColor.includes('#0eadff');
          const isRed = headerColor.includes('rgb(242, 60, 87)') || headerColor.includes('rgb(242,60,87)') ||
                       headerColor.includes('red');
          if (isBlue) {
            isIncoming = true;
            log('Message from header color: BLUE [INCOMING]');
          } else if (isRed) {
            isOutgoing = true;
            log('Message from header color: RED [OUTGOING]');
          }
        }
      }

      // Find the actual message text in span.ogn1z.nonIntl (deep in nested structure)
      // CRITICAL: Only look inside message bubbles (div.KB4Aq), NOT in headers
      // The header has span.nonIntl with the username, but we want span.ogn1z inside div.KB4Aq
      const messageBubbles = messageItem.querySelectorAll('div.KB4Aq');
      const seenTexts = new Set();

      if (messageBubbles.length === 0) {
        log('No message bubbles found in this item');
        continue;
      }

      for (const bubble of messageBubbles) {
        // CRITICAL: Only look for message text in the specific path: div.KB4Aq > div.p8r1z > span.ogn1z.nonIntl
        // This ensures we only get the actual message text, not header text
        const p8r1zDiv = bubble.querySelector('div.p8r1z');
        if (!p8r1zDiv) {
          log('No div.p8r1z found in bubble, skipping');
          continue;
        }
        
        // Look specifically for span.ogn1z.nonIntl inside div.p8r1z
        const messageTextSpans = p8r1zDiv.querySelectorAll('span.ogn1z.nonIntl[dir="auto"], span.ogn1z.nonIntl, span.ogn1z[dir="auto"]');
        
        if (messageTextSpans.length === 0) {
          log('No span.ogn1z found in div.p8r1z');
          continue;
        }
        
        for (const span of messageTextSpans) {
          // Triple-check: make sure this span is NOT inside a header (shouldn't be possible if we're in div.p8r1z, but be safe)
          if (span.closest('header.R1ne3')) {
            log('Skipping span inside header: "' + (span.textContent || '').substring(0, 20) + '"');
            continue;
          }
          
          // Make sure the span is actually inside the bubble we're processing
          if (!bubble.contains(span)) {
            log('Skipping span not in bubble');
            continue;
          }
          
          const text = span.textContent ? span.textContent.trim() : '';
          
          // Skip if empty
          if (!text || text.length < 1) {
            continue;
          }
          
          // Skip very short text (1-2 characters) that might be usernames or single letters
          if (text.length <= 2 && !text.match(/^[a-z]{2}$/i)) {
            log('Skipping very short text (likely not a message): "' + text + '"');
            continue;
          }
          
          // Skip if already seen
          if (seenTexts.has(text)) {
            log('Skipping duplicate text: "' + text + '"');
            continue;
          }
          
          // Skip if status text
          if (isStatusText(text)) {
            log('Skipping status text: "' + text + '"');
            continue;
          }
          
          // Skip if this element has child elements with text (avoid duplicates)
          const hasTextChildren = Array.from(span.children).some(child =>
            child.textContent && child.textContent.trim().length > 0
          );
          if (hasTextChildren) {
            log('Skipping span with text children: "' + text.substring(0, 30) + '"');
            continue;
          }

          seenTexts.add(text);
          
          // If we determined direction from header, use it; otherwise check message bubble
          let msgIsIncoming = isIncoming;
          if (!isIncoming && !isOutgoing) {
            // No header info, check the message bubble div.KB4Aq
            const bubbleStyle = bubble.getAttribute('style') || '';
            const bubbleColor = window.getComputedStyle(bubble).borderColor || '';
            // Blue border (rgb(14, 173, 255)) usually means incoming
            // Red border (rgb(242, 60, 87)) means outgoing
            const isBlueBubble = bubbleStyle.includes('rgb(14, 173, 255)') || bubbleStyle.includes('rgb(14,173,255)') ||
                                bubbleColor.includes('rgb(14, 173, 255)') || bubbleColor.includes('rgb(14,173,255)');
            const isRedBubble = bubbleStyle.includes('rgb(242, 60, 87)') || bubbleStyle.includes('rgb(242,60,87)') ||
                               bubbleColor.includes('rgb(242, 60, 87)') || bubbleColor.includes('rgb(242,60,87)');
            if (isBlueBubble) {
              msgIsIncoming = true;
            } else if (isRedBubble) {
              msgIsIncoming = false;
            }
          }
          
          const direction = msgIsIncoming ? 'INCOMING' : 'OUTGOING';
          log('  -> ' + direction + ': "' + text + '"');
          messages.push({ text, isIncoming: msgIsIncoming });
        }
      }
    }

    // If we didn't find messages, fall back to processing all groups more thoroughly
    if (messages.length === 0) {
      log('No messages found with new approach, processing all groups with fallback...');
      for (const group of allTopLevelLis) {
        // Find nested ul.ujRzj inside this group
        const nestedUl = group.querySelector('div > ul.ujRzj, ul.ujRzj');
        if (nestedUl) {
          const nestedLis = Array.from(nestedUl.querySelectorAll(':scope > li'));
          for (const nestedLi of nestedLis) {
            const header = nestedLi.querySelector('header.R1ne3') || group.querySelector('header.R1ne3');
            let isOutgoing = false;
            let isIncoming = false;

            if (header) {
              const meSpan = header.querySelector('span.nonIntl');
              const senderName = meSpan ? meSpan.textContent.trim() : '';
              if (senderName === 'Me') {
                isOutgoing = true;
              } else if (senderName && senderName.length > 0) {
                isIncoming = true;
              } else {
                // Check color
                const headerColor = header.getAttribute('style') || '';
                if (headerColor.includes('rgb(14, 173, 255)') || headerColor.includes('rgb(14,173,255)')) {
                  isIncoming = true;
                } else if (headerColor.includes('rgb(242, 60, 87)') || headerColor.includes('rgb(242,60,87)')) {
                  isOutgoing = true;
                }
              }
            }

            // Only look inside message bubbles, not headers
            const messageBubbles = nestedLi.querySelectorAll('div.KB4Aq');
            const seenTexts = new Set();
            for (const bubble of messageBubbles) {
              const textSpans = bubble.querySelectorAll('span.ogn1z.nonIntl, span.ogn1z');
              for (const span of textSpans) {
                // Skip if inside header
                if (span.closest('header.R1ne3')) continue;
                
                const text = span.textContent ? span.textContent.trim() : '';
                if (!text || text.length < 1 || seenTexts.has(text) || isStatusText(text)) continue;
                const hasTextChildren = Array.from(span.children).some(child =>
                  child.textContent && child.textContent.trim().length > 0
                );
                if (hasTextChildren) continue;
                seenTexts.add(text);
                
                // Determine direction if not already set
                let msgIsIncoming = isIncoming;
                if (!isIncoming && !isOutgoing) {
                  const bubbleStyle = bubble.getAttribute('style') || '';
                  if (bubbleStyle.includes('rgb(14, 173, 255)') || bubbleStyle.includes('rgb(14,173,255)')) {
                    msgIsIncoming = true;
                  } else if (bubbleStyle.includes('rgb(242, 60, 87)') || bubbleStyle.includes('rgb(242,60,87)')) {
                    msgIsIncoming = false;
                  }
                }
                
                const direction = msgIsIncoming ? 'INCOMING' : 'OUTGOING';
                log('  -> ' + direction + ': "' + text + '"');
                messages.push({ text, isIncoming: msgIsIncoming });
              }
            }
          }
        }
      }
    }

    log('Total messages collected: ' + messages.length);

    // CRITICAL VERIFICATION: Check if the detected sender matches the expected one
    if (expectedSender && detectedSender) {
      // Clean both for comparison (remove emojis, extra spaces, etc.)
      const cleanExpected = expectedSender.replace(/[^\w\s]/g, '').trim().toLowerCase();
      const cleanDetected = detectedSender.replace(/[^\w\s]/g, '').trim().toLowerCase();

      if (cleanDetected !== cleanExpected && !cleanExpected.includes(cleanDetected) && !cleanDetected.includes(cleanExpected)) {
        log('WARNING: Sender mismatch! Expected "' + expectedSender + '" but found "' + detectedSender + '"');
        log('This is likely stale/cached DOM! Returning empty to force retry.');
        return []; // Return empty to indicate stale data
      } else {
        log('Sender verification passed: "' + detectedSender + '" matches expected "' + expectedSender + '"');
      }
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
      if (isNewIncomingChat(c)) unreadCount++;
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

    // CRITICAL: Click into the input field first to show natural user behavior
    // This ensures Snapchat sees an active user clicking before typing
    window.focus(); // Ensure window has focus
    input.click(); // Click the input field
    await sleep(100); // Brief pause after click (natural behavior)
    input.focus(); // Then focus it

    // Clear first
    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = '';
    } else if ('value' in input) {
      input.value = '';
    }
    
    // Type character by character (fast defaults, still human-like)
    const delays = CONFIG.typingDelayRangeMs || [10, 35];
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Simulate key events so this behaves like typing, not paste.
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));

      if (input.getAttribute('contenteditable') === 'true') {
        const inserted = document.execCommand ? document.execCommand('insertText', false, char) : false;
        if (!inserted) {
          input.textContent = (input.textContent || '') + char;
        }
      } else if ('value' in input) {
        const el = input;
        const start = typeof el.selectionStart === 'number' ? el.selectionStart : (el.value || '').length;
        const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
        if (typeof el.setRangeText === 'function') {
          el.setRangeText(char, start, end, 'end');
        } else {
          el.value = (el.value || '') + char;
        }
      }

      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
      
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
    // CRITICAL: Ensure window has focus first (Snapchat detects this)
    // Focus the window to show user presence
    window.focus();

    // Focus the document body to ensure clicks register
    if (document.body) {
      document.body.focus();
    }

    // Focus the element itself if possible
    if (el.focus) {
      el.focus();
    }

    // Try multiple click methods

    // Method 1: Direct click
    el.click();

    // Method 2: Dispatch mouse events (more realistic to Snapchat)
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Dispatch full mouse event sequence with proper focus
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: centerX, clientY: centerY }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: centerX, clientY: centerY }));
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
  // Extract username from chat row element
  // SNAPCHAT USES: .mYSR9 > .FiLwP > .nonIntl (deeply nested!)
  function getUsernameFromChatRow(chatRow) {
    // Try nested path first (most accurate)
    const nestedSpan = chatRow.querySelector('.mYSR9 .FiLwP .nonIntl');
    if (nestedSpan) {
      return nestedSpan.textContent.trim();
    }

    // Fallback to .mYSR9 directly
    const usernameSpan = chatRow.querySelector('.mYSR9');
    if (usernameSpan) {
      return usernameSpan.textContent.trim();
    }

    return null;
  }

  // Legacy function - keep for compatibility but use getUsernameFromChatRow instead
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

  function findChatRowByUsername(username) {
    if (!username) return null;
    const target = username.trim().toLowerCase();
    const chats = findClickableChats();
    for (const row of chats) {
      const rowUsername = getUsernameFromChatRow(row);
      if (rowUsername && rowUsername.trim().toLowerCase() === target) {
        return row;
      }
    }
    return null;
  }

  async function refocusCurrentChat(username) {
    const row = findChatRowByUsername(username);
    if (!row) {
      log('Could not re-focus current chat row for: ' + username);
      return false;
    }
    clickElement(row);
    await sleep(200);
    log('Re-focused current chat: ' + username);
    return true;
  }
  
  // Process a chat
  async function processChat(chatEl, chatText) {
    // Extract username directly from .mYSR9 span (exact selector)
    const username = getUsernameFromChatRow(chatEl);

    if (!username) {
      // Fallback to old method if .mYSR9 not found
      log('WARNING: .mYSR9 not found, falling back to text parsing');
      const fallbackUsername = cleanUsername(chatText);
      if (!fallbackUsername || fallbackUsername.length < 2) {
        log('Invalid username, skipping');
        return;
      }
      log('Opening chat with (fallback): ' + fallbackUsername);
      // Continue with fallback username
      return processChat_internal(chatEl, fallbackUsername);
    }

    log('Opening chat with: ' + username);

    // Skip if username is empty or too short
    if (username.length < 2) {
      log('Invalid username, skipping');
      return;
    }

    return processChat_internal(chatEl, username);
  }

  // Track which chat we're currently monitoring
  let currentMonitoredChat = {
    username: null,
    lastMessageId: null,
    checkInterval: null
  };

  // Hard lock to prevent hopping to other conversations while processing one.
  let conversationLock = {
    active: false,
    username: null
  };

  function lockConversation(username) {
    if (!username) return;
    conversationLock.active = true;
    conversationLock.username = username;
    log('Conversation lock ON: ' + username);
  }

  function unlockConversation(reason) {
    if (!conversationLock.active) return;
    log('Conversation lock OFF (' + reason + '): ' + (conversationLock.username || 'unknown'));
    conversationLock.active = false;
    conversationLock.username = null;
  }

  // Internal chat processing (separated to avoid duplication)
  async function processChat_internal(chatEl, username) {
    lockConversation(username);

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
    log('Clicked chat: ' + username);

    // Wait briefly for conversation DOM swap, then scroll to hydrate messages.
    log('Waiting for chat to load and messages to populate...');
    await sleep(900);

    // CRITICAL: Click into the input field to ensure Snapchat detects user presence
    // This prevents the "doesn't seem to be present" detection
    try {
      const inputField = document.querySelector('[contenteditable="true"], textarea, input[type="text"]');
      if (inputField) {
        window.focus(); // Ensure window has focus
        inputField.focus(); // Focus the input field
        inputField.click(); // Click it for good measure
        log('Focused into input field to show presence');
      } else {
        log('Warning: Could not find input field to focus');
      }
    } catch (e) {
      log('Error focusing input field: ' + e.message);
    }

    await sleep(150); // Brief pause after focusing

    // Force scroll to bottom MULTIPLE times with waits to trigger lazy loading
    await scrollToLatestMessages();

    log('Finished scrolling, messages should be loaded now');

    // Process the initial messages
    const processingOutcome = await processCurrentChatMessages(username);
    if (processingOutcome === 'sent' || processingOutcome === 'no_new') {
      unlockConversation(processingOutcome);
    }

    // Start monitoring this chat for new messages
    startChatMonitoring(username);
  }

  // Helper function to scroll to latest messages
  async function scrollToLatestMessages() {
    for (let scrollAttempt = 0; scrollAttempt < 2; scrollAttempt++) {
      try {
        // Find ALL ul.ujRzj and scroll the LARGEST one (most likely to be active)
        const allLists = document.querySelectorAll('ul.ujRzj');
        log('Scroll attempt ' + (scrollAttempt + 1) + ': found ' + allLists.length + ' ul.ujRzj elements');

        let largestList = null;
        let maxHeight = 0;

        for (const list of allLists) {
          const rect = list.getBoundingClientRect();
          if (rect.height > maxHeight && rect.width > 0) {
            maxHeight = rect.height;
            largestList = list;
          }
        }

        if (largestList) {
          log('  Scrolling largest list (height=' + maxHeight.toFixed(0) + 'px)');

          // Scroll to bottom
          largestList.scrollTop = largestList.scrollHeight;

          // Also try to find and scroll the parent container
          const messageContainer = largestList.closest('[role="main"]') ||
                                  largestList.closest('.chat-container') ||
                                  largestList.parentElement;
          if (messageContainer && messageContainer.scrollTo) {
            messageContainer.scrollTop = messageContainer.scrollHeight;
          }

          // Short settle; we want quick reaction while still allowing lazy content to render.
          await sleep(350);
        } else {
          log('  No visible list found (all have height=0)');
        }
      } catch(e) {
        log('Scroll attempt ' + (scrollAttempt + 1) + ' FAILED: ' + e);
      }
    }
  }

  // Process messages in the currently open chat
  async function processCurrentChatMessages(username) {
    // Get messages using multiple methods
    // Pass expected username to verify we're not reading stale cache
    let messages = getVisibleMessages(username);
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
      log('No messages found - DOM may not have loaded yet');
      return 'no_new';
    }

    // CRITICAL CHECK: If ALL messages are from us, the DOM is stale/cached
    const incomingCount = messages.filter(m => m.isIncoming).length;
    const outgoingCount = messages.filter(m => !m.isIncoming).length;
    log('Message breakdown: ' + incomingCount + ' incoming, ' + outgoingCount + ' outgoing');

    if (incomingCount === 0 && outgoingCount > 0) {
      log('WARNING: All messages are from us - DOM is showing stale/cached data!');
      log('Chat was marked as "New Chat" or "Received" but we only see our own messages.');
      log('Possible causes: 1) DOM not fully loaded, 2) Message was deleted, 3) False unread indicator');
      return 'no_new';
    }

    // Build the latest contiguous incoming batch from the end of the chat.
    // This captures rapid multi-message sends (e.g. 3 quick messages).
    const latestIncomingBatch = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].isIncoming) {
        latestIncomingBatch.push(messages[i].text);
      } else if (latestIncomingBatch.length > 0) {
        break;
      } else {
        // Last message is outgoing; nothing new to process.
        break;
      }
    }
    latestIncomingBatch.reverse();

    if (latestIncomingBatch.length === 0) {
      log('No incoming message batch found');
      return 'no_new';
    }

    const latestIncomingText = latestIncomingBatch.join('\\n');
    const normalizedIncoming = latestIncomingBatch.map(m => m.toLowerCase().trim()).join(' || ');

    // Skip if this is actually a message we sent
    if (sentMessages.has(normalizedIncoming)) {
      log('Skipping - this is our own message');
      return 'no_new';
    }

    log('Incoming batch (' + latestIncomingBatch.length + '): ' + latestIncomingText.substring(0, 80));

    // Check if this is the same message we last replied to for this user
    const lastReplied = lastRepliedMessage.get(username);
    if (lastReplied && lastReplied === normalizedIncoming) {
      log('Already replied to this exact message from ' + username + ': "' + lastReplied.substring(0, 30) + '"');
      return 'no_new';
    }

    // Log what we last replied to for debugging
    if (lastReplied) {
      log('Last replied message from ' + username + ' was: "' + lastReplied.substring(0, 30) + '"');
      log('Current message: "' + normalizedIncoming.substring(0, 30) + '" - NEW, will process');
    } else {
      log('First message from ' + username + ', will process');
    }

    // Find reply (now async with AI support)
    const reply = await findReply(latestIncomingText, username);
    if (!reply) {
      log('No matching reply');
      // Still mark as replied so we don't keep trying to reply to a message with no match
      lastRepliedMessage.set(username, normalizedIncoming);
      return 'handled';
    }

    // Random skip
    if (Math.random() < (CONFIG.randomSkipProbability || 0.15)) {
      log('Random skip');
      // Mark as replied so we don't process again
      lastRepliedMessage.set(username, normalizedIncoming);
      return 'handled';
    }
    
    // Start typing immediately after reply generation.
    log('AI reply ready, typing now');
    
    // Type and send
    const typed = await typeMessage(reply);
    if (!typed) return 'handled';
    
    await sleep(500);
    const sent = await sendMessage();
    
    if (sent) {
      log('SUCCESS: Sent reply: ' + reply);

      // Track this as the last message we replied to for this user
      lastRepliedMessage.set(username, normalizedIncoming);
      log('Saved last replied message for ' + username + ': "' + normalizedIncoming.substring(0, 30) + '"');

      // Track this message as sent by us (to avoid replying to ourselves)
      sentMessages.add(reply.toLowerCase().trim());

      // Save their message to memory (username already cleaned above)
      latestIncomingBatch.forEach(msg => addToMemory(username, msg, true));

      // Save our reply to memory
      addToMemory(username, reply, false);

      // Log memory summary
      const summary = getMemorySummary(username);
      log('Memory for ' + username + ': ' + summary.total + ' msgs (' + summary.fromThem + ' from them, ' + summary.fromMe + ' from me)');

      // Keep the bot anchored in this conversation instead of jumping to another chat.
      await refocusCurrentChat(username);
      return 'sent';
    }
    return 'handled';
  }

  // Start monitoring the currently open chat for new messages
  function startChatMonitoring(username) {
    // Clear any existing monitor
    if (currentMonitoredChat.checkInterval) {
      clearInterval(currentMonitoredChat.checkInterval);
      log('Stopped monitoring previous chat: ' + currentMonitoredChat.username);
    }

    log('Starting to monitor chat: ' + username);
    currentMonitoredChat.username = username;
    currentMonitoredChat.lastMessageId = null;

    // Check for new messages frequently while staying in the current chat.
    const monitorIntervalMs = CONFIG.chatMonitorIntervalMs || 1000;
    currentMonitoredChat.checkInterval = setInterval(async () => {
      if (!window.__SNAPPY_RUNNING__) {
        clearInterval(currentMonitoredChat.checkInterval);
        return;
      }

      try {
        // Re-scan the DOM for messages
        let messages = getVisibleMessages(username);

        if (messages.length === 0) {
          return;
        }

        // Build the latest contiguous incoming batch for change detection.
        const latestIncomingBatch = [];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].isIncoming) {
            latestIncomingBatch.push(messages[i].text);
          } else if (latestIncomingBatch.length > 0) {
            break;
          } else {
            break;
          }
        }
        latestIncomingBatch.reverse();

        if (latestIncomingBatch.length === 0) {
          return;
        }

        // Create a unique ID for this incoming batch.
        const msgId = username + '::' + latestIncomingBatch.map(m => m.toLowerCase().trim()).join(' || ');

        // Check if this is a NEW message we haven't seen before
        if (currentMonitoredChat.lastMessageId === null) {
          // First check - just record the message ID
          currentMonitoredChat.lastMessageId = msgId;
          log('[Monitor] Initial batch recorded (' + latestIncomingBatch.length + ')');
        } else if (currentMonitoredChat.lastMessageId !== msgId) {
          // NEW MESSAGE DETECTED!
          log('[Monitor] NEW MESSAGE DETECTED!');
          currentMonitoredChat.lastMessageId = msgId;

          // Scroll to see the latest
          await scrollToLatestMessages();

          // Short settle before parsing message nodes
          await sleep(150);

          // Process the new message
          await processCurrentChatMessages(username);
        }
      } catch (e) {
        log('[Monitor] Error checking for new messages: ' + e);
      }
    }, monitorIntervalMs);
  }

  // Stop monitoring when we leave the chat
  function stopChatMonitoring() {
    if (currentMonitoredChat.checkInterval) {
      clearInterval(currentMonitoredChat.checkInterval);
      log('Stopped monitoring chat: ' + currentMonitoredChat.username);
      currentMonitoredChat.username = null;
      currentMonitoredChat.lastMessageId = null;
      currentMonitoredChat.checkInterval = null;
    }
  }

  // Main poll function
  let pollCount = 0;
  async function poll() {
    if (!window.__SNAPPY_RUNNING__) return;

    // Check if already processing - if so, skip this poll cycle
    if (isProcessing) {
      log('Already processing, skipping this poll cycle');
      return;
    }

    if (conversationLock.active && conversationLock.username) {
      const lockedChat = findChatRowByUsername(conversationLock.username);
      if (!lockedChat) {
        log('Conversation lock active but row not found for: ' + conversationLock.username);
        return;
      }

      isProcessing = true;
      try {
        const chatText = lockedChat.textContent?.trim().substring(0, 50) || 'Unknown';
        await processChat(lockedChat, chatText);
      } finally {
        isProcessing = false;
        log('Finished locked conversation poll cycle');
      }
      return;
    }

    pollCount++;
    log('--- Poll #' + pollCount + ' ---');
    
    const chats = findClickableChats();
    log('Found ' + chats.length + ' chat items');

    // Debug first 5 chats on every poll (to see what we're detecting)
    if (chats.length > 0) {
      log('Showing first ' + Math.min(5, chats.length) + ' chats:');
      for (let i = 0; i < Math.min(5, chats.length); i++) {
        debugChatElement(chats[i], i);
      }
    }

    // Find chats with unread
    const unreadChats = [];
    for (const chat of chats) {
      if (isNewIncomingChat(chat)) {
        unreadChats.push(chat);
      }
    }

    log('Unread chats: ' + unreadChats.length);

    // Only process chats with actual unread indicators
    if (unreadChats.length === 0) {
      log('No unread messages to process');
      return;
    }

    // Prefer staying in the currently monitored conversation if it still exists.
    let chat = unreadChats[0];
    let username = getUsernameFromChatRow(chat);
    if (currentMonitoredChat.username) {
      const currentUsername = currentMonitoredChat.username;
      const matchingUnread = unreadChats.find(c => {
        const name = getUsernameFromChatRow(c);
        return name && name.trim().toLowerCase() === currentUsername.trim().toLowerCase();
      });
      const matchingAny = matchingUnread || findChatRowByUsername(currentUsername);
      if (matchingAny) {
        chat = matchingAny;
        username = getUsernameFromChatRow(chat);
        log('Keeping focus on current chat: ' + currentUsername);
      }
    }

    if (currentMonitoredChat.username && username !== currentMonitoredChat.username) {
      log('New unread chat from different user, switching from ' + currentMonitoredChat.username + ' to ' + username);
      stopChatMonitoring();
    }

    // Process first unread chat (set lock to prevent concurrent processing)
    isProcessing = true;
    try {
      const chatText = chat.textContent?.trim().substring(0, 50) || 'Unknown';
      await processChat(chat, chatText);
    } finally {
      isProcessing = false;
      log('Finished processing, ready for next poll');
    }
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

// Generate the Instagram bot script via main/preload source-of-truth module
async function getInstagramBotScript(config: Config): Promise<string> {
  const bridgedScript = await (window as any).bot?.getInstagramBotScript?.(config);
  if (typeof bridgedScript === 'string' && bridgedScript.length > 0) {
    return bridgedScript;
  }
  throw new Error('Instagram bot script unavailable from preload bridge');
}

async function getBotScript(config: Config, hostname: string): Promise<string> {
  const site = detectSiteFromHost(hostname);
  switch (site) {
    case 'threads':
      return buildThreadsBotScript(config as any);
    case 'reddit':
      return buildRedditBotScript(config as any);
    case 'instagram':
      return await getInstagramBotScript(config);
    case 'snapchat':
    default:
      return await getSnapchatBotScript(config);
  }
}

// Helper function to find which session a webview belongs to
function getSessionIdForWebview(wv: Electron.WebviewTag): string | null {
  for (const [sessionId, webview] of sessionWebviews.entries()) {
    if (webview === wv) {
      return sessionId;
    }
  }
  return null;
}

// Listen for console messages from webview
function setupWebviewListeners(wv: Electron.WebviewTag) {
  wv.addEventListener('console-message', (e) => {
    const msg = e.message;
    // Log ALL messages for debugging
    console.log('[Webview Console]', msg);
    
    if (msg.includes('[Snappy]')) {
      const cleanMsg = msg.replace(/\[Snappy\]\s*/g, '');
      const sessionId = getSessionIdForWebview(wv) || undefined;
      
      if (msg.includes('SUCCESS') || msg.includes('FOUND')) {
        addLog(cleanMsg, 'success', sessionId);
      } else if (msg.includes('ERROR') || msg.includes('NOT FOUND')) {
        addLog(cleanMsg, 'error', sessionId);
      } else {
        addLog(cleanMsg, 'info', sessionId);
      }
    }
  });

  // Listen for URL changes to refresh site settings
  let lastUrl = wv.src;
  
  wv.addEventListener('did-navigate', () => {
    const newUrl = wv.src;
    if (newUrl !== lastUrl) {
      lastUrl = newUrl;
      
      // Only refresh if this is the active webview and settings panel is open
      if (wv === getActiveWebview() && isPanelOpen) {
        setTimeout(() => {
          refreshSiteSettingsForSession();
        }, 1000); // Delay to ensure page is loaded
      }
    }
  });
  
  wv.addEventListener('did-navigate-in-page', () => {
    const newUrl = wv.src;
    if (newUrl !== lastUrl) {
      lastUrl = newUrl;
      
      // Only refresh if this is the active webview and settings panel is open
      if (wv === getActiveWebview() && isPanelOpen) {
        setTimeout(() => {
          refreshSiteSettingsForSession();
        }, 500); // Shorter delay for in-page navigation
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
      const sessionId = getSessionIdForWebview(currentWebview) || undefined;
      logs.forEach((log: string) => addLog(log, 'info', sessionId));
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
        const effectiveAIConfig = getEffectiveSessionAIConfig(activeSessionId, request.config);
        if (effectiveAIConfig?.provider === 'local') {
          addLog(`AI request endpoint: ${effectiveAIConfig.llmEndpoint}:${effectiveAIConfig.llmPort}`, 'info');
        }

        const result = await (window as any).bot.generateAIReply(
          request.username,
          request.messages[request.messages.length - 1].content, // last message is the user's
          request.username,
          effectiveAIConfig || undefined
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
    const sessionId = getSessionIdForWebview(wv) || undefined;
    addLog('Page loaded: ' + wv.getURL(), 'info', sessionId);
  
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
    const sessionId = getSessionIdForWebview(wv) || undefined;
    addLog('Load failed: ' + e.errorDescription, 'error', sessionId);
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

// ============================================================================
// Resize Handles Setup
// ============================================================================

function setupResizeHandles() {
  setupTabBarResize();
  setupSettingsPanelResize();
}

function setupTabBarResize() {
  const tabBar = document.getElementById('tab-bar');
  const resizeHandle = document.getElementById('tab-bar-resize-handle');
  
  if (!tabBar || !resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const startResize = (e: MouseEvent) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = tabBar.offsetWidth;
    resizeHandle.classList.add('dragging');
    document.body.classList.add('resizing');
    
    e.preventDefault();
    e.stopPropagation();
  };

  const doResize = (e: MouseEvent) => {
    if (!isResizing) return;
    
    const deltaX = e.clientX - startX;
    const newWidth = Math.max(150, Math.min(400, startWidth + deltaX));
    
    tabBar.style.width = `${newWidth}px`;
    
    // Store the width for persistence
    localStorage.setItem('tabBarWidth', newWidth.toString());
    
    e.preventDefault();
    e.stopPropagation();
  };

  const stopResize = (e?: MouseEvent) => {
    if (!isResizing) return;
    
    isResizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.classList.remove('resizing');
    
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  resizeHandle.addEventListener('mousedown', startResize);
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
  
  // Handle escape key to cancel resize
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isResizing) {
      stopResize();
    }
  });

  // Restore saved width
  const savedWidth = localStorage.getItem('tabBarWidth');
  if (savedWidth) {
    tabBar.style.width = `${savedWidth}px`;
  }
}

function setupSettingsPanelResize() {
  const settingsPanel = document.getElementById('settings-panel');
  const resizeHandle = document.getElementById('settings-resize-handle');
  
  if (!settingsPanel || !resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const startResize = (e: MouseEvent) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = settingsPanel.offsetWidth;
    resizeHandle.classList.add('dragging');
    document.body.classList.add('resizing');
    
    e.preventDefault();
    e.stopPropagation();
  };

  const doResize = (e: MouseEvent) => {
    if (!isResizing) return;
    
    const deltaX = startX - e.clientX; // Reverse direction for right panel
    const newWidth = Math.max(200, Math.min(500, startWidth + deltaX));
    
    settingsPanel.style.width = `${newWidth}px`;
    
    // Update CSS custom property for other elements
    document.documentElement.style.setProperty('--settings-panel-width', `${newWidth}px`);
    
    // Store the width for persistence
    localStorage.setItem('settingsPanelWidth', newWidth.toString());
    
    e.preventDefault();
    e.stopPropagation();
  };

  const stopResize = (e?: MouseEvent) => {
    if (!isResizing) return;
    
    isResizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.classList.remove('resizing');
    
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  resizeHandle.addEventListener('mousedown', startResize);
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
  
  // Handle escape key to cancel resize
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isResizing) {
      stopResize();
    }
  });

  // Restore saved width
  const savedWidth = localStorage.getItem('settingsPanelWidth');
  if (savedWidth) {
    settingsPanel.style.width = `${savedWidth}px`;
    document.documentElement.style.setProperty('--settings-panel-width', `${savedWidth}px`);
  }
}

// ============================================================================
// Main Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  loadConfig();
  addLog('Snappy initialized', 'highlight');
  
  // Set up resize handles for panels
  setupResizeHandles();
  
  // Clear stale llama server tracking from previous runs
  try {
    await (window as any).llama.clearTracking();
    console.log('[Renderer] Cleared stale llama server tracking');
  } catch (e) {
    console.log('[Renderer] Could not clear llama tracking:', e);
  }
  
  // Check if this is a detached window via URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const isDetachedWindow = urlParams.get('detached') === 'true';
  const detachedSessionId = urlParams.get('sessionId');
  const detachedSessionName = urlParams.get('sessionName');
  
  if (isDetachedWindow && detachedSessionId && detachedSessionName) {
    // Set up detached window mode immediately
    (window as any).isDetachedWindow = true;
    (window as any).detachedSessionId = detachedSessionId;
    
    // Set up UI for detached mode
    setupMultiSessionUI();
    setupDetachedWindowMode(detachedSessionId, detachedSessionName);
  } else {
    // Normal window - set up multi-session UI and load all sessions
    setupMultiSessionUI();
    
    // Try to load existing sessions from main process
    try {
      const sessions = await (window as any).session.getAllSessions();
      if (sessions && sessions.length > 0) {
        // Load saved sessions
        sessions.forEach((s: SessionData) => addSessionToUI(s));
        addLog(`Loaded ${sessions.length} session(s)`, 'info');
      
        // Update all tab indicators after loading
        setTimeout(() => updateAllTabIndicators(), 100);
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
  }
  
  // Update webview reference
  webview = getActiveWebview();
});


// ============================================================================
// Llama.cpp Server Management
// ============================================================================

interface LlamaServerConfig {
  buildPath: string;
  startCommand: string;
  enabled: boolean;
}

interface LlamaServerStatus {
  running: boolean;
  pid?: number;
  error?: string;
  startTime?: number;
}

let llamaServerConfig: LlamaServerConfig = {
  buildPath: '',
  startCommand: '',
  enabled: false
};

function extractLlamaPort(startCommand?: string): number | null {
  if (!startCommand) return null;
  const matches = Array.from(startCommand.matchAll(/(?:^|\s)(?:--port|-p)\s*=?\s*(\d{2,5})(?=\s|$)/gi));
  if (matches.length === 0) return null;
  const port = parseInt(matches[matches.length - 1][1], 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) return null;
  return port;
}

function getEffectiveSessionAIConfig(sessionId: string | null, requestAIConfig?: Partial<AIConfig>): AIConfig | null {
  if (!sessionId) return null;
  const sessionConfig = sessionConfigs.get(sessionId);
  const sessionAI = sessionConfig?.ai || ({} as Partial<AIConfig>);
  const sessionLlama = sessionConfig?.llama;
  const fallbackLlama = llamaServerConfig;

  const merged = {
    ...sessionAI,
    ...(requestAIConfig || {})
  } as Partial<AIConfig>;

  const provider = merged.provider || 'local';
  const effectiveLlamaCommand = sessionLlama?.startCommand || fallbackLlama?.startCommand || '';
  const parsedPort = extractLlamaPort(effectiveLlamaCommand);

  return {
    enabled: merged.enabled ?? false,
    provider,
    llmEndpoint: merged.llmEndpoint || '127.0.0.1',
    llmPort: provider === 'local' ? (parsedPort || merged.llmPort || 8080) : (merged.llmPort || 8080),
    modelName: merged.modelName || 'local-model',
    systemPrompt: merged.systemPrompt || '',
    temperature: merged.temperature ?? 0.7,
    maxTokens: merged.maxTokens ?? 150,
    contextHistoryEnabled: merged.contextHistoryEnabled ?? true,
    maxContextMessages: merged.maxContextMessages ?? 10,
    requestTimeoutMs: merged.requestTimeoutMs ?? 30000,
    maxRetries: merged.maxRetries ?? 3,
    retryBackoffMs: merged.retryBackoffMs ?? 1000,
    chatgptApiKey: merged.chatgptApiKey || '',
    chatgptModel: merged.chatgptModel || 'gpt-3.5-turbo',
    chatgptBaseUrl: merged.chatgptBaseUrl || 'https://api.openai.com/v1'
  };
}

// Per-session server PID tracking
const sessionServerPids = new Map<string, { pid: number; startTime: number }>();

// Get the current session's server status
function getSessionServerStatus(): LlamaServerStatus {
  if (!activeSessionId) {
    return { running: false };
  }
  const serverInfo = sessionServerPids.get(activeSessionId);
  if (serverInfo) {
    return { running: true, pid: serverInfo.pid, startTime: serverInfo.startTime };
  }
  return { running: false };
}

let llamaStatusUpdateInterval: NodeJS.Timeout | null = null;

// UI Elements
const llamaConfigModal = document.getElementById('llama-config-modal')!;
const openLlamaConfigBtn = document.getElementById('open-llama-config')!;
const llamaBuildPathInput = document.getElementById('llama-build-path') as HTMLInputElement;
const llamaStartCommandInput = document.getElementById('llama-start-command') as HTMLInputElement;
const llamaEnabledCheckbox = document.getElementById('llama-enabled') as HTMLInputElement;
const llamaStartBtn = document.getElementById('llama-start-btn')!;
const llamaStopBtn = document.getElementById('llama-stop-btn')!;
const llamaSaveConfigBtn = document.getElementById('llama-save-config-btn')!;
const llamaStatusDot = document.getElementById('llama-status')!;
const llamaServerRunning = document.getElementById('llama-server-running')!;
const llamaServerPid = document.getElementById('llama-server-pid')!;
const llamaServerUptime = document.getElementById('llama-server-uptime')!;
const modalCloseBtn = llamaConfigModal.querySelector('.modal-close')!;
const modalCancelBtn = llamaConfigModal.querySelector('.modal-cancel')!;

// Load llama.cpp configuration
async function loadLlamaConfig() {
  // Load from current session config if available
  if (activeSessionId) {
    const sessionConfig = sessionConfigs.get(activeSessionId);
    if (sessionConfig && sessionConfig.llama) {
      llamaServerConfig = sessionConfig.llama;
      llamaBuildPathInput.value = sessionConfig.llama.buildPath || '';
      llamaStartCommandInput.value = sessionConfig.llama.startCommand || '';
      llamaEnabledCheckbox.checked = sessionConfig.llama.enabled || false;
      return;
    }
  }
  
  // Fallback to global config if no session config
  try {
    const config = await (window as any).llama.getConfig();
    if (config) {
      llamaServerConfig = config;
      llamaBuildPathInput.value = config.buildPath || '';
      llamaStartCommandInput.value = config.startCommand || '';
      llamaEnabledCheckbox.checked = config.enabled || false;
    }
  } catch (e) {
    console.error('Failed to load llama config:', e);
  }
}

// Save llama.cpp configuration
async function saveLlamaConfig() {
  const llamaConfig = {
    buildPath: llamaBuildPathInput.value.trim(),
    startCommand: llamaStartCommandInput.value.trim(),
    enabled: llamaEnabledCheckbox.checked
  };

  // Update global config for immediate use
  llamaServerConfig = llamaConfig;

  // Save to global llama-config.json (used by llama:start handler)
  try {
    await (window as any).llama.saveConfig(llamaConfig);
    addLog('Llama.cpp configuration saved', 'success');
  } catch (e) {
    addLog(`Failed to save Llama config: ${e}`, 'error');
    return;
  }

  // Also update session config if available
  if (activeSessionId) {
    const sessionConfig = sessionConfigs.get(activeSessionId);
    if (sessionConfig) {
      sessionConfig.llama = llamaConfig;
      sessionConfigs.set(activeSessionId, sessionConfig);
      
      try {
        await (window as any).session.updateSessionConfig(activeSessionId, sessionConfig);
      } catch (e) {
        console.log('Session API not available, using local storage only');
      }
    }
  }

  llamaSaveConfigBtn.textContent = 'Saved';
  setTimeout(() => {
    llamaSaveConfigBtn.textContent = 'Save Config';
  }, 1500);
}

// Start llama.cpp server
async function startLlamaServer() {
  if (!llamaServerConfig.buildPath || !llamaServerConfig.startCommand) {
    addLog('Build path and start command are required', 'error');
    return;
  }

  if (!activeSessionId) {
    addLog('No active session', 'error');
    return;
  }

  addLog('Starting Llama.cpp server...', 'highlight');
  (llamaStartBtn as HTMLButtonElement).disabled = true;

  try {
    await (window as any).llama.saveConfig(llamaServerConfig);
    const status = await (window as any).llama.start();

    if (status.running && status.pid) {
      // Store PID for this session
      sessionServerPids.set(activeSessionId, { pid: status.pid, startTime: status.startTime || Date.now() });
      addLog(`Llama.cpp server started (PID: ${status.pid})`, 'success');
      updateLlamaUI();
    } else {
      addLog(`Failed to start server: ${status.error}`, 'error');
    }
  } catch (e) {
    addLog(`Error starting server: ${e}`, 'error');
  } finally {
    (llamaStartBtn as HTMLButtonElement).disabled = false;
  }
}

// Stop llama.cpp server by PID (only stops this session's server)
async function stopLlamaServer() {
  if (!activeSessionId) {
    addLog('No active session', 'error');
    return;
  }

  const serverInfo = sessionServerPids.get(activeSessionId);
  if (!serverInfo) {
    addLog('No server running for this session', 'error');
    return;
  }
  
  const currentPid = serverInfo.pid;
  addLog(`Stopping Llama.cpp server (PID: ${currentPid})...`, 'highlight');
  (llamaStopBtn as HTMLButtonElement).disabled = true;

  try {
    const status = await (window as any).llama.stopByPid(currentPid);

    if (!status.error) {
      // Remove PID from this session's tracking
      sessionServerPids.delete(activeSessionId);
      addLog(`Llama.cpp server stopped (PID: ${currentPid})`, 'success');
      updateLlamaUI();
    } else {
      addLog(`Failed to stop server: ${status.error}`, 'error');
    }
  } catch (e) {
    addLog(`Error stopping server: ${e}`, 'error');
  } finally {
    (llamaStopBtn as HTMLButtonElement).disabled = false;
  }
}

// Get llama.cpp server status (uses per-session tracking)
async function getLlamaStatus() {
  // Just update the UI based on our local session tracking
  // No need to call the backend since we track PIDs per-session locally
  updateLlamaUI();
}

// Update llama.cpp UI based on this session's server status
function updateLlamaUI() {
  const sessionStatus = getSessionServerStatus();
  
  if (sessionStatus.running) {
    llamaStatusDot.className = 'llama-status running';
    llamaStatusDot.textContent = '●';
    llamaServerRunning.textContent = 'Running';
    llamaServerPid.textContent = String(sessionStatus.pid || '-');

    // Update uptime
    if (sessionStatus.startTime) {
      const uptime = Math.floor((Date.now() - sessionStatus.startTime) / 1000);
      const minutes = Math.floor(uptime / 60);
      const seconds = uptime % 60;
      llamaServerUptime.textContent = `${minutes}m ${seconds}s`;
    }
  } else {
    llamaStatusDot.className = 'llama-status disconnected';
    llamaStatusDot.textContent = '●';
    llamaServerRunning.textContent = 'Stopped';
    llamaServerPid.textContent = '-';
    llamaServerUptime.textContent = '-';
  }
  
  // Always show start button, only show stop if this session has a running server
  llamaStartBtn.style.display = 'inline-block';
  llamaStopBtn.style.display = sessionStatus.running && sessionStatus.pid ? 'inline-block' : 'none';
  
  // Update button text
  (llamaStartBtn as HTMLButtonElement).textContent = 'Start Server';
  (llamaStopBtn as HTMLButtonElement).textContent = `Stop (PID: ${sessionStatus.pid || '-'})`;
}

// Show llama.cpp configuration modal
function showLlamaConfigModal() {
  llamaConfigModal.classList.remove('hidden');
  loadLlamaConfig();
  getLlamaStatus();

  // Start updating status every second
  if (llamaStatusUpdateInterval) {
    clearInterval(llamaStatusUpdateInterval);
  }
  llamaStatusUpdateInterval = setInterval(() => {
    getLlamaStatus();
  }, 1000);
}

// Hide llama.cpp configuration modal
function hideLlamaConfigModal() {
  llamaConfigModal.classList.add('hidden');
  if (llamaStatusUpdateInterval) {
    clearInterval(llamaStatusUpdateInterval);
    llamaStatusUpdateInterval = null;
  }
}

// Wire up llama.cpp UI events
openLlamaConfigBtn.addEventListener('click', showLlamaConfigModal);
modalCloseBtn.addEventListener('click', hideLlamaConfigModal);
modalCancelBtn.addEventListener('click', hideLlamaConfigModal);
llamaStartBtn.addEventListener('click', startLlamaServer);
llamaStopBtn.addEventListener('click', stopLlamaServer);
llamaSaveConfigBtn.addEventListener('click', saveLlamaConfig);

// Close modal on backdrop click
llamaConfigModal.addEventListener('click', (e) => {
  if (e.target === llamaConfigModal) {
    hideLlamaConfigModal();
  }
});

// Initialize llama status on startup
loadLlamaConfig();

// ============================================================================
// Per-Tab Settings Actions
// ============================================================================

// Copy settings from another tab button
const copyFromTabBtn = document.getElementById('copy-from-tab-btn');
if (copyFromTabBtn) {
  copyFromTabBtn.addEventListener('click', () => {
    if (activeSessionId) {
      showCopySettingsModal(activeSessionId);
    }
  });
}

// Reset tab settings button
const resetTabSettingsBtn = document.getElementById('reset-tab-settings-btn');
if (resetTabSettingsBtn) {
  resetTabSettingsBtn.addEventListener('click', () => {
    if (activeSessionId && confirm('Reset this tab\'s settings to default?')) {
      resetSessionToDefault(activeSessionId);
    }
  });
}

// Reset session to default configuration
function resetSessionToDefault(sessionId: string) {
  const defaultConfig: Config = {
    initialUrl: 'https://web.snapchat.com',
    autoInject: false,
    replyRules: [],
    typingDelayRangeMs: [50, 150],
    preReplyDelayRangeMs: [2000, 6000],
    maxRepliesPerMinute: 5,
    maxRepliesPerHour: 30,
    randomSkipProbability: 0.15,
    ai: {
      enabled: false,
      provider: 'local' as 'local' | 'chatgpt',
      llmEndpoint: 'localhost',
      llmPort: 8080,
      modelName: 'local-model',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 150,
      contextHistoryEnabled: true,
      maxContextMessages: 10,
      requestTimeoutMs: 30000,
      maxRetries: 3,
      retryBackoffMs: 1000,
      chatgptApiKey: '',
      chatgptModel: 'gpt-3.5-turbo',
      chatgptBaseUrl: 'https://api.openai.com/v1'
    },
    llama: {
      buildPath: '',
      startCommand: '',
      enabled: false
    }
  };
  
  sessionConfigs.set(sessionId, defaultConfig);
  
  if (sessionId === activeSessionId) {
    loadConfigIntoUI(defaultConfig);
  }
  
  // Update visual indicator
  updateTabCustomSettingsIndicator(sessionId);
  
  addLog(`Settings reset to default for ${getSessionName(sessionId)}`, 'info');
}

// Update button states based on active session
function updateTabSettingsButtons() {
  const copyBtn = document.getElementById('copy-from-tab-btn') as HTMLButtonElement;
  const resetBtn = document.getElementById('reset-tab-settings-btn') as HTMLButtonElement;
  
  if (copyBtn && resetBtn) {
    const hasMultipleTabs = sessionWebviews.size > 1;
    (copyBtn as HTMLButtonElement).disabled = !activeSessionId || !hasMultipleTabs;
    (resetBtn as HTMLButtonElement).disabled = !activeSessionId;
    
    if (!hasMultipleTabs) {
      copyBtn.title = 'Need multiple tabs to copy settings';
    } else {
      copyBtn.title = 'Copy settings from another tab';
    }
  }
}

// Update tab visual indicator for custom settings
function updateTabCustomSettingsIndicator(sessionId: string) {
  const tab = document.getElementById(`tab-${sessionId}`);
  if (!tab) return;
  
  const hasCustomSettings = sessionConfigs.has(sessionId);
  
  // Add or remove custom settings indicator
  let indicator = tab.querySelector('.tab-settings-indicator');
  if (hasCustomSettings && !indicator) {
    indicator = document.createElement('span');
    indicator.className = 'tab-settings-indicator';
    (indicator as HTMLElement).title = 'Has custom settings';
    indicator.textContent = '●';
    
    // Insert before the close button
    const closeBtn = tab.querySelector('.tab-close');
    if (closeBtn) {
      tab.insertBefore(indicator, closeBtn);
    } else {
      tab.appendChild(indicator);
    }
  } else if (!hasCustomSettings && indicator) {
    indicator.remove();
  }
}

// Update all tab indicators
function updateAllTabIndicators() {
  sessionWebviews.forEach((_, sessionId) => {
    updateTabCustomSettingsIndicator(sessionId);
  });
}

// ============================================================================
// System Tray Bot Control Handlers
// ============================================================================

/**
 * Start bots for all sessions (like clicking Start on each tab)
 */
async function startAllSessionBots(): Promise<void> {
  addLog('Starting bots for all sessions...', 'highlight');
  
  let startedCount = 0;
  const originalActiveSession = activeSessionId;
  
  for (const [sessionId, webview] of sessionWebviews.entries()) {
    const sessionName = getSessionName(sessionId);
    
    // Get session config
    const config = sessionConfigs.get(sessionId);
    const llamaConfig = (config as any)?.llama;
    const aiConfig = (config as any)?.ai;
    
    // Start llama server only if using local AI provider and server is enabled for this session
    const aiProvider = aiConfig?.provider || 'local';
    if (aiProvider === 'local' && llamaConfig?.enabled && llamaConfig?.buildPath && llamaConfig?.startCommand) {
      // Skip if already running
      if (!sessionServerPids.has(sessionId)) {
        try {
          await (window as any).llama.saveConfig(llamaConfig);
          const startResult = await (window as any).llama.start();
          if (startResult.running && startResult.pid) {
            sessionServerPids.set(sessionId, { pid: startResult.pid, startTime: startResult.startTime || Date.now() });
            addLog(`Llama server started for ${sessionName} (PID: ${startResult.pid})`, 'success', sessionId);
          }
        } catch (e) {
          addLog(`Failed to start llama for ${sessionName}: ${e}`, 'error', sessionId);
        }
      }
    } else if (aiProvider === 'chatgpt') {
      addLog(`Using ChatGPT API for ${sessionName} (no local server needed)`, 'info', sessionId);
    }
    
    // Inject bot into webview
    try {
      const injected = await injectBotIntoSpecificWebview(webview, sessionId);
      if (injected) {
        await (window as any).session.updateBotStatus(sessionId, 'active');
        // Update tab bot status indicator
        const tab = document.getElementById(`tab-${sessionId}`);
        if (tab) {
          const botStatusEl = tab.querySelector('.tab-bot-status');
          if (botStatusEl) {
            botStatusEl.className = 'tab-bot-status active';
            botStatusEl.setAttribute('title', 'Bot Status: active');
          }
        }
        addLog(`Bot started for ${sessionName}`, 'success', sessionId);
        startedCount++;
      }
    } catch (e) {
      addLog(`Failed to start bot for ${sessionName}: ${e}`, 'error', sessionId);
    }
    
    // Small delay between starts
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // Update UI for active session
  if (originalActiveSession && sessionWebviews.has(originalActiveSession)) {
    isBotActive = true;
    statusDot.classList.add('active');
    statusText.textContent = 'Active';
    botBtn.textContent = 'Stop';
  }
  
  addLog(`Started ${startedCount} bot(s)`, 'success');
  updateLlamaUI();
}

/**
 * Stop bots for all sessions (like clicking Stop on each tab)
 */
async function stopAllSessionBots(): Promise<void> {
  addLog('Stopping all bots...', 'highlight');
  
  let stoppedCount = 0;
  
  for (const [sessionId, webview] of sessionWebviews.entries()) {
    const sessionName = getSessionName(sessionId);
    
    // Stop bot in webview
    try {
      await stopBotInSpecificWebview(webview);
      await (window as any).session.updateBotStatus(sessionId, 'inactive');
      // Update tab bot status indicator
      const tab = document.getElementById(`tab-${sessionId}`);
      if (tab) {
        const botStatusEl = tab.querySelector('.tab-bot-status');
        if (botStatusEl) {
          botStatusEl.className = 'tab-bot-status inactive';
          botStatusEl.setAttribute('title', 'Bot Status: inactive');
        }
      }
      stoppedCount++;
    } catch (e) {
      addLog(`Failed to stop bot for ${sessionName}: ${e}`, 'error', sessionId);
    }
    
    // Stop llama server if running for this session
    const serverInfo = sessionServerPids.get(sessionId);
    if (serverInfo) {
      try {
        await (window as any).llama.stopByPid(serverInfo.pid);
        sessionServerPids.delete(sessionId);
        addLog(`Llama server stopped for ${sessionName}`, 'info', sessionId);
      } catch (e) {
        addLog(`Failed to stop llama for ${sessionName}: ${e}`, 'error', sessionId);
      }
    }
  }
  
  // Update UI
  isBotActive = false;
  statusDot.classList.remove('active');
  statusText.textContent = 'Inactive';
  botBtn.textContent = 'Start';
  
  addLog(`Stopped ${stoppedCount} bot(s)`, 'success');
  updateLlamaUI();
}

/**
 * Inject bot into a specific webview
 */
async function injectBotIntoSpecificWebview(webview: Electron.WebviewTag, sessionId: string): Promise<boolean> {
  if (!webview) return false;
  
  const config = (sessionConfigs.get(sessionId) as Config) || ({} as Config);
  
  try {
    const hostname = new URL(webview.getURL()).hostname;
    const site = detectSiteFromHost(hostname);
    const resolvedConfig = applySiteSettingsToConfig(config, hostname);
    
    let botScript = '';
    if (site === 'snapchat') {
      botScript = await getSnapchatBotScript(resolvedConfig);
    } else if (site === 'threads') {
      botScript = buildThreadsBotScript(resolvedConfig);
    } else if (site === 'reddit') {
      botScript = buildRedditBotScript(resolvedConfig);
    } else if (site === 'instagram') {
      botScript = await getInstagramBotScript(config as Config);
      botScript = buildInstagramBotScript(resolvedConfig);
    } else {
      addLog(`Unknown site: ${site}`, 'error', sessionId);
      return false;
    }
    
    await webview.executeJavaScript(botScript);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Stop bot in a specific webview
 */
async function stopBotInSpecificWebview(webview: Electron.WebviewTag): Promise<void> {
  if (!webview) return;
  
  try {
    await webview.executeJavaScript(`
      if (window.__SNAPPY_STOP__) {
        window.__SNAPPY_STOP__();
      }
      window.__SNAPPY_RUNNING__ = false;
    `);
  } catch (e) {
    // Ignore errors
  }
}

// Register tray event listeners
if ((window as any).tray) {
  (window as any).tray.onStartAllServers(() => {
    startAllSessionBots();
  });
  
  (window as any).tray.onAllServersStopped(() => {
    stopAllSessionBots();
  });
}
