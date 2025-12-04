# Requirements Document

## Introduction

This document specifies the requirements for transforming Snappy from a single-session Electron application into a multi-session architecture. The feature enables users to run multiple isolated browser sessions simultaneously, each with unique browser fingerprints, dedicated proxy connections, and independent bot configurations. This addresses the need for managing multiple accounts across messaging platforms while avoiding detection through fingerprint isolation and proxy rotation.

## Glossary

- **Session**: An isolated browser context with its own cookies, storage, fingerprint, and proxy configuration
- **Partition**: Electron's session isolation mechanism (e.g., `persist:session_abc123`) that provides separate cookie/storage containers
- **Browser Fingerprint**: A collection of browser and device characteristics (user agent, screen size, WebGL parameters, etc.) used to identify unique browsers
- **Proxy**: An intermediary server that routes network traffic, providing IP address isolation
- **Residential Proxy**: A proxy using IP addresses assigned to real residential devices, appearing more legitimate than datacenter proxies
- **Fingerprint Spoofing**: Overriding browser APIs to return fake fingerprint values
- **Tab**: A UI element representing a session, allowing users to switch between active sessions
- **Proxy Pool**: A collection of available proxy configurations that can be assigned to sessions
- **Session Manager**: The component responsible for creating, managing, and destroying session instances
- **WebRTC Leak**: When a browser reveals the real IP address through WebRTC APIs despite proxy usage

## Requirements

### Requirement 1

**User Story:** As a user, I want to create multiple isolated browser sessions, so that I can manage multiple accounts without cross-contamination of cookies or storage.

#### Acceptance Criteria

1. WHEN a user clicks the "+" button in the tab bar THEN the Session Manager SHALL create a new session with a unique partition identifier
2. WHEN a new session is created THEN the Session Manager SHALL assign a unique `persist:session_<id>` partition that isolates cookies, localStorage, and cache from other sessions
3. WHEN multiple sessions exist THEN each session SHALL maintain completely independent browser state with no shared cookies or storage
4. WHEN a session is created THEN the Session Manager SHALL generate a unique session ID using a cryptographically random method

### Requirement 2

**User Story:** As a user, I want each session to have a unique browser fingerprint, so that websites cannot correlate my sessions through fingerprint matching.

#### Acceptance Criteria

1. WHEN a new session is created THEN the Fingerprint Generator SHALL produce a unique, realistic browser fingerprint
2. WHEN generating a fingerprint THEN the Fingerprint Generator SHALL include user agent, screen resolution, color depth, timezone, language, platform, WebGL vendor/renderer, canvas noise seed, audio context noise seed, hardware concurrency, and device memory
3. WHEN a webview loads a page THEN the Fingerprint Injector SHALL override browser APIs to return the session's assigned fingerprint values before any page scripts execute
4. WHEN spoofing canvas fingerprint THEN the Fingerprint Injector SHALL add deterministic noise based on the session's canvas noise seed
5. WHEN spoofing WebGL fingerprint THEN the Fingerprint Injector SHALL override `getParameter()` to return the session's assigned vendor and renderer strings

### Requirement 3

**User Story:** As a user, I want to assign a dedicated proxy to each session, so that each account appears to originate from a different IP address.

#### Acceptance Criteria

1. WHEN a session is created with a proxy configuration THEN the Proxy Manager SHALL configure the session's Electron partition to route all traffic through the specified proxy
2. WHEN a proxy requires authentication THEN the Proxy Manager SHALL handle authentication via Electron's login event
3. WHEN configuring a proxy THEN the Proxy Manager SHALL support HTTP, HTTPS, and SOCKS5 protocols
4. WHEN a session has proxy rotation enabled THEN the Proxy Manager SHALL rotate to a new proxy from the pool at the configured interval
5. WHEN a proxy connection fails THEN the Proxy Manager SHALL emit an error event and update the session's proxy status indicator

### Requirement 4

**User Story:** As a user, I want to prevent WebRTC IP leaks, so that my real IP address is not exposed despite using a proxy.

#### Acceptance Criteria

1. WHEN a session has a proxy configured THEN the Fingerprint Injector SHALL disable or spoof WebRTC APIs to prevent IP leakage
2. WHEN WebRTC is disabled THEN the Fingerprint Injector SHALL override `RTCPeerConnection` to prevent real IP discovery
3. WHEN a page attempts to enumerate local IP addresses via WebRTC THEN the system SHALL return empty or spoofed results

