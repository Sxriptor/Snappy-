/**
 * Rate Limiting System
 * Tracks reply frequency and enforces limits
 */

const ONE_MINUTE = 60 * 1000;
const ONE_HOUR = 60 * ONE_MINUTE;

interface RateLimitConfig {
  maxRepliesPerMinute: number;
  maxRepliesPerHour: number;
}

class RateLimitTracker {
  private replyTimestamps: number[] = [];
  private config: RateLimitConfig;
  private logCallback: ((message: string) => void) | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Set logging callback
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
      console.log('[RateLimiter]', message);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: RateLimitConfig): void {
    this.config = config;
  }

  /**
   * Clean up old timestamps outside the tracking window
   */
  cleanup(): void {
    const now = Date.now();
    const oneHourAgo = now - ONE_HOUR;
    this.replyTimestamps = this.replyTimestamps.filter(ts => ts > oneHourAgo);
  }

  /**
   * Get count of replies in the last minute
   */
  getRepliesInLastMinute(): number {
    const now = Date.now();
    const oneMinuteAgo = now - ONE_MINUTE;
    return this.replyTimestamps.filter(ts => ts > oneMinuteAgo).length;
  }

  /**
   * Get count of replies in the last hour
   */
  getRepliesInLastHour(): number {
    const now = Date.now();
    const oneHourAgo = now - ONE_HOUR;
    return this.replyTimestamps.filter(ts => ts > oneHourAgo).length;
  }

  /**
   * Check if we can send another reply without exceeding limits
   */
  canReply(): boolean {
    this.cleanup();
    
    const repliesLastMinute = this.getRepliesInLastMinute();
    const repliesLastHour = this.getRepliesInLastHour();
    
    if (repliesLastMinute >= this.config.maxRepliesPerMinute) {
      this.log(`Rate limit: ${repliesLastMinute}/${this.config.maxRepliesPerMinute} per minute`);
      return false;
    }
    
    if (repliesLastHour >= this.config.maxRepliesPerHour) {
      this.log(`Rate limit: ${repliesLastHour}/${this.config.maxRepliesPerHour} per hour`);
      return false;
    }
    
    return true;
  }

  /**
   * Record a reply timestamp
   */
  recordReply(): void {
    this.replyTimestamps.push(Date.now());
    this.log(`Reply recorded. Total: ${this.replyTimestamps.length}`);
  }

  /**
   * Check if approaching rate limits (80% threshold)
   */
  isApproachingLimit(): boolean {
    const repliesLastMinute = this.getRepliesInLastMinute();
    const repliesLastHour = this.getRepliesInLastHour();
    
    const minuteThreshold = this.config.maxRepliesPerMinute * 0.8;
    const hourThreshold = this.config.maxRepliesPerHour * 0.8;
    
    return repliesLastMinute >= minuteThreshold || repliesLastHour >= hourThreshold;
  }

  /**
   * Get time until rate limit resets (in ms)
   */
  getTimeUntilReset(): number {
    if (this.replyTimestamps.length === 0) {
      return 0;
    }
    
    const oldestInMinute = this.replyTimestamps.find(ts => ts > Date.now() - ONE_MINUTE);
    if (oldestInMinute) {
      return ONE_MINUTE - (Date.now() - oldestInMinute);
    }
    
    return 0;
  }

  /**
   * Get current status
   */
  getStatus(): { perMinute: number; perHour: number; canReply: boolean } {
    return {
      perMinute: this.getRepliesInLastMinute(),
      perHour: this.getRepliesInLastHour(),
      canReply: this.canReply()
    };
  }

  /**
   * Reset all tracking
   */
  reset(): void {
    this.replyTimestamps = [];
    this.log('Rate limiter reset');
  }
}

export { RateLimitTracker, RateLimitConfig };
