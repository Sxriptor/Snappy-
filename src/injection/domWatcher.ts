/**
 * DOM Watcher - MutationObserver for message detection
 */

import { log } from './bot';

let observer: MutationObserver | null = null;
let isWatching: boolean = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY = 100; // ms

type MutationCallback = (mutations: MutationRecord[]) => void;
let onMutationCallback: MutationCallback | null = null;

/**
 * Debounced mutation handler to avoid excessive processing
 */
function handleMutations(mutations: MutationRecord[]): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  
  debounceTimer = setTimeout(() => {
    if (onMutationCallback) {
      onMutationCallback(mutations);
    }
  }, DEBOUNCE_DELAY);
}

/**
 * Attach a MutationObserver to watch for DOM changes
 */
function attachDOMWatcher(callback: MutationCallback, targetElement?: Element): boolean {
  if (isWatching) {
    log('DOM watcher already attached');
    return true;
  }

  const target = targetElement || document.body;
  
  if (!target) {
    log('Error: No target element for DOM watcher');
    return false;
  }

  onMutationCallback = callback;

  observer = new MutationObserver((mutations) => {
    handleMutations(mutations);
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true
  });

  isWatching = true;
  log('DOM watcher attached to ' + (targetElement ? 'custom element' : 'document.body'));
  return true;
}

/**
 * Disconnect the MutationObserver
 */
function disconnectWatcher(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  
  isWatching = false;
  onMutationCallback = null;
  log('DOM watcher disconnected');
}

/**
 * Reconnect the watcher (useful after page changes)
 */
function reconnectWatcher(callback: MutationCallback, targetElement?: Element): boolean {
  disconnectWatcher();
  return attachDOMWatcher(callback, targetElement);
}

/**
 * Check if watcher is currently active
 */
function isWatcherActive(): boolean {
  return isWatching;
}

export {
  attachDOMWatcher,
  disconnectWatcher,
  reconnectWatcher,
  isWatcherActive
};
