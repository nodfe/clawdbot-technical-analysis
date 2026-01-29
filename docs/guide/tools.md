# 第5课：工具系统与扩展机制

## 内置工具系统

Clawdbot的工具系统是其强大功能的核心，允许AI代理与外部系统进行交互。这些工具通过标准化的接口暴露给AI模型，使其能够执行各种操作。

### 工具注册与管理

Clawdbot的工具系统通过一个中心化的工具注册表进行管理：

```typescript
// 工具注册示例
export interface ToolDefinition {
  name: string;                    // 工具名称
  description: string;             // 工具描述
  parameters: object;              // 参数定义（JSON Schema格式）
  handler: (params: any) => any;   // 执行处理器
  securityLevel: 'safe' | 'user_confirm' | 'admin_only'; // 安全级别
}

// 工具注册过程
class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  
  register(toolDef: ToolDefinition): void {
    if (this.tools.has(toolDef.name)) {
      throw new Error(`Tool ${toolDef.name} is already registered`);
    }
    this.tools.set(toolDef.name, toolDef);
  }
  
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}
```

### 核心工具实现

#### 1. 文件系统工具

文件系统工具是Clawdbot的基础工具，包括读取、写入和编辑文件：

```typescript
// 文件读取工具
export const readFileTool = {
  name: "read",
  description: "Read the contents of a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to read" },
      limit: { type: "number", description: "Maximum number of lines to read" },
      offset: { type: "number", description: "Line number to start reading from" }
    },
    required: ["path"]
  },
  handler: async (params) => {
    const { path, limit, offset } = params;
    const fullPath = resolveUserPath(path);
    
    // 安全检查：确保路径在允许范围内
    if (!isPathInWorkspace(fullPath)) {
      throw new Error("Access denied: path outside allowed workspace");
    }
    
    // 读取文件内容
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    
    // 应用偏移和限制
    const filteredLines = lines.slice(offset || 0, limit ? (offset || 0) + limit : undefined);
    
    return {
      success: true,
      content: filteredLines.join('\n'),
      stats: {
        totalLines: lines.length,
        returnedLines: filteredLines.length
      }
    };
  }
};

// 文件写入工具
export const writeFileTool = {
  name: "write",
  description: "Write content to a file (creates or overwrites)",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write" },
      content: { type: "string", description: "Content to write to the file" }
    },
    required: ["path", "content"]
  },
  handler: async (params) => {
    const { path, content } = params;
    const fullPath = resolveUserPath(path);
    
    // 安全检查：确保路径在允许范围内
    if (!isPathInWorkspace(fullPath)) {
      throw new Error("Access denied: path outside allowed workspace");
    }
    
    // 创建必要的目录
    const dirPath = dirname(fullPath);
    await fs.mkdir(dirPath, { recursive: true });
    
    // 写入文件
    await fs.writeFile(fullPath, content, 'utf-8');
    
    return {
      success: true,
      path: fullPath,
      bytesWritten: Buffer.byteLength(content)
    };
  }
};
```

#### 2. 执行工具

执行工具允许运行系统命令，这是最强大的工具之一，但也最需要安全控制：

```typescript
// 执行工具实现
export const execTool = {
  name: "exec",
  description: "Execute shell commands",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      timeout: { type: "number", description: "Timeout in seconds (optional)" },
      elevated: { type: "boolean", description: "Run with elevated permissions (if allowed)" },
      security: { 
        type: "string", 
        enum: ["deny", "allowlist", "full"],
        description: "Security mode for command execution"
      }
    },
    required: ["command"]
  },
  handler: async (params) => {
    const { command, timeout, elevated, security } = params;
    
    // 安全检查：根据安全模式验证命令
    const securityCheck = validateCommand(command, security);
    if (!securityCheck.allowed) {
      throw new Error(`Command blocked by security policy: ${securityCheck.reason}`);
    }
    
    // 如果需要提升权限，检查是否被允许
    if (elevated && !isElevationAllowed()) {
      throw new Error("Elevated permissions not allowed for this session");
    }
    
    // 执行命令
    const execResult = await executeCommand({
      command,
      timeout: timeout || 30, // 默认30秒超时
      elevated
    });
    
    return {
      success: execResult.success,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      exitCode: execResult.exitCode,
      executionTimeMs: execResult.executionTime
    };
  }
};

// 安全验证函数
function validateCommand(command: string, securityMode: string): { allowed: boolean; reason?: string } {
  if (securityMode === "deny") {
    // 完全禁止执行
    return { allowed: false, reason: "All command execution is disabled" };
  }
  
  if (securityMode === "allowlist") {
    // 检查命令是否在允许列表中
    const allowedCommands = ["ls", "cat", "grep", "find", "echo", "date"];
    const cmdParts = command.trim().split(/\s+/);
    const primaryCmd = cmdParts[0].replace(/[^\w\-]/g, ''); // 移除非字母数字字符
    
    if (!allowedCommands.includes(primaryCmd)) {
      return { 
        allowed: false, 
        reason: `Command '${primaryCmd}' not in allowlist` 
      };
    }
  }
  
  // 检查危险操作
  if (command.includes('rm -rf') || command.includes('/dev/null')) {
    return { 
      allowed: false, 
      reason: "Dangerous operation detected" 
    };
  }
  
  return { allowed: true };
}
```

