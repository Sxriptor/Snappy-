/**
 * Tab Manager
 * Manages the tab-based UI for multi-session support
 * 
 * @module tabManager
 */

import { Session, SessionState } from '../types';

export interface TabState {
  sessionId: string;
  name: string;
  proxyStatus: 'connected' | 'disconnected' | 'error' | 'none';
  botStatus: 'active' | 'inactive';
  isHibernated: boolean;
  isActive: boolean;
}

/**
 * TabManager class
 * Handles tab UI rendering and webview management
 */
export class TabManager {
  private tabs: Map<string, TabState> = new Map();
  private activeTabId: string | null = null;
  private tabsContainer: HTMLElement;
  private webviewContainer: HTMLElement;
  private contextMenu: HTMLElement;
  private contextMenuTargetId: string | null = null;

  // Callbacks
  public onTabActivate?: (sessionId: string) => void;
  public onTabClose?: (sessionId: string) => void;
  public onTabRename?: (sessionId: string, newName: string) => void;
  public onTabDuplicate?: (sessionId: string) => void;
  public onTabHibernate?: (sessionId: string) => void;
  public onTabDetach?: (sessionId: string, sessionName: string) => void;
  public onNewSession?: () => void;

  constructor() {
    this.tabsContainer = document.getElementById('tabs-container')!;
    this.webviewContainer = document.getElementById('webview-container')!;
    this.contextMenu = document.getElementById('tab-context-menu')!;

    this.setupEventListeners();
    this.setupResizeHandles();
  }