### Requirement 5

**User Story:** As a user, I want a tab-based UI to switch between sessions, so that I can easily manage and monitor multiple accounts.

#### Acceptance Criteria

1. WHEN the application starts THEN the Renderer SHALL display a tab bar at the top with tabs for each saved session and a "+" button for creating new sessions
2. WHEN a user clicks on a session tab THEN the Renderer SHALL switch the visible webview to that session's webview
3. WHEN a user right-clicks on a session tab THEN the Renderer SHALL display a context menu with options to rename, duplicate, or close the session
4. WHEN a session is active THEN the tab SHALL display the session name and a proxy status indicator (connected/disconnected/error)
5. WHEN a user closes a session tab THEN the Session Manager SHALL prompt for confirmation before destroying the session and its data

### Requirement 6

**User Story:** As a user, I want to configure each session independently, so that I can customize bot behavior, target URLs, and reply rules per account.

#### Acceptance Criteria

1. WHEN a user opens session settings THEN the Renderer SHALL display a settings panel with session-specific configuration options
2. WHEN configuring a session THEN the user SHALL be able to set the initial URL, auto-inject preference, reply rules, typing delays, and rate limits independently from other sessions
3. WHEN a session configuration is modified THEN the Settings Manager SHALL persist the changes to the session's configuration object
4. WHEN creating a new session THEN the Session Manager SHALL allow the user to specify a name, proxy configuration, and initial settings

### Requirement 7

**User Story:** As a user, I want my sessions to persist across application restarts, so that I don't have to reconfigure sessions each time I launch the app.

#### Acceptance Criteria

1. WHEN the application exits THEN the Session Manager SHALL save all session configurations to `sessions.json`
2. WHEN the application starts THEN the Session Manager SHALL restore all previously saved sessions from `sessions.json`
3. WHEN restoring a session THEN the Session Manager SHALL recreate the session with its original partition, fingerprint, proxy, and configuration
4. WHEN a session's configuration is modified THEN the Session Manager SHALL persist the change to `sessions.json` within 5 seconds

### Requirement 8

**User Story:** As a user, I want to manage a pool of proxies, so that I can easily assign and rotate proxies across sessions.

#### Acceptance Criteria

1. WHEN the user opens proxy pool settings THEN the Renderer SHALL display a list of available proxies with their status
2. WHEN adding a proxy to the pool THEN the Proxy Manager SHALL validate the proxy configuration format before adding
3. WHEN a proxy is assigned to a session THEN the Proxy Manager SHALL track the assignment to prevent duplicate assignments
4. WHEN the proxy pool is low (fewer than 2 unassigned proxies) THEN the Proxy Manager SHALL display a warning to the user
5. WHEN importing proxies THEN the Proxy Manager SHALL accept a list format with host:port:username:password entries

### Requirement 9

**User Story:** As a user, I want to manage memory efficiently when running many sessions, so that the application remains responsive.

#### Acceptance Criteria

1. WHEN a session tab is inactive for more than 10 minutes THEN the Session Manager SHALL offer to hibernate the session to reduce memory usage
2. WHEN a session is hibernated THEN the Session Manager SHALL unload the webview while preserving the session configuration
3. WHEN a user clicks on a hibernated session tab THEN the Session Manager SHALL restore the webview with its original partition and fingerprint
4. WHEN memory usage exceeds 80% of available system memory THEN the Session Manager SHALL display a warning and suggest hibernating inactive sessions

### Requirement 10

**User Story:** As a user, I want realistic fingerprint combinations, so that my spoofed fingerprints are not detected as fake.

#### Acceptance Criteria

1. WHEN generating a fingerprint THEN the Fingerprint Generator SHALL use combinations derived from real browser telemetry data
2. WHEN selecting a user agent THEN the Fingerprint Generator SHALL choose from a curated list of common Chrome and Firefox user agents with realistic version numbers
3. WHEN generating screen resolution THEN the Fingerprint Generator SHALL select from common resolution/color depth combinations that match the selected platform
4. WHEN generating WebGL parameters THEN the Fingerprint Generator SHALL use vendor/renderer pairs that correspond to real graphics hardware
5. WHEN generating hardware concurrency and device memory THEN the Fingerprint Generator SHALL select values that are consistent with the chosen platform and user agent
