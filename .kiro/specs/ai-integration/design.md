# Design Document

## Overview

This feature transforms Snappy's Brain Layer from a rule-based reply system to an AI-powered reply generator using local LLM servers. The system connects to llama.cpp or Ollama servers via their OpenAI-compatible REST API (`/v1/chat/completions`), enabling contextual, human-like responses without cloud dependencies.

The design adds a Settings Menu UI for configuring the AI connection, system prompt, and behavior toggles. The existing Brain Layer interface is preserved, making this a drop-in replacement that maintains compatibility with the rest of the Snappy architecture.

## Architecture

### Updated Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Snappy Application                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │           Shell Layer (Electron Main)              │    │
│  │  - Window Management                               │    │
│  │  - Script Injection                                │    │
│  │  - Configuration Loading                           │    │
│  │  - Settings Menu IPC Handlers                      │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                            │
│                 │ Preload Bridge (IPC)                      │
│                 │                                            │
│  ┌──────────────▼─────────────────────────────────────┐    │
│  │              Renderer Process                       │    │
│  │  ┌───────────────────────────────────────────┐    │    │
│  │  │         Settings Menu UI                   │    │    │
│  │  │  - LLM Connection Settings                 │    │    │
│  │  │  - System Prompt Editor                    │    │    │
│  │  │  - Behavior Toggles                        │    │    │
│  │  │  - Connection Status Display               │    │    │
│  │  └───────────────────────────────────────────┘    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Web Page Context (Target Site)             │    │
│  │  ┌───────────────────────────────────────────┐    │    │
│  │  │    Injection Layer (bot.js)               │    │    │
│  │  └──────────────┬────────────────────────────┘    │    │
│  │                 │                                  │    │
│  │  ┌──────────────▼────────────────────────────┐    │    │
│  │  │    Brain Layer (AI-Powered)               │    │    │
│  │  │  - LLM Client                             │    │    │
│  │  │  - Context Manager                        │    │    │
│  │  │  - Rate Limiting                          │    │    │
│  │  └──────────────┬────────────────────────────┘    │    │
│  └─────────────────│────────────────────────────────────┘    │
│                    │                                         │
└────────────────────│─────────────────────────────────────────┘
                     │
                     │ HTTP (OpenAI-compatible API)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Local LLM Server (llama.cpp / Ollama)          │
│              http://localhost:8080/v1/chat/completions      │
└─────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
User sends message → Injection Layer detects it
                            ↓
              Brain Layer receives message
                            ↓
         Context Manager builds conversation history
                            ↓
         LLM Client formats OpenAI-compatible request
                            ↓
              HTTP POST to local LLM server
                            ↓
         Parse response, extract reply text
                            ↓
         Injection Layer types and sends reply