  private setupEventListeners(): void {
    // New session button
    const newSessionBtn = document.getElementById('new-session-btn');
    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', () => {
        this.onNewSession?.();
      });
    }

    // Context menu actions
    this.contextMenu.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;
      if (action && this.contextMenuTargetId) {
        this.handleContextMenuAction(action, this.contextMenuTargetId);
      }
      this.hideContextMenu();
    });

    // Hide context menu on click outside
    document.addEventListener('click', (e) => {
      if (!this.contextMenu.contains(e.target as Node)) {
        this.hideContextMenu();
      }
    });

    // Hide context menu on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
    });
  }

  /**
   * Add a new tab for a session
   */
  addTab(session: Session): void {
    const tabState: TabState = {
      sessionId: session.id,
      name: session.name,
      proxyStatus: session.proxy ? 'connected' : 'none',
      botStatus: session.botStatus || 'inactive',
      isHibernated: session.state === 'hibernated',
      isActive: false
    };

    this.tabs.set(session.id, tabState);
    this.renderTab(tabState);

    // Create webview for this session
    if (!tabState.isHibernated) {
      this.createWebview(session);
    }

    // Activate if first tab
    if (this.tabs.size === 1) {
      this.activateTab(session.id);
    }
  }

  /**
   * Remove a tab
   */
  removeTab(sessionId: string): void {
    const tab = this.tabs.get(sessionId);
    if (!tab) return;

    // Remove tab element
    const tabElement = document.getElementById(`tab-${sessionId}`);
    if (tabElement) {
      tabElement.remove();
    }

    // Remove webview
    this.destroyWebview(sessionId);

    this.tabs.delete(sessionId);

    // Activate another tab if this was active
    if (this.activeTabId === sessionId) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.activateTab(remainingTabs[0]);
      } else {
        this.activeTabId = null;
      }
    }
  }

  /**
   * Activate a tab
   */
  activateTab(sessionId: string): void {
    const tab = this.tabs.get(sessionId);
    if (!tab) return;

    // Deactivate current tab
    if (this.activeTabId) {
      const currentTab = this.tabs.get(this.activeTabId);
      if (currentTab) {
        currentTab.isActive = false;
        this.updateTabElement(this.activeTabId);
        this.hideWebview(this.activeTabId);
      }
    }

    // Activate new tab
    tab.isActive = true;
    this.activeTabId = sessionId;
    this.updateTabElement(sessionId);
    this.showWebview(sessionId);

    this.onTabActivate?.(sessionId);
  }

  /**
   * Update tab state
   */
  updateTabState(sessionId: string, state: Partial<TabState>): void {
    const tab = this.tabs.get(sessionId);
    if (!tab) return;

    Object.assign(tab, state);
    this.updateTabElement(sessionId);
  }

  /**
   * Render a tab element
   */
  private renderTab(tab: TabState): void {
    const tabElement = document.createElement('div');
    tabElement.id = `tab-${tab.sessionId}`;
    tabElement.className = 'session-tab';
    if (tab.isActive) tabElement.classList.add('active');
    if (tab.isHibernated) tabElement.classList.add('hibernated');

    tabElement.innerHTML = `
      <span class="tab-status ${tab.proxyStatus}"></span>
      <span class="tab-bot-status ${tab.botStatus}" title="Bot Status: ${tab.botStatus}">●</span>
      <span class="tab-name">${this.escapeHtml(tab.name)}</span>
      <button class="tab-close" title="Close">&times;</button>
    `;

    // Click to activate
    tabElement.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).classList.contains('tab-close')) {
        this.activateTab(tab.sessionId);
      }
    });

    // Right-click for context menu
    tabElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(tab.sessionId, e.clientX, e.clientY);
    });

    // Close button
    const closeBtn = tabElement.querySelector('.tab-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTabClose?.(tab.sessionId);
      });
    }

    this.tabsContainer.appendChild(tabElement);
  }

  /**
   * Update a tab element
   */
  private updateTabElement(sessionId: string): void {
    const tab = this.tabs.get(sessionId);
    if (!tab) return;

    const tabElement = document.getElementById(`tab-${sessionId}`);
    if (!tabElement) return;

    tabElement.className = 'session-tab';
    if (tab.isActive) tabElement.classList.add('active');
    if (tab.isHibernated) tabElement.classList.add('hibernated');

    const statusEl = tabElement.querySelector('.tab-status');
    if (statusEl) {
      statusEl.className = `tab-status ${tab.proxyStatus}`;
    }

    const botStatusEl = tabElement.querySelector('.tab-bot-status');
    if (botStatusEl) {
      botStatusEl.className = `tab-bot-status ${tab.botStatus}`;
      botStatusEl.setAttribute('title', `Bot Status: ${tab.botStatus}`);
    }

    const nameEl = tabElement.querySelector('.tab-name');
    if (nameEl) {
      nameEl.textContent = tab.name;
    }
  }

  /**
   * Create a webview for a session
   */
  createWebview(session: Session): HTMLElement {
    const webview = document.createElement('webview');
    webview.id = `webview-${session.id}`;
    webview.className = 'session-webview hidden';
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('partition', session.partition);
    webview.setAttribute('useragent', session.fingerprint.userAgent);
    webview.setAttribute('src', session.config.initialUrl);

    this.webviewContainer.appendChild(webview);
    return webview;
  }

  /**
   * Show a webview
   */
  showWebview(sessionId: string): void {
    const webview = document.getElementById(`webview-${sessionId}`);
    if (webview) {
      webview.classList.remove('hidden');
    }
  }

  /**
   * Hide a webview
   */
  hideWebview(sessionId: string): void {
    const webview = document.getElementById(`webview-${sessionId}`);
    if (webview) {
      webview.classList.add('hidden');
    }
  }

  /**
   * Destroy a webview
   */
  destroyWebview(sessionId: string): void {
    const webview = document.getElementById(`webview-${sessionId}`);
    if (webview) {
      webview.remove();
    }
  }

  /**
   * Get webview for a session
   */
  getWebview(sessionId: string): HTMLElement | null {
    return document.getElementById(`webview-${sessionId}`);
  }

  /**
   * Show context menu
   */
  private showContextMenu(sessionId: string, x: number, y: number): void {
    this.contextMenuTargetId = sessionId;
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
    this.contextMenu.classList.remove('hidden');

    // Update hibernate/restore text
    const tab = this.tabs.get(sessionId);
    const hibernateItem = this.contextMenu.querySelector('[data-action="hibernate"]');
    if (hibernateItem && tab) {
      hibernateItem.textContent = tab.isHibernated ? 'Restore' : 'Hibernate';
    }
  }

  /**
   * Hide context menu
   */
  private hideContextMenu(): void {
    this.contextMenu.classList.add('hidden');
    this.contextMenuTargetId = null;
  }

  /**
   * Handle context menu action
   */
  private handleContextMenuAction(action: string, sessionId: string): void {
    const tab = this.tabs.get(sessionId);
    if (!tab) return;

    switch (action) {
      case 'rename':
        const newName = prompt('Enter new name:');
        if (newName) {
          this.onTabRename?.(sessionId, newName);
        }
        break;
      case 'duplicate':
        this.onTabDuplicate?.(sessionId);
        break;
      case 'detach':
        this.onTabDetach?.(sessionId, tab.name);
        break;
      case 'hibernate':
        this.onTabHibernate?.(sessionId);
        break;
      case 'close':
        if (confirm('Are you sure you want to close this session?')) {
          this.onTabClose?.(sessionId);
        }
        break;
    }
  }

  /**
   * Get active tab ID
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * Get all tabs
   */
  getAllTabs(): TabState[] {
    return Array.from(this.tabs.values());
  }

  /**
   * Clear all tabs
   */
  clear(): void {
    for (const sessionId of this.tabs.keys()) {
      this.removeTab(sessionId);
    }
  }

  /**
   * Transfer webview to detached window
   */
  transferWebviewToDetached(sessionId: string): { sessionId: string; html: string } | null {
    const webview = this.getWebview(sessionId);
    if (!webview) return null;

    const webviewData = {
      sessionId,
      html: webview.outerHTML
    };

    // Hide the webview in main window (don't remove yet)
    webview.classList.add('hidden');
    webview.classList.add('detached');

    return webviewData;
  }

  /**
   * Receive webview back from detached window
   */
  receiveWebviewFromDetached(webviewData: { sessionId: string; html: string }): void {
    const existingWebview = this.getWebview(webviewData.sessionId);
    
    if (existingWebview) {
      // Remove the placeholder webview
      existingWebview.remove();
    }

    // Create new webview from transferred HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = webviewData.html;
    const webview = tempDiv.querySelector('webview');
    
    if (webview) {
      webview.classList.remove('detached');
      webview.classList.add('hidden'); // Start hidden
      this.webviewContainer.appendChild(webview);

      // If this session is active, show the webview
      if (this.activeTabId === webviewData.sessionId) {
        this.showWebview(webviewData.sessionId);
      }
    }
  }

  /**
   * Mark tab as detached (visual indicator)
   */
  markTabAsDetached(sessionId: string): void {
    const tabElement = document.getElementById(`tab-${sessionId}`);
    if (tabElement) {
      tabElement.classList.add('detached');
      tabElement.title = 'This tab is detached to a separate window';
    }
  }

  /**
   * Mark tab as reattached (remove visual indicator)
   */
  markTabAsReattached(sessionId: string): void {
    const tabElement = document.getElementById(`tab-${sessionId}`);
    if (tabElement) {
      tabElement.classList.remove('detached');
      tabElement.title = '';
    }
  }

  /**
   * Setup resize handles for tab bar and settings panel
   */
  private setupResizeHandles(): void {
    this.setupTabBarResize();
    this.setupSettingsPanelResize();
  }

  /**
   * Setup tab bar resize functionality
   */
  private setupTabBarResize(): void {
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

  /**
   * Setup settings panel resize functionality
   */
  private setupSettingsPanelResize(): void {
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

  /**
   * Escape HTML for safe rendering
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
