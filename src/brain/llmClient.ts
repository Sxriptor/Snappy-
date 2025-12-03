/**
 * LLM Client - Handles communication with local LLM server (llama.cpp/Ollama)
 * Uses OpenAI-compatible API format
 */

import {
  AIConfig,
  ChatMessage,
  LLMRequestBody,
  LLMResponse,
  ConnectionTestResult,
  DEFAULT_AI_CONFIG
} from '../types';

/**
 * LLM Client class for managing LLM server communication
 */
export class LLMClient {
  private config: AIConfig;
  private errorTracker: ErrorTracker;
  private logCallback: ((message: string) => void) | null = null;

  constructor(config: AIConfig) {
    this.config = config;
    this.errorTracker = new ErrorTracker(
      config.retryBackoffMs,
      60000,
      config.maxRetries * 3
    );
  }

  /**
   * Set the logging callback
   */
  setLogCallback(callback: (message: string) => void): void {
    this.logCallback = callback;
  }

  /**
   * Log a message
   */
  private log(message: string): void {
    if (this.logCallback) {
      this.logCallback(message);
    } else {
      console.log('[LLMClient]', message);
    }
  }

  /**
   * Get the full LLM endpoint URL
   */
  getEndpointUrl(): string {
    return `http://${this.config.llmEndpoint}:${this.config.llmPort}/v1/chat/completions`;
  }

  /**
   * Build the request body in OpenAI-compatible format
   */
  buildRequestBody(messages: ChatMessage[]): LLMRequestBody {
    return {
      model: this.config.modelName,
      messages: messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens
    };
  }

  /**
   * Send a request to the LLM server and get a reply
   */
  async generateReply(messages: ChatMessage[]): Promise<string | null> {
    if (!this.errorTracker.shouldRetry()) {
      this.log('Too many consecutive errors, skipping request');
      return null;
    }

    // Wait for backoff delay if needed
    const backoffDelay = this.errorTracker.getBackoffDelay();
    if (backoffDelay > 0) {
      this.log(`Waiting ${backoffDelay}ms before retry (backoff)`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }

    const url = this.getEndpointUrl();
    const body = this.buildRequestBody(messages);
    
    this.log(`Sending request to ${url}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        this.log(`HTTP error: ${response.status} ${response.statusText}`);
        this.errorTracker.recordError();
        return null;
      }
      
      const data: LLMResponse = await response.json();
      
      if (!data.choices || data.choices.length === 0) {
        this.log('No choices in response');
        this.errorTracker.recordError();
        return null;
      }
      
      const reply = data.choices[0].message?.content;
      if (!reply) {
        this.log('No content in response');
        this.errorTracker.recordError();
        return null;
      }
      
      this.log(`Got reply: ${reply.substring(0, 50)}...`);
      this.errorTracker.recordSuccess();
      return reply.trim();
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.log(`Request timed out after ${this.config.requestTimeoutMs}ms`);
      } else {
        this.log(`Request failed: ${error.message}`);
      }
      this.errorTracker.recordError();
      return null;
    }
  }

  /**
   * Test the connection to the LLM server
   */
  async testConnection(): Promise<ConnectionTestResult> {
    const url = this.getEndpointUrl();
    
    this.log(`Testing connection to ${url}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for test
      
      const testMessages: ChatMessage[] = [
        { role: 'user', content: 'Hi' }
      ];
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.buildRequestBody(testMessages)),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      
      const data: LLMResponse = await response.json();
      
      return {
        success: true,
        modelName: this.config.modelName
      };
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Connection timed out'
        };
      }
      return {
        success: false,
        error: error.message || 'Connection failed'
      };
    }
  }

  /**
   * Check if the LLM client is configured and ready
   */
  isConnected(): boolean {
    return this.config.enabled && this.config.llmEndpoint.length > 0 && this.config.llmPort > 0;
  }

  /**
   * Update configuration
   */
  updateConfig(config: AIConfig): void {
    this.config = config;
  }

  /**
   * Get current configuration
   */
  getConfig(): AIConfig {
    return this.config;
  }

  /**
   * Get the error tracker
   */
  getErrorTracker(): ErrorTracker {
    return this.errorTracker;
  }
}