```

## Components and Interfaces

### 1. LLM Client (src/brain/llmClient.ts)

**Responsibilities:**
- Send requests to the local LLM server
- Format requests in OpenAI-compatible format
- Parse responses and extract reply text
- Handle connection errors and timeouts
- Implement exponential backoff for retries

**Key Interfaces:**

```typescript
interface LLMClient {
  generateReply(messages: ChatMessage[]): Promise<string | null>;
  testConnection(): Promise<ConnectionTestResult>;
  isConnected(): boolean;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMRequestBody {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface LLMResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
}

interface ConnectionTestResult {
  success: boolean;
  modelName?: string;
  error?: string;
}
```

### 2. Context Manager (src/brain/contextManager.ts)

**Responsibilities:**
- Track conversation history per conversation
- Build message arrays for LLM requests
- Enforce context length limits
- Reset context when conversation changes
- Format messages with correct roles
- Load and include per-user memory in context

**Key Interfaces:**

```typescript
interface ContextManager {
  addMessage(conversationId: string, message: IncomingMessage, isBot: boolean): void;
  getContext(conversationId: string, userId: string): ChatMessage[];
  resetContext(conversationId: string): void;
  setMaxMessages(limit: number): void;
  getUserMemory(userId: string): UserMemory | null;
}

interface ConversationHistory {
  messages: StoredMessage[];
  lastUpdated: number;
}

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface UserMemory {
  userId: string;
  notes: string;           // Free-form notes about the user
  facts: string[];         // Key facts to remember
  lastUpdated: number;
}
```

### 2b. Memory Bridge (src/brain/memoryBridge.ts)

**Responsibilities:**
- Bridge to existing localStorage-based memory system (window.__SNAPPY_MEMORY__)
- Format existing memory data for LLM context inclusion
- Convert conversation history to system prompt context

**Note:** The memory storage itself already exists in the injected bot script. This bridge just formats it for AI use.

**Key Interfaces:**

```typescript
interface MemoryBridge {
  getFormattedMemory(userId: string): string;  // Returns formatted string for system prompt
  getRecentMessages(userId: string, limit: number): ChatMessage[];
}

// Existing memory structure (from bot.js localStorage)
interface ExistingUserMemory {
  username: string;
  messages: Array<{
    text: string;
    from: 'them' | 'me';
    timestamp: number;
  }>;
  firstSeen: number;
  lastSeen: number;
}
```

### 3. AI Brain (src/brain/aiBrain.ts)

**Responsibilities:**
- Replace rule-based decideReply with AI-powered version
- Coordinate between Context Manager and LLM Client
- Apply system prompt to requests
- Handle AI enable/disable toggle
- Maintain existing rate limiting integration

**Key Interfaces:**

```typescript
interface AIBrain {
  decideReply(message: IncomingMessage): Promise<string | null>;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  updateConfig(config: AIConfig): void;
}

interface AIConfig {
  enabled: boolean;
  llmEndpoint: string;
  llmPort: number;
  modelName: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextHistoryEnabled: boolean;
  maxContextMessages: number;
  requestTimeoutMs: number;
}
```

### 4. Settings Manager (src/main/settingsManager.ts)

**Responsibilities:**
- Load and save AI configuration
- Validate configuration values
- Provide defaults for missing values
- Notify components of config changes

**Key Interfaces:**

```typescript
interface SettingsManager {
  loadSettings(): AIConfig;
  saveSettings(config: Partial<AIConfig>): void;
  validateSettings(config: Partial<AIConfig>): ValidationResult;
  getDefaults(): AIConfig;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

### 5. Settings UI (src/renderer/settingsPanel.ts)

**Responsibilities:**
- Render settings panel UI
- Handle user input for all settings
- Display connection status
- Trigger connection tests
- Communicate with main process via IPC

**Key Interfaces:**

```typescript
interface SettingsPanel {
  show(): void;
  hide(): void;
  updateConnectionStatus(status: ConnectionStatus): void;
  onSettingsChange(callback: (settings: Partial<AIConfig>) => void): void;
}

type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'testing';
```

## Data Models

### AI Configuration Model

```typescript
interface AIConfig {
  // Connection settings
  enabled: boolean;
  llmEndpoint: string;        // default: "localhost"
  llmPort: number;            // default: 8080
  modelName: string;          // default: "local-model"
  
  // Prompt settings
  systemPrompt: string;       // default: see DEFAULT_SYSTEM_PROMPT
  
  // Generation settings
  temperature: number;        // default: 0.7, range: 0.1-1.5
  maxTokens: number;          // default: 150
  
  // Context settings
  contextHistoryEnabled: boolean;  // default: true
  maxContextMessages: number;      // default: 10
  
  // Reliability settings
  requestTimeoutMs: number;   // default: 30000
  maxRetries: number;         // default: 3
  retryBackoffMs: number;     // default: 1000
}

const DEFAULT_SYSTEM_PROMPT = `You are a friendly person chatting casually. Keep responses brief and natural. Match the tone of the conversation. Don't be overly formal or use excessive punctuation.`;

// When user memory exists, it's appended to the system prompt:
// Example combined prompt:
// "You are a friendly person chatting casually...
//
// About this person:
// Notes: likes gaming, works night shift, prefers short messages
// Facts:
// - Name: Alex
// - Timezone: PST
// - Met on: Snapchat"

const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: true,
  llmEndpoint: "localhost",
  llmPort: 8080,
  modelName: "local-model",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.7,
  maxTokens: 150,
  contextHistoryEnabled: true,
  maxContextMessages: 10,
  requestTimeoutMs: 30000,
  maxRetries: 3,
  retryBackoffMs: 1000
};
```

### Extended Configuration Model

```typescript
// Updated config.json structure
interface Configuration {
  // Existing fields...
  initialUrl: string;
  autoInject: boolean;
  typingDelayRangeMs: [number, number];
  preReplyDelayRangeMs: [number, number];
  maxRepliesPerMinute: number;
  maxRepliesPerHour: number;
  maxReplyLength: number;
  siteMode: 'universal' | 'snapchat' | 'twitter';
  randomSkipProbability: number;
  
