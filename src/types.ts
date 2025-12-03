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
 * LLM request body (OpenAI-compatible format)
 */
export interface LLMRequestBody {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
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
  randomSkipProbability: 0.15
};
