# Requirements Document

## Introduction

Snappy is a desktop application built with Electron that provides universal web automation for messaging platforms. The system enables automated message detection and response on any web-based messaging platform (Snapchat Web, Twitter DMs, etc.) by injecting automation scripts into loaded web pages. The application allows users to manually authenticate with their accounts while the automation handles message monitoring and response generation based on configurable rules.

## Glossary

- **Snappy Application**: The Electron-based desktop application that hosts web pages and manages automation
- **Shell Layer**: The Electron main process responsible for window management and script injection
- **Injection Layer**: The automation script (bot.js) that runs within the web page context
- **Brain Layer**: The logic component that determines reply content based on rules or AI
- **Target Site**: Any web-based messaging platform (e.g., Snapchat Web, Twitter DMs)
- **Automation Script**: JavaScript code injected into web pages to monitor and interact with the DOM
- **Message Bubble**: DOM element representing a chat message in the Target Site's UI
- **Preload Bridge**: Secure communication channel between web page context and Electron main process
- **Reply Rule**: A condition-action pair that determines automated responses
- **Human-Like Behavior**: Timing patterns and randomization that mimic human interaction

## Requirements

### Requirement 1

**User Story:** As a user, I want to launch the Snappy Application and load a messaging website, so that I can prepare for automated message handling.

#### Acceptance Criteria

1. WHEN the user starts the Snappy Application THEN the Shell Layer SHALL create a desktop window with Chromium rendering capabilities
2. WHEN the Shell Layer initializes THEN the Snappy Application SHALL load a configured Target Site URL into the window
3. WHEN the Target Site loads THEN the Snappy Application SHALL preserve all browser session data including cookies and localStorage
4. WHEN the window is created THEN the Shell Layer SHALL provide standard browser navigation controls
5. WHEN the Target Site requires authentication THEN the Snappy Application SHALL allow manual user login without automation

### Requirement 2

**User Story:** As a user, I want to inject automation into the loaded web page, so that the system can begin monitoring for messages.

#### Acceptance Criteria

1. WHEN the Target Site finishes loading AND auto-inject is enabled THEN the Shell Layer SHALL inject the Automation Script into the page context
2. WHEN the user triggers manual injection THEN the Shell Layer SHALL execute the Automation Script in the current page
3. WHEN the Automation Script is injected THEN the Injection Layer SHALL initialize and log confirmation to the console
4. WHEN the Automation Script initializes THEN the Injection Layer SHALL verify document.body exists before proceeding
5. WHEN the Automation Script starts THEN the Injection Layer SHALL identify the Target Site via location.hostname

### Requirement 3

**User Story:** As a user, I want the system to detect new incoming messages, so that it can respond appropriately.

#### Acceptance Criteria

1. WHEN the Automation Script is active THEN the Injection Layer SHALL attach a MutationObserver to monitor DOM changes
2. WHEN DOM mutations occur THEN the Injection Layer SHALL scan for new Message Bubble elements
3. WHEN a Message Bubble is detected THEN the Injection Layer SHALL determine if the message is incoming or outgoing
4. WHEN an incoming message is identified THEN the Injection Layer SHALL extract sender, messageText, and timestamp data
5. WHEN a message is processed THEN the Injection Layer SHALL store the message identifier in a seen-messages set to prevent duplicate processing

### Requirement 4

**User Story:** As a user, I want the system to decide whether and how to reply to messages, so that responses are contextually appropriate.

#### Acceptance Criteria

1. WHEN a new incoming message is detected THEN the Brain Layer SHALL evaluate the message against configured Reply Rules
2. WHEN a Reply Rule matches the message content THEN the Brain Layer SHALL return the corresponding reply text
3. WHEN no Reply Rule matches THEN the Brain Layer SHALL return null to indicate no response
4. WHEN the Brain Layer processes a message THEN the Snappy Application SHALL log the decision and reasoning
5. WHERE simple rule-based logic is configured THEN the Brain Layer SHALL support keyword matching and conditional responses

### Requirement 5

**User Story:** As a user, I want the system to type and send replies naturally, so that automated responses appear human-like.

#### Acceptance Criteria

