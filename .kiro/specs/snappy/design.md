# Design Document

## Overview

Snappy is an Electron-based desktop application that provides universal web automation for messaging platforms. The architecture consists of three distinct layers: the Shell Layer (Electron main process), the Injection Layer (DOM automation script), and the Brain Layer (reply logic). The system operates by loading web-based messaging platforms in a Chromium window, allowing manual user authentication, then injecting JavaScript automation that monitors the DOM for new messages and generates human-like responses based on configurable rules.

The design prioritizes simplicity for the MVP while maintaining extensibility for future AI integration. The system uses MutationObserver for efficient DOM monitoring, implements realistic timing patterns to avoid detection, and provides a secure bridge between the web context and Electron process.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Snappy Application                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │           Shell Layer (Electron Main)              │    │
│  │  - Window Management                               │    │
│  │  - Script Injection                                │    │
│  │  - Configuration Loading                           │    │
│  │  - Session Persistence                             │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                            │
│                 │ Preload Bridge (IPC)                      │
│                 │                                            │
│  ┌──────────────▼─────────────────────────────────────┐    │
│  │         Web Page Context (Target Site)             │    │
│  │                                                     │    │
│  │  ┌───────────────────────────────────────────┐    │    │
│  │  │    Injection Layer (bot.js)               │    │    │
│  │  │  - MutationObserver                       │    │    │
│  │  │  - Message Detection                      │    │    │
│  │  │  - DOM Interaction                        │    │    │
│  │  │  - Typing Simulation                      │    │    │
│  │  └──────────────┬────────────────────────────┘    │    │
│  │                 │                                  │    │
│  │  ┌──────────────▼────────────────────────────┐    │    │
│  │  │    Brain Layer (Reply Logic)              │    │    │
│  │  │  - Rule Matching                          │    │    │
│  │  │  - Reply Generation                       │    │    │
│  │  │  - Rate Limiting                          │    │    │
│  │  └───────────────────────────────────────────┘    │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
User starts app → Shell Layer creates window → Loads Target Site
                                                      ↓
User logs in manually → Session persisted → User triggers injection
                                                      ↓
Shell Layer injects bot.js → Injection Layer initializes
                                                      ↓
MutationObserver watches DOM → New message detected
                                                      ↓
Extract message data → Brain Layer evaluates rules
                                                      ↓
Reply generated → Injection Layer simulates typing → Sends message
                                                      ↓
Event logged via Preload Bridge → Shell Layer receives log
```

## Components and Interfaces

### 1. Shell Layer (main.js)

**Responsibilities:**
- Create and manage the BrowserWindow
- Load Target Site URLs
- Inject automation scripts into web pages
- Manage configuration loading and persistence
- Handle IPC communication from web context
- Persist session data (cookies, localStorage)

**Key Interfaces:**

```typescript
interface ShellLayer {
  createWindow(): BrowserWindow;
  loadTargetSite(url: string): Promise<void>;
  injectAutomationScript(): Promise<void>;
  loadConfiguration(): Configuration;
  handleLog(message: string): void;
}

interface Configuration {
  initialUrl: string;
  autoInject: boolean;
  replyRules: ReplyRule[];
  typingDelayRangeMs: [number, number];
  preReplyDelayRangeMs: [number, number];
  maxRepliesPerMinute: number;
  siteMode: 'universal' | 'snapchat' | 'twitter';
}
```

### 2. Preload Bridge (preload.js)

**Responsibilities:**
- Expose secure APIs to web page context
- Facilitate communication between Injection Layer and Shell Layer
- Maintain context isolation for security

**Key Interfaces:**

```typescript
interface PreloadBridge {
  log(message: string): void;
  injectBot(): void;
}

// Exposed to window object
window.bot = {
  log: (message: string) => void;
  injectBot: () => void;
};
```

### 3. Injection Layer (bot.js)

**Responsibilities:**
- Monitor DOM for changes using MutationObserver
- Detect and parse incoming messages
- Locate input fields and send buttons
- Simulate human-like typing
- Trigger message sending
- Maintain seen-messages tracking

**Key Interfaces:**

```typescript
interface InjectionLayer {
  initialize(): void;
  attachDOMWatcher(): void;
  detectNewMessages(mutations: MutationRecord[]): IncomingMessage[];
  handleIncomingMessage(message: IncomingMessage): Promise<void>;
  typeAndSend(replyText: string): Promise<void>;
  locateInputField(): HTMLElement | null;
  locateSendButton(): HTMLElement | null;
  simulateTyping(text: string, element: HTMLElement): Promise<void>;
}

