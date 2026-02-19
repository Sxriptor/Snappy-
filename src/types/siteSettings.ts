/**
 * Site-Specific Settings Types
 * Separate from AI config - handles platform-specific automation settings
 */

export interface RedditSiteSettings {
  postScheduler?: RedditPostSchedulerSettings;
  // Monitoring settings
  watchNotifications: boolean;
  watchPrivateMessages: boolean;
  watchSubreddits: string[];
  subredditKeywords: string[];
  
  // Behavior settings
  autoReplyToComments: boolean;
  autoReplyToPMs: boolean;
  autoReplyToPosts: boolean;
  
  // Performance settings
  pollIntervalMs: number;
  maxItemsPerPoll: number;
  
  // Filtering settings
  minPostScore: number;
  maxPostAge: number; // in hours
  skipOwnPosts: boolean;
  skipOwnComments: boolean;
  authCookieString: string;
  sessionCookie: string;
}

export interface RedditScheduledPost {
  id: string;
  textPath: string;
  body: string;
  mediaPath?: string;
  mediaType?: 'image' | 'video';
}

export interface RedditDaySchedule {
  enabled: boolean;
  times: string[];
}

export interface RedditPostSchedulerSettings {
  enabled: boolean;
  folderPath: string;
  subreddit: string;
  days: {
    monday: RedditDaySchedule;
    tuesday: RedditDaySchedule;
    wednesday: RedditDaySchedule;
    thursday: RedditDaySchedule;
    friday: RedditDaySchedule;
    saturday: RedditDaySchedule;
    sunday: RedditDaySchedule;
  };
  posts: RedditScheduledPost[];
}

export interface InstagramSiteSettings {
  postScheduler?: InstagramPostSchedulerSettings;
  // DM settings
  watchDirectMessages: boolean;
  watchMessageRequests: boolean;
  autoAcceptRequests: boolean;
  
  // Story settings
  watchStoryReplies: boolean;
  autoReplyToStories: boolean;
  
  // Performance settings
  pollIntervalMs: number;
  maxMessagesPerPoll: number;
  
  // Filtering settings
  skipVerifiedAccounts: boolean;
  skipBusinessAccounts: boolean;
  minFollowerCount: number;
}

export interface InstagramScheduledPost {
  id: string;
  mediaPath: string;
  textPath: string;
  caption: string;
  mediaType: 'image' | 'video';
}

export interface InstagramDaySchedule {
  enabled: boolean;
  times: string[];
}

export interface InstagramPostSchedulerSettings {
  enabled: boolean;
  folderPath: string;
  days: {
    monday: InstagramDaySchedule;
    tuesday: InstagramDaySchedule;
    wednesday: InstagramDaySchedule;
    thursday: InstagramDaySchedule;
    friday: InstagramDaySchedule;
    saturday: InstagramDaySchedule;
    sunday: InstagramDaySchedule;
  };
  posts: InstagramScheduledPost[];
}

export interface TwitterSiteSettings {
  // DM settings
  watchDirectMessages: boolean;
  watchMentions: boolean;
  
  // Tweet settings
  watchReplies: boolean;
  autoReplyToMentions: boolean;
  autoReplyToReplies: boolean;
  
  // Performance settings
  pollIntervalMs: number;
  maxTweetsPerPoll: number;
  
  // Filtering settings
  skipVerifiedAccounts: boolean;
  minFollowerCount: number;
  maxTweetAge: number; // in hours
}

export interface SnapchatSiteSettings {
  // Chat settings
  watchChats: boolean;
  watchSnapReplies: boolean;
  
  // Behavior settings
  autoOpenSnaps: boolean;
  autoReplyToChats: boolean;
  autoReplyToSnaps: boolean;
  
  // Performance settings
  pollIntervalMs: number;
  maxChatsPerPoll: number;
  
  // Filtering settings
  skipGroupChats: boolean;
  skipStreaks: boolean;
}

export interface ThreadsSiteSettings {
  // Activity settings
  watchActivityColumn: boolean;
  activityPriority: boolean;
  
  // Post settings
  watchPostComments: boolean;
  autoReplyToComments: boolean;
  
  // Performance settings
  pollIntervalMs: number;
  maxCommentsPerPoll: number;
  
  // Filtering settings
  skipVerifiedAccounts: boolean;
  minFollowerCount: number;
}

export interface SiteSettingsConfig {
  reddit: RedditSiteSettings;
  instagram: InstagramSiteSettings;
  twitter: TwitterSiteSettings;
  snapchat: SnapchatSiteSettings;
  threads: ThreadsSiteSettings;
}

// Default settings for each platform
export const DEFAULT_SITE_SETTINGS: SiteSettingsConfig = {
  reddit: {
    postScheduler: {
      enabled: false,
      folderPath: '',
      subreddit: '',
      days: {
        monday: { enabled: false, times: ['09:00'] },
        tuesday: { enabled: false, times: ['09:00'] },
        wednesday: { enabled: false, times: ['09:00'] },
        thursday: { enabled: false, times: ['09:00'] },
        friday: { enabled: false, times: ['09:00'] },
        saturday: { enabled: false, times: ['09:00'] },
        sunday: { enabled: false, times: ['09:00'] }
      },
      posts: []
    },
    watchNotifications: true,
    watchPrivateMessages: true,
    watchSubreddits: [],
    subredditKeywords: [],
    autoReplyToComments: true,
    autoReplyToPMs: true,
    autoReplyToPosts: false,
    pollIntervalMs: 30000,
    maxItemsPerPoll: 3,
    minPostScore: 1,
    maxPostAge: 24,
    skipOwnPosts: true,
    skipOwnComments: true,
    authCookieString: '',
    sessionCookie: ''
  },
  
  instagram: {
    postScheduler: {
      enabled: false,
      folderPath: '',
      days: {
        monday: { enabled: false, times: ['09:00'] },
        tuesday: { enabled: false, times: ['09:00'] },
        wednesday: { enabled: false, times: ['09:00'] },
        thursday: { enabled: false, times: ['09:00'] },
        friday: { enabled: false, times: ['09:00'] },
        saturday: { enabled: false, times: ['09:00'] },
        sunday: { enabled: false, times: ['09:00'] }
      },
      posts: []
    },
    watchDirectMessages: true,
    watchMessageRequests: true,
    autoAcceptRequests: false,
    watchStoryReplies: false,
    autoReplyToStories: false,
    pollIntervalMs: 15000,
    maxMessagesPerPoll: 5,
    skipVerifiedAccounts: false,
    skipBusinessAccounts: false,
    minFollowerCount: 0
  },
  
  twitter: {
    watchDirectMessages: true,
    watchMentions: true,
    watchReplies: true,
    autoReplyToMentions: true,
    autoReplyToReplies: true,
    pollIntervalMs: 20000,
    maxTweetsPerPoll: 3,
    skipVerifiedAccounts: false,
    minFollowerCount: 0,
    maxTweetAge: 12
  },
  
  snapchat: {
    watchChats: true,
    watchSnapReplies: true,
    autoOpenSnaps: true,
    autoReplyToChats: true,
    autoReplyToSnaps: false,
    pollIntervalMs: 10000,
    maxChatsPerPoll: 3,
    skipGroupChats: false,
    skipStreaks: true
  },
  
  threads: {
    watchActivityColumn: true,
    activityPriority: true,
    watchPostComments: true,
    autoReplyToComments: true,
    pollIntervalMs: 60000,
    maxCommentsPerPoll: 5,
    skipVerifiedAccounts: false,
    minFollowerCount: 0
  }
};

export type SiteName = keyof SiteSettingsConfig;
