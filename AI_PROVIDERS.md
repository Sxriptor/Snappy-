# AI Provider Configuration

Snappy now supports multiple AI providers for generating automated replies. You can choose between a local LLM server or ChatGPT API.

## Available Providers

### 1. Local LLM Server (Default)
- **Use case**: Privacy-focused, NSFW content, no API costs
- **Requirements**: Local llama.cpp or Ollama server running
- **Configuration**: Managed through the "Llama Server" section in settings
- **Server Management**: Llama server automatically starts/stops with bot sessions

### 2. ChatGPT API
- **Use case**: High-quality responses, no local setup required
- **Requirements**: OpenAI API key
- **Configuration**: Enter API key and select model in AI settings
- **Server Management**: No local server needed - uses OpenAI's cloud API

## Configuration Steps

### Using Local LLM Server

1. **Set up your local server** (llama.cpp, Ollama, etc.)
2. **Configure in Snappy**:
   - Go to "AI Settings" section
   - Set Provider to "Local LLM Server"
   - Go to "Llama Server" section (now visible)
   - Set build path and start command
3. **Start bot**: The llama server will automatically start when you start the bot

### Using ChatGPT API

1. **Get OpenAI API key**:
   - Visit https://platform.openai.com/api-keys
   - Create a new API key
2. **Configure in Snappy**:
   - Go to "AI Settings" section
   - Set Provider to "ChatGPT API"
   - Enter your API key
   - Select desired model (gpt-3.5-turbo, gpt-4, etc.)
   - Click "Test" to verify connection
3. **Start bot**: No server setup needed - bot will use ChatGPT API directly

## UI Behavior

### When Local LLM is Selected:
- ✅ "Llama Server" section is visible
- ✅ Server automatically starts when bot starts
- ✅ Server status and controls available
- ✅ Per-session server management

### When ChatGPT API is Selected:
- ❌ "Llama Server" section is hidden
- ✅ ChatGPT settings (API key, model) are visible
- ❌ No local server is started
- ✅ Direct API communication

## Model Recommendations

### For General Use (SFW)
- **ChatGPT**: `gpt-3.5-turbo` (fast, cost-effective) or `gpt-4o-mini` (better quality)
- **Local**: Any general-purpose model like Llama 2/3, Mistral, etc.

### For NSFW Content
- **Local only**: Use uncensored models like Mythomax, WizardLM-Uncensored, etc.
- **ChatGPT**: Not recommended due to content policies

## Cost Considerations

### ChatGPT API Pricing (as of 2024)
- **gpt-3.5-turbo**: ~$0.002 per 1K tokens
- **gpt-4o-mini**: ~$0.0002 per 1K tokens  
- **gpt-4**: ~$0.03 per 1K tokens

### Local LLM
- **Cost**: Free after initial setup
- **Requirements**: Decent GPU (8GB+ VRAM recommended) or CPU with sufficient RAM

## Security & Privacy

### Local LLM
- ✅ Complete privacy - data never leaves your machine
- ✅ No API key required
- ✅ Works offline
- ❌ Requires technical setup

### ChatGPT API
- ⚠️ Data sent to OpenAI servers
- ❌ Requires API key (keep secure)
- ✅ No local setup required
- ❌ Requires internet connection

## Troubleshooting

### Local LLM Issues
- **Connection failed**: Check if server is running on correct port
- **Server won't start**: Verify build path and start command are correct
- **Slow responses**: Consider using smaller model or upgrading hardware
- **Out of memory**: Reduce model size or increase system RAM

### ChatGPT API Issues
- **Invalid API key**: Verify key is correct and has sufficient credits
- **Rate limits**: OpenAI has usage limits - consider upgrading plan
- **Content policy**: Some prompts may be rejected for policy violations

## Configuration Examples

### Example config.json (Local)
```json
{
  "ai": {
    "enabled": true,
    "provider": "local",
    "llmEndpoint": "127.0.0.1",
    "llmPort": 8081,
    "systemPrompt": "You are a helpful assistant...",
    "temperature": 0.7,
    "maxTokens": 150
  }
}
```

### Example config.json (ChatGPT)
```json
{
  "ai": {
    "enabled": true,
    "provider": "chatgpt",
    "chatgptApiKey": "sk-your-api-key-here",
    "chatgptModel": "gpt-3.5-turbo",
    "systemPrompt": "You are a helpful assistant...",
    "temperature": 0.7,
    "maxTokens": 150
  }
}
```

## Best Practices

1. **Start with ChatGPT** for ease of setup, then consider local if you need privacy
2. **Use appropriate models** - don't use gpt-4 for simple tasks
3. **Set reasonable token limits** to control costs/response length
4. **Test your configuration** before enabling automation
5. **Monitor usage** to avoid unexpected costs or rate limits
6. **Keep API keys secure** - never share or commit them to version control
7. **Provider switching** - you can change providers anytime without losing other settings