## 浏览器控制工具

浏览器控制工具是Clawdbot的一大特色，提供了强大的网页自动化能力：

```typescript
// 浏览器工具实现
export const browserTool = {
  name: "browser",
  description: "Control the browser via Clawdbot's browser control server",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["status", "start", "stop", "open", "snapshot", "screenshot", "navigate", "act"],
        description: "Browser action to perform"
      },
      url: { type: "string", description: "URL for open/navigate actions" },
      targetId: { type: "string", description: "Specific tab to target" },
      request: {
        type: "object",
        description: "Action request parameters",
        properties: {
          kind: { type: "string", enum: ["click", "type", "fill", "hover", "drag"] },
          ref: { type: "string", description: "Element reference" },
          text: { type: "string", description: "Text for type/fill actions" }
        }
      }
    },
    required: ["action"]
  },
  handler: async (params) => {
    const { action, url, targetId, request } = params;
    
    switch (action) {
      case "status":
        return await getBrowserStatus();
      
      case "start":
        return await startBrowserInstance();
      
      case "open":
        if (!url) throw new Error("URL is required for open action");
        return await openUrlInBrowser(url);
      
      case "navigate":
        if (!url) throw new Error("URL is required for navigate action");
        return await navigateBrowserTab(targetId, url);
      
      case "snapshot":
        return await getTabSnapshot(targetId);
      
      case "act":
        if (!request) throw new Error("Request is required for act action");
        return await performBrowserAction(targetId, request);
      
      default:
        throw new Error(`Unsupported browser action: ${action}`);
    }
  }
};

// 浏览器动作处理器
async function performBrowserAction(targetId: string, request: any) {
  const { kind, ref, text } = request;
  
  switch (kind) {
    case "click":
      return await clickElement(targetId, ref);
    
    case "fill":
    case "type":
      if (!text) throw new Error("Text is required for fill/type actions");
      return await fillInput(targetId, ref, text);
    
    case "hover":
      return await hoverElement(targetId, ref);
    
    case "drag":
      return await dragElement(targetId, ref, request.targetRef);
    
    default:
      throw new Error(`Unsupported browser action kind: ${kind}`);
  }
}
```

## Canvas可视化系统

Canvas系统为Clawdbot提供了可视化的交互界面，允许AI代理控制和展示视觉内容：

```typescript
// Canvas工具实现
export const canvasTool = {
  name: "canvas",
  description: "Control node canvases (present/hide/navigate/eval/snapshot/A2UI)",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["present", "hide", "navigate", "eval", "snapshot", "a2ui_push", "a2ui_reset"],
        description: "Canvas action to perform"
      },
      url: { type: "string", description: "URL for navigate action" },
      javaScript: { type: "string", description: "JavaScript code for eval action" },
      node: { type: "string", description: "Target node ID" },
      quality: { type: "number", description: "Quality for snapshot (1-100)" }
    },
    required: ["action"]
  },
  handler: async (params) => {
    const { action, url, javaScript, node, quality } = params;
    
    switch (action) {
      case "present":
        return await presentCanvas(node);
      
      case "hide":
        return await hideCanvas(node);
      
      case "navigate":
        if (!url) throw new Error("URL is required for navigate action");
        return await navigateCanvas(node, url);
      
      case "eval":
        if (!javaScript) throw new Error("JavaScript is required for eval action");
        return await evaluateCanvasJS(node, javaScript);
      
      case "snapshot":
        return await captureCanvasSnapshot(node, quality);
      
      case "a2ui_push":
        return await pushA2UIContent(node, params.jsonl || params.jsonlPath);
      
      case "a2ui_reset":
        return await resetA2UI(node);
      
      default:
        throw new Error(`Unsupported canvas action: ${action}`);
    }
  }
};

// A2UI（AI-to-UI）推送功能
async function pushA2UIContent(nodeId: string, content: string | object) {
  // A2UI是一种AI驱动的UI协议，允许AI代理动态生成UI元素
  const a2uiPayload = typeof content === 'string' ? 
    JSON.parse(content) : content;
  
  return await sendA2UICommand(nodeId, {
    type: 'push',
    payload: a2uiPayload
  });
}
```

