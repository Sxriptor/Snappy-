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
  let pollInterval = null;
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

function buildRedditBotScript(config: any): string {
  return '/* Reddit bot script placeholder */';
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
  const seenRequests = new Set();
  let isRunning = true;
  let pollInterval = null;
  let isProcessing = false;

  const MIN_MESSAGE_LENGTH = 2;
  const BASE_POLL_MS = (CONFIG?.instagram && CONFIG.instagram.pollIntervalMs) || 8000;
  const POLL_VARIANCE_MS = 4000; // Random variance for more natural scanning
  const typingDelayRange = CONFIG?.typingDelayRangeMs || [50, 150];
  const preReplyDelayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];

  function getRandomPollInterval() {
    // Random interval between BASE_POLL_MS and BASE_POLL_MS + POLL_VARIANCE_MS
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

  function findRequestsTab() {
    const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase().trim();
      if (text && (text.includes('request') || text.includes('pending'))) {
        return btn;
      }
    }
    return null;
  }

  function findMessageRequests() {
    const requests = [];
    const acceptButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(btn => {
      const text = btn.textContent?.toLowerCase();
      return text && text.includes('accept');
    });

    for (const acceptBtn of acceptButtons) {
      let container = acceptBtn.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        const text = container.textContent || '';
        if (text.length > 10 && text.length < 500) {
          const requestId = 'req-' + text.substring(0, 50).replace(/\\s+/g, '-');
          if (!seenRequests.has(requestId)) {
            requests.push({ id: requestId, element: container, acceptButton: acceptBtn });
            break;
          }
        }
        container = container.parentElement;
      }
    }

    if (window.location.href.includes('/requests')) {
      const conversationItems = Array.from(document.querySelectorAll('[role="listitem"], [role="button"]'));
      for (const item of conversationItems) {
        const text = item.textContent || '';
        if (text.length > MIN_MESSAGE_LENGTH && text.length < 500) {
          const requestId = 'req-' + text.substring(0, 50).replace(/\\s+/g, '-');
          if (!seenRequests.has(requestId)) {
            const hasAccept = item.textContent?.toLowerCase().includes('accept');
            if (hasAccept) {
              requests.push({ id: requestId, element: item, acceptButton: null });
            }
          }
        }
      }
    }

    return requests;
  }

  async function acceptMessageRequest(request) {
    try {
      log('Accepting message request: ' + request.id);
      request.element.click();
      await sleep(1500);

      let acceptBtn = request.acceptButton;
      if (!acceptBtn) {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        acceptBtn = buttons.find(btn => {
          const text = btn.textContent?.toLowerCase();
          return text && text.includes('accept');
        });
      }

      if (acceptBtn) {
        acceptBtn.click();
        await sleep(800);
        seenRequests.add(request.id);
        log('✓ Accepted message request: ' + request.id);
        return true;
      } else {
        log('Accept button not found for request: ' + request.id);
        return false;
      }
    } catch (err) {
      log('Error accepting request: ' + err);
      return false;
    }
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
      const convId = 'conv-' + fullText.substring(0, 50).replace(/\\s+/g, '-');

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
    // Primary method: Look for the specific Instagram unread div
    const unreadDiv = element.querySelector('div.x9f619.x1ja2u2z.xzpqnlu.x1hyvwdk.x14bfe9o.xjm9jq1.x6ikm8r.x10wlt62.x10l6tqk.x1i1rx1s');
    if (unreadDiv && unreadDiv.textContent?.includes('Unread')) {
      return true;
    }

    // Fallback: Check for any element with "Unread" text
    const allDivs = element.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.textContent?.trim() === 'Unread') {
        return true;
      }
    }

    // Additional fallback: notification badges
    const badge = element.querySelector('[role="status"], [aria-label*="unread"], [aria-label*="notification"]');
    if (badge) return true;

    // Check for bold text (Instagram often bolds unread message previews)
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
      conversation.element.click();
      await sleep(1500);
      return true;
    } catch (err) {
      log('Error opening conversation: ' + err);
      return false;
    }
  }

  function getConversationMessages() {
    const messages = [];
    const messageElements = Array.from(document.querySelectorAll('[role="row"], [class*="message"], [class*="Message"]'));

    for (const el of messageElements) {
      const text = extractMessageText(el);
      if (!text || text.length < MIN_MESSAGE_LENGTH) continue;

      const isIncoming = isIncomingMessage(el);

      messages.push({ text: text, isIncoming: isIncoming, element: el });
    }

    return messages;
  }

  function extractMessageText(element) {
    const textElements = element.querySelectorAll('span, p, div');
    let longestText = '';

    for (const el of textElements) {
      const text = el.textContent?.trim() || '';
      if (text.length > longestText.length && text.length < 5000) {
        if (!/^\\d{1,2}:\\d{2}/.test(text) && !/^\\d+[smhd]/.test(text)) {
          longestText = text;
        }
      }
    }

    return longestText;
  }

  function isIncomingMessage(element) {
    const rect = element.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const messageCenter = (rect.left + rect.right) / 2;
    const isOnLeft = messageCenter < windowWidth / 2;

    const classes = element.className.toLowerCase();
    const html = element.innerHTML.toLowerCase();

    const incomingKeywords = ['incoming', 'received', 'other', 'left'];
    const outgoingKeywords = ['outgoing', 'sent', 'self', 'right', 'you'];

    const hasIncoming = incomingKeywords.some(kw => classes.includes(kw) || html.includes(kw));
    const hasOutgoing = outgoingKeywords.some(kw => classes.includes(kw) || html.includes(kw));

    if (hasIncoming) return true;
    if (hasOutgoing) return false;

    return isOnLeft;
  }

  function getLatestIncomingMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.isIncoming) {
        const msgId = 'msg-' + msg.text.substring(0, 100);
        if (!seenMessages.has(msgId)) {
          return { text: msg.text, id: msgId };
        }
      }
    }
    return null;
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
    const input = document.querySelector('[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"], textarea');

    if (!input) {
      log('Input field not found');
      return false;
    }

    input.focus();
    await sleep(200);

    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = '';
      input.textContent = '';
    } else if (input.value !== undefined) {
      input.value = '';
    }

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (input.getAttribute('contenteditable') === 'true') {
        input.textContent = (input.textContent || '') + char;
      } else if (input.value !== undefined) {
        input.value += char;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

      const delay = Math.floor(Math.random() * (typingDelayRange[1] - typingDelayRange[0])) + typingDelayRange[0];
      await sleep(delay);
    }

    log('Typed message: "' + text.substring(0, 30) + '..."');
    return true;
  }

  async function sendMessage() {
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const sendBtn = buttons.find(btn => {
      const text = btn.textContent?.toLowerCase();
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
      return (text && text.includes('send')) || (ariaLabel && ariaLabel.includes('send'));
    });

    if (sendBtn) {
      sendBtn.click();
      log('Send button clicked');
      await sleep(800);
      return true;
    }

    const input = document.querySelector('[contenteditable="true"][role="textbox"], textarea');
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      log('Sent via Enter key');
      await sleep(800);
      return true;
    }

    log('Could not send message');
    return false;
  }

  async function processConversation(conversation) {
    try {
      const opened = await openConversation(conversation);
      if (!opened) return;

      const messages = getConversationMessages();
      log('Found ' + messages.length + ' messages in conversation');

      if (messages.length === 0) {
        log('No messages found');
        return;
      }

      const latestMsg = getLatestIncomingMessage(messages);
      if (!latestMsg) {
        log('No new incoming messages');
        return;
      }

      log('Latest incoming message: "' + latestMsg.text.substring(0, 50) + '..."');

      seenMessages.add(latestMsg.id);
      seenMessages.add(conversation.id);

      const reply = await generateReply(latestMsg.text);
      if (!reply) {
        log('No reply generated');
        return;
      }

      const skipProb = CONFIG?.randomSkipProbability || 0.15;
      if (Math.random() < skipProb) {
        log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%)');
        return;
      }

      const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
      log('Waiting ' + delay + 'ms before replying');
      await sleep(delay);

      const typed = await typeMessage(reply);
      if (!typed) return;

      await sleep(500);

      const sent = await sendMessage();
      if (sent) {
        log('✓ Reply sent: "' + reply.substring(0, 60) + '..."');
      }
    } catch (err) {
      log('Error processing conversation: ' + err);
    }
  }

  async function poll() {
    if (!isRunning || isProcessing) return;
    isProcessing = true;

    try {
      if (!isOnDMsPage()) {
        const navigated = navigateToDMs();
        if (navigated) {
          await sleep(2000);
        }
        isProcessing = false;
        return;
      }

      log('Polling for new messages and requests...');

      const requestsTab = findRequestsTab();
      if (requestsTab) {
        requestsTab.click();
        await sleep(1500);

        const requests = findMessageRequests();
        if (requests.length > 0) {
          log('Found ' + requests.length + ' message request(s)');
          for (const request of requests) {
            if (!isRunning) break;
            await acceptMessageRequest(request);
            await sleep(1000);
          }
        }

        const primaryTab = Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(btn => {
          const text = btn.textContent?.toLowerCase();
          return text && (text.includes('primary') || text.includes('general'));
        });
        if (primaryTab) {
          primaryTab.click();
          await sleep(1000);
        }
      }

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
      scheduleNextPoll(); // Schedule the next one after this completes
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

  log('🚀 Instagram DM bot started (no page refresh needed - Instagram updates automatically)');
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
  llmEndpoint: string;
  llmPort: number;
  modelName: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextHistoryEnabled: boolean;
  maxContextMessages: number;
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
  };
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

    // Inject the bot script into the webview
    const botScript = getBotScript(config!, hostname);
    
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
    
    // Update session bot status across all windows
    await (window as any).session.updateBotStatus(activeSessionId, 'inactive');
  } else {
    addLog('Starting bot...', 'highlight');
    
    // Start llama server if enabled (always start new instance)
    if (llamaServerConfig.enabled) {
      addLog('Starting new Llama.cpp server instance...', 'info');
      const startResult = await (window as any).llama.start();
      if (startResult.running) {
        addLog(`Llama.cpp server started (PID: ${startResult.pid})`, 'success');
        updateLlamaUI();
      } else {
        addLog(`Warning: Failed to start Llama.cpp server: ${startResult.error}`, 'error');
        // Continue with bot startup anyway
      }
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
      llmEndpoint: aiEndpoint?.value || 'localhost',
      llmPort: parseInt(aiPort?.value) || 8080,
      modelName: aiModel?.value || 'local-model',
      systemPrompt: aiPrompt?.value || '',
      temperature: parseFloat(aiTemp?.value) || 0.7,
      maxTokens: parseInt(aiTokens?.value) || 150,
      contextHistoryEnabled: aiContext?.checked || true,
      maxContextMessages: parseInt(aiHistory?.value) || 10
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
    sessionConfigs.set(sessionId, config);
  }
  
  loadConfigIntoUI(config);
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
function getSnapchatBotScript(config: Config): string {
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

  // Internal chat processing (separated to avoid duplication)
  async function processChat_internal(chatEl, username) {

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

    // CRITICAL: Wait for the DOM to fully update with NEW chat content
    // Snapchat lazy-loads messages, so we need to wait AND scroll aggressively
    log('Waiting for chat to load and messages to populate...');
    await sleep(2500);

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

    await sleep(500); // Brief pause after focusing

    // Force scroll to bottom MULTIPLE times with waits to trigger lazy loading
    await scrollToLatestMessages();

    log('Finished scrolling, messages should be loaded now');

    // Process the initial messages
    await processCurrentChatMessages(username);

    // Start monitoring this chat for new messages
    startChatMonitoring(username);
  }

  // Helper function to scroll to latest messages
  async function scrollToLatestMessages() {
    for (let scrollAttempt = 0; scrollAttempt < 3; scrollAttempt++) {
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

          // Wait for lazy load
          await sleep(1200);
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
      return;
    }

    // CRITICAL CHECK: If ALL messages are from us, the DOM is stale/cached
    const incomingCount = messages.filter(m => m.isIncoming).length;
    const outgoingCount = messages.filter(m => !m.isIncoming).length;
    log('Message breakdown: ' + incomingCount + ' incoming, ' + outgoingCount + ' outgoing');

    if (incomingCount === 0 && outgoingCount > 0) {
      log('WARNING: All messages are from us - DOM is showing stale/cached data!');
      log('Chat was marked as "New Chat" or "Received" but we only see our own messages.');
      log('Possible causes: 1) DOM not fully loaded, 2) Message was deleted, 3) False unread indicator');
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

    // Check if this is the same message we last replied to for this user
    const lastReplied = lastRepliedMessage.get(username);
    if (lastReplied && lastReplied === normalizedIncoming) {
      log('Already replied to this exact message from ' + username + ': "' + lastReplied.substring(0, 30) + '"');
      return;
    }

    // Log what we last replied to for debugging
    if (lastReplied) {
      log('Last replied message from ' + username + ' was: "' + lastReplied.substring(0, 30) + '"');
      log('Current message: "' + normalizedIncoming.substring(0, 30) + '" - NEW, will process');
    } else {
      log('First message from ' + username + ', will process');
    }

    // Find reply (now async with AI support)
    const reply = await findReply(lastIncoming, username);
    if (!reply) {
      log('No matching reply');
      // Still mark as replied so we don't keep trying to reply to a message with no match
      lastRepliedMessage.set(username, normalizedIncoming);
      return;
    }

    // Random skip
    if (Math.random() < (CONFIG.randomSkipProbability || 0.15)) {
      log('Random skip');
      // Mark as replied so we don't process again
      lastRepliedMessage.set(username, normalizedIncoming);
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

      // Track this as the last message we replied to for this user
      lastRepliedMessage.set(username, normalizedIncoming);
      log('Saved last replied message for ' + username + ': "' + normalizedIncoming.substring(0, 30) + '"');

      // Track this message as sent by us (to avoid replying to ourselves)
      sentMessages.add(reply.toLowerCase().trim());

      // Save their message to memory (username already cleaned above)
      addToMemory(username, lastIncoming, true);

      // Save our reply to memory
      addToMemory(username, reply, false);

      // Log memory summary
      const summary = getMemorySummary(username);
      log('Memory for ' + username + ': ' + summary.total + ' msgs (' + summary.fromThem + ' from them, ' + summary.fromMe + ' from me)');
    }
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

    // Check for new messages every 3 seconds
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

        // Find the last incoming message
        let lastIncoming = null;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].isIncoming) {
            lastIncoming = messages[i].text;
            break;
          }
        }

        if (!lastIncoming) {
          return;
        }

        // Create a unique ID for this message
        const msgId = username + '::' + lastIncoming.toLowerCase().trim();

        // Check if this is a NEW message we haven't seen before
        if (currentMonitoredChat.lastMessageId === null) {
          // First check - just record the message ID
          currentMonitoredChat.lastMessageId = msgId;
          log('[Monitor] Initial message recorded: ' + lastIncoming.substring(0, 30));
        } else if (currentMonitoredChat.lastMessageId !== msgId) {
          // NEW MESSAGE DETECTED!
          log('[Monitor] NEW MESSAGE DETECTED!');
          currentMonitoredChat.lastMessageId = msgId;

          // Scroll to see the latest
          await scrollToLatestMessages();

          // Wait a moment for DOM to settle
          await sleep(500);

          // Process the new message
          await processCurrentChatMessages(username);
        }
      } catch (e) {
        log('[Monitor] Error checking for new messages: ' + e);
      }
    }, 3000); // Check every 3 seconds
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

    // Check if the unread chat is from someone different than who we're monitoring
    const chat = unreadChats[0];
    const username = getUsernameFromChatRow(chat);

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

