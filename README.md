# Snappy

A desktop automation assistant for web-based messaging platforms. Snappy is an Electron app that opens messaging sites (Snapchat Web, Twitter DMs, etc.) in a browser window, lets you log in manually, then injects automation scripts that watch for incoming messages and send human-like replies based on configurable rules.

## Features

- **Universal**: Works on any web messaging platform
- **Manual Auth**: You handle login, 2FA, captchas - Snappy handles the rest
- **Rule-Based Replies**: Simple keyword matching with support for future AI integration
- **Human-Like Behavior**: Realistic typing delays, random pauses, rate limiting
- **Local-First**: Runs on your machine with your own accounts

## Quick Start

```bash
# Install dependencies
npm install

# Start the app
npm start
```

## Configuration

Edit `config.json` to customize behavior:

```json
{
  "initialUrl": "https://web.snapchat.com",
  "autoInject": false,
  "siteMode": "universal",
  
  "replyRules": [
    { "match": "hello", "reply": "Hey! How's it going?", "caseSensitive": false },
    { "match": "thanks", "reply": "You're welcome!", "caseSensitive": false }
  ],
  
  "typingDelayRangeMs": [50, 150],
  "preReplyDelayRangeMs": [2000, 6000],
  "maxRepliesPerMinute": 5,
  "maxRepliesPerHour": 30,
  "randomSkipProbability": 0.15,
  
  "activeHours": { "start": "09:00", "end": "22:00" }
}
```

### Key Settings

| Setting | Description |
|---------|-------------|
| `initialUrl` | Target messaging site URL |
| `autoInject` | Auto-inject automation on page load |
| `siteMode` | `"universal"`, `"snapchat"`, or `"twitter"` |
| `replyRules` | Array of match/reply pairs |
| `typingDelayRangeMs` | Character typing speed range (ms) |
| `preReplyDelayRangeMs` | Delay before starting to type (ms) |
| `maxRepliesPerMinute` | Rate limiting |
| `randomSkipProbability` | Chance to skip a reply (0-1) |
| `activeHours` | Operating hours (24h format) |

## Commands

```bash
npm start              # Build and start the app
npm run dev            # Development mode
npm run dev:debug      # Development with logging
npm test               # Run all tests
npm run test:unit      # Unit tests only
npm run test:property  # Property-based tests only
npm run build          # Compile TypeScript
npm run package        # Package for distribution
```

## Architecture

Snappy uses a three-layer architecture:

```
┌─────────────────────────────────────────────────┐
│                  Shell Layer                     │
│         (Electron main process)                  │
│   Window management, config, script injection    │
└─────────────────────┬───────────────────────────┘
                      │ Preload Bridge (IPC)
┌─────────────────────▼───────────────────────────┐
│                Injection Layer                   │
│            (Runs in web page)                    │
│   DOM monitoring, message detection, typing      │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│                  Brain Layer                     │
│              (Reply logic)                       │
│   Rule matching, rate limiting, decisions        │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
snappy/
├── src/
│   ├── main/          # Shell Layer (Electron main process)
│   ├── preload/       # Secure IPC bridge
│   ├── injection/     # DOM automation (bot.js)
│   └── brain/         # Reply logic and rules
├── tests/             # Unit and property-based tests
├── config.json        # Runtime configuration
└── package.json       # Dependencies and scripts
```

## How It Works

1. **Launch**: Snappy opens a browser window with your target messaging site
2. **Login**: You manually log in to your account (handles 2FA, captchas, etc.)
3. **Inject**: Automation script is injected into the page (auto or manual)
4. **Monitor**: MutationObserver watches for new incoming messages
5. **Decide**: Brain layer evaluates messages against reply rules
6. **Reply**: Types and sends responses with human-like timing

## Anti-Detection Features

- Randomized typing delays (50-150ms per character)
- Pre-reply thinking pauses (2-6 seconds)
- Occasional mid-typing pauses
- Rate limiting (per minute and per hour)
- Random skip probability (10-20% of messages)
- Active hours restriction

## License

MIT