## 节点(Node)系统

节点系统允许Clawdbot与远程设备（如手机、平板等）进行交互：

```typescript
// 节点工具实现
export const nodesTool = {
  name: "nodes",
  description: "Discover and control paired nodes (status/describe/pairing/notify/camera/screen/location/run)",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "status", "describe", "pending", "approve", "reject", "notify", 
          "camera_snap", "camera_list", "camera_clip", "screen_record", 
          "location_get", "run"
        ],
        description: "Node action to perform"
      },
      deviceId: { type: "string", description: "Target device ID" },
      body: { type: "string", description: "Notification body" },
      title: { type: "string", description: "Notification title" },
      facing: { 
        type: "string", 
        enum: ["front", "back", "both"], 
        description: "Camera facing direction"
      },
      duration: { type: "string", description: "Recording duration" }
    },
    required: ["action"]
  },
  handler: async (params) => {
    const { action, deviceId, body, title, facing, duration } = params;
    
    switch (action) {
      case "status":
        return await getNodeStatus(deviceId);
      
      case "describe":
        return await describeNode(deviceId);
      
      case "notify":
        if (!body) throw new Error("Body is required for notify action");
        return await sendNotification(deviceId, title, body);
      
      case "camera_snap":
        return await takeCameraSnap(deviceId, facing);
      
      case "camera_list":
        return await listCameras(deviceId);
      
      case "screen_record":
        return await startScreenRecord(deviceId, duration);
      
      case "location_get":
        return await getLocation(deviceId);
      
      case "run":
        return await runOnNode(deviceId, params.command);
      
      default:
        throw new Error(`Unsupported node action: ${action}`);
    }
  }
};

// 节点通信协议
class NodeCommunicator {
  private connections: Map<string, WebSocket> = new Map();
  
  async connectToDevice(deviceId: string, pairingCode: string): Promise<boolean> {
    // 建立到节点设备的安全WebSocket连接
    const wsUrl = `ws://${await resolveNodeAddress(deviceId)}/api/v1/ws`;
    const ws = new WebSocket(wsUrl);
    
    // 验证配对码
    await authenticateConnection(ws, pairingCode);
    
    this.connections.set(deviceId, ws);
    return true;
  }
  
  async sendCommand(deviceId: string, command: string, params: any): Promise<any> {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      throw new Error(`No connection to device ${deviceId}`);
    }
    
    // 发送命令并等待响应
    return await sendAndWaitForResponse(connection, {
      command,
      params,
      id: generateRequestId()
    });
  }
}
```

## 工具扩展机制

Clawdbot提供了灵活的工具扩展机制，允许开发者创建自定义工具：

```typescript
// 工具扩展接口
export interface CustomTool {
  name: string;
  description: string;
  parameters: object;
  execute: (params: any, context: ToolExecutionContext) => Promise<any>;
  validate?: (params: any) => { valid: boolean; errors?: string[] };
  authorize?: (context: AuthorizationContext) => boolean;
}