  // New AI fields
  ai: AIConfig;
  
  // Deprecated (kept for backwards compatibility)
  replyRules?: ReplyRule[];
}
```

### Error Tracking Model

```typescript
interface ErrorTracker {
  consecutiveErrors: number;
  lastErrorTime: number;
  currentBackoffMs: number;
  
  recordError(): void;
  recordSuccess(): void;
  shouldRetry(): boolean;
  getBackoffDelay(): number;
}
```

### User Memory Model (Existing)

The memory system already exists in the injected bot script, stored in localStorage:

```typescript
// Existing structure from bot.js (localStorage key: 'snappy_memories')
interface ExistingUserMemory {
  username: string;
  messages: Array<{
    text: string;
    from: 'them' | 'me';
    timestamp: number;
  }>;
  firstSeen: number;
  lastSeen: number;
}

// All memories stored as:
interface MemoryStore {
  [username: string]: ExistingUserMemory;
}
```

The AI integration will read this existing memory and format it for the LLM context.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: OpenAI-compatible request format
*For any* message sent to the LLM, the request body SHALL contain a valid `model` string and a `messages` array where each message has a `role` (system/user/assistant) and `content` string.
**Validates: Requirements 1.5**

### Property 2: System prompt inclusion
*For any* LLM request, the messages array SHALL contain exactly one message with role "system" containing the configured system prompt as the first message.
**Validates: Requirements 2.3**

### Property 3: Settings persistence round-trip
*For any* valid AI configuration saved to the config file, loading the configuration SHALL return equivalent values for all fields.
**Validates: Requirements 2.2, 3.4, 3.5**

### Property 4: Settings validation
*For any* configuration input, the validation function SHALL reject invalid values (negative temperature, port out of range, empty endpoint) and accept valid values.
**Validates: Requirements 3.3**

### Property 5: Temperature clamping
*For any* temperature value set via the UI, the saved value SHALL be clamped to the range [0.1, 1.5].
**Validates: Requirements 4.3**

### Property 6: Settings hot-reload
*For any* settings change while the application is running, subsequent LLM requests SHALL use the updated values without requiring restart.
**Validates: Requirements 2.5, 4.5**

### Property 7: Context history inclusion
*For any* message when context history is enabled, the LLM request messages array SHALL include previous messages from the same conversation.
**Validates: Requirements 5.1**

### Property 8: Context history limit
*For any* conversation history exceeding the configured limit, the LLM request SHALL include at most `maxContextMessages` previous messages (plus system prompt and current message).
**Validates: Requirements 5.2**

### Property 9: Message role formatting
*For any* message in the context history, incoming messages SHALL have role "user" and bot-sent messages SHALL have role "assistant".
**Validates: Requirements 5.3**

### Property 10: Context reset on conversation change
*For any* change in conversationId, the context history for the previous conversation SHALL be cleared before processing the new message.
**Validates: Requirements 5.4**

### Property 11: Context exclusion when disabled
*For any* message when context history is disabled, the LLM request messages array SHALL contain only the system prompt and the current user message.
**Validates: Requirements 5.5**

### Property 12: Graceful error handling
*For any* LLM server error (timeout, HTTP error, malformed JSON), the Brain Layer SHALL return null and log the error without crashing.
**Validates: Requirements 6.1, 6.2, 6.3**

### Property 13: Exponential backoff
*For any* sequence of consecutive LLM errors, the delay before the next retry SHALL increase exponentially (delay = baseDelay * 2^errorCount, capped at maxDelay).
**Validates: Requirements 6.5**

### Property 14: Connection status accuracy
*For any* successful test connection, the UI SHALL display "connected" status with the model name; for any failed test, the UI SHALL display the error message.
**Validates: Requirements 7.3, 7.4**

### Property 15: User memory inclusion in context
*For any* user with stored memory, when building the LLM request context, the system prompt SHALL include the user's notes and facts to provide personalized context.
**Validates: Requirements 5.1 (extended)**

### Property 16: User memory persistence round-trip
*For any* user memory saved to the memory store, loading the memory for that user SHALL return equivalent values for all fields.
**Validates: Requirements 5.1 (extended)**

## Error Handling

### Error Categories

1. **Connection Errors**
   - Server unreachable (ECONNREFUSED)
   - DNS resolution failure
   - Network timeout
   - Strategy: Log error, return null, increment backoff counter

2. **HTTP Errors**
   - 4xx client errors (bad request, unauthorized)
   - 5xx server errors (internal error, overloaded)
   - Strategy: Log status and body, return null, apply backoff

3. **Response Parsing Errors**
   - Invalid JSON response
   - Missing expected fields (choices, message, content)
   - Strategy: Log raw response, return null

4. **Configuration Errors**
   - Invalid endpoint URL
   - Port out of range
   - Invalid temperature value
   - Strategy: Reject save, show validation error in UI

### Exponential Backoff Implementation

```typescript
class ErrorTracker {
  private consecutiveErrors = 0;
  private readonly baseDelayMs = 1000;
  private readonly maxDelayMs = 60000;
  
