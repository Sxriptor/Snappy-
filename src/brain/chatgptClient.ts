/**
 * ChatGPT Client - Handles communication with OpenAI's ChatGPT API
 * Uses OpenAI's chat completions endpoint
 */

import {
  AIConfig,
  ChatMessage,
  ConnectionTestResult
} from '../types';

/**
 * ChatGPT Client class for managing OpenAI API communication
 */
export class ChatGPTClient {
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
      console.log('[ChatGPTClient]', message);
    }
  }

  /**
   * Get the ChatGPT API endpoint URL
   */
  getEndpointUrl(): string {
    const baseUrl = this.config.chatgptBaseUrl || 'https://api.openai.com/v1';
    return `${baseUrl}/chat/completions`;
  }

  /**
   * Build the request body for OpenAI chat completions API
   */
  buildRequestBody(messages: ChatMessage[]): any {
    return {
      model: this.config.chatgptModel,
      messages: messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: false
    };
  }

  /**
   * Send a request to the ChatGPT API and get a reply
   */
  async generateReply(messages: ChatMessage[]): Promise<string | null> {
    if (!this.config.chatgptApiKey) {
      this.log('ChatGPT API key not configured');
      return null;
    }

    if (!this.errorTracker.shouldRetry()) {
      const timeUntilRecovery = this.errorTracker.getTimeUntilRecovery();
      this.log(`Too many consecutive errors, skipping request. Will auto-recover in ${Math.ceil(timeUntilRecovery / 1000)}s`);
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
    
    this.log(`Sending request to ChatGPT API`);
    
    try {
      // Use Electron's net module for better compatibility
      const { net } = require('electron');
      
      const request = net.request({
        method: 'POST',
        url: url
      });
      
      request.setHeader('Content-Type', 'application/json');
      request.setHeader('Authorization', `Bearer ${this.config.chatgptApiKey}`);
      
      const responsePromise = new Promise<string | null>((resolve, reject) => {
        let responseData = '';
        let timedOut = false;
        
        const timeoutId = setTimeout(() => {
          timedOut = true;
          request.abort();
          reject(new Error('Request timed out'));
        }, this.config.requestTimeoutMs);
        
        request.on('response', (response: any) => {
          if (timedOut) return;
          
          response.on('data', (chunk: any) => {
            responseData += chunk.toString();
          });
          
          response.on('end', () => {
            clearTimeout(timeoutId);
            
            if (response.statusCode !== 200) {
              this.log(`HTTP error: ${response.statusCode}`);
              this.log(`Response: ${responseData}`);
              this.errorTracker.recordError();
              resolve(null);
              return;
            }
            
            try {
              const data: any = JSON.parse(responseData);
              
              if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                this.log('Invalid response format from ChatGPT API');
                this.errorTracker.recordError();
                resolve(null);
                return;
              }
              
              const reply = data.choices[0].message.content.trim();
              this.log(`Got reply: ${reply.substring(0, 50)}...`);
              this.errorTracker.recordSuccess();
              resolve(reply);
            } catch (parseError: any) {
              this.log(`JSON parse error: ${parseError.message}`);
              this.errorTracker.recordError();
              resolve(null);
            }
          });
          
          response.on('error', (error: any) => {
            clearTimeout(timeoutId);
            this.log(`Response error: ${error.message}`);
            this.errorTracker.recordError();
            resolve(null);
          });
        });
        
        request.on('error', (error: any) => {
          if (!timedOut) {
            clearTimeout(timeoutId);
            this.log(`Request error: ${error.message}`);
            this.errorTracker.recordError();
            resolve(null);
          }
        });
        
        request.write(JSON.stringify(body));
        request.end();
      });
      
      return await responsePromise;
      
    } catch (error: any) {
      this.log(`Request failed: ${error.message}`);
      this.errorTracker.recordError();
      return null;
    }
  }

  /**
   * Test the connection to the ChatGPT API
   */
  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.config.chatgptApiKey) {
      return {
        success: false,
        error: 'API key not configured'
      };
    }

    this.log('Testing connection to ChatGPT API');
    
    try {
      const { net } = require('electron');
      
      const testMessages: ChatMessage[] = [
        { role: 'user', content: 'Hi' }
      ];
      
      const body = this.buildRequestBody(testMessages);
      const url = this.getEndpointUrl();
      
      const request = net.request({
        method: 'POST',
        url: url
      });
      
      request.setHeader('Content-Type', 'application/json');
      request.setHeader('Authorization', `Bearer ${this.config.chatgptApiKey}`);
      
      const result = await new Promise<ConnectionTestResult>((resolve) => {
        let responseData = '';
        let timedOut = false;
        
        const timeoutId = setTimeout(() => {
          timedOut = true;
          request.abort();
          resolve({ success: false, error: 'Connection timed out' });
        }, 10000);
        
        request.on('response', (response: any) => {
          if (timedOut) return;
          
          response.on('data', (chunk: any) => {
            responseData += chunk.toString();
          });
          
          response.on('end', () => {
            clearTimeout(timeoutId);
            
            if (response.statusCode === 401) {
              resolve({ success: false, error: 'Invalid API key' });
              return;
            }
            
            if (response.statusCode !== 200) {
              resolve({ success: false, error: `HTTP ${response.statusCode}` });
              return;
            }
            
            try {
              const data: any = JSON.parse(responseData);
              
              if (!data.choices || !data.choices[0]) {
                resolve({ success: false, error: 'Invalid response format' });
                return;
              }
              
              resolve({ 
                success: true, 
                modelName: this.config.chatgptModel 
              });
            } catch (parseError: any) {
              resolve({ success: false, error: 'Invalid JSON response' });
            }
          });
          
          response.on('error', (error: any) => {
            clearTimeout(timeoutId);
            resolve({ success: false, error: error.message });
          });
        });
        
        request.on('error', (error: any) => {
          if (!timedOut) {
            clearTimeout(timeoutId);
            resolve({ success: false, error: error.message });
          }
        });
        
        request.write(JSON.stringify(body));
        request.end();
      });
      
      return result;
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Connection failed'
      };
    }
  }

  /**
   * Check if the ChatGPT client is configured and ready
   */
  isConnected(): boolean {
    return this.config.enabled && 
           this.config.chatgptApiKey.length > 0 && 
           this.config.chatgptModel.length > 0;
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

/**
 * Error Tracker - Implements exponential backoff for API errors
 * (Reused from LLMClient)
 */
export class ErrorTracker {
  private consecutiveErrors: number = 0;
  private lastErrorTime: number = 0;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxErrors: number;
  private readonly recoveryTimeMs: number;

  constructor(baseDelayMs: number = 1000, maxDelayMs: number = 60000, maxErrors: number = 10, recoveryTimeMs: number = 120000) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.maxErrors = maxErrors;
    this.recoveryTimeMs = recoveryTimeMs;
  }

  recordError(): void {
    this.consecutiveErrors++;
    this.lastErrorTime = Date.now();
    console.log(`[ChatGPTClient] Error recorded. Consecutive errors: ${this.consecutiveErrors}`);
  }

  recordSuccess(): void {
    if (this.consecutiveErrors > 0) {
      console.log(`[ChatGPTClient] Success recorded. Resetting error count from ${this.consecutiveErrors}`);
    }
    this.consecutiveErrors = 0;
  }

  getBackoffDelay(): number {
    if (this.consecutiveErrors === 0) {
      return 0;
    }
    const delay = this.baseDelayMs * Math.pow(2, this.consecutiveErrors - 1);
    return Math.min(delay, this.maxDelayMs);
  }

  shouldRetry(): boolean {
    if (this.consecutiveErrors >= this.maxErrors && this.lastErrorTime > 0) {
      const timeSinceLastError = Date.now() - this.lastErrorTime;
      if (timeSinceLastError >= this.recoveryTimeMs) {
        console.log(`[ChatGPTClient] Auto-recovery: ${timeSinceLastError}ms since last error, resetting error count`);
        this.consecutiveErrors = 0;
        return true;
      }
    }
    return this.consecutiveErrors < this.maxErrors;
  }

  getErrorCount(): number {
    return this.consecutiveErrors;
  }

  getLastErrorTime(): number {
    return this.lastErrorTime;
  }

  reset(): void {
    this.consecutiveErrors = 0;
    this.lastErrorTime = 0;
  }

  getTimeUntilRecovery(): number {
    if (this.consecutiveErrors < this.maxErrors) {
      return 0;
    }
    const timeSinceLastError = Date.now() - this.lastErrorTime;
    return Math.max(0, this.recoveryTimeMs - timeSinceLastError);
  }
}