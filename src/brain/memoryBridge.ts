/**
 * Memory Bridge
 * 
 * Bridges the existing localStorage-based memory system to the AI Brain.
 * Formats conversation history and user data for inclusion in LLM context.
 */

import { ExistingUserMemory } from '../types';

const MEMORY_KEY = 'snappy_memories';

/**
 * Load all memories from localStorage
 */
export function loadAllMemories(): Record<string, ExistingUserMemory> {
  try {
    if (typeof localStorage === 'undefined') {
      return {};
    }
    const data = localStorage.getItem(MEMORY_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Error loading memories:', e);
    return {};
  }
}

/**
 * Get memory for a specific user
 */
export function getUserMemory(username: string): ExistingUserMemory | null {
  const memories = loadAllMemories();
  // Use hasOwnProperty to avoid prototype pollution
  if (Object.prototype.hasOwnProperty.call(memories, username)) {
    return memories[username];
  }
  return null;
}

/**
 * Format user memory as a string for inclusion in system prompt
 * Returns a formatted string with conversation history and context
 */
export function getFormattedMemory(username: string): string {
  const memory = getUserMemory(username);
  
  if (!memory || !memory.messages || memory.messages.length === 0) {
    return '';
  }
  
  const lines: string[] = [];
  lines.push(`\n--- Context about ${username} ---`);
  
  // Add timing context
  const firstSeenDate = new Date(memory.firstSeen).toLocaleDateString();
  const lastSeenDate = new Date(memory.lastSeen).toLocaleDateString();
  lines.push(`First contact: ${firstSeenDate}`);
  lines.push(`Last contact: ${lastSeenDate}`);
  
  // Add message count summary
  const theirCount = memory.messages.filter(m => m.from === 'them').length;
  const myCount = memory.messages.filter(m => m.from === 'me').length;
  lines.push(`Messages exchanged: ${theirCount} from them, ${myCount} from you`);
  
  // Add recent conversation snippet (last 5 messages)
  if (memory.messages.length > 0) {
    lines.push('\nRecent conversation:');
    const recentMessages = memory.messages.slice(-5);
    recentMessages.forEach(msg => {
      const prefix = msg.from === 'them' ? `${username}:` : 'You:';
      const text = msg.text.length > 80 ? msg.text.substring(0, 80) + '...' : msg.text;
      lines.push(`  ${prefix} ${text}`);
    });
  }
  
  lines.push('--- End context ---\n');
  
  return lines.join('\n');
}

/**
 * Get recent messages formatted as ChatMessage array
 * Useful for building conversation context
 */
export function getRecentMessages(username: string, limit: number = 10): Array<{ role: 'user' | 'assistant'; content: string }> {
  const memory = getUserMemory(username);
  
  if (!memory || !memory.messages || memory.messages.length === 0) {
    return [];
  }
  
  const recentMessages = memory.messages.slice(-limit);
  
  return recentMessages.map(msg => ({
    role: msg.from === 'them' ? 'user' as const : 'assistant' as const,
    content: msg.text
  }));
}

/**
 * Check if memory exists for a user
 */
export function hasMemory(username: string): boolean {
  const memory = getUserMemory(username);
  return memory !== null && memory.messages && memory.messages.length > 0;
}
