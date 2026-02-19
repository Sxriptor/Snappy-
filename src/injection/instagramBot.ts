import { Configuration } from '../types';

/**
 * Build an injection script for Instagram that:
 * - Navigates to DMs and finds unread conversations
 * - Uses improved div[role="row"] detection once inside conversations
 * - Replies to new messages automatically with human-like typing
 * - Respects site settings for what to monitor (DMs, requests, auto-accept)
 */
export function buildInstagramBotScript(config: Configuration): string {
  const serializedConfig = JSON.stringify(config || {});

  return `
(function() {
  try {
    if (window.__SNAPPY_RUNNING__ && window.__SNAPPY_INSTAGRAM_RUNNING__) {
      console.log('[Snappy][Instagram] Already running');
      return;
    }

    window.__SNAPPY_RUNNING__ = true;
    window.__SNAPPY_INSTAGRAM_RUNNING__ = true;

    const CONFIG = ${serializedConfig};
    const SITE_SETTINGS = CONFIG?.siteSettings?.instagram || {};
    
    // Set defaults for site settings
    const shouldWatchDMs = SITE_SETTINGS.watchDirectMessages !== false;
    const shouldWatchRequests = SITE_SETTINGS.watchMessageRequests === true;
    const shouldAutoAccept = SITE_SETTINGS.autoAcceptRequests === true;
    const schedulerConfig = SITE_SETTINGS.postScheduler || {};
    const schedulerEnabled = schedulerConfig.enabled === true;
    
    console.log('[Snappy][Instagram] Bot settings - DMs: ' + shouldWatchDMs + ', Requests: ' + shouldWatchRequests + ', Auto-accept: ' + shouldAutoAccept + ', Scheduler: ' + schedulerEnabled);
    
    if (!shouldWatchDMs && !shouldWatchRequests && !schedulerEnabled) {
      console.log('[Snappy][Instagram] All monitoring disabled - bot will remain idle');
      window.__SNAPPY_STOP__ = function() {
        window.__SNAPPY_RUNNING__ = false;
        window.__SNAPPY_INSTAGRAM_RUNNING__ = false;
        console.log('[Snappy][Instagram] Bot stopped');
      };
      return;
    }

    const seenMessages = new Set();
    const recentlyProcessedConversations = new Map();
    const processedScheduleSlots = new Set();
    let isRunning = true;
    let pollInterval = null;
    let isProcessing = false;
    let schedulerInterval = null;
    let isPostingScheduledContent = false;

    const MIN_MESSAGE_LENGTH = 2;
    const BASE_POLL_MS = (CONFIG?.instagram && CONFIG.instagram.pollIntervalMs) || 8000;
    const POLL_VARIANCE_MS = 4000;
    const REPROCESS_COOLDOWN_MS = 20000;
    const typingDelayRange = CONFIG?.typingDelayRangeMs || [50, 150];
    const preReplyDelayRange = CONFIG?.preReplyDelayRangeMs || [2000, 6000];
    const SCHEDULER_JITTER_MINUTES = 15;
    let lastQuietWindowLogAt = 0;

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

    function isStopped() {
      return !isRunning || window.__SNAPPY_RUNNING__ !== true || window.__SNAPPY_INSTAGRAM_RUNNING__ !== true;
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

    function clickElementByText(candidates, textMatch) {
      const lowerMatch = textMatch.toLowerCase();
      for (const el of candidates) {
        const text = (el.textContent || '').trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        if (text === lowerMatch || text.includes(lowerMatch) || ariaLabel === lowerMatch || ariaLabel.includes(lowerMatch)) {
          el.click();
          return true;
        }
      }
      return false;
    }

    async function waitForSelector(selectors, timeoutMs) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        for (const selector of selectors) {
          const found = document.querySelector(selector);
          if (found) {
            return found;
          }
        }
        await sleep(200);
      }
      return null;
    }

    function getSchedulerPosts() {
      const posts = Array.isArray(schedulerConfig.posts) ? schedulerConfig.posts : [];
      return posts.filter(post =>
        post &&
        typeof post.id === 'string' &&
        ((Array.isArray(post.mediaPaths) && post.mediaPaths.length > 0) || typeof post.mediaPath === 'string') &&
        typeof post.caption === 'string'
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
        const raw = localStorage.getItem('__snappy_ig_scheduler_posted__');
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {}
      return {};
    }

    function savePostedState(state) {
      try {
        localStorage.setItem('__snappy_ig_scheduler_posted__', JSON.stringify(state || {}));
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

    async function requestMediaAttach(filePaths) {
      const normalizedPaths = Array.isArray(filePaths)
        ? filePaths.filter(item => typeof item === 'string' && item.trim().length > 0)
        : [];
      if (normalizedPaths.length === 0) return false;
      const requestId = 'ig-upload-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      window.__SNAPPY_IG_UPLOAD_RESPONSE__ = null;
      window.__SNAPPY_IG_UPLOAD_REQUEST__ = {
        id: requestId,
        filePaths: normalizedPaths,
        selector: 'input[type="file"]'
      };

      let waited = 0;
      const timeoutMs = 30000;
      while (waited < timeoutMs && !isStopped()) {
        await sleep(250);
        waited += 250;
        const response = window.__SNAPPY_IG_UPLOAD_RESPONSE__;
        if (response && response.id === requestId) {
          window.__SNAPPY_IG_UPLOAD_RESPONSE__ = null;
          return response.success === true;
        }
      }
      return false;
    }

    async function clickCreatePostFlow() {
      const homeLink = document.querySelector('a[href="/"], a[href="https://www.instagram.com/"]');
      if (homeLink && window.location.pathname.startsWith('/direct')) {
        homeLink.click();
        await sleep(1200);
      }

      const createCandidates = Array.from(document.querySelectorAll('a, button, div[role="button"]'));
      const createClicked = clickElementByText(createCandidates, 'create') || clickElementByText(createCandidates, 'new post');
      if (!createClicked) {
        log('Scheduler: Create button not found');
        return false;
      }

      await sleep(1000);
      const postCandidates = Array.from(document.querySelectorAll('a, button, div[role="button"]'));
      clickElementByText(postCandidates, 'post');
      await sleep(1000);
      return true;
    }

    async function clickSelectFromComputerStep() {
      const selected = await clickButtonByText('select from computer', 7000);
      if (selected) {
        log('Scheduler: clicked "Select from computer"');
        await sleep(600);
      } else {
        log('Scheduler: "Select from computer" not found, trying direct file input');
      }
      return selected;
    }

    async function clickButtonByText(buttonText, timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs && !isStopped()) {
        const candidates = Array.from(document.querySelectorAll('button, div[role="button"]'));
        if (clickElementByText(candidates, buttonText)) {
          return true;
        }
        await sleep(200);
      }
      return false;
    }

    async function setPostCaption(caption) {
      const captionInput = await waitForSelector([
        'textarea[aria-label*="caption" i]',
        '[contenteditable="true"][aria-label*="caption" i]',
        'textarea[placeholder*="caption" i]'
      ], 10000);

      if (!captionInput) {
        log('Scheduler: Caption input not found');
        return false;
      }

      const text = String(caption || '').trim();
      if (!text) {
        return true;
      }

      captionInput.focus();
      if (captionInput.tagName === 'TEXTAREA') {
        captionInput.value = text;
        captionInput.dispatchEvent(new Event('input', { bubbles: true }));
        captionInput.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        captionInput.textContent = text;
        captionInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }

      await sleep(400);
      return true;
    }

    async function publishScheduledPost(post) {
      const mediaPaths = getPostMediaPaths(post);
      if (!post || mediaPaths.length === 0) {
        log('Scheduler: No scheduled media found');
        return false;
      }

      if (isPostingScheduledContent) {
        return false;
      }

      isPostingScheduledContent = true;
      try {
        log('Scheduler: starting scheduled publish for slot item ' + post.id);

        const openedCreate = await clickCreatePostFlow();
        if (!openedCreate) return false;

        await clickSelectFromComputerStep();

        const input = await waitForSelector(['input[type="file"]'], 12000);
        if (!input) {
          log('Scheduler: file input not found');
          return false;
        }

        const attached = await requestMediaAttach(mediaPaths);
        if (!attached) {
          log('Scheduler: media attach failed');
          return false;
        }

        await sleep(2000);

        const next1 = await clickButtonByText('next', 12000);
        if (!next1) {
          log('Scheduler: first Next button not found');
          return false;
        }

        await sleep(1200);
        await clickButtonByText('next', 5000);
        await sleep(900);

        const captionSet = await setPostCaption(post.caption || '');
        if (!captionSet) return false;

        const shareClicked = await clickButtonByText('share', 12000);
        if (!shareClicked) {
          log('Scheduler: Share button not found');
          return false;
        }

        log('Scheduler: post submitted for publishing');
        return true;
      } catch (error) {
        log('Scheduler publish error: ' + error);
        return false;
      } finally {
        isPostingScheduledContent = false;
      }
    }

    function getDueScheduleSlot() {
      if (!schedulerEnabled) return null;
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

    function isWithinSchedulerQuietWindow(date) {
      if (!schedulerEnabled) return false;
      const dayKey = getDayKey(date);
      const dayConfig = schedulerConfig.days?.[dayKey];
      if (!dayConfig || dayConfig.enabled !== true || !Array.isArray(dayConfig.times) || dayConfig.times.length === 0) {
        return false;
      }

      for (const timeValue of dayConfig.times) {
        const normalized = normalizeTime(timeValue);
        if (!normalized) continue;
        const baseTime = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          normalized.hour,
          normalized.minute,
          0,
          0
        );
        const quietStart = new Date(baseTime.getTime() - (SCHEDULER_JITTER_MINUTES * 60 * 1000));
        const quietEnd = new Date(baseTime.getTime() + (SCHEDULER_JITTER_MINUTES * 60 * 1000));
        if (date >= quietStart && date <= quietEnd) {
          return true;
        }
      }

      return false;
    }

    async function processScheduledPosting() {
      if (!schedulerEnabled || isStopped()) return;
      if (isPostingScheduledContent) return;

      const dueSlot = getDueScheduleSlot();
      if (!dueSlot) return;

      const post = getNextScheduledPost();
      if (!post) {
        log('Scheduler: no unposted media/text pairs available');
        processedScheduleSlots.add(dueSlot.slotKey);
        return;
      }

      log('Scheduler due at ' + dueSlot.planned + ' with random offset ' + dueSlot.offsetMinutes + ' min');
      const posted = await publishScheduledPost(post);
      if (posted) {
        const folderPath = typeof schedulerConfig.folderPath === 'string' ? schedulerConfig.folderPath.trim() : '';
        markPostPublished(post, folderPath);
        processedScheduleSlots.add(dueSlot.slotKey);
      }
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

    function isInConversation() {
      return window.location.href.includes('/direct/t/');
    }

    function navigateBackToDMs() {
      const dmLinks = Array.from(document.querySelectorAll('a[href*="/direct/"], a[href="/direct/inbox/"]'));
      for (const link of dmLinks) {
        if (link.href.includes('/direct/t/')) continue;
        log('Navigating back to main DMs page');
        link.click();
        return true;
      }
      
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
      const seenConvIds = new Set();

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
            for (let i = 0; i < 8 && parent; i++) {
              const hasDirectLink = !!parent.querySelector?.('a[href*="/direct/t/"]');
              if (parent.tagName === 'A' || hasDirectLink || parent.getAttribute('role') === 'button') {
                return parent;
              }
              parent = parent.parentElement;
            }
            return null;
          }).filter(el => el !== null);
        }
      }

      log('Found ' + items.length + ' total conversation items to check');

      for (const item of items) {
        const hasUnread = hasUnreadIndicator(item);
        if (!hasUnread) continue;

        const convId = getConversationId(item);
        if (!convId) {
          log('Skipping unread candidate without stable conversation id');
          continue;
        }

        if (seenConvIds.has(convId)) {
          log('Skipping duplicate unread conversation in same scan: ' + convId.substring(0, 60));
          continue;
        }
        seenConvIds.add(convId);

        const lastProcessedAt = recentlyProcessedConversations.get(convId) || 0;
        if (Date.now() - lastProcessedAt < REPROCESS_COOLDOWN_MS) {
          log('Skipping recently processed conversation: ' + convId.substring(0, 60));
          continue;
        }

        if (!seenMessages.has(convId)) {
          log('Found unread conversation: ' + convId.substring(0, 60));
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

      const ariaUnread = element.querySelector('[aria-label*="unread" i]');
      if (ariaUnread) return true;

      const statusBadges = element.querySelectorAll('[role="status"]');
      for (const badge of statusBadges) {
        const text = badge.textContent?.trim() || '';
        if (/^\\d+$/.test(text) || text.toLowerCase().includes('unread')) {
          return true;
        }
      }

      return false;
    }

    function getConversationId(element) {
      if (!element) return null;

      const directLink = element.tagName === 'A'
        ? element
        : element.querySelector('a[href*="/direct/t/"]');
      const href = directLink?.getAttribute?.('href') || '';
      const match = href.match(/\\/direct\\/t\\/([^\\/?#]+)/);
      if (match && match[1]) {
        return 'conv-' + match[1];
      }

      const rawText = (element.textContent || '').replace(/\\s+/g, ' ').trim();
      const normalized = rawText.replace(/\\bunread\\b/ig, '').trim();
      if (!normalized || normalized.length < 4) return null;
      return 'conv-' + normalized.substring(0, 80);
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
        
        await sleep(3000);
        
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

    function getConversationMessages() {
      const messages = [];
      
      let messageElements = Array.from(document.querySelectorAll('div[role="row"]'));
      log('Found ' + messageElements.length + ' message rows with role="row"');
      
      if (messageElements.length === 0) {
        messageElements = Array.from(document.querySelectorAll('div[dir="auto"]'));
        log('Found ' + messageElements.length + ' elements with dir="auto"');
        
        if (messageElements.length === 0) {
          messageElements = Array.from(document.querySelectorAll('[data-testid*="message"], [class*="message"], [class*="Message"]'));
          log('Found ' + messageElements.length + ' elements with message-related attributes');
        }
        
        if (messageElements.length === 0) {
          const allDivs = Array.from(document.querySelectorAll('div'));
          messageElements = allDivs.filter(div => {
            const text = div.innerText?.trim();
            return text && text.length > 2 && text.length < 1000 && 
                   !text.includes('Unread') && !text.includes('Active') &&
                   div.querySelector('div[dir="auto"]');
          });
          log('Found ' + messageElements.length + ' potential message containers');
        }
      }

      for (const element of messageElements) {
        const text = getMessageText(element);
        
        if (!text) {
          continue;
        }
        
        if (text.length < MIN_MESSAGE_LENGTH) {
          continue;
        }

        const isIncomingMsg = isIncoming(element);
        
        log('Message found: "' + text.substring(0, 30) + '..." - Incoming: ' + isIncomingMsg + ' - Length: ' + text.length);

        messages.push({ text: text, isIncoming: isIncomingMsg, element: element });
      }

      return messages;
    }

    function getMessageText(row) {
      const messageDiv = row.querySelector('div[dir="auto"]');
      if (messageDiv) {
        const text = messageDiv.innerText.trim();
        if (text) {
          return text;
        }
      }
      
      if (row.getAttribute('dir') === 'auto') {
        const text = row.innerText.trim();
        if (text) {
          return text;
        }
      }
      
      const span = row.querySelector('span');
      if (span) {
        const text = span.innerText.trim();
        if (text) {
          return text;
        }
      }
      
      return null;
    }

    function isIncoming(row) {
      return !row.innerText.includes('Seen') && !row.innerText.includes('Delivered');
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

    async function generateReply(messageText) {
      // Try rule-based matching first
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

      // Try AI if enabled
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

      // Fallback responses
      if (lower.includes('?')) return "That's a good question! Let me get back to you on that.";
      if (lower.includes('thank')) return "You're welcome! 😊";
      if (lower.includes('hi') || lower.includes('hey') || lower.includes('hello')) return "Hey! What's up?";

      return null;
    }

    function focusMessageInput(input) {
      try {
        input.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch {}

      const rect = input.getBoundingClientRect();
      const cx = Math.floor(rect.left + rect.width / 2);
      const cy = Math.floor(rect.top + rect.height / 2);

      const pointerOpts = {
        bubbles: true,
        cancelable: true,
        clientX: cx,
        clientY: cy,
        button: 0
      };

      input.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
      input.dispatchEvent(new MouseEvent('mousedown', pointerOpts));
      if (typeof input.click === 'function') input.click();
      input.dispatchEvent(new MouseEvent('mouseup', pointerOpts));
      input.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
      input.focus();

      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {}

      const active = document.activeElement === input || input.contains(document.activeElement);
      return active;
    }

    async function typeMessage(text) {
      const input = document.querySelector('[contenteditable="true"][role="textbox"][data-lexical-editor="true"], [contenteditable="true"][role="textbox"], textarea[placeholder*="Message"], textarea, [data-testid="message-input"]');

      if (!input) {
        log('Input field not found');
        return false;
      }

      log('Found input field: ' + input.tagName + (input.getAttribute('role') ? '[role="' + input.getAttribute('role') + '"]' : ''));
      if (isStopped()) return false;

      const focused = focusMessageInput(input);
      await sleep(500);
      if (isStopped()) return false;
      if (!focused) {
        log('Input did not receive focus/caret');
        return false;
      }

      // Clear existing content
      if (input.getAttribute('contenteditable') === 'true') {
        try {
          document.execCommand('selectAll', false);
          document.execCommand('delete', false);
        } catch {}
        input.textContent = '';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      } else if (input.value !== undefined) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      await sleep(200);

      // Type character by character
      for (let i = 0; i < text.length; i++) {
        if (isStopped()) return false;
        const char = text[i];

        if (input.getAttribute('contenteditable') === 'true') {
          try {
            document.execCommand('insertText', false, char);
          } catch {
            input.textContent = (input.textContent || '') + char;
          }
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
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
      if (isStopped()) return false;
      await sleep(300);
      if (isStopped()) return false;
      
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
        await sleep(1000);
        if (isStopped()) return false;
        
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
        if (isStopped()) return false;
        
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

    async function processConversation(conversation) {
      try {
        if (isStopped()) return;
        const opened = await openConversation(conversation);
        if (!opened) {
          seenMessages.add(conversation.id);
          recentlyProcessedConversations.set(conversation.id, Date.now());
          return;
        }
        if (isStopped()) return;

        const messages = getConversationMessages();
        log('Found ' + messages.length + ' messages in conversation');

        if (messages.length === 0) {
          log('No messages found - marking conversation as seen and navigating back to DMs');
          seenMessages.add(conversation.id);
          recentlyProcessedConversations.set(conversation.id, Date.now());
          await sleep(1000);
          navigateBackToDMs();
          return;
        }

        const latestMsg = getLatestIncomingMessage(messages);
        if (!latestMsg) {
          log('No new incoming messages - marking conversation as seen and navigating back to DMs');
          seenMessages.add(conversation.id);
          recentlyProcessedConversations.set(conversation.id, Date.now());
          await sleep(1000);
          navigateBackToDMs();
          return;
        }

        log('Latest incoming message: "' + latestMsg.text.substring(0, 50) + '..."');

        // Mark both message and conversation as seen
        seenMessages.add(latestMsg.id);
        seenMessages.add(conversation.id);
        recentlyProcessedConversations.set(conversation.id, Date.now());

        const reply = await generateReply(latestMsg.text);
        if (isStopped()) return;
        if (!reply) {
          log('No reply generated - navigating back to DMs');
          recentlyProcessedConversations.set(conversation.id, Date.now());
          await sleep(1000);
          navigateBackToDMs();
          return;
        }

        const skipProb = CONFIG?.randomSkipProbability || 0.15;
        if (Math.random() < skipProb) {
          log('Randomly skipping reply (prob ' + Math.round(skipProb * 100) + '%) - navigating back to DMs');
          recentlyProcessedConversations.set(conversation.id, Date.now());
          await sleep(1000);
          navigateBackToDMs();
          return;
        }

        const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
        log('Waiting ' + delay + 'ms before replying');
        await sleep(delay);
        if (isStopped()) return;

        const typed = await typeMessage(reply);
        if (!typed) {
          log('Failed to type message - navigating back to DMs');
          recentlyProcessedConversations.set(conversation.id, Date.now());
          await sleep(1000);
          navigateBackToDMs();
          return;
        }

        await sleep(500);
        if (isStopped()) return;

        const sent = await sendMessage();
        if (isStopped()) return;
        if (sent) {
          log('✓ Reply sent: "' + reply.substring(0, 60) + '..." - navigating back to DMs');
        } else {
          log('Failed to send message - navigating back to DMs');
        }
        
        recentlyProcessedConversations.set(conversation.id, Date.now());

        // Always navigate back to DMs after processing
        await sleep(2000);
        navigateBackToDMs();
        
      } catch (err) {
        log('Error processing conversation: ' + err + ' - marking as seen and navigating back to DMs');
        seenMessages.add(conversation.id);
        recentlyProcessedConversations.set(conversation.id, Date.now());
        await sleep(1000);
        navigateBackToDMs();
      }
    }

    function isOnRequestsPage() {
      return window.location.href.includes('/direct/requests/');
    }

    function navigateToRequests() {
      // ONLY look for the "Request (X)" tab with a number - don't click if no pending requests
      const requestTabs = Array.from(document.querySelectorAll('[role="tab"]')).filter(tab => {
        const text = tab.textContent?.toLowerCase() || '';
        return text.includes('request') && /\\(\\d+\\)/.test(text);
      });
      
      if (requestTabs.length > 0) {
        // Extract the number for logging
        const tabText = requestTabs[0].textContent || '';
        const numberMatch = tabText.match(/\\((\\d+)\\)/);
        const requestCount = numberMatch ? numberMatch[1] : 'unknown';
        
        log('Found requests tab with ' + requestCount + ' pending request(s), clicking...');
        requestTabs[0].click();
        return true;
      }
      
      // If no numbered requests tab found, don't navigate
      log('No requests tab with pending requests found - skipping requests navigation');
      return false;
    }

    async function processMessageRequests() {
      if (!shouldWatchRequests) {
        log('Message requests monitoring disabled');
        return;
      }

      log('Processing message requests...');
      
      // Find request items - look for elements with user profiles and "Unread" indicators
      // BUT exclude "Hidden Requests" items
      const requestItems = Array.from(document.querySelectorAll('[role="button"]')).filter(item => {
        const text = item.textContent || '';
        // Look for items that have profile pictures and "Unread" text
        const hasProfilePic = !!item.querySelector('img[alt*="profile"]');
        const hasUnread = text.includes('Unread');
        const hasUserName = !!item.querySelector('[title]'); // User names usually have title attributes
        const isHiddenRequest = text.includes('Hidden Requests') || text.includes('Hidden Request');
        
        return hasProfilePic && hasUnread && hasUserName && text.length > 50 && !isHiddenRequest; // Exclude hidden requests
      });

      log('Found ' + requestItems.length + ' potential message requests (excluding hidden requests)');

      for (const item of requestItems) {
        if (isStopped()) break;
        
        // Extract user name for logging
        const nameElement = item.querySelector('[title]');
        const userName = nameElement ? nameElement.getAttribute('title') || nameElement.textContent : 'Unknown User';
        
        log('Processing request from: ' + userName);
        
        // If auto-accept is enabled, we need to click into the conversation first
        if (shouldAutoAccept) {
          log('Auto-accept enabled, opening conversation to accept request');
          
          // Click into the conversation
          item.click();
          await sleep(3000); // Wait for conversation to load
          
          // Look for accept button in the conversation
          const acceptButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
            return text.includes('accept') || text.includes('allow') || 
                   ariaLabel.includes('accept') || ariaLabel.includes('allow');
          });
          
          if (acceptButtons.length > 0) {
            log('Found accept button, clicking to accept request from ' + userName);
            acceptButtons[0].click();
            await sleep(2000); // Wait for accept to process
            
            // After clicking accept, look for "Primary" button
            const primaryButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(btn => {
              const text = btn.textContent?.toLowerCase() || '';
              const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
              return text.includes('primary') || ariaLabel.includes('primary');
            });
            
            if (primaryButtons.length > 0) {
              log('Found primary button, clicking to complete acceptance for ' + userName);
              primaryButtons[0].click();
              await sleep(1500);
            } else {
              log('No primary button found after accepting request from ' + userName);
            }
            
            // After accepting, we can optionally process the conversation like a normal DM
            if (shouldWatchDMs) {
              log('Processing accepted request as normal conversation');
              const messages = getConversationMessages();
              if (messages.length > 0) {
                const latestMsg = getLatestIncomingMessage(messages);
                if (latestMsg) {
                  const reply = await generateReply(latestMsg.text);
                  if (reply && Math.random() > (CONFIG?.randomSkipProbability || 0.15)) {
                    const delay = Math.floor(Math.random() * (preReplyDelayRange[1] - preReplyDelayRange[0])) + preReplyDelayRange[0];
                    log('Waiting ' + delay + 'ms before replying to accepted request');
                    await sleep(delay);
                    if (!isStopped()) {
                      await typeMessage(reply);
                      await sleep(500);
                      const sent = await sendMessage();
                      if (sent) {
                        log('✓ Reply sent to accepted request from ' + userName);
                      }
                    }
                  }
                }
              }
            }
          } else {
            log('No accept button found for request from ' + userName);
          }
          
          // Navigate back to main DMs (not requests) after processing
          await sleep(1000);
          navigateBackToDMs();
          await sleep(2000);
        } else {
          log('Auto-accept disabled, skipping request from ' + userName);
        }
      }
      
      log('Finished processing message requests');
    }

    async function poll() {
      if (!isRunning || isProcessing) return;
      isProcessing = true;

      try {
        if (isWithinSchedulerQuietWindow(new Date())) {
          const now = Date.now();
          if (now - lastQuietWindowLogAt > 60000) {
            log('Scheduler quiet window active; pausing DM/request monitoring');
            lastQuietWindowLogAt = now;
          }
          isProcessing = false;
          return;
        }

        if (!shouldWatchDMs && !shouldWatchRequests) {
          log('All monitoring disabled in site settings - bot will remain idle');
          isProcessing = false;
          return;
        }

        if (!isOnDMsPage()) {
          const navigated = navigateToDMs();
          if (navigated) {
            await sleep(2000);
          }
          isProcessing = false;
          return;
        }
        
        if (isInConversation()) {
          log('Currently in conversation, navigating back to main DMs');
          navigateBackToDMs();
          await sleep(2000);
          isProcessing = false;
          return;
        }

        // Handle message requests if enabled
        if (shouldWatchRequests) {
          if (isOnRequestsPage()) {
            await processMessageRequests();
            // After processing requests, always navigate back to main DMs
            log('Finished processing requests, navigating back to main DMs');
            navigateBackToDMs();
            await sleep(2000);
          } else if (!isInConversation()) {
            // We're on main DMs page, check if we should go to requests
            const navigatedToRequests = navigateToRequests();
            if (navigatedToRequests) {
              await sleep(2000);
              isProcessing = false;
              return;
            } else {
              // No pending requests found, continue with DM processing
              log('No pending requests to process, continuing with DM monitoring');
            }
          }
        }

        if (shouldWatchDMs) {
          log('Polling for new DM conversations...');
          const conversations = findConversations();
          if (conversations.length === 0) {
            log('No unread conversations');
          } else {
            log('Found ' + conversations.length + ' unread conversation(s)');
            
            // Process each unread conversation
            for (const conv of conversations) {
              if (!isRunning) break;
              await processConversation(conv);
              await sleep(2000);
            }
          }
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
      if (schedulerInterval) {
        clearInterval(schedulerInterval);
      }
      window.__SNAPPY_RUNNING__ = false;
      window.__SNAPPY_INSTAGRAM_RUNNING__ = false;
      log('Instagram bot stopped');
    }

    // Start workers
    log('Instagram bot started');
    if (shouldWatchDMs || shouldWatchRequests) {
      log('DM/request monitoring enabled');
      poll();
      scheduleNextPoll();
    } else {
      log('DM/request monitoring disabled');
    }

    if (schedulerEnabled) {
      log('Post scheduler enabled (local machine time with random +/- 15 minute window)');
      processScheduledPosting();
      schedulerInterval = setInterval(() => {
        processScheduledPosting();
      }, 30000);
    }

    window.__SNAPPY_STOP__ = stop;
    
  } catch (error) {
    console.error('[Snappy][Instagram] Script error:', error);
    window.dispatchEvent(new CustomEvent('snappy-log', { 
      detail: { 
        message: '[Snappy][Instagram] Script error: ' + error.message, 
        timestamp: Date.now() 
      } 
    }));
  }
})();
`;
}