interface IncomingMessage {
  sender: string;
  messageText: string;
  timestamp: number;
  conversationId?: string;
  messageId: string;
}
```

### 4. Brain Layer (Reply Logic)

**Responsibilities:**
- Evaluate messages against Reply Rules
- Generate appropriate responses
- Enforce rate limiting
- Implement random reply probability
- Support future AI integration

**Key Interfaces:**

```typescript
interface BrainLayer {
  decideReply(message: IncomingMessage): string | null;
  evaluateRules(messageText: string): string | null;
  shouldReply(): boolean;
  checkRateLimit(): boolean;
}

interface ReplyRule {
  match: string | RegExp;
  reply: string;
  priority?: number;
}
```

### 5. Site Strategy System

**Responsibilities:**
- Provide site-specific DOM selectors
- Handle platform-specific message parsing
- Adapt to different UI structures

**Key Interfaces:**

```typescript
interface SiteStrategy {
  name: string;
  hostPatterns: string[];
  selectors: SiteSelectors;
  parseMessage(element: HTMLElement): IncomingMessage | null;
  isIncomingMessage(element: HTMLElement): boolean;
}

interface SiteSelectors {
  messageContainer: string;
  messageBubble: string;
  incomingMessageClass: string;
  outgoingMessageClass: string;
  inputField: string[];
  sendButton: string[];
}
```

## Data Models

### Configuration Model

```typescript
interface Configuration {
  initialUrl: string;
  autoInject: boolean;
  replyRules: ReplyRule[];
  typingDelayRangeMs: [number, number];
  preReplyDelayRangeMs: [number, number];
  maxRepliesPerMinute: number;
  maxReplyLength: number;
  siteMode: 'universal' | 'snapchat' | 'twitter';
  activeHours?: {
    start: string; // HH:MM format
    end: string;
  };
  randomSkipProbability: number; // 0.1 to 0.2 for 10-20%
}
```

### Message Model

```typescript
interface IncomingMessage {
  messageId: string;
  sender: string;
  messageText: string;
  timestamp: number;
  conversationId?: string;
  element: HTMLElement;
}
```

### Reply Rule Model

```typescript
interface ReplyRule {
  match: string | RegExp;
  reply: string;
  priority?: number;
  caseSensitive?: boolean;
}
```

### Rate Limit Tracker

```typescript
interface RateLimitTracker {
  replyTimestamps: number[];
  maxRepliesPerMinute: number;
  maxRepliesPerHour: number;
  