  recordError(): void {
    this.consecutiveErrors++;
  }
  
  recordSuccess(): void {
    this.consecutiveErrors = 0;
  }
  
  getBackoffDelay(): number {
    const delay = this.baseDelayMs * Math.pow(2, this.consecutiveErrors);
    return Math.min(delay, this.maxDelayMs);
  }
  
  shouldRetry(): boolean {
    return this.consecutiveErrors < 10; // Give up after 10 consecutive failures
  }
}
```

## Testing Strategy

### Unit Testing

The system will use **Jest** as the testing framework for unit tests.

Unit tests will cover:
- LLM request body formatting
- Response parsing and extraction
- Configuration validation logic
- Temperature clamping
- Context history building
- Error tracker backoff calculations
- Settings serialization/deserialization

### Property-Based Testing

The system will use **fast-check** as the property-based testing library.

Property-based tests will:
- Run a minimum of 100 iterations per property
- Use smart generators for valid configurations, messages, and error scenarios
- Tag each test with the corresponding correctness property
- Use the format: `**Feature: ai-integration, Property {number}: {property_text}**`

Property-based test coverage:

1. **Request Format Properties (Properties 1, 2)**
   - Generate random messages and system prompts
   - Verify request body structure matches OpenAI schema
   - Verify system prompt is always first message

2. **Settings Properties (Properties 3, 4, 5)**
   - Generate random valid configurations
   - Verify round-trip persistence
   - Generate invalid inputs and verify rejection
   - Verify temperature clamping at boundaries

3. **Context Properties (Properties 7, 8, 9, 10, 11)**
   - Generate conversation histories of varying lengths
   - Verify context inclusion/exclusion based on toggle
   - Verify limit enforcement
   - Verify role assignment

4. **Error Handling Properties (Properties 12, 13)**
   - Generate various error scenarios
   - Verify graceful handling without crashes
   - Verify backoff delay calculations

### Integration Testing

Integration tests will verify:
- End-to-end flow from message detection to AI reply
- IPC communication for settings changes
- Settings UI interaction with main process
- Actual HTTP requests to a mock LLM server

## Security Considerations

### Local-Only Communication
- LLM requests stay on localhost by default
- No data sent to external servers
- User controls the endpoint configuration

### Input Sanitization
- Sanitize user messages before sending to LLM
- Limit message length to prevent abuse
- Validate all configuration inputs

### Configuration Security
- Config file stored in app data directory
- No sensitive credentials stored (local LLM needs no auth)
- Validate endpoint URLs to prevent SSRF

## Performance Considerations

### Request Optimization
- Limit context history to reduce token usage
- Set reasonable max_tokens to control response length
- Use streaming responses for long replies (future enhancement)

### Memory Management
- Limit stored conversation history per conversation
- Clean up old conversations periodically
- Don't store full LLM responses, only extracted text

### Timeout Handling
- Default 30-second timeout for LLM requests
- Configurable timeout for slower models
- Cancel pending requests when conversation changes

