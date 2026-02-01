/**
 * Unified AI Client - Handles communication with different AI providers
 * Supports both local LLM servers and ChatGPT API
 */

import {
  AIConfig,
  ChatMessage,
  ConnectionTestResult,
  AIProvider
} from '../types';
import { LLMClient } from './llmClient';
import { ChatGPTClient } from './chatgptClient';

/**
 * Unified AI Client that can switch between different providers
 */
export class AIClient {
  private config: AIConfig;
  private llmClient: LLMClient;
  private chatgptClient: ChatGPTClient;
  private logCallback: ((message: string) => void) | null = null;

  constructor(config: AIConfig) {
    this.config = config;
    this.llmClient = new LLMClient(config);
    this.chatgptClient = new ChatGPTClient(config);
  }

  /**
   * Set the logging callback for all clients
   */
  setLogCallback(callback: (message: string) => void): void {
    this.logCallback = callback;
    this.llmClient.setLogCallback(callback);
    this.chatgptClient.setLogCallback(callback);
  }

  /**
   * Log a message
   */
  private log(message: string): void {
    if (this.logCallback) {
      this.logCallback(message);
    } else {
      console.log('[AIClient]', message);
    }
  }

  /**
   * Get the current active client based on provider setting
   */
  private getActiveClient(): LLMClient | ChatGPTClient {
    switch (this.config.provider) {
      case 'chatgpt':
        return this.chatgptClient;
      case 'local':
      default:
        return this.llmClient;
    }
  }

  /**
   * Generate a reply using the configured AI provider
   */
  async generateReply(messages: ChatMessage[]): Promise<string | null> {
    if (!this.config.enabled) {
      return null;
    }

    const client = this.getActiveClient();
    this.log(`Using ${this.config.provider} provider for reply generation`);
    
    return client.generateReply(messages);
  }

  /**
   * Test connection to the configured AI provider
   */
  async testConnection(): Promise<ConnectionTestResult> {
    const client = this.getActiveClient();
    this.log(`Testing connection to ${this.config.provider} provider`);
    
    return client.testConnection();
  }

  /**
   * Check if the current provider is connected and ready
   */
  isConnected(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const client = this.getActiveClient();
    return client.isConnected();
  }

  /**
   * Update configuration for all clients
   */
  updateConfig(config: AIConfig): void {
    this.config = config;
    this.llmClient.updateConfig(config);
    this.chatgptClient.updateConfig(config);
  }

  /**
   * Get current configuration
   */
  getConfig(): AIConfig {
    return this.config;
  }

  /**
   * Get the current provider name
   */
  getCurrentProvider(): AIProvider {
    return this.config.provider;
  }

  /**
   * Get provider-specific status information
   */
  getProviderStatus(): { provider: AIProvider; connected: boolean; error?: string } {
    const client = this.getActiveClient();
    
    return {
      provider: this.config.provider,
      connected: client.isConnected(),
      error: this.getProviderError()
    };
  }

  /**
   * Get any provider-specific error information
   */
  private getProviderError(): string | undefined {
    switch (this.config.provider) {
      case 'chatgpt':
        if (!this.config.chatgptApiKey) {
          return 'ChatGPT API key not configured';
        }
        break;
      case 'local':
        if (!this.config.llmEndpoint || !this.config.llmPort) {
          return 'Local LLM endpoint not configured';
        }
        break;
    }
    return undefined;
  }

  /**
   * Get error tracker for the current provider
   */
  getErrorTracker() {
    const client = this.getActiveClient();
    return client.getErrorTracker();
  }

  /**
   * Validate configuration for the specified provider
   */
  static validateProviderConfig(config: AIConfig, provider: AIProvider): { valid: boolean; error?: string } {
    switch (provider) {
      case 'chatgpt':
        if (!config.chatgptApiKey || config.chatgptApiKey.trim() === '') {
          return { valid: false, error: 'ChatGPT API key is required' };
        }
        if (!config.chatgptModel || config.chatgptModel.trim() === '') {
          return { valid: false, error: 'ChatGPT model is required' };
        }
        break;
      
      case 'local':
        if (!config.llmEndpoint || config.llmEndpoint.trim() === '') {
          return { valid: false, error: 'Local LLM endpoint is required' };
        }
        if (!config.llmPort || config.llmPort <= 0) {
          return { valid: false, error: 'Valid local LLM port is required' };
        }
        break;
      
      default:
        return { valid: false, error: 'Unknown AI provider' };
    }
    
    return { valid: true };
  }

  /**
   * Get available ChatGPT models
   */
  static getAvailableChatGPTModels(): string[] {
    return [
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k',
      'gpt-4',
      'gpt-4-turbo-preview',
      'gpt-4o',
      'gpt-4o-mini'
    ];
  }

  /**
   * Get provider display names
   */
  static getProviderDisplayName(provider: AIProvider): string {
    switch (provider) {
      case 'local':
        return 'Local LLM Server';
      case 'chatgpt':
        return 'ChatGPT API';
      default:
        return 'Unknown Provider';
    }
  }
}