# bot-mvp.md  
**Universal Web Auto-Responder MVP (Snapchat / Twitter / Anything)**

---

## 0. What This MVP Actually Is

This MVP is **not** a dream. It’s a very concrete thing:

- A **desktop app** (Electron) that:
  - Opens *any* website in a window (Snapchat Web, Twitter DMs, etc.)
  - Lets **you** log in (no automated login, no account creation).
  - Injects an **automation script** into the page.
  - That script:
    - Watches the page for new messages.
    - Detects when something matches your conditions.
    - Types and sends replies *inside the site* like a human.

Think of it as:

> **"A universal browser assistant that sits on top of any site and reacts for you."**

This file gives you **everything conceptually required** to build and run v1 in a real project.  
Not theoretical. This is the wiring, architecture, and flow you actually need.

---

## 1. Tech Stack & Moving Parts

### 1.1. Core Components

You need **three layers**:

1. **Shell Layer – Electron App**
   - Responsible for:
     - Creating the main desktop window.
     - Loading a target URL (e.g. `https://web.snapchat.com`).
     - Managing session (cookies, localStorage).
     - Triggering injection of your automation code into the webpage.

2. **Injection Layer – Page Automation Script**
   - Runs **inside** the loaded web page context (like code from DevTools console).
   - Responsible for:
     - Watching DOM changes (new messages, new elements).
     - Parsing message elements (who said what, when).
     - Typing and sending replies via:
       - `contenteditable` elements
       - `<textarea>` or `<input>`
       - Send buttons (e.g. `button[aria-label="Send"]` or `[data-testid="send-button"]`).
     - Mimicking human behavior (delays, typing, random pauses).

3. **Brain Layer – Logic / AI / Rules**
   - **Optional at MVP**, but this is where you plug in:
     - Rule-based replies (“If message contains X → reply Y”).
     - LLM / GPT-based responses.
     - Per-account/persona logic.

For MVP, you can keep Brain Layer **simple rule-based** and upgrade to full AI later.

---

## 2. Project Layout (What Exists on Disk)

Create a project folder. Inside it, you have at least:

- `package.json`
- `main.js` → Electron main process (shell).
- `preload.js` → Secure bridge to the website context.
- `bot.js` → The **injected automation logic** that runs inside web pages.
- `config.json` → Simple config (initial URL, injection toggle, etc.) – optional but recommended.
- `README.md` or this `bot-mvp.md` as your spec.

You can also add:

- `/scripts` → For future multi-site behavior (Snapchat-only, Twitter-only).
- `/logs` → Store log outputs, errors, events.

---

## 3. How the Flow Works (End-to-End)

### 3.1. Lifecycle

1. **You run the app**
   - `npm start` (or your chosen script).
   - Electron launches a window.

2. **Target site loads**
   - Electron loads `https://web.snapchat.com` or `https://x.com/messages`.
   - It behaves like a normal Chromium browser.

3. **You log in manually**
   - You solve OTP, 2FA, captchas, etc.
   - The session is stored in:
     - Cookies
     - localStorage/sessionStorage

4. **You trigger automation**
   - Either:
     - Automatically after load,
     - Or via a menu/button (e.g. “Start Bot”).
   - Electron injects `bot.js` into the current page.

5. **bot.js starts watching**
   - Sets up a `MutationObserver` on `document.body` or specific containers.
   - Whenever new message bubbles or DOM nodes appear, it:
     - Filters for “incoming messages”.
     - Extracts sender + text.
     - Runs your reply logic.

6. **Reply logic fires**
   - Brain Layer decides: “Do I reply? What do I say?”
   - If yes:
     - Finds the active input/message field.
     - Simulates typing (char by char, with delays).
     - Clicks the send button.
   - Logs the event (to console and/or to Electron via `window.bot.log(...)`).

---

## 4. The Automation Script Design (bot.js – Conceptually)

You don’t need code copied here; you need the **structure** of what this file does.

### 4.1. Responsibilities

`bot.js` must:

1. **Initialize**
   - Log that it’s been injected.
   - Confirm that `document.body` exists.
   - Optionally, identify which site it’s on (via `location.host`).

2. **Attach a DOM Watcher**
   - Use `MutationObserver` to watch for changes in:
     - The conversation/message container.
     - Or the whole document body (simpler for MVP).

3. **Detect New Messages**
   - Every time the DOM changes:
     - Scan relevant elements (message bubbles).
     - Determine:
       - Is this **incoming** (not sent by me)?
       - Is it **new** (not seen before)?
     - Extract:
       - `sender`
       - `messageText`
       - `timestamp` (if available)
       - `conversationId` (if determinable)

   - Use a simple in-memory “seen messages” set to avoid double-processing.

4. **Decide What To Do**
   - A small function like:  
     `decideReply({ sender, messageText, context })` that can:
     - Return `null` → do nothing.
     - Return a string → reply with that text.

   - For MVP:
     - Use simple conditions:
       - If message contains “?” → say “I’ll reply soon.”
       - If message contains certain keywords → custom responses.

5. **Type and Send**
   - Steps:
     1. Locate the input field:
        - Prefer `[contenteditable="true"]`.
        - Fall back to `textarea` or `input[type="text"]`.
     2. Focus it.
     3. Clear previous text if any.
     4. Simulate typing:
        - For each character:
          - Append or set the text.
          - Wait 50–150 ms (random per char).
     5. Locate send button:
        - Common selectors:  
          - `[data-testid="send-button"]`  
          - `button[aria-label*="Send"]`  
          - `button[type="submit"]`
     6. Click send.
     7. Optionally, log “Sent reply to X: <text>”.

6. **Handle Errors Softly**
   - If input not found → log & skip.
   - If send button not found → log & skip.
   - If DOM structure changes → keep trying; don’t crash.

---

## 5. Handling Different Sites (Snapchat / Twitter / etc.)

The MVP should be **universal** but not stupid.

You have two broad approaches:

### 5.1. Single Universal Heuristic (MVP)

- Use **very generic rules**:
  - `contenteditable` = possible message input.
  - Last message bubble in DOM = likely last message in chat.
  - Buttons with “send” semantics = send action.

- Pros:
  - One script works “okay” on many sites.
- Cons:
  - Not perfect; you’ll adapt for each site later.

### 5.2. Per-Site Strategy (Next Step)

- Identify site via `location.hostname`.
- Switch logic:
  - `if (host.includes("snapchat")) { useSnapchatStrategy() }`
  - `if (host.includes("twitter.com") || host.includes("x.com")) { useTwitterStrategy() }`

Each strategy knows:

- Where DOM containers are.
- How message bubbles look (class names, attributes).
- Where the input box is.
- Where the send button is.

For MVP, start with **Snapchat Web only** and keep the selectors flexible enough to not break on small UI changes.

---

## 6. Human-Like Behavior (Anti-Detection Basics)

Even at MVP you should avoid “bot obviousness”.

### 6.1. Delays

- Use:
  - 50–150 ms per character for typing.
  - 2–6 seconds delay before starting to reply.
  - Random small “thinking pauses” (200–1000 ms) mid-message occasionally.

### 6.2. Limits

- Total replies per minute/hour.
- Maximum length per reply.
- Randomly **choose not to reply** sometimes (e.g. 10–20% of the time).

### 6.3. No 24/7 Operation (at MVP)

- Run your bot during a reasonable “active hours” window.
- Future: add a scheduler or “sleep cycles” for each account.

---

## 7. How You Actually Use This MVP (Workflow)

This is how a normal session looks:

1. **Start app**
   - `npm start` → Electron opens a window pointing at Snapchat Web.

2. **Login manually**
   - Complete:
     - Email/SMS verification.
     - Any captcha or confirmation.
   - (Optionally, persist cookies to disk so you don’t log in every time.)

3. **Open a conversation**
   - Click into the chat you care about (e.g., one person, or a group).

