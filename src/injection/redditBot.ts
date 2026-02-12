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
  let pollInterval = null;
  let isProcessing = false;
  let nextSubredditCheckAt = 0;
  let lastPmCheckAt = 0;
  let lastPmReplyRunAt = 0;
  const unreadPmQueue = [];

  const MIN_SUBREDDIT_CHECK_MS = 5 * 60 * 1000;
  const MAX_SUBREDDIT_CHECK_MS = 60 * 60 * 1000;
  const PM_CHECK_DEBOUNCE_MS = 15000;
  const PM_REPLY_DEBOUNCE_MS = 12000;

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
    return settings.watchPrivateMessages !== false && settings.autoReplyToPMs !== false;
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

  function findConversationElementForAuthor(author) {
    const cleanAuthor = sanitizeAuthor(author).toLowerCase();
    if (!cleanAuthor) return null;

    const hrefNode = document.querySelector('a[href*="/message/messages/' + cleanAuthor + '"]');
    if (hrefNode && hrefNode instanceof HTMLElement) return hrefNode;

    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], li, div')).slice(0, 400);
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
      '[data-testid*="message"]',
      '[data-id*="message"]',
      '.message',
      '[class*="message"] p',
      '[class*="message"] span'
    ];

    let latest = '';
    messageSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(node => {
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
      const el = document.querySelector(selector);
      if (el && el instanceof HTMLElement) {
        input = el;
        break;
      }
    }
    if (!input) return false;

    input.focus();
    if (input.getAttribute('contenteditable') === 'true') {
      input.textContent = '';
      input.textContent = text;
    } else if (Object.prototype.hasOwnProperty.call(input, 'value')) {
      input.value = text;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);

    const buttonSelectors = [
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[data-testid*="send"]'
    ];
    for (const selector of buttonSelectors) {
      const btn = document.querySelector(selector);
      if (btn && btn instanceof HTMLElement) {
        btn.click();
        return true;
      }
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  }

  async function processUnreadPmConversations() {
    if (!shouldReadPrivateMessages()) return;
    if (settings.autoReplyToPMs === false) return;
    if ((Date.now() - lastPmReplyRunAt) < PM_REPLY_DEBOUNCE_MS) return;
    lastPmReplyRunAt = Date.now();

    if (!unreadPmQueue.length) return;
    const limit = Math.max(1, Number(settings.maxItemsPerPoll) || 3);
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
          convoEl.click();
          log('Opened PM thread for u/' + author);
          await sleep(1200);
        } else {
          log('Could not find PM thread in UI for u/' + author + ', using latest inbox text');
        }

        const latestMessage = extractLatestConversationMessage() || String(pm.body || '').trim();
        if (!latestMessage) continue;

        const messageKey = 'pm-msg:' + author + ':' + latestMessage.substring(0, 200);
        if (processedItems.has(messageKey)) continue;

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

  function stop() {
    isRunning = false;
    if (pollInterval) clearInterval(pollInterval);
    window.__SNAPPY_RUNNING__ = false;
    window.__SNAPPY_REDDIT_RUNNING__ = false;
    log('Reddit bot stopped');
  }

  log('Reddit bot started');
  log('Watch list size: ' + ((settings.watchSubreddits && settings.watchSubreddits.length) || 0));
  if (String(settings.authCookieString || '').trim() || String(settings.sessionCookie || '').trim()) {
    log('Manual Reddit auth cookies configured');
  }
  applyManualAuthCookies();
  scheduleNextSubredditCheck();
  openChatAndCheckUnread().then(() => runSubredditCheck(true)).catch(error => {
    log('Startup Reddit checks error: ' + error);
  });
  poll();
  pollInterval = setInterval(poll, Math.max(5000, Number(settings.pollIntervalMs) || 30000));
  window.__SNAPPY_STOP__ = stop;
})();
`;
}