// 工具注册器
class ToolRegistrar {
  static registerCustomTool(tool: CustomTool): void {
    // 验证工具定义
    if (!this.validateToolDefinition(tool)) {
      throw new Error(`Invalid tool definition: ${tool.name}`);
    }
    
    // 注册工具到全局工具库
    globalToolRegistry.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      handler: async (params, context) => {
        // 执行前置验证
        if (tool.validate) {
          const validation = tool.validate(params);
          if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors?.join(', ')}`);
          }
        }
        
        // 执行权限检查
        if (tool.authorize && !tool.authorize(context.authorization)) {
          throw new Error("Unauthorized access to tool");
        }
        
        // 执行工具
        return await tool.execute(params, context);
      }
    });
  }
  
  private static validateToolDefinition(tool: CustomTool): boolean {
    return !!(
      tool.name &&
      tool.description &&
      tool.parameters &&
      typeof tool.execute === 'function'
    );
  }
}

// 示例：自定义天气查询工具
const weatherTool: CustomTool = {
  name: "get_weather",
  description: "Get current weather information for a location",
  parameters: {
    type: "object",
    properties: {
      location: { type: "string", description: "City or location to get weather for" },
      units: { 
        type: "string", 
        enum: ["metric", "imperial"], 
        description: "Units for temperature (metric=Celsius, imperial=Fahrenheit)"
      }
    },
    required: ["location"]
  },
  execute: async (params, context) => {
    const { location, units = "metric" } = params;
    
    // 使用天气API获取数据
    const weatherData = await fetchWeatherData(location, units);
    
    return {
      location: weatherData.location,
      temperature: weatherData.temperature,
      conditions: weatherData.conditions,
      humidity: weatherData.humidity,
      windSpeed: weatherData.windSpeed,
      timestamp: new Date().toISOString()
    };
  },
  validate: (params) => {
    if (!params.location || typeof params.location !== 'string') {
      return { valid: false, errors: ["Location is required and must be a string"] };
    }
    return { valid: true };
  }
};

// 注册自定义工具
ToolRegistrar.registerCustomTool(weatherTool);
```

## 安全与权限控制

Clawdbot的工具系统具有多层安全控制机制：

```typescript
// 权限管理器
class PermissionManager {
  private readonly permissionPolicies: Map<string, PermissionPolicy> = new Map();
  
  async checkPermission(
    userId: string, 
    toolName: string, 
    sessionContext: SessionContext
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = this.permissionPolicies.get(toolName) || 
                  this.getDefaultPolicy(toolName);
    
    // 检查用户权限
    if (!this.userHasRole(userId, policy.requiredRoles)) {
      return { 
        allowed: false, 
        reason: `User lacks required roles: ${policy.requiredRoles.join(', ')}` 
      };
    }
    
    // 检查会话上下文
    if (sessionContext.isSandboxed && !policy.allowedInSandbox) {
      return { 
        allowed: false, 
        reason: `Tool not allowed in sandboxed environment` 
      };
    }
    
    // 检查资源限制
    if (await this.exceedsResourceLimits(userId, toolName)) {
      return { 
        allowed: false, 
        reason: `Resource limits exceeded for tool: ${toolName}` 
      };
    }
    
    return { allowed: true };
  }
  
  private getDefaultPolicy(toolName: string): PermissionPolicy {
    // 根据工具名称确定默认安全策略
    if (['read', 'write', 'edit'].includes(toolName)) {
      return {
        requiredRoles: ['user'],
        allowedInSandbox: true,
        resourceLimits: { maxFiles: 10, maxSizeMB: 10 }
      };
    } else if (toolName === 'exec') {
      return {
        requiredRoles: ['admin'],
        allowedInSandbox: false,
        resourceLimits: { maxProcesses: 1, maxRuntimeSec: 30 }
      };
    }
    
    return {
      requiredRoles: ['user'],
      allowedInSandbox: true,
      resourceLimits: {}
    };
  }
}

// 资源限制器
class ResourceLimiter {
  private readonly usageTracker: UsageTracker = new UsageTracker();
  
  async enforceLimits(userId: string, toolName: string, params: any): Promise<void> {
    // 检查执行频率限制
    if (await this.checkRateLimit(userId, toolName)) {
      throw new Error(`Rate limit exceeded for tool: ${toolName}`);
    }
    
    // 检查资源使用量
    if (await this.checkResourceUsage(userId, toolName, params)) {
      throw new Error(`Resource limit exceeded for tool: ${toolName}`);
    }
    
    // 记录使用情况
    await this.usageTracker.recordUsage(userId, toolName, params);
  }
  
  private async checkRateLimit(userId: string, toolName: string): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - 60000; // 1分钟窗口
    
    const recentCalls = await this.usageTracker.getRecentUsage(
      userId, 
      toolName, 
      windowStart
    );
    
    const limits = this.getRateLimits(toolName);
    return recentCalls.length > limits.maxPerMinute;
  }
}
```

## 总结

Clawdbot的工具系统是一个功能强大且高度可扩展的框架，具有以下关键特性：

1. **丰富的内置工具**：提供了文件系统、执行、浏览器、Canvas、节点等多种工具
2. **安全的权限控制**：多层安全机制确保工具使用的安全性
3. **灵活的扩展机制**：支持自定义工具开发和注册
4. **统一的接口标准**：所有工具遵循相同的接口规范
5. **资源管理**：内置资源限制和用量跟踪机制

在下一课中，我们将深入探讨技能(Skills)系统与插件架构，了解如何创建和管理可重用的功能模块。