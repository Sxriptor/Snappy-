# Requirements Document

## Introduction

This feature replaces Snappy's rule-based reply system with local AI integration using llama.cpp's OpenAI-compatible API. The system connects to a locally-running llama.cpp server (or Ollama) to generate contextual, human-like replies instead of using static keyword-matching rules. Users can configure the AI through a settings menu with system prompt customization and behavior toggles.

## Glossary

- **Snappy Application**: The Electron-based desktop application that hosts web pages and manages automation
- **Brain Layer**: The logic component that determines reply content (now AI-powered instead of rule-based)
- **LLM Server**: A locally-running llama.cpp or Ollama server exposing an OpenAI-compatible API
- **System Prompt**: Instructions that define the AI's personality and response style
- **OpenAI-Compatible API**: REST API format matching OpenAI's `/v1/chat/completions` endpoint
- **Settings Menu**: UI panel for configuring AI behavior, system prompt, and connection settings
- **Conversation Context**: Recent message history sent to the LLM for contextual replies

## Requirements

### Requirement 1

**User Story:** As a user, I want to connect Snappy to a local LLM server, so that I can generate AI-powered replies without cloud dependencies.

#### Acceptance Criteria

1. WHEN the Snappy Application starts THEN the Brain Layer SHALL attempt to connect to the configured LLM Server endpoint
2. WHEN the LLM Server is available THEN the Brain Layer SHALL use AI-generated replies instead of rule-based matching
3. WHEN the LLM Server is unavailable THEN the Brain Layer SHALL log the connection failure and disable auto-replies
4. WHERE the LLM Server endpoint is configurable THEN the Snappy Application SHALL support custom host and port settings (default: http://localhost:8080)
5. WHEN the Brain Layer sends a request THEN the request SHALL follow the OpenAI-compatible chat completions format

### Requirement 2

**User Story:** As a user, I want to customize the AI's system prompt, so that I can control the personality and style of generated replies.

#### Acceptance Criteria

1. WHEN the Settings Menu is opened THEN the Snappy Application SHALL display a text area for editing the system prompt
2. WHEN the user modifies the system prompt THEN the Snappy Application SHALL save the changes to configuration
3. WHEN the Brain Layer generates a reply THEN the configured system prompt SHALL be included in the LLM request
4. WHEN no custom system prompt is configured THEN the Brain Layer SHALL use a default conversational prompt
5. WHEN the system prompt is saved THEN the Snappy Application SHALL apply the changes immediately without restart

### Requirement 3

**User Story:** As a user, I want to access AI settings through a menu, so that I can easily configure the AI behavior.

#### Acceptance Criteria

1. WHEN the user clicks the settings button THEN the Snappy Application SHALL display the Settings Menu panel
2. WHEN the Settings Menu is displayed THEN the panel SHALL show LLM connection settings, system prompt editor, and behavior toggles
3. WHEN the user modifies settings THEN the Snappy Application SHALL validate inputs before saving
4. WHEN the Settings Menu is closed THEN the Snappy Application SHALL persist all changes to the configuration file
5. WHEN the Snappy Application starts THEN the Settings Menu SHALL load previously saved settings

### Requirement 4

**User Story:** As a user, I want behavior toggles for the AI, so that I can fine-tune how the AI responds.

#### Acceptance Criteria

1. WHERE the Settings Menu is displayed THEN the Snappy Application SHALL provide a toggle to enable or disable AI replies
2. WHERE the Settings Menu is displayed THEN the Snappy Application SHALL provide a toggle for including conversation history in context
3. WHERE the Settings Menu is displayed THEN the Snappy Application SHALL provide a slider for response creativity (temperature: 0.1 to 1.5)
4. WHERE the Settings Menu is displayed THEN the Snappy Application SHALL provide a field for maximum response length in tokens
5. WHEN any toggle or setting changes THEN the Brain Layer SHALL apply the new value to subsequent requests

### Requirement 5

**User Story:** As a user, I want the AI to consider conversation context, so that replies are relevant to the ongoing discussion.

#### Acceptance Criteria

1. WHEN the context history toggle is enabled THEN the Brain Layer SHALL include recent messages in the LLM request
2. WHEN building context THEN the Brain Layer SHALL include up to the configured number of previous messages (default: 10)
3. WHEN formatting context THEN the Brain Layer SHALL distinguish between user messages and assistant (bot) messages
4. WHEN the conversation changes THEN the Brain Layer SHALL reset the context history for the new conversation
5. WHEN context history is disabled THEN the Brain Layer SHALL send only the current message to the LLM

### Requirement 6

**User Story:** As a user, I want the AI to handle errors gracefully, so that the application remains stable when the LLM is unavailable.

#### Acceptance Criteria

1. IF the LLM Server request times out THEN the Brain Layer SHALL log the timeout and skip the reply
2. IF the LLM Server returns an error response THEN the Brain Layer SHALL log the error details and skip the reply
3. IF the LLM Server returns malformed JSON THEN the Brain Layer SHALL log the parsing error and skip the reply
4. WHEN an LLM error occurs THEN the Snappy Application SHALL continue monitoring for new messages
5. WHEN repeated LLM errors occur THEN the Brain Layer SHALL implement exponential backoff before retrying

### Requirement 7

**User Story:** As a user, I want to see the AI connection status, so that I know if the LLM server is working.

#### Acceptance Criteria

1. WHEN the Settings Menu is displayed THEN the Snappy Application SHALL show the current LLM connection status (connected, disconnected, error)
2. WHEN the user clicks a test connection button THEN the Snappy Application SHALL send a test request to the LLM Server
3. WHEN the test request succeeds THEN the Snappy Application SHALL display a success indicator with the model name
4. WHEN the test request fails THEN the Snappy Application SHALL display the error message to the user
5. WHILE the LLM Server is disconnected THEN the Settings Menu SHALL display a warning indicator

### Requirement 8

**User Story:** As a user, I want to store notes and facts about each person I chat with, so that the AI can provide personalized and contextual replies.

#### Acceptance Criteria

1. WHEN the Brain Layer builds context for a user THEN the system SHALL load any stored memory for that user
2. WHEN user memory exists THEN the Brain Layer SHALL include the notes and facts in the system prompt context
3. WHERE the Settings Menu is displayed THEN the Snappy Application SHALL provide a way to view and edit user memories
4. WHEN user memory is modified THEN the Snappy Application SHALL persist the changes to the memory store file
5. WHEN no user memory exists THEN the Brain Layer SHALL proceed without personalized context

