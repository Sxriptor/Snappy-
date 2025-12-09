/**
 * Shared Types for Snappy Application
 */

export interface ReplyRule {
  match: string | RegExp;
  reply: string;
  priority?: number;
  caseSensitive?: boolean;
}

export interface Configuration {
  initialUrl: string;
  autoInject: boolean;
  replyRules: ReplyRule[];  // Deprecated: kept for backwards compatibility
  typingDelayRangeMs: [number, number];
  preReplyDelayRangeMs: [number, number];
  maxRepliesPerMinute: number;
  maxRepliesPerHour: number;
  maxReplyLength: number;
  siteMode: 'universal' | 'snapchat' | 'twitter';
  activeHours?: {
    start: string;
    end: string;
  };
  randomSkipProbability: number;
  ai?: AIConfig;  // New AI configuration
  threads?: {
    pollIntervalMs?: number;
    maxCommentsPerPoll?: number;
  };
  reddit?: {
    pollIntervalMs?: number;
    maxCommentsPerPoll?: number;
  };
}

export interface IncomingMessage {
  messageId: string;
  sender: string;
  messageText: string;
  timestamp: number;
  conversationId?: string;
}

export interface SiteSelectors {
  messageContainer: string;
  messageBubble: string;
  incomingMessageClass: string;
  outgoingMessageClass: string;
  inputField: string[];
  sendButton: string[];
}

export interface SiteStrategy {
  name: string;
  hostPatterns: string[];
  selectors: SiteSelectors;
}

/**
 * AI Configuration for local LLM integration
 */
export interface AIConfig {
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
  maxRetries: number;
  retryBackoffMs: number;
}

/**
 * Chat message format for LLM requests (OpenAI-compatible)
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM request body (llama.cpp /completion format)
 */
export interface LLMRequestBody {
  prompt: string;
  temperature?: number;
  max_tokens?: number;
  cache_prompt?: boolean;
}

/**
 * LLM response format (OpenAI-compatible)
 */
export interface LLMResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  success: boolean;
  modelName?: string;
  error?: string;
}

/**
 * Llama.cpp server configuration
 */
export interface LlamaServerConfig {
  buildPath: string;
  startCommand: string;
  enabled: boolean;
}

/**
 * Llama.cpp server status
 */
export interface LlamaServerStatus {
  running: boolean;
  pid?: number;
  error?: string;
  startTime?: number;
}

/**
 * Existing user memory structure (from localStorage)
 */
export interface ExistingUserMemory {
  username: string;
  messages: Array<{
    text: string;
    from: 'them' | 'me';
    timestamp: number;
  }>;
  firstSeen: number;
  lastSeen: number;
}

export const DEFAULT_SYSTEM_PROMPT = `You are a friendly person chatting casually. Keep responses brief and natural. Match the tone of the conversation. Don't be overly formal or use excessive punctuation.`;

export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: true,
  llmEndpoint: 'localhost',
  llmPort: 8080,
  modelName: 'local-model',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.7,
  maxTokens: 150,
  contextHistoryEnabled: true,
  maxContextMessages: 10,
  requestTimeoutMs: 30000,
  maxRetries: 3,
  retryBackoffMs: 1000
};

export const DEFAULT_CONFIG: Configuration = {
  initialUrl: 'https://web.snapchat.com',
  autoInject: false,
  replyRules: [],
  typingDelayRangeMs: [50, 150],
  preReplyDelayRangeMs: [2000, 6000],
  maxRepliesPerMinute: 5,
  maxRepliesPerHour: 30,
  maxReplyLength: 500,
  siteMode: 'universal',
  randomSkipProbability: 0.15,
  threads: {
    pollIntervalMs: 60000,
    maxCommentsPerPoll: 5
  },
  reddit: {
    pollIntervalMs: 10000,
    maxCommentsPerPoll: 5
  }
};


// ============================================================================
// Multi-Session Types
// ============================================================================

/**
 * Session state enumeration
 */
export type SessionState = 'active' | 'hibernated' | 'loading' | 'error';

/**
 * Proxy protocol types
 */
export type ProxyProtocol = 'http' | 'https' | 'socks5';

/**
 * Proxy status in the pool
 */
export type ProxyStatus = 'available' | 'assigned' | 'error' | 'testing';

/**
 * Browser fingerprint for anti-detection
 */
export interface BrowserFingerprint {
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  timezone: string;
  timezoneOffset: number;
  screenResolution: [number, number];
  availableScreenResolution: [number, number];
  colorDepth: number;
  pixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  webgl: {
    vendor: string;
    renderer: string;
    unmaskedVendor: string;
    unmaskedRenderer: string;
  };
  canvas: {
    noiseSeed: number;
  };
  audio: {
    noiseSeed: number;
  };
  fonts: string[];
  plugins: PluginData[];
}

