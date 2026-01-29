# Lesson 7: Memory & State Management

## Memory Management System

For an AI assistant, "memory" is what differentiates a helpful partner from a stateless bot. Clawdbot implements a sophisticated memory system that balances context window limitations with long-term retention.

### Memory Tiers

1.  **Short-Term Memory (Context Window)**: The immediate conversation history. Limited by the model's token limit (e.g., 128k or 200k tokens).
2.  **Medium-Term Memory (Daily Logs)**: Files like `memory/YYYY-MM-DD.md` that store raw logs of the day's activities.
3.  **Long-Term Memory (Curated)**: The `MEMORY.md` file, containing distilled facts, preferences, and important events.

## Session Persistence

Sessions are persisted to disk as JSON files, ensuring that the state is preserved even if the Gateway restarts.

### Session File Structure

```json
{
  "id": "session-123",
  "history": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" }
  ],
  "context": {
    "variables": { "userName": "Gnod" }
  },
  "metadata": {
    "created": 1700000000,
    "lastActive": 1700000100
  }
}
```

## Context Compression & Management

As conversations grow, the token count increases. Clawdbot employs several strategies to manage this:

### 1. Sliding Window
Keeping only the last N messages or tokens. Simple but loses older context.

### 2. Summarization
Periodically asking the model to summarize the conversation so far and replacing older messages with the summary.

```typescript
// Summarization logic
async function compressHistory(history: Message[]) {
  if (tokenCount(history) > THRESHOLD) {
    const older = history.slice(0, history.length / 2);
    const newer = history.slice(history.length / 2);
    const summary = await model.summarize(older);
    return [
      { role: 'system', content: `Previous conversation summary: ${summary}` },
      ...newer
    ];
  }
  return history;
}
```

## Memory Mechanism Implementation

Clawdbot's `MEMORY.md` system is unique. It relies on the Agent actively reading and updating its own memory file.

### Active Recall

Before answering a question that might require context, the agent searches its memory:

```typescript
// Memory search tool usage
const results = await tools.memory_search({ query: "project alpha deadline" });
// Agent reads the results and incorporates them into the answer
```

### Active Consolidation

Agents are instructed to update `MEMORY.md` when they learn something new and important:

```typescript
// Agent instructions
// If the user tells you a preference or a fact, use the 'edit' tool to add it to MEMORY.md.
```

### Memory Maintenance

Periodic "heartbeat" tasks can trigger the agent to review daily logs and consolidate them into long-term memory, simulating a "sleep/consolidation" cycle.

## Summary

Clawdbot's memory system combines automated persistence with agent-driven memory management. By treating memory as files that the agent can read and write, it leverages the LLM's own reasoning to decide what is worth remembering.

In the next lesson, we will look at Model Integration, exploring how Clawdbot supports multiple AI providers and handles failovers.
