# Cross-Session Bot Status Synchronization

This feature enables real-time synchronization of bot status across all sessions and windows in Snappy.

## How It Works

### 1. Session Bot Status Tracking
- Each session now has a `botStatus` field ('active' | 'inactive')
- Bot status is persisted with session data
- Status is synchronized across all renderer windows

### 2. Visual Indicators
- Each tab shows a colored dot indicating bot status:
  - 🟢 Green dot: Bot is active
  - ⚫ Gray dot: Bot is inactive
- The main status panel reflects the active session's bot status

### 3. Cross-Session Synchronization
- When bot starts/stops in any session, all windows are notified
- Tab indicators update immediately across all windows
- Activity logs show bot status changes from other sessions

### 4. Implementation Details

#### Main Process (src/main/main.ts)
- Added `session:updateBotStatus` IPC handler
- Broadcasts bot status changes to all renderer windows
- Persists bot status with session data

#### Session Manager (src/main/sessionManager.ts)
- Added `updateSessionBotStatus()` method
- Emits `sessionBotStatusChanged` events
- Includes bot status in session serialization

#### Preload Bridge (src/preload/preload.ts)
- Added `updateBotStatus()` API
- Added `onSessionBotStatusChanged()` event listener

#### Renderer (src/renderer/renderer.ts)
- Added bot status indicator to tab UI
- Added cross-session event handling
- Syncs UI when switching between sessions

#### Styles (src/renderer/styles.css)
- Added `.tab-bot-status` styles with green/gray indicators
- Added subtle glow effect for active bot status

## Usage

1. **Starting Bot**: Click "Start" in any session - all tabs show green dot
2. **Stopping Bot**: Click "Stop" in any session - all tabs show gray dot  
3. **Session Switching**: Bot status UI updates to match active session
4. **Multiple Windows**: Status syncs across detached windows too

## Benefits

- **Visual Clarity**: Instantly see which sessions have active bots
- **Coordination**: Avoid accidentally running multiple bots
- **Monitoring**: Track bot activity across all sessions from any window
- **Consistency**: UI always reflects actual bot state

## Technical Notes

- Bot status is session-specific (each session can have different status)
- Status persists across app restarts
- Events use Electron IPC for reliable cross-window communication
- Graceful fallback if session data is missing bot status field