1. WHEN the Brain Layer returns reply text THEN the Injection Layer SHALL locate the message input field using contenteditable, textarea, or input selectors
2. WHEN the input field is located THEN the Injection Layer SHALL focus the field and clear any existing content
3. WHEN typing begins THEN the Injection Layer SHALL simulate character-by-character input with delays between 50 and 150 milliseconds per character
4. WHEN typing completes THEN the Injection Layer SHALL locate the send button using common selector patterns
5. WHEN the send button is found THEN the Injection Layer SHALL click the button to submit the message
6. WHEN a reply is sent THEN the Injection Layer SHALL log the event with sender and message text
7. IF the input field is not found THEN the Injection Layer SHALL log the error and skip the reply without crashing
8. IF the send button is not found THEN the Injection Layer SHALL log the error and skip the reply without crashing

### Requirement 6

**User Story:** As a user, I want replies to include realistic delays and timing, so that the automation is not easily detected.

#### Acceptance Criteria

1. WHEN a reply is triggered THEN the Injection Layer SHALL wait between 2000 and 6000 milliseconds before beginning to type
2. WHEN typing a message THEN the Injection Layer SHALL randomly vary the delay per character within the configured range
3. WHEN typing a longer message THEN the Injection Layer SHALL occasionally insert thinking pauses between 200 and 1000 milliseconds
4. WHEN calculating delays THEN the Injection Layer SHALL use random number generation to ensure non-deterministic timing
5. WHEN the system operates THEN the Snappy Application SHALL enforce a maximum replies-per-minute limit to prevent spam detection

### Requirement 7

**User Story:** As a user, I want to configure automation behavior, so that I can customize how the system operates.

#### Acceptance Criteria

1. WHEN the Snappy Application starts THEN the Shell Layer SHALL load configuration from a config file or default values
2. WHERE configuration is provided THEN the Snappy Application SHALL support initialUrl, autoInject, replyRules, typingDelayRangeMs, preReplyDelayRangeMs, maxRepliesPerMinute, and siteMode settings
3. WHEN Reply Rules are configured THEN the Brain Layer SHALL evaluate messages against the rule set in order
4. WHEN timing parameters are configured THEN the Injection Layer SHALL use the specified ranges for delays
5. WHEN siteMode is set THEN the Injection Layer SHALL apply site-specific DOM selectors and strategies if available

### Requirement 8

**User Story:** As a user, I want secure communication between the web page and Electron, so that automation can log events safely.

#### Acceptance Criteria

1. WHEN the Snappy Application initializes THEN the Shell Layer SHALL create a Preload Bridge with exposed APIs
2. WHEN the Automation Script needs to log THEN the Preload Bridge SHALL provide a log function accessible via window.bot.log
3. WHEN the Automation Script calls log THEN the Preload Bridge SHALL transmit the message to the Electron main process
4. WHEN the Preload Bridge is created THEN the Shell Layer SHALL ensure context isolation for security
5. WHEN APIs are exposed THEN the Preload Bridge SHALL limit exposed functions to only injectBot and log operations

### Requirement 9

**User Story:** As a user, I want the system to handle different messaging platforms, so that I can use Snappy on multiple sites.

#### Acceptance Criteria

1. WHEN the siteMode is "universal" THEN the Injection Layer SHALL use generic heuristics for contenteditable elements, message bubbles, and send buttons
2. WHERE site-specific strategies exist THEN the Injection Layer SHALL detect the Target Site hostname and apply the appropriate strategy
3. WHEN a site-specific strategy is active THEN the Injection Layer SHALL use platform-specific DOM selectors for message containers, input fields, and send buttons
4. WHEN DOM selectors fail THEN the Injection Layer SHALL fall back to generic patterns and log the fallback event
5. WHEN the Target Site UI changes THEN the Injection Layer SHALL continue attempting to locate elements without crashing

### Requirement 10

**User Story:** As a user, I want the system to avoid obvious bot behavior, so that my account remains in good standing.

#### Acceptance Criteria

1. WHEN the system is configured THEN the Snappy Application SHALL support setting active hours to limit operation time
2. WHEN evaluating whether to reply THEN the Brain Layer SHALL randomly choose not to reply 10-20% of the time
3. WHEN rate limits are configured THEN the Injection Layer SHALL enforce maximum reply counts per minute and per hour
4. WHEN generating reply text THEN the Brain Layer SHALL limit response length to configured maximum values
5. WHEN the system operates continuously THEN the Snappy Application SHALL track reply frequency and pause when limits are approached
