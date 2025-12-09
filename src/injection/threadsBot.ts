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
  const seenComments = new Set();
  const seenNotifications = new Set();
  let isRunning = true;
  let pollInterval = null;
  let isProcessing = false;

  const MIN_COMMENT_LENGTH = 3;
  const POLL_MS = (CONFIG?.threads && CONFIG.threads.pollIntervalMs) || 60000;
  const MAX_PER_POLL = (CONFIG?.threads && CONFIG.threads.maxCommentsPerPoll) || 5;
  const typingDelayRange = CONFIG?.typingDelayRangeMs || [50, 150];
  const preReplyDelayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];

  function log(msg) {
    const formatted = '[Snappy][Threads] ' + msg;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      log('✓ Replied to @' + comment.author + ': ' + reply.substring(0, 60));
    } else {
      log('Failed to send reply to @' + comment.author);
    }
  }

  async function poll() {
    if (!isRunning) return;
    if (isProcessing) return;
    isProcessing = true;
    try {
      // If not on a post page, try to open the latest notification that looks like a comment on our post
      if (!isOnPostPage()) {
        const notif = findNewNotification();
        if (notif) {
          seenNotifications.add(notif.id);
          log('Opening notification: ' + notif.href);
          notif.element.click();
          await sleep(1500);
        } else {
          log('No new notifications with comments');
        }
        isProcessing = false;
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
    window.__SNAPPY_RUNNING__ = false;
    window.__SNAPPY_THREADS_RUNNING__ = false;
    log('Threads bot stopped');
  }

  // Start polling
  log('🚀 Threads bot started');
  poll();
  pollInterval = setInterval(poll, POLL_MS);

  window.__SNAPPY_STOP__ = stop;
})();
`;
}

