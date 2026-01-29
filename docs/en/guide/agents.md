# Lesson 4: Agent System Architecture

## Agent Runtime Design

Clawdbot's agent system is the core of AI interaction, responsible for communicating with large language models, executing tool calls, and maintaining conversation context. The agent system adopts an embedded Pi Agent architecture, built on the [mariozechner/pi-agent-core](https://github.com/mariozechner/pi-agent-core) library.

### Agent Configuration Management

Let's first look at how agent configuration is managed:

```typescript
// From src/agents/agent-scope.ts
export function resolveAgentConfig(
  cfg: MoltbotConfig,
  agentId: string,
): ResolvedAgentConfig | undefined {
  const id = normalizeAgentId(agentId);
  const entry = resolveAgentEntry(cfg, id);
  if (!entry) return undefined;
  return {
    name: typeof entry.name === "string" ? entry.name : undefined,
    workspace: typeof entry.workspace === "string" ? entry.workspace : undefined,
    agentDir: typeof entry.agentDir === "string" ? entry.agentDir : undefined,
    model:
      typeof entry.model === "string" || (entry.model && typeof entry.model === "object")
        ? entry.model
        : undefined,
    memorySearch: entry.memorySearch,
    humanDelay: entry.humanDelay,
    heartbeat: entry.heartbeat,
    identity: entry.identity,
    groupChat: entry.groupChat,
    subagents: typeof entry.subagents === "object" && entry.subagents ? entry.subagents : undefined,
    sandbox: entry.sandbox,
    tools: entry.tools,
  };
}

// Resolve agent model configuration
export function resolveAgentModelPrimary(cfg: MoltbotConfig, agentId: string): string | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw) return undefined;
  if (typeof raw === "string") return raw.trim() || undefined;
  const primary = raw.primary?.trim();
  return primary || undefined;
}

export function resolveAgentWorkspaceDir(cfg: MoltbotConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.workspace?.trim();
  if (configured) return resolveUserPath(configured);
  const defaultAgentId = resolveDefaultAgentId(cfg);
  if (id === defaultAgentId) {
    const fallback = cfg.agents?.defaults?.workspace?.trim();
    if (fallback) return resolveUserPath(fallback);
    return DEFAULT_AGENT_WORKSPACE_DIR;
  }
  return path.join(os.homedir(), `clawd-${id}`);
}
```

### Agent Runtime Main Flow

The agent runtime logic is implemented in the `runEmbeddedPiAgent` function, which is the heart of the agent system:

```typescript
// From src/agents/pi-embedded-runner/run.ts
export async function runEmbeddedPiAgent(
  params: RunEmbeddedPiAgentParams,
): Promise<EmbeddedPiRunResult> {
  const sessionLane = resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
  const globalLane = resolveGlobalLane(params.lane);
  const enqueueGlobal =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(globalLane, task, opts));
  const enqueueSession =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(sessionLane, task, opts));

  return enqueueSession(() =>
    enqueueGlobal(async () => {
      const started = Date.now();
      const resolvedWorkspace = resolveUserPath(params.workspaceDir);
      const prevCwd = process.cwd();

      // Resolve model configuration
      const provider = (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
      const modelId = (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      const agentDir = params.agentDir ?? resolveMoltbotAgentDir();

      // Model resolution
      const { model, error, authStorage, modelRegistry } = resolveModel(
        provider,
        modelId,
        agentDir,
        params.config,
      );
      if (!model) {
        throw new Error(error ?? `Unknown model: ${provider}/${modelId}`);
      }

      // Context window check
      const ctxInfo = resolveContextWindowInfo({
        cfg: params.config,
        provider,
        modelId,
        modelContextWindow: model.contextWindow,
        defaultTokens: DEFAULT_CONTEXT_TOKENS,
      });
      const ctxGuard = evaluateContextWindowGuard({
        info: ctxInfo,
        warnBelowTokens: CONTEXT_WINDOW_WARN_BELOW_TOKENS,
        hardMinTokens: CONTEXT_WINDOW_HARD_MIN_TOKENS,
      });
      if (ctxGuard.shouldBlock) {
        throw new FailoverError(
          `Model context window too small (${ctxGuard.tokens} tokens). Minimum is ${CONTEXT_WINDOW_HARD_MIN_TOKENS}.`,
          { reason: "unknown", provider, model: modelId },
        );
      }

      // Auth configuration
      const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
      const profileOrder = resolveAuthProfileOrder({
        cfg: params.config,
        store: authStore,
        provider,
        preferredProfile: params.authProfileId,
      });
      const profileCandidates = profileOrder.length > 0
        ? profileOrder
        : [undefined];

      // Try auth profiles
      let profileIndex = 0;
      while (profileIndex < profileCandidates.length) {
        const candidate = profileCandidates[profileIndex];
        await applyApiKeyInfo(candidate);
        break;
      }

      // Agent attempt loop
      let overflowCompactionAttempted = false;
      while (true) {
        const attempt = await runEmbeddedAttempt({
          // ... passing lots of params to attempt function
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          prompt: params.prompt,
          provider,
          modelId,
          model,
          // ... more params
        });

        const { aborted, promptError, timedOut, sessionIdUsed, lastAssistant } = attempt;

        // Error handling and retry logic
        if (promptError && !aborted) {
          const errorText = describeUnknownError(promptError);
          
          // Context overflow handling
          if (isContextOverflowError(errorText)) {
            if (!overflowCompactionAttempted) {
              overflowCompactionAttempted = true;
              const compactResult = await compactEmbeddedPiSessionDirect({
                // Automatic session compaction
              });
              if (compactResult.compacted) {
                continue; // Retry
              }
            }
            // Return error info
            return {
              payloads: [{
                text: "Context overflow: prompt too large for the model...",
                isError: true,
              }],
              // ...
            };
          }
          
          // Failover handling
          if (isFailoverErrorMessage(errorText) && (await advanceAuthProfile())) {
            continue; // Try next auth profile
          }
        }

        // Auth failure handling
        const authFailure = isAuthAssistantError(lastAssistant);
        const rateLimitFailure = isRateLimitAssistantError(lastAssistant);
        const failoverFailure = isFailoverAssistantError(lastAssistant);
        
        if ((failoverFailure || timedOut) && lastProfileId) {
          // Mark auth profile as failed
          await markAuthProfileFailure({
            store: authStore,
            profileId: lastProfileId,
            reason: timedOut ? "timeout" : assistantFailoverReason ?? "unknown",
            cfg: params.config,
            agentDir: params.agentDir,
          });

          // Try next auth profile
          const rotated = await advanceAuthProfile();
          if (rotated) continue; // Retry
        }

        // Return successful result
        const usage = normalizeUsage(lastAssistant?.usage as UsageLike);
        const agentMeta: EmbeddedPiAgentMeta = {
          sessionId: sessionIdUsed,
          provider: lastAssistant?.provider ?? provider,
          model: lastAssistant?.model ?? model.id,
          usage,
        };

        const payloads = buildEmbeddedRunPayloads({
          assistantTexts: attempt.assistantTexts,
          toolMetas: attempt.toolMetas,
          lastAssistant: attempt.lastAssistant,
          // ...
        });

        return {
          payloads: payloads.length ? payloads : undefined,
          meta: {
            durationMs: Date.now() - started,
            agentMeta,
            aborted,
            systemPromptReport: attempt.systemPromptReport,
          },
          // ...
        };
      }
    }),
  );
}
```

## Session Models & Context Management

### Session Keys & Identification

Clawdbot uses session keys to identify different sessions, supporting complex session routing:

```typescript
// Session key parsing
export function parseAgentSessionKey(sessionKey: string): {
  agentId?: string;
  channelId?: string;
  peerId?: string;
  threadId?: string;
  raw: string;
} | null {
  // Format: agentId:channelId:peerId:threadId
  const parts = sessionKey.split(":");
  if (parts.length < 1) return null;
  
  if (parts.length === 1) {
    // Only one part - likely a simple session ID
    return { raw: parts[0] };
  }
  
  // Multi-part - parse according to convention
  return {
    agentId: parts[0] || undefined,
    channelId: parts[1] || undefined,
    peerId: parts[2] || undefined,
    threadId: parts[3] || undefined,
    raw: sessionKey,
  };
}
```

### Session File Management

Session state is persisted to the file system:

```typescript
// Session directory structure
// ~/.clawdbot/state/agents/{agentId}/sessions/{sessionId}.json
// or
// ~/clawd/sessions/{sessionId}.json

export function resolveAgentDir(cfg: MoltbotConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.agentDir?.trim();
  if (configured) return resolveUserPath(configured);
  const root = resolveStateDir(process.env, os.homedir());
  return path.join(root, "agents", id, "agent");
}
```

## Tool Calling Mechanism

### Tool Execution Flow

The agent system executes external operations via tool calls, which is one of its core capabilities:

```typescript
// Handling tool calls in runEmbeddedAttempt
async function runEmbeddedAttempt(params) {
  // ... initialization and model call
  
  // Process tool call results
  for (const toolCall of assistantResponse.toolCalls) {
    const toolResult = await executeToolCall(toolCall);
    
    // Add tool result back to conversation history
    conversationHistory.push({
      role: 'tool',
      content: toolResult,
      tool_call_id: toolCall.id
    });
    
    // Recall model to get final response
    const finalResponse = await callModel(conversationHistory);
  }
  
  return {
    assistantTexts: extractTextFromResponse(finalResponse),
    toolMetas: extractToolMetadata(finalResponse),
    lastAssistant: finalResponse,
    // ...
  };
}
```

### Tool Categories & Implementation

Clawdbot has built-in tools, each serving a specific function:

1. **File System Tools** (`read`, `write`, `edit`)
2. **Execution Tools** (`exec`, `process`)
3. **Browser Tools** (`browser`)
4. **Node Tools** (`nodes`)
5. **Scheduler Tools** (`cron`)
6. **Message Tools** (`message`)

## Sandbox Security Model

### Sandbox Configuration

Clawdbot implements a flexible sandbox mechanism that can apply different security policies based on session type:

```typescript
// Sandbox configuration example
export type AgentSandboxConfig = {
  mode?: "off" | "non-main";  // "non-main" enables sandbox for non-main sessions
  allowlist?: string[];       // List of allowed tools
  denylist?: string[];        // List of denied tools
  exec?: {
    security?: "deny" | "allowlist" | "full";  // Execution security level
    allowlist?: string[];                       // List of allowed commands
  };
};

// Sandbox application logic
function applySandboxRules(sessionKey: string, config: AgentSandboxConfig) {
  const isMainSession = sessionKey === "main" || sessionKey.startsWith("main:");
  
  if (config.mode === "non-main" && !isMainSession) {
    // Apply sandbox rules to non-main sessions
    return {
      allowlist: config.allowlist || ["bash", "process", "read", "write", "edit"],
      denylist: config.denylist || ["browser", "canvas", "nodes", "cron"],
    };
  }
  
  return { allowlist: null, denylist: null }; // Do not apply sandbox
}
```

### Secure Execution Environment

The sandbox environment restricts access to sensitive operations:

```typescript
// Sandbox tool access control
function checkToolAccess(toolName: string, sandboxConfig: SandboxConfig): boolean {
  if (sandboxConfig.allowlist && !sandboxConfig.allowlist.includes(toolName)) {
    return false;  // Not in allowlist
  }
  
  if (sandboxConfig.denylist && sandboxConfig.denylist.includes(toolName)) {
    return false;  // In denylist
  }
  
  return true;  // Access allowed
}

// Security check during tool execution
async function secureToolExecution(toolName: string, params: any, sessionContext: SessionContext) {
  const sandboxConfig = sessionContext.sandbox;
  if (!checkToolAccess(toolName, sandboxConfig)) {
    throw new Error(`Tool '${toolName}' is not allowed in current security context`);
  }
  
  // Execute tool
  return await executeTool(toolName, params);
}
```

## Summary

Clawdbot's agent system is a complex and powerful AI interaction engine with the following key features:

1. **Flexible Configuration Management**: Supports multi-agent configuration and model selection.
2. **Robust Error Handling**: Includes context overflow handling and auth failover.
3. **Intelligent Session Management**: Supports complex session routing and persistence.
4. **Rich Tool Ecosystem**: Provides multiple built-in tools for AI invocation.
5. **Flexible Security Model**: Supports fine-grained sandbox control.

In the next lesson, we will delve into the tool system and extension mechanisms, including browser control, Canvas visualization, and the node system.