/**
 * Browser plugin data for fingerprint
 */
export interface PluginData {
  name: string;
  description: string;
  filename: string;
}

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  id: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  username?: string;
  password?: string;
  rotationEnabled?: boolean;
  rotationIntervalMs?: number;
}

/**
 * Proxy pool entry with status tracking
 */
export interface ProxyPoolEntry {
  proxy: ProxyConfig;
  status: ProxyStatus;
  assignedTo: string | null;
  lastUsed: number | null;
  errorCount: number;
}

/**
 * Per-session configuration (extends base config)
 */
export interface SessionConfig {
  initialUrl: string;
  autoInject: boolean;
  replyRules: ReplyRule[];
  typingDelayRangeMs: [number, number];
  preReplyDelayRangeMs: [number, number];
  maxRepliesPerMinute: number;
  maxRepliesPerHour: number;
  maxReplyLength: number;
  siteMode: 'universal' | 'snapchat' | 'twitter';
  randomSkipProbability: number;
  ai?: AIConfig;
}

/**
 * Session instance
 */
export interface Session {
  id: string;
  name: string;
  partition: string;
  fingerprint: BrowserFingerprint;
  proxy: ProxyConfig | null;
  config: SessionConfig;
  state: SessionState;
  createdAt: number;
  lastActiveAt: number;
}

/**
 * Serialized session for persistence
 */
export interface SerializedSession {
  id: string;
  name: string;
  partition: string;
  fingerprint: BrowserFingerprint;
  proxy: ProxyConfig | null;
  config: SessionConfig;
  createdAt: number;
  lastActiveAt: number;
}

/**
 * Sessions file structure for persistence
 */
export interface SessionsFile {
  version: number;
  sessions: SerializedSession[];
  proxyPool: ProxyConfig[];
}

/**
 * Fingerprint profile for realistic generation
 */
export interface FingerprintProfile {
  name: string;
  userAgents: string[];
  platforms: string[];
  screenResolutions: [number, number][];
  colorDepths: number[];
  webglCombos: { vendor: string; renderer: string }[];
  hardwareConcurrency: number[];
  deviceMemory: number[];
  languages: string[];
  timezones: string[];
}

/**
 * Fingerprint injector configuration
 */
export interface FingerprintInjectorConfig {
  fingerprint: BrowserFingerprint;
  disableWebRTC: boolean;
}

// ============================================================================
// IPC Message Types
// ============================================================================

/**
 * Session created message (Main -> Renderer)
 */
export interface SessionCreatedMessage {
  type: 'session-created';
  session: Session;
}

/**
 * Session deleted message (Main -> Renderer)
 */
export interface SessionDeletedMessage {
  type: 'session-deleted';
  sessionId: string;
}

/**
 * Session state changed message (Main -> Renderer)
 */
export interface SessionStateChangedMessage {
  type: 'session-state-changed';
  sessionId: string;
  state: SessionState;
  proxyStatus?: 'connected' | 'disconnected' | 'error';
}

/**
 * Proxy pool updated message (Main -> Renderer)
 */
export interface ProxyPoolUpdatedMessage {
  type: 'proxy-pool-updated';
  pool: ProxyPoolEntry[];
  unassignedCount: number;
}

/**
 * Create session request (Renderer -> Main)
 */
export interface CreateSessionRequest {
  type: 'create-session';
  name?: string;
  proxyId?: string;
  config?: Partial<SessionConfig>;
}

/**
 * Delete session request (Renderer -> Main)
 */
export interface DeleteSessionRequest {
  type: 'delete-session';
  sessionId: string;
  confirmed: boolean;
}

/**
 * Update session config request (Renderer -> Main)
 */
export interface UpdateSessionConfigRequest {
  type: 'update-session-config';
  sessionId: string;
  config: Partial<SessionConfig>;
}

/**
 * Hibernate session request (Renderer -> Main)
 */
export interface HibernateSessionRequest {
  type: 'hibernate-session';
  sessionId: string;
}

/**
 * Restore session request (Renderer -> Main)
 */
export interface RestoreSessionRequest {
  type: 'restore-session';
  sessionId: string;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  initialUrl: 'https://web.snapchat.com',
  autoInject: false,
  replyRules: [],
  typingDelayRangeMs: [50, 150],
  preReplyDelayRangeMs: [2000, 6000],
  maxRepliesPerMinute: 5,
  maxRepliesPerHour: 30,
  maxReplyLength: 500,
  siteMode: 'universal',
  randomSkipProbability: 0.15
};

export const SESSIONS_FILE_VERSION = 1;
