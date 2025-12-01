# Project Organization

## Directory Structure

```
.kiro/
├── specs/
│   └── snappy/
│       ├── requirements.md    # User stories and acceptance criteria
│       ├── design.md          # Architecture, components, properties
│       └── tasks.md           # Implementation checklist
└── steering/                  # AI assistant guidance documents

src/
├── main/                      # Shell Layer (Electron main process)
├── preload/                   # Preload Bridge (secure IPC)
├── injection/                 # Injection Layer (DOM automation)
└── brain/                     # Brain Layer (reply logic)

tests/                         # All test files
```

## File Naming Conventions

- Main process: `main.js` or `main.ts`
- Preload script: `preload.js` or `preload.ts`
- Injection script: `bot.js` (injected into web pages)
- Configuration: `config.json` (runtime settings)
- Tests: `*.test.ts` or `*.spec.ts`

## Component Organization

### Shell Layer (`src/main/`)
Electron main process components:
- Window management
- Script injection logic
- Configuration loading
- Session persistence
- IPC handlers

### Preload Bridge (`src/preload/`)
Secure communication layer:
- Context bridge setup
- Exposed APIs (log, injectBot)
- IPC message formatting

### Injection Layer (`src/injection/`)
Web page automation:
- MutationObserver setup
- Message detection and parsing
- DOM interaction (input fields, buttons)
- Typing simulation
- Site-specific strategies

### Brain Layer (`src/brain/`)
Decision logic:
- Reply rule evaluation
- Rate limiting
- Random skip logic
- Future AI integration point

## Spec Documents

The `.kiro/specs/snappy/` directory contains the formal specification:

- **requirements.md**: 10 requirements with user stories and acceptance criteria
- **design.md**: Architecture diagrams, component interfaces, 50 correctness properties
- **tasks.md**: Implementation checklist with property test mappings

These documents drive development and testing. Each task references specific requirements, and each property-based test validates specific acceptance criteria.

## Configuration Files

- `package.json`: Dependencies, scripts, project metadata
- `tsconfig.json`: TypeScript compiler configuration
- `config.json`: Runtime configuration (URL, rules, timing, rate limits)
- `.gitignore`: Exclude node_modules, build artifacts, logs

## Testing Organization

Tests mirror the source structure:
- `tests/main/`: Shell Layer tests
- `tests/injection/`: Injection Layer tests
- `tests/brain/`: Brain Layer tests
- `tests/integration/`: End-to-end tests

Property-based tests use fast-check and tag each test with the corresponding property number from design.md.
