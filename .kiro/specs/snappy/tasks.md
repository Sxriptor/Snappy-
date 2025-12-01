# Implementation Plan

- [x] 1. Set up project structure and dependencies
  - Initialize Node.js project with package.json
  - Install Electron, TypeScript, Jest, and fast-check dependencies
  - Create directory structure: src/, src/main/, src/preload/, src/injection/, src/brain/, tests/
  - Configure TypeScript with tsconfig.json
  - Set up Jest configuration for testing
  - Create npm scripts for development and building
  - _Requirements: 1.1, 1.2_

- [x] 2. Implement Shell Layer (Electron main process)
  - Create main.js with BrowserWindow initialization
  - Implement window creation with Chromium rendering
  - Add configuration loading from config.json with defaults
  - Implement Target Site URL loading
  - Add session persistence for cookies and localStorage
  - Create script injection mechanism using executeJavaScript
  - Set up IPC handlers for receiving logs from web context
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 7.1, 8.3_

- [x] 3. Implement Preload Bridge


  - Create preload.js with contextBridge setup
  - Expose window.bot.log function for logging
  - Expose window.bot.injectBot function for manual injection
  - Set up IPC communication to main process
  - Ensure context isolation is enabled
  - Limit exposed API surface to only required functions
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 4. Implement core Injection Layer structure


  - Create bot.js with initialization function
  - Add document.body verification check
  - Implement site identification via location.hostname
  - Add initialization logging via window.bot.log
  - Create seen-messages Set for duplicate prevention
  - Set up error handling that logs and continues
  - _Requirements: 2.3, 2.4, 2.5, 3.5_

- [x] 5. Implement DOM monitoring with MutationObserver


  - Create attachDOMWatcher function that sets up MutationObserver
  - Configure observer to watch document.body or message container
  - Implement mutation callback that scans for Message Bubble elements
  - Add debouncing to avoid excessive processing
  - Handle observer disconnection and reconnection
  - _Requirements: 3.1, 3.2_

- [x] 6. Implement message detection and parsing


  - Create detectNewMessages function to identify Message Bubbles
  - Implement message classification (incoming vs outgoing)
  - Add data extraction for sender, messageText, and timestamp
  - Generate unique message IDs
  - Filter out already-seen messages using seen-messages Set
  - _Requirements: 3.3, 3.4, 3.5_

- [x] 7. Implement Brain Layer with rule-based logic


  - Create decideReply function that evaluates Reply Rules
  - Implement rule matching with keyword and regex support
  - Add rule priority and ordering logic
  - Return corresponding reply text on match, null on no match
  - Add decision logging for all evaluations
  - Implement random skip probability (10-20%)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 10.2_

- [x] 8. Implement rate limiting system


  - Create RateLimitTracker class with timestamp array
  - Implement canReply function that checks time windows
  - Add recordReply function to track reply timestamps
  - Implement cleanup function to remove old timestamps
  - Enforce maxRepliesPerMinute and maxRepliesPerHour limits
  - Add frequency tracking and pause logic
  - _Requirements: 6.5, 10.3, 10.5_

- [x] 9. Implement DOM interaction for typing and sending


  - Create locateInputField function with multiple selector fallbacks
  - Create locateSendButton function with common selector patterns
  - Implement field focus and clear functionality
  - Add error handling for missing elements (log and skip)
  - _Requirements: 5.1, 5.2, 5.7, 5.8_

- [x] 10. Implement human-like typing simulation


  - Create simulateTyping function with character-by-character input
  - Implement random delay generation within configured range (50-150ms)
  - Add pre-reply delay (2000-6000ms) before typing starts
  - Insert thinking pauses (200-1000ms) for longer messages
  - Ensure non-deterministic timing using random number generation
  - Add reply length limiting based on configuration
  - _Requirements: 5.3, 6.1, 6.2, 6.3, 6.4, 10.4_

- [x] 11. Implement message sending functionality


  - Create typeAndSend function that orchestrates the full flow
  - Locate input field and send button
  - Execute typing simulation
  - Click send button
  - Log the sent reply with context
  - Handle errors gracefully at each step
  - _Requirements: 5.4, 5.5, 5.6_

- [x] 12. Implement site strategy system


  - Create SiteStrategy interface with selectors and parsing methods
  - Implement universal strategy with generic heuristics
  - Add site detection logic based on hostname
  - Create strategy selection function based on siteMode
  - Implement fallback logic when selectors fail
  - Add logging for fallback events
  - _Requirements: 7.5, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 13. Implement Snapchat Web strategy


  - Create Snapchat-specific SiteStrategy
  - Define DOM selectors for Snapchat Web UI
  - Implement message parsing for Snapchat message structure
  - Add incoming/outgoing message detection
  - _Requirements: 9.2, 9.3_

- [x] 14. Wire up auto-injection and manual injection


  - Implement auto-injection on did-finish-load event
  - Add manual injection trigger via menu or IPC
  - Ensure injection only happens once per page load
  - Add injection status tracking
  - _Requirements: 2.1, 2.2_

- [x] 15. Implement configuration system


  - Create default configuration object
  - Add config.json loading with error handling
  - Implement configuration validation
  - Apply timing parameters to Injection Layer
  - Support all required configuration fields
  - Add active hours support
  - _Requirements: 7.1, 7.2, 7.4, 10.1_

- [x] 16. Integrate all components into main message handling flow


  - Create handleIncomingMessage function that coordinates all layers
  - Wire DOM monitoring → message detection → Brain Layer → typing → sending
  - Add comprehensive error handling throughout the flow
  - Implement logging at each stage
  - _Requirements: All requirements integrated_

- [x] 17. Create example configuration file


  - Create config.json with sensible defaults
  - Add example Reply Rules for common scenarios
  - Document all configuration options
  - _Requirements: 7.1, 7.2_

- [x] 18. Add development tooling and scripts


  - Create npm start script for development
  - Add npm build script for production
  - Add DevTools toggle for debugging
  - Create logging utilities for development
  - _Requirements: Supporting development workflow_

- [x] 19. Final verification - Ensure build compiles



  - Verify TypeScript compiles without errors
  - Verify Electron app can start
