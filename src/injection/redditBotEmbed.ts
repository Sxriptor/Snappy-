import { Configuration } from '../types';

/**
 * Lightweight Reddit reply bot script builder.
 * Focuses on replying to comments on the current post using existing reply rules/AI.
 */
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
  const seen = new Set();
  let isRunning = true;
  let pollInterval = null;
  let isProcessing = false;

  const MIN_COMMENT_LENGTH = 3;
  const POLL_MS = (CONFIG?.reddit && CONFIG.reddit.pollIntervalMs) || 10000;
  const MAX_PER_POLL = (CONFIG?.reddit && CONFIG.reddit.maxCommentsPerPoll) || 5;

  function log(msg) {
    const formatted = '[Snappy][Reddit] ' + msg;
    console.log(formatted);
    window.dispatchEvent(new CustomEvent('snappy-log', { detail: { message: formatted, timestamp: Date.now() } }));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getLoggedInUser() {
    const selectors = [
      '[data-testid="user-drawer-button"] span',
      'a[href^="/user/"][data-testid]',
      '#header-bottom-right .user a'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const txt = el?.textContent?.trim();
      if (txt && txt.length > 1) return txt.replace(/^u\\//, '');
    }
    const match = window.location.pathname.match(/\\/user\\/([^/]+)/);
    return match ? match[1] : null;
  }

  function extractCommentAuthor(el) {
    const authorSelectors = [
      '[data-testid="comment-author-link"]',
      'a.author',
      '[slot="authorName"]',
    ];
    for (const sel of authorSelectors) {
      const node = el.querySelector(sel);
      const text = node?.textContent?.trim();
      if (text) return text.replace(/^u\\//, '');
    }
    return null;
  }

  function extractCommentText(el) {
    const textSelectors = [
      '[slot="comment"] p',
      '[data-testid="comment"] p',
      '.md p',
      '.Comment p'
    ];
    const parts = [];
    for (const sel of textSelectors) {
      el.querySelectorAll(sel).forEach(node => {
        const t = node.textContent?.trim();
        if (t) parts.push(t);
      });
    }
    const combined = parts.join(' ').trim();
    if (combined.length >= MIN_COMMENT_LENGTH) return combined.substring(0, 500);
    const fallback = el.textContent?.trim() || '';
    return fallback.substring(0, 500);
  }

  function extractCommentId(el) {
    return el.getAttribute('data-comment-id') ||
      el.getAttribute('data-fullname') ||
      el.id ||
      ('rd-' + (extractCommentText(el) || '').slice(0, 50));
  }

  function findComments() {
    return Array.from(document.querySelectorAll('[data-testid="comment"], .Comment, shreddit-comment'));
  }

  function hasReplied(commentEl, username) {
    const replies = commentEl.querySelectorAll('[data-testid="comment"], .Comment, shreddit-comment');
    for (const r of replies) {
      const author = extractCommentAuthor(r as HTMLElement);
      if (author && username && author.toLowerCase() === username.toLowerCase()) return true;
    }
    return false;
  }

  function findNewComments(username) {
    const results = [];
    const elements = findComments();
    elements.forEach(el => {
      const author = extractCommentAuthor(el as HTMLElement);
      if (!author || (username && author.toLowerCase() === username.toLowerCase())) return;
      const text = extractCommentText(el as HTMLElement);
      if (!text || text.length < MIN_COMMENT_LENGTH) return;
      const id = extractCommentId(el as HTMLElement);
      if (seen.has(id)) return;
      if (hasReplied(el as HTMLElement, username)) return;
      results.push({ id, author, text, element: el });
    });
    return results;
  }

  async function typeReply(input, text) {
    input.focus();
    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = '';
      input.textContent = '';
    } else if ('value' in input) {
      input.value = '';
    }
    await sleep(150);
    const range = CONFIG?.typingDelayRangeMs || [50, 150];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (input.getAttribute('contenteditable') === 'true') {
        input.textContent = (input.textContent || '') + ch;
      } else if ('value' in input) {
        input.value += ch;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      const delay = Math.floor(Math.random() * (range[1] - range[0])) + range[0];
      await sleep(delay);
    }
    return true;
  }

  function findReplyInput(scope) {
    const selectors = [
      '[contenteditable="true"][data-lexical-editor="true"]',
      'div[role="textbox"][contenteditable="true"]',
      'textarea[name="text"]',
      'textarea'
    ];
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findReplyButton(scope) {
    const selectors = [
      'button[data-click-id="reply"]',
      '[data-testid="comment-reply-button"]',
      'button.reply-button'
    ];
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    // Text match fallback
    const buttons = scope.querySelectorAll('button, a');
    for (const btn of buttons) {
      const t = btn.textContent?.toLowerCase().trim();
      if (t === 'reply' || t === 'comment') return btn;
    }
    return null;
  }

  function findSubmitButton(scope) {
    const selectors = [
      'button[type="submit"]',
      '[data-testid="comment-submission-form-submit"]',
      'faceplate-button[type="submit"]'
    ];
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  async function generateReply(text, author) {
    const rules = CONFIG?.replyRules || [];
    const lower = (text || '').toLowerCase();
    for (const rule of rules) {
      const matchStr = typeof rule.match === 'string' ? rule.match : '';
      const match = rule.caseSensitive ? matchStr : matchStr.toLowerCase();
      const target = rule.caseSensitive ? text : lower;
      if (match && target.includes(match)) {
        log('Rule matched: ' + matchStr);
        return rule.reply;
      }
    }

    const ai = CONFIG?.ai;
    if (ai?.enabled) {
      try {
        const messages = [
          { role: 'system', content: ai.systemPrompt || 'You are a friendly Reddit user replying to comments on your post. Keep responses brief and on-topic.' },
          { role: 'user', content: 'Reply to u/' + author + ': ' + text }
        ];
        const url = 'http://' + (ai.llmEndpoint || 'localhost') + ':' + (ai.llmPort || 8080) + '/v1/chat/completions';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ai.requestTimeoutMs || 30000);
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ai.modelName || 'local-model',
            messages,
            temperature: ai.temperature || 0.7,
            max_tokens: ai.maxTokens || 150
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (resp.ok) {
          const data = await resp.json();
          const aiReply = data?.choices?.[0]?.message?.content?.trim();
          if (aiReply) return aiReply;
        } else {
          log('AI request failed: HTTP ' + resp.status);
        }
      } catch (err) {
        if (err?.name === 'AbortError') {
          log('AI request timed out');
        } else {
          log('AI error: ' + err?.message);
        }
      }
    }

    if (lower.includes('?')) return "Good question!";
    if (lower.includes('thank')) return "You're welcome!";
    return null;
  }

  async function processComment(comment, username) {
    const reply = await generateReply(comment.text, comment.author);
    if (!reply) {
      seen.add(comment.id);
      return;
    }

    const skipProb = CONFIG?.randomSkipProbability || 0.15;
    if (Math.random() < skipProb) {
      log('Randomly skipping reply');
      seen.add(comment.id);
      return;
    }

    const delayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];
    const delay = Math.floor(Math.random() * (delayRange[1] - delayRange[0])) + delayRange[0];
    log('Waiting ' + delay + 'ms before replying');
    await sleep(delay);

    comment.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);

    const replyBtn = findReplyButton(comment.element);
    if (replyBtn) replyBtn.click();
    await sleep(600);

    const input = findReplyInput(comment.element);
    if (!input) {
      log('Reply input not found');
      return;
    }

    const typed = await typeReply(input, reply);
    if (!typed) return;
    await sleep(400);

    const submit = findSubmitButton(comment.element);
    if (submit) {
      submit.click();
      await sleep(1200);
      log('✓ Replied to u/' + comment.author + ': ' + reply.substring(0, 60));
      seen.add(comment.id);
      return;
    }

    // Fallback Enter submit
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(1200);
    seen.add(comment.id);
    log('Sent reply via Enter key');
  }

  async function poll() {
    if (!isRunning || isProcessing) return;
    isProcessing = true;
    try {
      if (!window.location.pathname.includes('/comments/')) {
        log('Not on a comments page, waiting...');
        isProcessing = false;
        return;
      }
      const username = getLoggedInUser();
      const comments = findNewComments(username);
      if (!comments || comments.length === 0) {
        log('No new comments');
        isProcessing = false;
        return;
      }
      log('Found ' + comments.length + ' new comment(s)');
      const toProcess = comments.slice(0, MAX_PER_POLL);
      for (const c of toProcess) {
        if (!isRunning) break;
        await processComment(c, username);
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
    window.__SNAPPY_REDDIT_RUNNING__ = false;
    log('Reddit bot stopped');
  }

  log('🚀 Reddit bot started');
  poll();
  pollInterval = setInterval(poll, POLL_MS);
  window.__SNAPPY_STOP__ = stop;
})();
`;
}

