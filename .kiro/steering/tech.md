# Technology Stack

## Core Technologies

- **Runtime**: Node.js with Electron
- **Language**: TypeScript (configured via tsconfig.json)
- **Testing**: Jest for unit tests, fast-check for property-based testing
- **Architecture**: Three-layer system (Shell, Injection, Brain)

## Key Dependencies

- Electron: Desktop app framework with Chromium rendering
- TypeScript: Type-safe development
- Jest: Testing framework
- fast-check: Property-based testing library

## Project Structure

```
snappy/
├── src/
│   ├── main/          # Electron main process (Shell Layer)
│   ├── preload/       # Secure IPC bridge
│   ├── injection/     # DOM automation scripts (bot.js)
│   └── brain/         # Reply logic and rules
├── tests/             # Unit and property-based tests
├── config.json        # Runtime configuration
└── package.json       # Dependencies and scripts
```

## Common Commands

### Development
```bash
npm start              # Start Electron app in development mode
npm run dev            # Development with hot reload
```

### Testing
```bash
npm test               # Run all tests
npm run test:unit      # Run unit tests only
npm run test:property  # Run property-based tests only
```

### Building
```bash
npm run build          # Build for production
npm run package        # Package Electron app
```

## Architecture Layers

1. **Shell Layer** (main.js): Electron main process - window management, script injection, configuration
2. **Preload Bridge** (preload.js): Secure IPC communication between web context and Electron
3. **Injection Layer** (bot.js): Runs inside web pages - DOM monitoring, message detection, typing simulation
4. **Brain Layer**: Reply logic - rule matching, rate limiting, decision making

## Configuration

Configuration is loaded from `config.json` with these key settings:
- `initialUrl`: Target messaging site
- `autoInject`: Auto-inject automation on page load
- `replyRules`: Array of match/reply pairs
- `typingDelayRangeMs`: Character typing speed range
- `preReplyDelayRangeMs`: Delay before starting to type
- `maxRepliesPerMinute`: Rate limiting
- `siteMode`: "universal" | "snapchat" | "twitter"

## Testing Philosophy

- Write implementation first, then tests
- Property-based tests validate universal behaviors (100+ iterations)
- Unit tests cover specific logic and edge cases
- Integration tests verify end-to-end flows
- Focus on high-value coverage, avoid over-testing
