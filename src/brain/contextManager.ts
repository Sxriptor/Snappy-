/**
 * Context Manager
 * 
 * Manages conversation history and builds context for LLM requests.
 * Tracks messages per conversation, enforces limits, and formats for AI.
 */

import { ChatMessage, IncomingMessage, AIConfig } from '../types';
import { getFormattedMemory, getRecentMessages } from './memoryBridge';

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ConversationHistory {
  messages: StoredMessage[];
  lastUpdated: number;
}

export class ContextManager {
  private conversations: Map<string, ConversationHistory> = new Map();
  private maxMessages: number;
  private systemPrompt: string;
  private contextEnabled: boolean;

  constructor(config: AIConfig) {
    this.maxMessages = config.maxContextMessages;
    this.systemPrompt = config.systemPrompt;
    this.contextEnabled = config.contextHistoryEnabled;
  }

  /**
   * Add a message to the conversation history
   */
  addMessage(conversationId: string, message: IncomingMessage, isBot: boolean): void {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, {
        messages: [],
        lastUpdated: Date.now()
      });
    }

    const history = this.conversations.get(conversationId)!;
    
    history.messages.push({
      role: isBot ? 'assistant' : 'user',
      content: message.messageText,
      timestamp: message.timestamp
    });

    // Enforce message limit
    if (history.messages.length > this.maxMessages) {
      history.messages = history.messages.slice(-this.maxMessages);
    }

    history.lastUpdated = Date.now();
  }

  /**
   * Build context for an LLM request
   * Returns array of ChatMessages including system prompt, history, and current message
   */
  getContext(conversationId: string, userId: string, currentMessage?: string): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // Always include system prompt first
    let systemPromptText = this.systemPrompt;
    
    // Append user memory to system prompt if available
    const userMemory = getFormattedMemory(userId);
    if (userMemory) {
      systemPromptText += userMemory;
    }
    
    messages.push({
      role: 'system',
      content: systemPromptText
    });

    // Include conversation history if enabled
    if (this.contextEnabled && this.conversations.has(conversationId)) {
      const history = this.conversations.get(conversationId)!;
      
      // Add historical messages (up to maxMessages)
      const recentHistory = history.messages.slice(-this.maxMessages);
      recentHistory.forEach(msg => {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      });
    }

    // Add current message if provided
    if (currentMessage) {
      messages.push({
        role: 'user',
        content: currentMessage
      });
    }

    return messages;
  }

  /**
   * Reset context for a specific conversation
   */
  resetContext(conversationId: string): void {
    this.conversations.delete(conversationId);
  }

  /**
   * Update max messages limit
   */
  setMaxMessages(limit: number): void {
    this.maxMessages = limit;
  }

  /**
   * Update system prompt
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Enable or disable context history
   */
  setContextEnabled(enabled: boolean): void {
    this.contextEnabled = enabled;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AIConfig>): void {
    if (config.maxContextMessages !== undefined) {
      this.maxMessages = config.maxContextMessages;
    }
    if (config.systemPrompt !== undefined) {
      this.systemPrompt = config.systemPrompt;
    }
    if (config.contextHistoryEnabled !== undefined) {
      this.contextEnabled = config.contextHistoryEnabled;
    }
  }

  /**
   * Get current conversation message count
   */
  getMessageCount(conversationId: string): number {
    const history = this.conversations.get(conversationId);
    return history ? history.messages.length : 0;
  }

  /**
   * Clear all conversations (useful for testing)
   */
  clearAll(): void {
    this.conversations.clear();
  }
}
