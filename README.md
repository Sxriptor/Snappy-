<h1 align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="https://github.com/user-attachments/assets/"
    >
    <img
      alt="SNAPPY"
      src="https://github.com/user-attachments/assets/"
      width="300"
      height="100"
      style="margin-bottom:-4px;"
    >
  </picture>
  <br>
  <small>Automation • Speed • Scale</small>
</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-white">
  <img src="https://img.shields.io/badge/status-active-white">
  <img src="https://img.shields.io/badge/platform-Windows 10/11-white">
  <img src="https://img.shields.io/badge/discord-78_online-white">
</p>

---

# 🚀 SNAPPY  
**Multi-session web automation at scale.**  
SNAPPY opens, controls, and automates actions inside platforms like **Snapchat Web, Twitter, Instagram**, and more — letting you run **tens or hundreds** of simultaneous browser sessions with smart reply logic and DOM-aware interaction.

> **Think of SNAPPY as your high-speed UI robot:  
It reads the page, detects states, and instantly performs actions for you.**

---

## 🔥 What SNAPPY Can Do

### ✅ **Real Browser Automation**
SNAPPY doesn’t fake API calls — it interacts with the actual website UI using DOM selectors, dynamic element detection, and behavioral timing.

- Reads unread messages  
- Detects whether a message is from you or them  
- Sends automated or AI-generated responses  
- Handles multiple tabs / windows without slowing down  
- Supports custom logic per platform

---

### ⚡ **Massively Parallel Sessions**
Run **10, 50, or 100+ sessions** (Snapchat, Twitter, IG, anything).  
Each one operates independently with its own logic and message flow.

Perfect for:
- Customer support  
- Lead generation  
- Creator agencies  
- Automated engagement  
- Testing and simulation  

---

### 🤖 **AI-Enhanced Reply Logic**
Optional AI mode allows SNAPPY to:
- Read incoming chat messages  
- Decide the correct response contextually  
- Reply instantly through the UI  

This works using models you choose — remote API or local LLMs.

---

### 🔍 **DOM-Level Awareness**
SNAPPY dynamically inspects the site DOM to determine:
- If the chat is unread  
- Which messages belong to you  
- Whether an action is available (send button, typing box, etc.)  
- Message timestamps & metadata  

This makes the automation **reliable and not brittle**.

---

## 🖥️ Install SNAPPY

Download the latest version:

➡️ **https://snappy.app**  
(Or replace with your actual URL)

After installing:
1. Open the app  
2. Choose the platform you want to automate  
3. Set the session count  
4. (Optional) Enable AI reply logic  
5. Press **Start Automation**

---

## 📁 Repo Purpose

This repository exists to provide:
- The latest SNAPPY installers  
- Release notes  
- Troubleshooting help  
- Documentation for automation logic  
- Contribution guidelines (optional)

---

## 📞 Support

<p align="center">
  <a href="https://snappy.app" target="_blank">
    <img src="https://img.shields.io/badge/website-snappy.app-white?style=for-the-badge">
  </a>
  <a href="https://discord.gg/" target="_blank">
    <img src="https://img.shields.io/badge/discord-community-white?style=for-the-badge">
  </a>
</p>

If you run into issues or want custom automation logic, reach out anytime.

---

## 🛠️ Roadmap
- Multi-platform script editor  
- Cloud automation mode  
- Full AI-driven conversation engine  
- Auto-account rotation  
- Behavioral pacing & bot-detection avoidance  
- Mobile device spoofing layer  

---

## ⭐ Contribute
Want to add platform scripts or new automation modules?  
Fork the repo and open a PR — all contributions are welcome.

---

**SNAPPY — Automation that actually moves at your speed.**

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
