# Lesson 8: Model Integration & AI Interfaces

## Multi-Model Support Architecture

Clawdbot is model-agnostic. It is designed to work with various LLM providers (Anthropic, OpenAI, Google, local models via Ollama, etc.) through a unified interface.

### Model Abstraction Layer

```typescript
// Model interface
interface ModelInterface {
  id: string;
  provider: string;
  contextWindow: number;
  generate(messages: Message[], options: GenerationOptions): Promise<GenerationResult>;
  stream(messages: Message[], options: GenerationOptions): AsyncIterable<string>;
}
```

### Configuration

Users can configure different models for different agents or tasks:

```json
{
  "agents": {
    "coder": { "model": "anthropic/claude-3-5-sonnet-20241022" },
    "writer": { "model": "openai/gpt-4o" },
    "chat": { "model": "google/gemini-pro-1.5" }
  }
}
```

## Model Failover Mechanisms

To ensure reliability, Clawdbot supports automatic failover. If the primary model fails (API downtime, rate limits), it can automatically switch to a fallback model.

```typescript
// Failover logic
async function callModelWithFailover(messages, config) {
  const models = [config.primary, ...config.fallbacks];
  
  for (const model of models) {
    try {
      return await model.generate(messages);
    } catch (error) {
      console.warn(`Model ${model.id} failed, trying next...`);
      continue;
    }
  }
  throw new Error("All models failed");
}
```

## Prompt Engineering & Template System

Clawdbot uses a sophisticated system prompt to define the Agent's personality and capabilities.

### Dynamic System Prompt

The system prompt is dynamically assembled based on:
1.  **Identity**: `SOUL.md` (Persona).
2.  **Context**: Current time, location, user info.
3.  **Tools**: Definitions of available tools.
4.  **Skills**: Instructions from loaded skills.

```typescript
// Prompt assembly
const systemPrompt = `
You are Clawdbot.
Current time: ${new Date().toISOString()}
User: ${userProfile.name}

${soulContent}

Available Tools:
${toolDefinitions}

${skillInstructions}
`;
```

## Usage Tracking & Billing

Clawdbot tracks token usage for every request to help users monitor costs.

```typescript
// Usage tracking
interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  timestamp: number;
}

// Saving stats
await statsDb.insert({
  ...usage,
  sessionId: session.id
});
```

## Summary

The Model Integration layer provides flexibility and reliability. By abstracting the model provider, Clawdbot allows users to choose the best model for their needs (or budget) and ensures that the agent keeps running even if one provider goes down.

In the next lesson, we will discuss the Security Model, a critical aspect of running an agent with access to your personal data.
