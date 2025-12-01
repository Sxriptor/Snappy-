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
  replyRules: ReplyRule[];
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
