# 第4课：代理(Agent)系统架构

## 代理运行时设计

Clawdbot的代理系统是整个AI交互的核心，负责与大语言模型通信、执行工具调用以及维护对话上下文。代理系统采用了嵌入式Pi Agent架构，基于[mariozechner/pi-agent-core](https://github.com/mariozechner/pi-agent-core)库构建。

### 代理配置管理

让我们先看看代理配置是如何管理的：

```typescript
// 来自 src/agents/agent-scope.ts
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

// 解析代理模型配置
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

### 代理运行时主流程

代理的运行时逻辑实现在`runEmbeddedPiAgent`函数中，这是整个代理系统的核心：

```typescript
// 来自 src/agents/pi-embedded-runner/run.ts
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

      // 解析模型配置
      const provider = (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
      const modelId = (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      const agentDir = params.agentDir ?? resolveMoltbotAgentDir();

      // 模型解析
      const { model, error, authStorage, modelRegistry } = resolveModel(
        provider,
        modelId,
        agentDir,
        params.config,
      );
      if (!model) {
        throw new Error(error ?? `Unknown model: ${provider}/${modelId}`);
      }

      // 上下文窗口检查
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

      // 认证配置
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

      // 尝试认证配置文件
      let profileIndex = 0;
      while (profileIndex < profileCandidates.length) {
        const candidate = profileCandidates[profileIndex];
        await applyApiKeyInfo(candidate);
        break;
      }

      // 代理尝试循环
      let overflowCompactionAttempted = false;
      while (true) {
        const attempt = await runEmbeddedAttempt({
          // ... 传递大量参数给尝试函数
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          prompt: params.prompt,
          provider,
          modelId,
          model,
          // ... 更多参数
        });

        const { aborted, promptError, timedOut, sessionIdUsed, lastAssistant } = attempt;

        // 错误处理和重试逻辑
        if (promptError && !aborted) {
          const errorText = describeUnknownError(promptError);
          
          // 上下文溢出处理
          if (isContextOverflowError(errorText)) {
            if (!overflowCompactionAttempted) {
              overflowCompactionAttempted = true;
              const compactResult = await compactEmbeddedPiSessionDirect({
                // 自动压缩会话
              });
              if (compactResult.compacted) {
                continue; // 重新尝试
              }
            }
            // 返回错误信息
            return {
              payloads: [{
                text: "Context overflow: prompt too large for the model...",
                isError: true,
              }],
              // ...
            };
          }
          
          // 失败转移处理
          if (isFailoverErrorMessage(errorText) && (await advanceAuthProfile())) {
            continue; // 尝试下一个认证配置文件
          }
        }

        // 认证失败处理
        const authFailure = isAuthAssistantError(lastAssistant);
        const rateLimitFailure = isRateLimitAssistantError(lastAssistant);
        const failoverFailure = isFailoverAssistantError(lastAssistant);
        
        if ((failoverFailure || timedOut) && lastProfileId) {
          // 标记认证配置文件失败
          await markAuthProfileFailure({
            store: authStore,
            profileId: lastProfileId,
            reason: timedOut ? "timeout" : assistantFailoverReason ?? "unknown",
            cfg: params.config,
            agentDir: params.agentDir,
          });

          // 尝试下一个认证配置文件
          const rotated = await advanceAuthProfile();
          if (rotated) continue; // 重新尝试
        }

        // 成功返回结果
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

## 会话模型与上下文管理

### 会话键与标识

Clawdbot使用会话键来标识不同的会话，支持复杂的会话路由：

```typescript
// 会话键解析
export function parseAgentSessionKey(sessionKey: string): {
  agentId?: string;
  channelId?: string;
  peerId?: string;
  threadId?: string;
  raw: string;
} | null {
  // 解析格式: agentId:channelId:peerId:threadId
  const parts = sessionKey.split(":");
  if (parts.length < 1) return null;
  
  if (parts.length === 1) {
    // 只有一个部分 - 可能是简单的会话ID
    return { raw: parts[0] };
  }
  
  // 多部分 - 按约定顺序解析
  return {
    agentId: parts[0] || undefined,
    channelId: parts[1] || undefined,
    peerId: parts[2] || undefined,
    threadId: parts[3] || undefined,
    raw: sessionKey,
  };
}
```

### 会话文件管理

会话状态持久化到文件系统中：

```typescript
// 会话目录结构
// ~/.clawdbot/state/agents/{agentId}/sessions/{sessionId}.json
// 或
// ~/clawd/sessions/{sessionId}.json

export function resolveAgentDir(cfg: MoltbotConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.agentDir?.trim();
  if (configured) return resolveUserPath(configured);
  const root = resolveStateDir(process.env, os.homedir());
  return path.join(root, "agents", id, "agent");
}
```

## 工具调用机制

### 工具执行流程

代理系统通过工具调用来执行外部操作，这是其核心能力之一：

```typescript
// 在 runEmbeddedAttempt 中处理工具调用
async function runEmbeddedAttempt(params) {
  // ... 初始化和模型调用
  
  // 处理工具调用结果
  for (const toolCall of assistantResponse.toolCalls) {
    const toolResult = await executeToolCall(toolCall);
    
    // 将工具结果添加回对话历史
    conversationHistory.push({
      role: 'tool',
      content: toolResult,
      tool_call_id: toolCall.id
    });
    
    // 重新调用模型以获取最终响应
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

### 工具分类与实现

Clawdbot内置了多种工具，每种工具都有特定的功能：

1. **文件系统工具** (`read`, `write`, `edit`)
2. **执行工具** (`exec`, `process`)
3. **浏览器工具** (`browser`)
4. **节点工具** (`nodes`)
5. **定时任务工具** (`cron`)
6. **消息工具** (`message`)

## 沙箱安全模型

### 沙箱配置

Clawdbot实现了灵活的沙箱机制，可以根据会话类型应用不同的安全策略：

```typescript
// 沙箱配置示例
export type AgentSandboxConfig = {
  mode?: "off" | "non-main";  // "non-main" 对非主会话启用沙箱
  allowlist?: string[];       // 允许的工具列表
  denylist?: string[];        // 禁止的工具列表
  exec?: {
    security?: "deny" | "allowlist" | "full";  // 执行安全级别
    allowlist?: string[];                       // 允许的命令列表
  };
};

// 沙箱应用逻辑
function applySandboxRules(sessionKey: string, config: AgentSandboxConfig) {
  const isMainSession = sessionKey === "main" || sessionKey.startsWith("main:");
  
  if (config.mode === "non-main" && !isMainSession) {
    // 对非主会话应用沙箱规则
    return {
      allowlist: config.allowlist || ["bash", "process", "read", "write", "edit"],
      denylist: config.denylist || ["browser", "canvas", "nodes", "cron"],
    };
  }
  
  return { allowlist: null, denylist: null }; // 不应用沙箱
}
```

### 安全执行环境

沙箱环境中限制了对敏感操作的访问：

```typescript
// 沙箱工具访问控制
function checkToolAccess(toolName: string, sandboxConfig: SandboxConfig): boolean {
  if (sandboxConfig.allowlist && !sandboxConfig.allowlist.includes(toolName)) {
    return false;  // 不在允许列表中
  }
  
  if (sandboxConfig.denylist && sandboxConfig.denylist.includes(toolName)) {
    return false;  // 在禁止列表中
  }
  
  return true;  // 允许访问
}

// 执行工具时的安全检查
async function secureToolExecution(toolName: string, params: any, sessionContext: SessionContext) {
  const sandboxConfig = sessionContext.sandbox;
  if (!checkToolAccess(toolName, sandboxConfig)) {
    throw new Error(`Tool '${toolName}' is not allowed in current security context`);
  }
  
  // 执行工具
  return await executeTool(toolName, params);
}
```

## 总结

Clawdbot的代理系统是一个复杂而强大的AI交互引擎，具有以下关键特性：

1. **灵活的配置管理**：支持多代理配置和模型选择
2. **健壮的错误处理**：包含上下文溢出处理和认证失败转移
3. **智能的会话管理**：支持复杂的会话路由和持久化
4. **丰富的工具生态**：提供多种内置工具供AI调用
5. **灵活的安全模型**：支持细粒度的沙箱控制

在下一课中，我们将深入探讨工具系统与扩展机制，包括浏览器控制、Canvas可视化和节点系统等高级功能。