// Export functional API for backwards compatibility with tests
let defaultClient: LLMClient | null = null;

export function setConfig(newConfig: AIConfig): void {
  if (!defaultClient) {
    defaultClient = new LLMClient(newConfig);
  } else {
    defaultClient.updateConfig(newConfig);
  }
}

export function setLogCallback(callback: (message: string) => void): void {
  if (!defaultClient) {
    defaultClient = new LLMClient(DEFAULT_AI_CONFIG);
  }
  defaultClient.setLogCallback(callback);
}

export function getEndpointUrl(): string {
  if (!defaultClient) {
    defaultClient = new LLMClient(DEFAULT_AI_CONFIG);
  }
  return defaultClient.getEndpointUrl();
}

export function buildRequestBody(messages: ChatMessage[]): LLMRequestBody {
  if (!defaultClient) {
    defaultClient = new LLMClient(DEFAULT_AI_CONFIG);
  }
  return defaultClient.buildRequestBody(messages);
}

export async function generateReply(messages: ChatMessage[]): Promise<string | null> {
  if (!defaultClient) {
    defaultClient = new LLMClient(DEFAULT_AI_CONFIG);
  }
  return defaultClient.generateReply(messages);
}

export async function testConnection(): Promise<ConnectionTestResult> {
  if (!defaultClient) {
    defaultClient = new LLMClient(DEFAULT_AI_CONFIG);
  }
  return defaultClient.testConnection();
}

export function isConfigured(): boolean {
  if (!defaultClient) {
    defaultClient = new LLMClient(DEFAULT_AI_CONFIG);
  }
  return defaultClient.isConnected();
}

export function getConfig(): AIConfig {
  if (!defaultClient) {
    defaultClient = new LLMClient(DEFAULT_AI_CONFIG);
  }
  return defaultClient.getConfig();
}

/**
 * Error Tracker - Implements exponential backoff for LLM errors
 */
export class ErrorTracker {
  private consecutiveErrors: number = 0;
  private lastErrorTime: number = 0;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxErrors: number;

  constructor(baseDelayMs: number = 1000, maxDelayMs: number = 60000, maxErrors: number = 10) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.maxErrors = maxErrors;
  }

  /**
   * Record an error occurrence
   */
  recordError(): void {
    this.consecutiveErrors++;
    this.lastErrorTime = Date.now();
    console.log(`[LLMClient] Error recorded. Consecutive errors: ${this.consecutiveErrors}`);
  }

  /**
   * Record a successful operation (resets error count)
   */
  recordSuccess(): void {
    if (this.consecutiveErrors > 0) {
      console.log(`[LLMClient] Success recorded. Resetting error count from ${this.consecutiveErrors}`);
    }
    this.consecutiveErrors = 0;
  }

  /**
   * Calculate the backoff delay based on consecutive errors
   * Formula: baseDelay * 2^errorCount, capped at maxDelay
   */
  getBackoffDelay(): number {
    if (this.consecutiveErrors === 0) {
      return 0;
    }
    const delay = this.baseDelayMs * Math.pow(2, this.consecutiveErrors - 1);
    return Math.min(delay, this.maxDelayMs);
  }

  /**
   * Check if we should retry after errors
   */
  shouldRetry(): boolean {
    return this.consecutiveErrors < this.maxErrors;
  }

  /**
   * Get the current consecutive error count
   */
  getErrorCount(): number {
    return this.consecutiveErrors;
  }

  /**
   * Get the time of the last error
   */
  getLastErrorTime(): number {
    return this.lastErrorTime;
  }

  /**
   * Reset the error tracker
   */
  reset(): void {
    this.consecutiveErrors = 0;
    this.lastErrorTime = 0;
  }
}

/**
 * Get the error tracker from default client
 */
export function getErrorTracker(): ErrorTracker {
  if (!defaultClient) {
    defaultClient = new LLMClient(DEFAULT_AI_CONFIG);
  }
  return defaultClient.getErrorTracker();
}
