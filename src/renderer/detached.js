/**
 * Detached Window Renderer - Handles individual detached session windows
 */
let sessionId = null;
let sessionName = '';
// Elements
const sessionNameEl = document.getElementById('session-name');
const reattachBtn = document.getElementById('reattach-btn');
const webviewContainer = document.getElementById('detached-webview-container');
// Initialize detached window
window.electronAPI.onDetachedWindowInit((data) => {
    sessionId = data.sessionId;
    sessionName = data.sessionName;
    sessionNameEl.textContent = sessionName;
    document.title = `Snappy - ${sessionName}`;
    console.log(`[Detached] Initialized for session: ${sessionName}`);
});
// Handle webview transfer from main window
window.electronAPI.onWebviewTransfer((webviewData) => {
    if (webviewData.sessionId === sessionId) {
        // Create webview element from transferred data
        webviewContainer.innerHTML = webviewData.html;
        const webview = webviewContainer.querySelector('webview');
        if (webview) {
            webview.classList.remove('hidden');
            webview.style.width = '100%';
            webview.style.height = '100%';
            console.log(`[Detached] Webview transferred for session: ${sessionName}`);
        }
    }
});
// Reattach button handler
reattachBtn.addEventListener('click', async () => {
    if (!sessionId)
        return;
    try {
        // Get webview before reattaching
        const webview = webviewContainer.querySelector('webview');
        let webviewData = null;
        if (webview) {
            webviewData = {
                sessionId,
                html: webview.outerHTML
            };
        }
        // Request reattach
        const result = await window.electronAPI.reattachWindow(sessionId);
        if (result.success) {
            // Send webview data back to main window
            if (webviewData) {
                window.electronAPI.sendWebviewToMain(webviewData);
            }
            console.log(`[Detached] Reattaching session: ${sessionName}`);
            // Window will be closed by the main process
        }
        else {
            console.error('[Detached] Failed to reattach:', result.error);
        }
    }
    catch (error) {
        console.error('[Detached] Error during reattach:', error);
    }
});
// Handle window close - cleanup
window.addEventListener('beforeunload', () => {
    console.log(`[Detached] Window closing for session: ${sessionName}`);
});
