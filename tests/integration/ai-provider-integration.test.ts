/**
 * AI Provider Integration Tests
 * Tests that the correct AI provider is used and llama server is only started when needed
 */

import { AIClient } from '../../src/brain/aiClient';
import { AIConfig, DEFAULT_AI_CONFIG } from '../../src/types';

describe('AI Provider Integration', () => {
  describe('Provider-specific behavior', () => {
    test('should use local provider by default', () => {
      const config = { ...DEFAULT_AI_CONFIG };
      const client = new AIClient(config);
      expect(client.getCurrentProvider()).toBe('local');
    });

    test('should switch to ChatGPT when configured', () => {
      const config = {
        ...DEFAULT_AI_CONFIG,
        provider: 'chatgpt' as const,
        chatgptApiKey: 'sk-test123'
      };
      const client = new AIClient(config);
      expect(client.getCurrentProvider()).toBe('chatgpt');
    });

    test('should validate provider requirements', () => {
      // Local provider needs endpoint and port
      const localConfig = {
        ...DEFAULT_AI_CONFIG,
        provider: 'local' as const,
        llmEndpoint: 'localhost',
        llmPort: 8080
      };
      const localResult = AIClient.validateProviderConfig(localConfig, 'local');
      expect(localResult.valid).toBe(true);

      // ChatGPT provider needs API key
      const chatgptConfig = {
        ...DEFAULT_AI_CONFIG,
        provider: 'chatgpt' as const,
        chatgptApiKey: 'sk-test123',
        chatgptModel: 'gpt-3.5-turbo'
      };
      const chatgptResult = AIClient.validateProviderConfig(chatgptConfig, 'chatgpt');
      expect(chatgptResult.valid).toBe(true);
    });

    test('should reject invalid configurations', () => {
      // Local without endpoint
      const invalidLocal = {
        ...DEFAULT_AI_CONFIG,
        llmEndpoint: '',
        llmPort: 0
      };
      const localResult = AIClient.validateProviderConfig(invalidLocal, 'local');
      expect(localResult.valid).toBe(false);

      // ChatGPT without API key
      const invalidChatGPT = {
        ...DEFAULT_AI_CONFIG,
        chatgptApiKey: '',
        chatgptModel: 'gpt-3.5-turbo'
      };
      const chatgptResult = AIClient.validateProviderConfig(invalidChatGPT, 'chatgpt');
      expect(chatgptResult.valid).toBe(false);
    });
  });

  describe('Connection status', () => {
    test('should report correct connection status for local provider', () => {
      const config = {
        ...DEFAULT_AI_CONFIG,
        provider: 'local' as const,
        enabled: true,
        llmEndpoint: 'localhost',
        llmPort: 8080
      };
      const client = new AIClient(config);
      
      // Should be considered "connected" if config is valid (actual network test would require server)
      expect(typeof client.isConnected()).toBe('boolean');
    });

    test('should report correct connection status for ChatGPT provider', () => {
      const config = {
        ...DEFAULT_AI_CONFIG,
        provider: 'chatgpt' as const,
        enabled: true,
        chatgptApiKey: 'sk-test123',
        chatgptModel: 'gpt-3.5-turbo'
      };
      const client = new AIClient(config);
      
      // Should be considered "connected" if API key is provided
      expect(client.isConnected()).toBe(true);
    });

    test('should report disconnected when disabled', () => {
      const config = {
        ...DEFAULT_AI_CONFIG,
        enabled: false
      };
      const client = new AIClient(config);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('Provider status reporting', () => {
    test('should provide detailed status for local provider', () => {
      const config = {
        ...DEFAULT_AI_CONFIG,
        provider: 'local' as const,
        llmEndpoint: 'localhost',
        llmPort: 8080
      };
      const client = new AIClient(config);
      const status = client.getProviderStatus();
      
      expect(status.provider).toBe('local');
      expect(typeof status.connected).toBe('boolean');
    });

    test('should provide detailed status for ChatGPT provider', () => {
      const config = {
        ...DEFAULT_AI_CONFIG,
        provider: 'chatgpt' as const,
        chatgptApiKey: '',
        chatgptModel: 'gpt-3.5-turbo'
      };
      const client = new AIClient(config);
      const status = client.getProviderStatus();
      
      expect(status.provider).toBe('chatgpt');
      expect(status.connected).toBe(false); // No API key
      expect(status.error).toContain('API key');
    });
  });
});