4. **Activate the bot**
   - The app triggers `bot.js` to inject.
     - This can be:
       - on `did-finish-load` event,
       - OR a manual button in a menu (“Inject Bot”).

5. **Watch behavior**
   - You keep DevTools open to see logs:
     - Incoming message text.
     - Decisions.
     - “Typing…” and send events.

6. **Verify it works**
   - Send test messages from another device.
   - Confirm:
     - The bot detects the message.
     - It responds according to your logic.
     - It types and sends inside the real site UI.

7. **Adjust rules / thresholds**
   - Tweak your reply logic:
     - Keywords.
     - Conditions.
     - Delay randomness.

---

## 8. Minimum Configuration Required (Conceptual)

Even if you hardcode some things, it’s good to think in config.

Your **MVP config** can include:

- `initialUrl` → e.g. `"https://web.snapchat.com"`
- `autoInject` → `true/false` (inject automatically on load).
- `replyRules` → an array like:
  - `{ match: "?", reply: "I'll check and get back to you." }`
  - `{ match: "hello", reply: "Hey :)" }`
- `typingDelayRangeMs` → `[50, 150]`
- `preReplyDelayRangeMs` → `[2000, 6000]`
- `maxRepliesPerMinute` → `N` (start low).
- `siteMode` → `"universal" | "snapchat" | "twitter"`

You can keep this in a file or inlined constants at first.

---

## 9. Where the Brain/AI Plugs In (Future Extension)

Once the skeleton works, swapping in AI is trivial:

- Instead of simple string rules, you:
  - Send the `messageText` (and optional history) to:
    - Local LLM
    - OpenAI, Anthropic, etc.

- The flow becomes:
  - Incoming message → `handleIncomingMessage()`
  - That calls an async function `generateReply(message, context)`
  - That returns AI output which you feed into `typeAndSend()`.

You can:
- Use **your own backend** (HTTP endpoint that wraps OpenAI).
- Or call APIs directly from Electron (but you probably prefer a backend).

---

## 10. Security & Risk Reality Check

Even though this MVP is **local only** and uses your **own account**:

- Snapchat, Twitter, etc. **do not like** automated activity.
- Risks:
  - Soft bans.
  - Forced re-logins.
  - Temporary flags.
  - Permanent account closure.

Minimize risk by:

- Not spamming.
- Keeping reply frequency human-like.
- Targeting a small number of conversations.
- Not running 24/7.

MVP goal is **proof-of-concept**, not a 1,000-account farm yet.

---

## 11. Summary – What You Actually Need To Build

To make this MVP functional, you need to implement:

1. **Electron Shell**
   - Create a main window.
   - Load a target URL.
   - Optionally expose a “Start Bot” action to inject `bot.js`.

2. **Preload Bridge**
   - Safe, minimal API from webpage to Electron (for logs, status).
   - You only need:
     - `injectBot`
     - `log(message)`

3. **Injected Automation Script (`bot.js`)**
   - On load:
     - Log self.
     - Start `MutationObserver` on the DOM.
   - On changes:
     - Detect new incoming messages.
     - Call reply logic.
   - Reply logic:
     - Decide reply text (simple rules).
     - Find input & send button.
     - Simulate typing.
     - Press send.
     - Log what it did.

4. **Basic Config**
   - Which URL to open.
   - Whether to auto-inject or manual.
   - Base rules for replying.
   - Timing parameters.

Once those four are actually implemented and wired, you have a **real**, working bot that:

- Opens Snapchat Web (or Twitter).
- Let’s you log in.
- Detects new messages.
- Types and sends responses inside the live UI.

---

If you want, next step I can do a **separate file** like:

- `architecture-diagram.md` → pure diagrams & workflows.
- `snapchat-strategy.md` → DOM strategies specifically for Snapchat Web (selectors, message structure, etc.).
- `scaling-plan.md` → how to go from 1 → 10 → 100 concurrent sessions (proxies, fingerprints, controllers).

But for MVP that actually runs, **this** is the spec you need to follow.