function getBotScript(config: Config, hostname: string): string {
  const site = detectSiteFromHost(hostname);
  switch (site) {
    case 'threads':
      return buildThreadsBotScript(config as any);
    case 'reddit':
      return buildRedditBotScript(config as any);
    case 'instagram':
      return buildInstagramBotScript(config as any);
    case 'snapchat':
    default:
      return getSnapchatBotScript(config);
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

document.addEventListener('DOMContentLoaded', async () => {
  loadConfig();
  addLog('Snappy initialized', 'highlight');
  
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

let llamaServerStatus: LlamaServerStatus = {
  running: false
};

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
  if (!activeSessionId) {
    addLog('No active session to save Llama config for', 'error');
    return;
  }

  const llamaConfig = {
    buildPath: llamaBuildPathInput.value.trim(),
    startCommand: llamaStartCommandInput.value.trim(),
    enabled: llamaEnabledCheckbox.checked
  };

  // Update global config for immediate use
  llamaServerConfig = llamaConfig;

  // Update session config
  const sessionConfig = sessionConfigs.get(activeSessionId);
  if (sessionConfig) {
    sessionConfig.llama = llamaConfig;
    sessionConfigs.set(activeSessionId, sessionConfig);
    
    // Save to persistent storage
    try {
      await (window as any).session.updateSessionConfig(activeSessionId, sessionConfig);
    } catch (e) {
      console.log('Session API not available, using local storage only');
    }
  }

  addLog(`Llama.cpp configuration saved for session: ${activeSessionId.substring(0, 8)}...`, 'success');
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

  addLog('Starting new Llama.cpp server instance...', 'highlight');
  (llamaStartBtn as HTMLButtonElement).disabled = true;

  try {
    const status = await (window as any).llama.start();
    llamaServerStatus = status;

    if (status.running) {
      addLog(`New Llama.cpp server started (PID: ${status.pid})`, 'success');
      updateLlamaUI();
    } else {
      addLog(`Failed to start new server: ${status.error}`, 'error');
    }
  } catch (e) {
    addLog(`Error starting new server: ${e}`, 'error');
  } finally {
    (llamaStartBtn as HTMLButtonElement).disabled = false;
  }
}

// Stop llama.cpp server
async function stopLlamaServer() {
  addLog('Stopping all Llama.cpp servers...', 'highlight');
  (llamaStopBtn as HTMLButtonElement).disabled = true;

  try {
    const status = await (window as any).llama.stop();
    llamaServerStatus = status;

    if (!status.running) {
      addLog('All Llama.cpp servers stopped', 'success');
      updateLlamaUI();
    } else {
      addLog(`Failed to stop all servers: ${status.error}`, 'error');
    }
  } catch (e) {
    addLog(`Error stopping servers: ${e}`, 'error');
  } finally {
    (llamaStopBtn as HTMLButtonElement).disabled = false;
  }
}

// Get llama.cpp server status
async function getLlamaStatus() {
  try {
    const status = await (window as any).llama.getStatus();
    llamaServerStatus = status;
    updateLlamaUI();
  } catch (e) {
    console.error('Failed to get llama status:', e);
  }
}

// Update llama.cpp UI based on status
function updateLlamaUI() {
  if (llamaServerStatus.running) {
    llamaStatusDot.className = 'llama-status running';
    llamaStatusDot.textContent = '●';
    llamaServerRunning.textContent = 'Running';
    llamaServerPid.textContent = String(llamaServerStatus.pid || '-');

    // Update uptime
    if (llamaServerStatus.startTime) {
      const uptime = Math.floor((Date.now() - llamaServerStatus.startTime) / 1000);
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
  
  // Always show both buttons - Start opens new instance, Stop kills all
  llamaStartBtn.style.display = 'inline-block';
  llamaStopBtn.style.display = 'inline-block';
  
  // Update button text to be clearer
  (llamaStartBtn as HTMLButtonElement).textContent = 'Start New Server';
  (llamaStopBtn as HTMLButtonElement).textContent = 'Stop All Servers';
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
