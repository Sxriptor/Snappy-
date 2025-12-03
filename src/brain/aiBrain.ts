/**
 * AI Brain
 * 
 * AI-powered reply decision system that replaces rule-based matching.
 * Coordinates between Context Manager and LLM Client to generate contextual replies.
 */

import { IncomingMessage, AIConfig } from '../types';
import { LLMClient } from './llmClient';
import { ContextManager } from './contextManager';

export class AIBrain {
  private llmClient: LLMClient;
  private contextManager: ContextManager;
  private enabled: boolean;
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
    this.enabled = config.enabled;
    this.llmClient = new LLMClient(config);
    this.contextManager = new ContextManager(config);
  }

  /**
   * Decide on a reply for an incoming message
   * Returns the reply text or null if no reply should be sent
   */
  async decideReply(message: IncomingMessage): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      // Get conversation ID (use sender as fallback if not provided)
      const conversationId = message.conversationId || message.sender;
      
      // Build context with conversation history and user memory
      const context = this.contextManager.getContext(
        conversationId,
        message.sender,
        message.messageText
      );

      // Generate reply using LLM
      const reply = await this.llmClient.generateReply(context);

      // Add the incoming message and our reply to context history
      if (reply) {
        this.contextManager.addMessage(conversationId, message, false);
        
        // Create a synthetic message for the bot's reply to add to history
        const botMessage: IncomingMessage = {
          messageId: `bot-${Date.now()}`,
          sender: 'bot',
          messageText: reply,
          timestamp: Date.now(),
          conversationId: conversationId
        };
        this.contextManager.addMessage(conversationId, botMessage, true);
      }

      return reply;
    } catch (error) {
      console.error('[AIBrain] Error generating reply:', error);
      return null;
    }
  }

  /**
   * Enable or disable AI replies
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if AI is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AIConfig>): void {
    // Update local config
    this.config = { ...this.config, ...config };
    
    // Update enabled state
    if (config.enabled !== undefined) {
      this.enabled = config.enabled;
    }

    // Update LLM client config
    this.llmClient.updateConfig(this.config);

    // Update context manager config
    this.contextManager.updateConfig(this.config);
  }

  /**
   * Test connection to LLM server
   */
  async testConnection() {
    return this.llmClient.testConnection();
  }

  /**
   * Check if connected to LLM server
   */
  isConnected(): boolean {
    return this.llmClient.isConnected();
  }

  /**
   * Reset context for a conversation
   */
  resetConversation(conversationId: string): void {
    this.contextManager.resetContext(conversationId);
  }
}
