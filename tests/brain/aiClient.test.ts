/**
 * AI Client Tests
 * Tests the unified AI client that supports multiple providers
 */

import { AIClient } from '../../src/brain/aiClient';
import { AIConfig, DEFAULT_AI_CONFIG } from '../../src/types';

describe('AIClient', () => {
  let aiClient: AIClient;
  let mockConfig: AIConfig;

  beforeEach(() => {
    mockConfig = {
      ...DEFAULT_AI_CONFIG,
      enabled: true,
      provider: 'local'
    };
    aiClient = new AIClient(mockConfig);
  });

  describe('Provider Selection', () => {
    test('should default to local provider', () => {
      expect(aiClient.getCurrentProvider()).toBe('local');
    });

    test('should switch to ChatGPT provider', () => {
      const chatgptConfig = {
        ...mockConfig,
        provider: 'chatgpt' as const,
        chatgptApiKey: 'test-key'
      };
      aiClient.updateConfig(chatgptConfig);
      expect(aiClient.getCurrentProvider()).toBe('chatgpt');
    });

    test('should get provider status', () => {
      const status = aiClient.getProviderStatus();
      expect(status.provider).toBe('local');
      expect(typeof status.connected).toBe('boolean');
    });
  });

  describe('Configuration Validation', () => {
    test('should validate local provider config', () => {
      const result = AIClient.validateProviderConfig(mockConfig, 'local');
      expect(result.valid).toBe(true);
    });

    test('should validate ChatGPT provider config', () => {
      const chatgptConfig = {
        ...mockConfig,
        chatgptApiKey: 'sk-test123',
        chatgptModel: 'gpt-3.5-turbo'
      };
      const result = AIClient.validateProviderConfig(chatgptConfig, 'chatgpt');
      expect(result.valid).toBe(true);
    });

    test('should reject invalid ChatGPT config', () => {
      const invalidConfig = {
        ...mockConfig,
        chatgptApiKey: '',
        chatgptModel: 'gpt-3.5-turbo'
      };
      const result = AIClient.validateProviderConfig(invalidConfig, 'chatgpt');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('API key');
    });

    test('should reject invalid local config', () => {
      const invalidConfig = {
        ...mockConfig,
        llmEndpoint: '',
        llmPort: 0
      };
      const result = AIClient.validateProviderConfig(invalidConfig, 'local');
      expect(result.valid).toBe(false);
    });
  });

  describe('Provider Display Names', () => {
    test('should return correct display names', () => {
      expect(AIClient.getProviderDisplayName('local')).toBe('Local LLM Server');
      expect(AIClient.getProviderDisplayName('chatgpt')).toBe('ChatGPT API');
    });
  });

  describe('Available Models', () => {
    test('should return ChatGPT models', () => {
      const models = AIClient.getAvailableChatGPTModels();
      expect(models).toContain('gpt-3.5-turbo');
      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-4o');
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('Connection Status', () => {
    test('should report disconnected when disabled', () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      aiClient.updateConfig(disabledConfig);
      expect(aiClient.isConnected()).toBe(false);
    });

    test('should check local provider connection requirements', () => {
      const localConfig = {
        ...mockConfig,
        provider: 'local' as const,
        llmEndpoint: 'localhost',
        llmPort: 8080
      };
      aiClient.updateConfig(localConfig);
      // Note: This tests the connection check logic, not actual network connectivity
      expect(typeof aiClient.isConnected()).toBe('boolean');
    });

    test('should check ChatGPT provider connection requirements', () => {
      const chatgptConfig = {
        ...mockConfig,
        provider: 'chatgpt' as const,
        chatgptApiKey: 'sk-test123',
        chatgptModel: 'gpt-3.5-turbo'
      };
      aiClient.updateConfig(chatgptConfig);
      expect(typeof aiClient.isConnected()).toBe('boolean');
    });
  });
});