  canReply(): boolean;
  recordReply(): void;
  cleanup(): void;
}
```

## Correctnes
s Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Window creation on startup
*For any* application startup, the Shell Layer should create a BrowserWindow with Chromium rendering capabilities
**Validates: Requirements 1.1**

### Property 2: Configuration URL loading
*For any* valid configuration containing an initialUrl, the Shell Layer should load that URL into the window
**Validates: Requirements 1.2**

### Property 3: Session data persistence
*For any* Target Site with session data (cookies, localStorage), that data should persist after the site loads
**Validates: Requirements 1.3**

### Property 4: Auto-injection on load
*For any* Target Site load when autoInject is enabled, the Automation Script should be injected into the page context
**Validates: Requirements 2.1**

### Property 5: Manual injection execution
*For any* manual injection trigger, the Automation Script should execute in the current page
**Validates: Requirements 2.2**

### Property 6: Initialization logging
*For any* Automation Script injection, the Injection Layer should initialize and log confirmation
**Validates: Requirements 2.3**

### Property 7: Document body verification
*For any* Automation Script initialization, the Injection Layer should verify document.body exists before proceeding
**Validates: Requirements 2.4**

### Property 8: Site identification
*For any* loaded page, the Injection Layer should correctly identify the Target Site via location.hostname
**Validates: Requirements 2.5**

### Property 9: MutationObserver attachment
*For any* active Automation Script, a MutationObserver should be attached to monitor DOM changes
**Validates: Requirements 3.1**

### Property 10: Message bubble scanning
*For any* DOM mutation, the Injection Layer should scan for new Message Bubble elements
**Validates: Requirements 3.2**

### Property 11: Message classification
*For any* detected Message Bubble, the Injection Layer should correctly classify it as incoming or outgoing
**Validates: Requirements 3.3**

### Property 12: Message data extraction
*For any* incoming message, the Injection Layer should extract sender, messageText, and timestamp
**Validates: Requirements 3.4**

### Property 13: Duplicate message prevention (Idempotence)
*For any* message processed twice, the Injection Layer should only handle it once using the seen-messages set
**Validates: Requirements 3.5**

### Property 14: Rule evaluation on new messages
*For any* new incoming message, the Brain Layer should evaluate it against configured Reply Rules
**Validates: Requirements 4.1**

### Property 15: Rule match returns reply
*For any* message matching a Reply Rule, the Brain Layer should return the corresponding reply text
**Validates: Requirements 4.2**

### Property 16: No match returns null
*For any* message not matching any Reply Rule, the Brain Layer should return null
**Validates: Requirements 4.3**

### Property 17: Decision logging
*For any* message processed by the Brain Layer, the system should log the decision and reasoning
**Validates: Requirements 4.4**

### Property 18: Keyword matching support
*For any* configured keyword rule, the Brain Layer should correctly match messages containing that keyword
**Validates: Requirements 4.5**

### Property 19: Input field location
*For any* page with contenteditable, textarea, or input elements, the Injection Layer should locate the message input field
**Validates: Requirements 5.1**

### Property 20: Field focus and clear
*For any* located input field, the Injection Layer should focus it and clear existing content
**Validates: Requirements 5.2**

### Property 21: Typing delay bounds
*For any* character typed, the delay should be between 50 and 150 milliseconds
**Validates: Requirements 5.3**

### Property 22: Send button location after typing
*For any* completed typing operation, the Injection Layer should locate the send button
**Validates: Requirements 5.4**

### Property 23: Button click on send
*For any* located send button, the Injection Layer should click it to submit the message
**Validates: Requirements 5.5**

### Property 24: Reply logging
*For any* sent reply, the Injection Layer should log the event with sender and message text
**Validates: Requirements 5.6**

### Property 25: Graceful input field failure
*For any* scenario where the input field is not found, the system should log the error and continue without crashing
**Validates: Requirements 5.7**

### Property 26: Graceful send button failure
*For any* scenario where the send button is not found, the system should log the error and continue without crashing
**Validates: Requirements 5.8**

### Property 27: Pre-reply delay bounds
*For any* triggered reply, the delay before typing should be between 2000 and 6000 milliseconds
**Validates: Requirements 6.1**

### Property 28: Character delay randomization
*For any* message being typed, character delays should vary randomly within the configured range
**Validates: Requirements 6.2**

### Property 29: Thinking pause insertion
*For any* longer message, thinking pauses between 200 and 1000 milliseconds should be inserted occasionally
**Validates: Requirements 6.3**

### Property 30: Non-deterministic timing
*For any* two executions of the same reply, the timing should differ due to random number generation
**Validates: Requirements 6.4**

### Property 31: Rate limit enforcement
*For any* time window, the number of replies should not exceed the configured maxRepliesPerMinute
**Validates: Requirements 6.5**

### Property 32: Configuration loading on startup
*For any* application startup, the Shell Layer should load configuration from file or defaults
**Validates: Requirements 7.1**

### Property 33: Configuration schema support
*For any* provided configuration, all specified fields (initialUrl, autoInject, replyRules, etc.) should be recognized and used
**Validates: Requirements 7.2**

### Property 34: Rule evaluation order
*For any* message evaluation, Reply Rules should be evaluated in their configured order
**Validates: Requirements 7.3**

### Property 35: Timing parameter application
*For any* configured timing parameters, the Injection Layer should use those values for delays
**Validates: Requirements 7.4**

### Property 36: Site strategy selection
*For any* siteMode setting, the Injection Layer should apply the corresponding DOM selectors and strategies
**Validates: Requirements 7.5**

### Property 37: Preload Bridge creation
*For any* application initialization, the Shell Layer should create a Preload Bridge with exposed APIs
**Validates: Requirements 8.1**

### Property 38: Log function availability
*For any* Automation Script execution, window.bot.log should be accessible and functional
**Validates: Requirements 8.2**

### Property 39: Log message transmission
*For any* call to window.bot.log, the message should be transmitted to the Electron main process
**Validates: Requirements 8.3**

### Property 40: API surface limitation
*For any* Preload Bridge, only injectBot and log functions should be exposed to the web context
**Validates: Requirements 8.5**

### Property 41: Universal mode selector usage
*For any* siteMode set to "universal", the Injection Layer should use generic heuristics for element location
**Validates: Requirements 9.1**

### Property 42: Site-specific strategy application
*For any* known Target Site hostname, the appropriate site-specific strategy should be applied
**Validates: Requirements 9.2**

### Property 43: Platform-specific selector usage
*For any* active site-specific strategy, platform-specific DOM selectors should be used
**Validates: Requirements 9.3**

### Property 44: Selector fallback behavior
*For any* failed DOM selector, the system should fall back to generic patterns and log the event
**Validates: Requirements 9.4**

### Property 45: UI change resilience
*For any* Target Site UI change, the Injection Layer should continue attempting element location without crashing
**Validates: Requirements 9.5**

### Property 46: Active hours configuration support
*For any* configuration with active hours, the system should recognize and apply the time limits
**Validates: Requirements 10.1**

### Property 47: Random skip probability
*For any* large set of messages, the Brain Layer should skip replying 10-20% of the time
**Validates: Requirements 10.2**

### Property 48: Multi-window rate limiting
*For any* configured rate limits (per minute and per hour), the system should enforce both limits
**Validates: Requirements 10.3**

### Property 49: Reply length limiting
*For any* generated reply, the length should not exceed the configured maximum
**Validates: Requirements 10.4**

### Property 50: Frequency tracking and throttling
*For any* continuous operation approaching rate limits, the system should track frequency and pause
**Validates: Requirements 10.5**

## Error Handling

### Error Categories

1. **DOM Element Not Found Errors**
   - Input field missing
   - Send button missing
   - Message container missing
   - Strategy: Log error, skip operation, continue monitoring

2. **Injection Errors**
   - Script injection fails
   - document.body not available
   - Strategy: Retry with exponential backoff, log failure

3. **Configuration Errors**
   - Invalid config file
   - Missing required fields
   - Strategy: Fall back to defaults, log warnings

4. **Rate Limit Errors**
   - Exceeded maxRepliesPerMinute
   - Exceeded maxRepliesPerHour
   - Strategy: Pause operation, log throttling event

5. **IPC Communication Errors**
   - Preload Bridge unavailable
   - Message transmission fails
   - Strategy: Fall back to console logging, continue operation

### Error Handling Principles

- Never crash the application due to DOM changes
- Always log errors with context (timestamp, site, operation)
- Gracefully degrade functionality when components fail
- Retry transient failures with backoff
- Maintain operation even when logging fails

### Error Recovery Strategies

```typescript
interface ErrorRecovery {
  retryWithBackoff(operation: () => Promise<void>, maxRetries: number): Promise<void>;
  fallbackToGenericSelector(specificSelector: string): string[];
  logAndContinue(error: Error, context: string): void;
  pauseOnRateLimit(duration: number): Promise<void>;
}
```

## Testing Strategy

### Unit Testing

The system will use **Jest** as the testing framework for unit tests.

Unit tests will cover:

- Configuration loading and validation
- Reply rule matching logic
- Rate limit tracking and enforcement
- Message data extraction from DOM elements
- Selector fallback logic
- Timing calculation functions
- IPC message formatting

Example unit test areas:
- Test that invalid configurations fall back to defaults
- Test that rate limit tracker correctly counts replies in time windows
- Test that reply rules match in the correct order
- Test that message ID generation is unique

### Property-Based Testing

The system will use **fast-check** as the property-based testing library for JavaScript/TypeScript.

Property-based tests will:
- Run a minimum of 100 iterations per property
- Use smart generators that constrain inputs to valid ranges
- Tag each test with the corresponding correctness property from this design document
- Use the format: `**Feature: snappy, Property {number}: {property_text}**`

Property-based test coverage:

1. **Timing Properties (Properties 21, 27, 28, 29, 30)**
   - Generate random messages and verify all delays fall within configured bounds
   - Verify non-deterministic behavior across multiple runs
   - Test that thinking pauses are inserted appropriately

2. **Rate Limiting Properties (Properties 31, 48, 50)**
   - Generate sequences of reply events and verify limits are enforced
   - Test that frequency tracking correctly pauses when approaching limits

3. **Message Processing Properties (Properties 10, 11, 12, 13)**
   - Generate random DOM structures and verify message detection
   - Test that duplicate messages are correctly filtered
   - Verify message classification accuracy

4. **Rule Matching Properties (Properties 15, 16, 18, 34)**
   - Generate random messages and rule sets
   - Verify correct rule matching and ordering
   - Test that non-matching messages return null

5. **Configuration Properties (Properties 32, 33, 35)**
   - Generate random valid configurations
   - Verify all fields are recognized and applied
   - Test that timing parameters are correctly used

6. **Error Handling Properties (Properties 25, 26, 44, 45)**
   - Generate scenarios with missing DOM elements
   - Verify graceful degradation without crashes
   - Test fallback behavior

7. **Strategy Selection Properties (Properties 36, 41, 42, 43)**
   - Generate different siteMode values
   - Verify correct strategy selection and selector usage

### Integration Testing

Integration tests will verify:
- End-to-end message detection and reply flow
- Electron IPC communication between layers
- Script injection into actual web pages
- Configuration loading and application across components

### Testing Approach

- Write implementation first, then corresponding tests
- Focus on core functional logic and important edge cases
- Use property-based tests to validate universal properties across many inputs
- Use unit tests for specific examples and integration points
- Avoid over-testing - prioritize high-value test coverage
- Tests should validate real functionality, not use mocks for core logic

## Performance Considerations

### DOM Monitoring Efficiency

- Use MutationObserver with targeted subtree observation
- Debounce mutation callbacks to avoid excessive processing
- Maintain efficient seen-messages set (use Set data structure)
- Limit message history retention to prevent memory growth

### Memory Management

- Clear old entries from rate limit tracker periodically
- Limit seen-messages set size (e.g., last 1000 messages)
- Avoid storing large DOM references
- Clean up observers when switching conversations

### Timing Optimization

- Use setTimeout for delays rather than busy-waiting
- Batch DOM queries where possible
- Cache selector results when DOM structure is stable
- Minimize main thread blocking during typing simulation

## Security Considerations

### Context Isolation

- Enable context isolation in Electron BrowserWindow
- Use contextBridge for secure IPC communication
- Limit exposed APIs to minimum required surface
- Validate all messages from web context

### Session Security

- Store session data in Electron's session partition
- Do not expose authentication credentials
- Use secure cookie storage
- Respect site security policies

### Code Injection Safety

- Inject only trusted automation scripts
- Validate script content before injection
- Use Content Security Policy where applicable
- Avoid eval() or dynamic code execution

## Future Extensions

### AI Integration

The Brain Layer is designed for easy AI integration:

```typescript
interface AIBrainLayer extends BrainLayer {
  generateReply(message: IncomingMessage, history: IncomingMessage[]): Promise<string>;
  callLLM(prompt: string): Promise<string>;
  buildContext(conversation: IncomingMessage[]): string;
}
```

Integration points:
- Replace rule-based `decideReply` with async AI call
- Add conversation history tracking
- Support multiple AI providers (OpenAI, Anthropic, local LLMs)
- Implement response caching for efficiency

### Multi-Account Support

Future architecture for managing multiple accounts:
- Account profile management
- Per-account configuration and rules
- Session isolation between accounts
- Coordinated rate limiting across accounts

### Advanced Site Strategies

Extensible strategy system:
- Plugin architecture for new sites
- Community-contributed strategies
- Automatic strategy updates
- Fallback chain for robustness

### Analytics and Monitoring

Observability features:
- Reply success/failure metrics
- Response time tracking
- Rule effectiveness analysis
- Detection risk scoring
