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
  let isRunning = true;
  let pollTimer = null;
  let isProcessing = false;
  let nextSubredditCheckAt = 0;
  let lastPmCheckAt = 0;
  let lastPmReplyRunAt = 0;
  const unreadPmQueue = [];

  const MIN_SUBREDDIT_CHECK_MS = 5 * 60 * 1000;
  const MAX_SUBREDDIT_CHECK_MS = 60 * 60 * 1000;
  const PM_CHECK_DEBOUNCE_MS = 15000;
  const PM_REPLY_DEBOUNCE_MS = 12000;
  const MIN_POLL_MS = 1000;
  const MAX_POLL_MS = 60000;

  const settings = {
    watchNotifications: true,
    watchPrivateMessages: true,
    readPrivateMessages: true,
    watchSubreddits: [],
    subredditKeywords: [],
    autoReplyToComments: true,
    autoReplyToPMs: true,
    autoReplyToPosts: false,
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

  function randomRange(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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

  function getUnreadConversationCandidates() {
    const candidates = [];
    const seenKeys = new Set();

    const links = deepQueryAll('a[href*="/message/messages/"]').filter(el => el instanceof HTMLElement);
    const markers = deepQueryAll('.notifications-badge, [aria-label*="unread" i], [data-unread="true"], [data-is-unread="true"]')
      .filter(el => el instanceof HTMLElement);

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    }

    function sameRow(rectA, rectB) {
      const centerA = rectA.top + (rectA.height / 2);
      const centerB = rectB.top + (rectB.height / 2);
      return Math.abs(centerA - centerB) <= 36;
    }

    links.forEach(link => {
      if (!isVisible(link)) return;
      const linkRect = link.getBoundingClientRect();
      const text = String(link.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!text || /^\\d+$/.test(text)) return;

      const hasUnreadMarker = markers.some(marker => {
        if (!isVisible(marker)) return false;
        const markerRect = marker.getBoundingClientRect();
        if (!sameRow(linkRect, markerRect)) return false;
        return Math.abs(markerRect.left - linkRect.left) < 600;
      });

      const unreadByText = /\\bunread\\b/i.test(String(link.getAttribute('aria-label') || '')) || /\\bunread\\b/i.test(text);
      if (!hasUnreadMarker && !unreadByText) return;

      const key = (link.getAttribute('href') || '') + '|' + text.substring(0, 160);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      candidates.push(link);
    });

    log('PM scan: links=' + links.length + ', markers=' + markers.length + ', unreadCandidates=' + candidates.length);
    return candidates;
  }

  function findConversationElementForAuthor(author) {
    const cleanAuthor = sanitizeAuthor(author).toLowerCase();
    if (!cleanAuthor) return null;

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

  function extractLatestConversationMessage() {
    const messageSelectors = [
      '.room-message[aria-label*=" said "] .room-message-text',
      '.room-message-text',
      '[data-testid*="message"]',
      '[data-id*="message"]',
      '.message',
      '[class*="message"] p',
      '[class*="message"] span'
    ];

    let latest = '';
    messageSelectors.forEach(selector => {
      deepQueryAll(selector).forEach(node => {
        const txt = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!txt) return;
        if (txt.length < 2) return;
        if (/^send a message$/i.test(txt)) return;
        latest = txt;
      });
    });

    return latest.substring(0, 500);
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
        const reqId = 'rd-pm-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
        window.__SNAPPY_AI_REQUEST__ = {
          id: reqId,
          username: username || 'reddit_user',
          messages: [{ role: 'user', content: String(messageText || '').trim() }]
        };
        const timeoutMs = Number(CONFIG?.ai?.requestTimeoutMs) || 30000;
        const reply = await waitForAiReply(reqId, timeoutMs);
        if (reply && String(reply).trim()) return String(reply).trim();
      } catch (error) {
        log('AI PM reply generation failed: ' + error);
      }
    }

    return 'Thanks for your message.';
  }

  async function sendPmReply(text) {
    const inputSelectors = [
      'textarea[name="text"]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]'
    ];

    let input = null;
    for (const selector of inputSelectors) {
      const nodes = deepQueryAll(selector);
      for (const el of nodes) {
        if (el && el instanceof HTMLElement) {
          input = el;
          break;
        }
      }
      if (input) break;
    }
    if (!input) return false;

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
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[data-testid*="send"]'
    ];
    for (const selector of buttonSelectors) {
      const btns = deepQueryAll(selector);
      for (const btn of btns) {
        if (btn && btn instanceof HTMLElement) {
          btn.click();
          return true;
        }
      }
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    return true;
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

  async function processUnreadPmConversations() {
    if (!shouldReadPrivateMessages()) {
      log('PM scan skipped: PM watch/read disabled');
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
    await sleep(300);

    const unreadCandidates = getUnreadConversationCandidates();
    if (unreadCandidates.length > 0) {
      log('Unread conversations detected: ' + unreadCandidates.length);
      for (const convoEl of unreadCandidates.slice(0, limit)) {
        try {
          const author = sanitizeAuthor(extractConversationAuthor(convoEl)) || 'reddit_user';
          const convoKey = 'pm-thread-ui:' + author + ':' + String(convoEl.textContent || '').substring(0, 120);
          if (processedItems.has(convoKey)) continue;

          const clicked = clickConversationElement(convoEl);
          if (!clicked) continue;
          log('Clicked unread conversation for u/' + author);
          await sleep(900);

          const latestMessage = extractLatestConversationMessage();
          if (!latestMessage) continue;
          const messageKey = 'pm-msg:' + author + ':' + latestMessage.substring(0, 200);
          if (processedItems.has(messageKey)) continue;
          if (!allowAutoReply) {
            log('Captured unread PM from u/' + author + ' (auto-reply disabled)');
            continue;
          }

          const reply = await generatePmReply(latestMessage, author);
          if (!reply) continue;
          const sent = await sendPmReply(reply);
          if (sent) {
            processedItems.add(convoKey);
            processedItems.add(messageKey);
            log('Replied to PM from u/' + author + ': ' + reply.substring(0, 80));
            await sleep(500);
            ensureThreadsTab();
          }
        } catch (error) {
          log('Error processing unread PM conversation (UI path): ' + error);
        }
      }
      return;
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

        const latestMessage = extractLatestConversationMessage() || String(pm.body || '').trim();
        if (!latestMessage) continue;

        const messageKey = 'pm-msg:' + author + ':' + latestMessage.substring(0, 200);
        if (processedItems.has(messageKey)) continue;
        if (!allowAutoReply) {
          log('Queued unread PM from u/' + author + ' (auto-reply disabled)');
          continue;
        }

        const reply = await generatePmReply(latestMessage, author);
        if (!reply) continue;

        const sent = await sendPmReply(reply);
        if (sent) {
          processedItems.add(repliedKey);
          processedItems.add(messageKey);
          log('Replied to PM from u/' + author + ': ' + reply.substring(0, 80));
          const qIdx = unreadPmQueue.findIndex(item => item.id === pm.id);
          if (qIdx >= 0) unreadPmQueue.splice(qIdx, 1);
          await sleep(800);
        }
      } catch (error) {
        log('Error processing unread PM conversation: ' + error);
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
      await sleep(300);
      const unreadEls = Array.from(document.querySelectorAll('.unread, [data-unread="true"], .message.unread'));
      if (unreadEls.length > 0) {
        log('Unread messages in UI: ' + unreadEls.length);
      }
    }

    await readUnreadPrivateMessages();
    await processUnreadPmConversations();
  }

  async function poll() {
    if (!isRunning || isProcessing) return;
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

      await readUnreadPrivateMessages();
      await processUnreadPmConversations();
      await runSubredditCheck(false);
    } catch (error) {
      log('Poll error: ' + error);
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

  log('Reddit bot started');
  log('Watch list size: ' + ((settings.watchSubreddits && settings.watchSubreddits.length) || 0));
  log('PM settings: watch=' + (settings.watchPrivateMessages !== false) + ', read=' + (settings.readPrivateMessages !== false) + ', autoReply=' + (settings.autoReplyToPMs !== false));
  if (String(settings.authCookieString || '').trim() || String(settings.sessionCookie || '').trim()) {
    log('Manual Reddit auth cookies configured');
  }
  applyManualAuthCookies();
  scheduleNextSubredditCheck();
  openChatAndCheckUnread().then(() => runSubredditCheck(true)).catch(error => {
    log('Startup Reddit checks error: ' + error);
  });
  poll();
  scheduleNextPoll();
  window.__SNAPPY_STOP__ = stop;
})();
`;
}
