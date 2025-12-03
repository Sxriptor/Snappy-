# Implementation Plan

- [x] 1. Set up AI configuration types and defaults


  - [x] 1.1 Add AIConfig interface and DEFAULT_AI_CONFIG to src/types.ts


    - Define all AI configuration fields (endpoint, port, systemPrompt, temperature, maxTokens, etc.)
    - Include UserMemory interface
    - _Requirements: 1.4, 2.4, 4.3_
  - [x] 1.2 Update Configuration interface to include `ai: AIConfig` field


    - Maintain backwards compatibility with existing config fields
    - _Requirements: 7.2_

- [-] 2. Implement LLM Client


  - [x] 2.1 Create src/brain/llmClient.ts with generateReply and testConnection methods

    - Implement HTTP POST to OpenAI-compatible endpoint
    - Format request body with model, messages, temperature, max_tokens
    - Parse response and extract choices[0].message.content
    - Handle fetch errors and timeouts
    - _Requirements: 1.1, 1.2, 1.5_


  - [x] 2.2 Write property test for OpenAI-compatible request format

    - **Property 1: OpenAI-compatible request format**
    - **Validates: Requirements 1.5**


  - [x] 2.3 Implement error handling with exponential backoff in llmClient.ts


    - Create ErrorTracker class for consecutive error counting
    - Calculate backoff delay as baseDelay * 2^errorCount (capped at maxDelay)
    - _Requirements: 6.1, 6.2, 6.3, 6.5_


  - [ ] 2.4 Write property test for exponential backoff
    - **Property 13: Exponential backoff**

    - **Validates: Requirements 6.5**
  - [x] 2.5 Write property test for graceful error handling

    - **Property 12: Graceful error handling**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [ ] 3. Integrate existing Memory System with AI
  - [x] 3.1 Create src/brain/memoryBridge.ts to access existing localStorage memory


    - Bridge to existing window.__SNAPPY_MEMORY__ functions
    - Format memory data for inclusion in LLM context
    - _Requirements: 8.1, 8.2_

  - [x] 3.2 Write property test for user memory inclusion in context

    - **Property 15: User memory inclusion in context**
    - **Validates: Requirements 8.2**

- [-] 4. Implement Context Manager

  - [x] 4.1 Create src/brain/contextManager.ts

    - Track conversation history per conversationId
    - Build ChatMessage arrays with correct roles (user/assistant)
    - Enforce maxContextMessages limit
    - Reset context when conversationId changes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 4.2 Integrate user memory into context building
    - Load user memory when building context
    - Append user notes/facts to system prompt

    - _Requirements: 8.1, 8.2_
  - [x] 4.3 Write property test for system prompt inclusion

    - **Property 2: System prompt inclusion**
    - **Validates: Requirements 2.3**

  - [ ] 4.4 Write property test for context history inclusion
    - **Property 7: Context history inclusion**

    - **Validates: Requirements 5.1**
  - [x] 4.5 Write property test for context history limit

    - **Property 8: Context history limit**
    - **Validates: Requirements 5.2**
  - [x] 4.6 Write property test for message role formatting

    - **Property 9: Message role formatting**
    - **Validates: Requirements 5.3**

  - [ ] 4.7 Write property test for context reset on conversation change
    - **Property 10: Context reset on conversation change**

    - **Validates: Requirements 5.4**
  - [ ] 4.8 Write property test for context exclusion when disabled
    - **Property 11: Context exclusion when disabled**
    - **Validates: Requirements 5.5**
  - [ ] 4.9 Write property test for memory formatting in context
    - **Property 16: User memory persistence round-trip**
    - **Validates: Requirements 8.2**

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement AI Brain
  - [x] 6.1 Create src/brain/aiBrain.ts replacing rule-based logic


    - Implement async decideReply using LLM Client
    - Coordinate Context Manager for building message history
    - Apply system prompt from config
    - Respect enabled/disabled toggle
    - Integrate with existing rate limiter
    - _Requirements: 1.2, 2.3, 4.1, 4.5_

  - [x] 6.2 Update src/brain/brain.ts to use AI Brain when enabled

    - Check if AI is enabled in config
    - Delegate to aiBrain.decideReply when enabled
    - Fall back to returning null when AI disabled (no rule-based fallback)
    - _Requirements: 1.2, 1.3_

- [-] 7. Implement Settings Manager

  - [x] 7.1 Create src/main/settingsManager.ts

    - Load AI settings from config.json
    - Save settings with validation
    - Provide defaults for missing values
    - _Requirements: 3.4, 3.5, 7.1_
  - [x] 7.2 Implement settings validation

    - Validate endpoint URL format
    - Validate port range (1-65535)
    - Clamp temperature to 0.1-1.5
    - Validate maxTokens is positive
    - _Requirements: 3.3, 4.3_
  - [x] 7.3 Write property test for settings validation


    - **Property 4: Settings validation**
    - **Validates: Requirements 3.3**

  - [ ] 7.4 Write property test for temperature clamping
    - **Property 5: Temperature clamping**

    - **Validates: Requirements 4.3**
  - [x] 7.5 Write property test for settings persistence round-trip

    - **Property 3: Settings persistence round-trip**
    - **Validates: Requirements 2.2, 3.4, 3.5**

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement Settings UI
  - [ ] 9.1 Add settings panel HTML to src/renderer/index.html
    - Add settings button to main UI
    - Create settings panel with sections for connection, prompt, toggles
    - Add LLM endpoint and port input fields
    - Add system prompt textarea
    - Add temperature slider (0.1-1.5)
    - Add max tokens input
    - Add context history toggle and limit input
    - Add AI enabled toggle
    - Add test connection button and status indicator
    - _Requirements: 2.1, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 7.1_
  - [ ] 9.2 Add settings panel styles to src/renderer/styles.css
    - Style settings panel layout
    - Style form inputs, toggles, sliders
    - Style connection status indicators
    - _Requirements: 3.2_
  - [ ] 9.3 Implement settings panel logic in src/renderer/renderer.ts
    - Handle settings button click to show/hide panel
    - Load current settings on panel open
    - Save settings on change/close
    - Handle test connection button
    - Update connection status display
    - _Requirements: 3.1, 3.4, 7.2, 7.3, 7.4, 7.5_

- [ ] 10. Add IPC handlers for settings
  - [ ] 10.1 Update src/preload/preload.ts with settings APIs
    - Expose getAISettings, saveAISettings, testLLMConnection
    - _Requirements: 8.1, 8.2_
  - [ ] 10.2 Add IPC handlers in src/main/main.ts
    - Handle get-ai-settings, save-ai-settings, test-llm-connection
    - Wire up to Settings Manager
    - _Requirements: 3.4, 3.5, 7.2_
  - [ ] 10.3 Write property test for settings hot-reload
    - **Property 6: Settings hot-reload**
    - **Validates: Requirements 2.5, 4.5**

- [ ] 11. Enhance existing Memory UI for AI context
  - [ ] 11.1 Update memories section to show AI context preview
    - Show how memory will be formatted for LLM
    - Display memory summary per user
    - _Requirements: 8.3_

- [ ] 12. Update configuration file
  - [ ] 12.1 Update config.json with default AI settings
    - Add ai section with all default values
    - Keep existing fields for backwards compatibility
    - _Requirements: 2.4, 7.2_

- [ ] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Write property test for connection status accuracy
  - **Property 14: Connection status accuracy**
  - **Validates: Requirements 7.3, 7.4**

- [ ] 15. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
