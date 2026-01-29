# 第8课：模型集成与AI接口

## 多模型支持架构

Clawdbot的模型集成架构是其核心特性之一，支持多种AI模型提供商和模型类型。该架构设计旨在提供灵活性、可靠性和高性能。

### 模型提供商抽象层

Clawdbot通过统一的接口抽象了不同的AI模型提供商，使得切换和使用不同的模型变得更加容易：

```typescript
// 模型提供商接口
export interface ModelProvider {
  id: string;
  name: string;
  capabilities: ModelCapabilities;
  initialize(config: ProviderConfig): Promise<void>;
  callModel(request: ModelRequest): Promise<ModelResponse>;
  validateConfig(config: ProviderConfig): ValidationResult;
  getModelsList(): Promise<ModelInfo[]>;
}

// 模型请求接口
export interface ModelRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | ToolChoice;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  seed?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  responseFormat?: ResponseFormat;
  reasoning?: boolean;
}

// 模型响应接口
export interface ModelResponse {
  id: string;
  model: string;
  created: number;
  choices: Choice[];
  usage: Usage;
  systemFingerprint?: string;
  headers?: Record<string, string>;
}

// 消息接口
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentPart[];
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

// 内容部分接口（支持多模态）
export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}
```

### 支持的模型提供商

Clawdbot集成了多种主流AI模型提供商：

```typescript
// Anthropic Claude提供商实现
export class AnthropicProvider implements ModelProvider {
  id = 'anthropic';
  name = 'Anthropic';
  
  capabilities: ModelCapabilities = {
    chat: true,
    tools: true,
    vision: true,
    streaming: true,
    functions: false, // Anthropic使用工具而非函数
    reasoning: true   // 支持推理模式
  };
  
  private apiKey: string;
  private client: Anthropic;
  
  async initialize(config: AnthropicProviderConfig): Promise<void> {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }
    
    this.apiKey = config.apiKey;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }
  
  async callModel(request: ModelRequest): Promise<ModelResponse> {
    const params: Anthropic.Params.Messages.Create = {
      model: request.model,
      messages: this.transformMessages(request.messages),
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature,
      top_p: request.topP,
      stop_sequences: request.stop,
      tools: request.tools ? this.transformTools(request.tools) : undefined,
      tool_choice: this.transformToolChoice(request.toolChoice),
      metadata: {
        reasoning: request.reasoning
      }
    };
    
    try {
      const response = await this.client.messages.create(params);
      
      return {
        id: response.id,
        model: response.model,
        created: Date.now(),
        choices: [{
          index: 0,
          message: this.transformResponse(response),
          finish_reason: this.transformFinishReason(response.stop_reason)
        }],
        usage: {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens
        },
        systemFingerprint: response.usage.cache_creation_input_tokens ? 
          `cache_write:${response.usage.cache_creation_input_tokens}` : undefined
      };
    } catch (error) {
      throw new Error(`Anthropic API error: ${(error as Error).message}`);
    }
  }
  
  private transformMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: this.transformContent(msg.content)
    }));
  }
  
  private transformContent(content: string | ContentPart[]): string | Anthropic.ContentBlock[] {
    if (typeof content === 'string') {
      return content;
    }
    
    return content.map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text || '' };
      } else if (part.type === 'image_url') {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: this.getMimeType(part.image_url!.url),
            data: this.extractBase64(part.image_url!.url)
          }
        };
      }
      return { type: 'text', text: '' };
    });
  }
  
  private getMimeType(url: string): string {
    if (url.startsWith('data:image/jpeg')) return 'image/jpeg';
    if (url.startsWith('data:image/png')) return 'image/png';
    if (url.startsWith('data:image/gif')) return 'image/gif';
    return 'image/jpeg'; // 默认
  }
  
  private extractBase64(dataUrl: string): string {
    return dataUrl.split(',')[1] || '';
  }
  
  private transformTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }
  
  private transformToolChoice(toolChoice?: any): Anthropic.ToolChoice | undefined {
    if (!toolChoice) return undefined;
    
    if (typeof toolChoice === 'string') {
      if (toolChoice === 'none') {
        return { type: 'any', name: '' }; // Anthropic equivalent
      }
      return { type: toolChoice as 'auto' | 'any' | 'tool' };
    }
    
    if (toolChoice.function) {
      return { type: 'tool', name: toolChoice.function.name };
    }
    
    return undefined;
  }
  
  private transformResponse(response: Anthropic.Message): Message {
    let content = '';
    const toolCalls: ToolCall[] = [];
    
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
      }
    }
    
    return {
      role: 'assistant',
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  }
  
  private transformFinishReason(reason?: string): string {
    if (!reason) return 'stop';
    // 映射Anthropic的停止原因到标准格式
    const mapping: Record<string, string> = {
      'end_turn': 'stop',
      'stop_sequence': 'stop',
      'max_tokens': 'length',
      'tool_use': 'tool_calls'
    };
    return mapping[reason] || reason;
  }
  
  validateConfig(config: ProviderConfig): ValidationResult {
    const anthropicConfig = config as AnthropicProviderConfig;
    if (!anthropicConfig.apiKey) {
      return { valid: false, errors: ['API key is required for Anthropic provider'] };
    }
    
    return { valid: true };
  }
  
  async getModelsList(): Promise<ModelInfo[]> {
    // Anthropic模型列表
    return [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', maxTokens: 200000, capabilities: ['vision', 'tools'] },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', maxTokens: 200000, capabilities: ['vision', 'tools'] },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', maxTokens: 200000, capabilities: ['vision', 'tools'] },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', maxTokens: 200000, capabilities: ['vision', 'tools'] }
    ];
  }
}

// OpenAI提供商实现
export class OpenAIProvider implements ModelProvider {
  id = 'openai';
  name = 'OpenAI';
  
  capabilities: ModelCapabilities = {
    chat: true,
    tools: true,
    vision: true,
    streaming: true,
    functions: true,  // OpenAI支持函数调用
    reasoning: false  // OpenAI不直接支持推理模式
  };
  
  private apiKey: string;
  private client: OpenAI;
  
  async initialize(config: OpenAIProviderConfig): Promise<void> {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
    
    this.apiKey = config.apiKey;
    this.client = new OpenAI({ apiKey: config.apiKey });
  }
  
  async callModel(request: ModelRequest): Promise<ModelResponse> {
    const params: OpenAI.Chat.ChatCompletionCreateParams = {
      model: request.model,
      messages: this.transformMessages(request.messages),
      tools: request.tools ? this.transformTools(request.tools) : undefined,
      tool_choice: request.toolChoice as any,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: request.stream,
      seed: request.seed,
      top_p: request.topP,
      frequency_penalty: request.frequencyPenalty,
      presence_penalty: request.presencePenalty,
      stop: request.stop
    };
    
    try {
      if (request.stream) {
        // 处理流式响应
        const stream = await this.client.chat.completions.create({
          ...params,
          stream: true
        });
        
        // 收集流式响应
        let fullResponse = '';
        let toolCalls: ToolCall[] = [];
        
        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (choice?.delta?.content) {
            fullResponse += choice.delta.content;
          }
          if (choice?.delta?.tool_calls) {
            // 处理工具调用流
            for (const toolCall of choice.delta.tool_calls) {
              if (toolCall.index !== undefined) {
                if (!toolCalls[toolCall.index]) {
                  toolCalls[toolCall.index] = {
                    id: toolCall.id || '',
                    type: 'function',
                    function: { name: '', arguments: '' }
                  };
                }
                
                if (toolCall.function?.name) {
                  toolCalls[toolCall.index].function.name += toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                }
              }
            }
          }
        }
        
        return {
          id: 'stream-' + Date.now(),
          model: request.model,
          created: Date.now(),
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: fullResponse,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } // 流式响应中无法准确获得用量
        };
      } else {
        // 处理非流式响应
        const response = await this.client.chat.completions.create(params);
        return response as unknown as ModelResponse;
      }
    } catch (error) {
      throw new Error(`OpenAI API error: ${(error as Error).message}`);
    }
  }
  
  // 其他方法实现类似AnthropicProvider...
  private transformMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content as string,
          tool_call_id: msg.toolCallId || ''
        } as OpenAI.Chat.ChatCompletionMessageParam;
      }
      
      if (typeof msg.content === 'string') {
        return {
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content
        };
      }
      
      // 处理多模态内容
      return {
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content.map(part => {
          if (part.type === 'text') {
            return { type: 'text', text: part.text || '' };
          } else if (part.type === 'image_url') {
            return {
              type: 'image_url',
              image_url: {
                url: part.image_url!.url,
                detail: part.image_url!.detail
              }
            };
          }
          return { type: 'text', text: '' };
        })
      };
    });
  }
  
  private transformTools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
  
  validateConfig(config: ProviderConfig): ValidationResult {
    const openaiConfig = config as OpenAIProviderConfig;
    if (!openaiConfig.apiKey) {
      return { valid: false, errors: ['API key is required for OpenAI provider'] };
    }
    
    return { valid: true };
  }
  
  async getModelsList(): Promise<ModelInfo[]> {
    // 从OpenAI API获取模型列表或使用预定义列表
    return [
      { id: 'gpt-4o', name: 'GPT-4 Omni', maxTokens: 128000, capabilities: ['vision', 'tools'] },
      { id: 'gpt-4o-mini', name: 'GPT-4 Omni Mini', maxTokens: 128000, capabilities: ['vision', 'tools'] },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', maxTokens: 128000, capabilities: ['vision', 'tools'] },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', maxTokens: 16385, capabilities: ['tools'] }
    ];
  }
}

// 模型能力接口
export interface ModelCapabilities {
  chat: boolean;           // 支持聊天
  tools: boolean;          // 支持工具调用
  vision: boolean;         // 支持视觉
  streaming: boolean;      // 支持流式输出
  functions: boolean;      // 支持函数调用
  reasoning: boolean;      // 支持推理模式
}
```

### 模型选择与路由

Clawdbot实现了智能的模型选择和路由机制：

```typescript
// 模型路由器
export class ModelRouter {
  private providers: Map<string, ModelProvider> = new Map();
  private providerPriorities: string[] = [];
  private defaultModel: string;
  
  constructor(defaultModel: string) {
    this.defaultModel = defaultModel;
  }
  
  // 注册提供商
  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }
  
  // 设置提供商优先级
  setProviderPriorities(priorities: string[]): void {
    this.providerPriorities = priorities;
  }
  
  // 解析模型字符串为提供商和模型名
  parseModel(model: string): { provider: string; model: string } {
    if (model.includes('/')) {
      const [provider, ...modelNameParts] = model.split('/');
      return { provider, model: modelNameParts.join('/') };
    }
    
    // 如果没有指定提供商，使用默认逻辑
    const defaultProvider = this.providerPriorities[0] || 'openai';
    return { provider: defaultProvider, model };
  }
  
  // 路由模型请求
  async routeRequest(request: ModelRequest): Promise<ModelResponse> {
    const { provider: providerId, model: modelName } = this.parseModel(request.model);
    
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    
    // 修改请求以使用解析出的模型名
    const modifiedRequest = { ...request, model: modelName };
    
    return await provider.callModel(modifiedRequest);
  }
  
  // 获取模型信息
  async getModelInfo(model: string): Promise<ModelInfo | null> {
    const { provider: providerId, model: modelName } = this.parseModel(model);
    
    const provider = this.providers.get(providerId);
    if (!provider) {
      return null;
    }
    
    try {
      const models = await provider.getModelsList();
      return models.find(m => m.id === modelName) || null;
    } catch (error) {
      console.error(`Failed to get model info for ${model}:`, error);
      return null;
    }
  }
}
```

## 模型故障转移机制

Clawdbot实现了强大的模型故障转移机制，确保在某个模型或提供商不可用时，系统仍能正常运行：

```typescript
// 故障转移管理器
export class FailoverManager {
  private router: ModelRouter;
  private healthChecker: HealthChecker;
  private retryStrategy: RetryStrategy;
  private circuitBreaker: CircuitBreaker;
  
  constructor(router: ModelRouter) {
    this.router = router;
    this.healthChecker = new HealthChecker();
    this.retryStrategy = new ExponentialBackoffRetry(3, 1000, 2);
    this.circuitBreaker = new CircuitBreaker();
  }
  
  async callModelWithFailover(request: ModelRequest): Promise<ModelResponse> {
    // 获取所有可用的备选模型
    const candidates = await this.getCandidateModels(request.model);
    
    let lastError: Error | null = null;
    
    for (const candidate of candidates) {
      try {
        // 检查此候选者是否处于熔断状态
        if (this.circuitBreaker.isTripped(candidate)) {
          console.debug(`Skipping ${candidate} - circuit breaker tripped`);
          continue;
        }
        
        // 检查健康状态
        if (!(await this.healthChecker.isHealthy(candidate))) {
          console.debug(`Skipping ${candidate} - not healthy`);
          continue;
        }
        
        console.debug(`Attempting model: ${candidate}`);
        
        // 尝试调用模型
        const response = await this.router.routeRequest({
          ...request,
          model: candidate
        });
        
        // 调用成功，重置熔断器
        this.circuitBreaker.reset(candidate);
        
        return response;
      } catch (error) {
        lastError = error as Error;
        console.error(`Model ${candidate} failed:`, error);
        
        // 记录故障并可能触发熔断
        this.circuitBreaker.recordFailure(candidate);
        
        // 如果是致命错误（如认证失败），立即停止尝试其他模型
        if (this.isFatalError(error)) {
          throw error;
        }
      }
    }
    
    // 如果所有候选者都失败了，抛出最后一个错误
    throw lastError || new Error(`All model candidates failed for request`);
  }
  
  // 获取候选模型列表
  private async getCandidateModels(primaryModel: string): Promise<string[]> {
    const { provider: primaryProvider, model: primaryModelName } = this.router.parseModel(primaryModel);
    
    // 首先尝试主模型
    const candidates = [primaryModel];
    
    // 根据提供商添加备用模型
    switch (primaryProvider) {
      case 'openai':
        candidates.push(
          'openai/gpt-4o-mini',
          'openai/gpt-3.5-turbo'
        );
        break;
      case 'anthropic':
        candidates.push(
          'anthropic/claude-3-5-sonnet-20241022',
          'anthropic/claude-3-sonnet-20240229'
        );
        break;
      default:
        // 添加通用备选方案
        candidates.push(
          'openai/gpt-4o',
          'anthropic/claude-3-5-sonnet-20241022'
        );
    }
    
    // 去重并返回
    return [...new Set(candidates)];
  }
  
  // 检查是否为致命错误
  private isFatalError(error: unknown): boolean {
    const errorMsg = (error as Error).message.toLowerCase();
    
    // 认证错误是致命的
    if (errorMsg.includes('authentication') || errorMsg.includes('api key')) {
      return true;
    }
    
    // 模型不存在通常是致命的
    if (errorMsg.includes('model') && errorMsg.includes('does not exist')) {
      return true;
    }
    
    return false;
  }
}

// 健康检查器
class HealthChecker {
  private healthStatus: Map<string, { healthy: boolean; lastChecked: number }> = new Map();
  private checkInterval = 30000; // 30秒
  
  async isHealthy(model: string): Promise<boolean> {
    const cached = this.healthStatus.get(model);
    
    // 如果缓存的健康状态较新（少于30秒），直接返回
    if (cached && Date.now() - cached.lastChecked < this.checkInterval) {
      return cached.healthy;
    }
    
    // 执行健康检查
    const healthy = await this.performHealthCheck(model);
    
    this.healthStatus.set(model, {
      healthy,
      lastChecked: Date.now()
    });
    
    return healthy;
  }
  
  private async performHealthCheck(model: string): Promise<boolean> {
    try {
      // 执行一个简单的ping请求来检查模型可用性
      // 这里可以实现一个轻量级的测试请求
      return true; // 简化实现
    } catch {
      return false;
    }
  }
}

// 重试策略接口
interface RetryStrategy {
  getNextDelay(attempt: number): number;
  shouldRetry(error: Error, attempt: number): boolean;
}

// 指数退避重试策略
class ExponentialBackoffRetry implements RetryStrategy {
  private maxRetries: number;
  private baseDelay: number;
  private multiplier: number;
  
  constructor(maxRetries: number, baseDelay: number, multiplier: number) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.multiplier = multiplier;
  }
  
  getNextDelay(attempt: number): number {
    return this.baseDelay * Math.pow(this.multiplier, attempt - 1);
  }
  
  shouldRetry(error: Error, attempt: number): boolean {
    if (attempt >= this.maxRetries) {
      return false;
    }
    
    const errorMsg = error.message.toLowerCase();
    
    // 对于某些类型的错误进行重试
    return errorMsg.includes('timeout') || 
           errorMsg.includes('rate limit') || 
           errorMsg.includes('server error') ||
           errorMsg.includes('503') || 
           errorMsg.includes('504');
  }
}

// 熔断器
class CircuitBreaker {
  private states: Map<string, CircuitState> = new Map();
  private failureThreshold = 5;
  private timeout = 60000; // 60秒后尝试恢复
  
  isTripped(model: string): boolean {
    const state = this.states.get(model);
    if (!state) return false;
    
    // 如果处于开启状态并且尚未超时，则熔断
    if (state.state === 'OPEN' && Date.now() - state.lastFailure < this.timeout) {
      return true;
    }
    
    // 如果超时了，进入半开状态
    if (state.state === 'OPEN' && Date.now() - state.lastFailure >= this.timeout) {
      this.states.set(model, { ...state, state: 'HALF_OPEN' });
      return false;
    }
    
    return false;
  }
  
  recordFailure(model: string): void {
    let state = this.states.get(model) || { 
      state: 'CLOSED', 
      failureCount: 0, 
      lastFailure: 0 
    };
    
    state.failureCount++;
    state.lastFailure = Date.now();
    
    if (state.failureCount >= this.failureThreshold) {
      state.state = 'OPEN';
    }
    
    this.states.set(model, state);
  }
  
  reset(model: string): void {
    this.states.set(model, {
      state: 'CLOSED',
      failureCount: 0,
      lastFailure: 0
    });
  }
}

interface CircuitState {
  state: 'OPEN' | 'CLOSED' | 'HALF_OPEN';
  failureCount: number;
  lastFailure: number;
}
```

## 提示工程与模板系统

Clawdbot提供了强大的提示工程和模板系统，以优化与AI模型的交互：

```typescript
// 提示模板系统
export class PromptTemplateSystem {
  private templates: Map<string, PromptTemplate> = new Map();
  private templateEngine: TemplateEngine;
  
  constructor() {
    this.templateEngine = new MustacheTemplateEngine(); // 使用Mustache模板引擎
    this.registerDefaultTemplates();
  }
  
  // 注册提示模板
  registerTemplate(template: PromptTemplate): void {
    this.templates.set(template.name, template);
  }
  
  // 渲染提示模板
  renderTemplate(name: string, context: Record<string, any>): string {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`Template not found: ${name}`);
    }
    
    return this.templateEngine.render(template.content, {
      ...context,
      // 添加辅助函数
      helpers: {
        formatDate: (date: Date) => date.toISOString(),
        truncate: (str: string, len: number) => str.substring(0, len) + (str.length > len ? '...' : ''),
        join: (arr: string[], separator: string = ', ') => arr.join(separator)
      }
    });
  }
  
  // 注册默认模板
  private registerDefaultTemplates(): void {
    // 系统提示模板
    this.registerTemplate({
      name: 'system-prompt',
      content: `
You are {{agentName}}, a helpful AI assistant created by {{creator}}.
Current date and time: {{currentTime}}
{{#customInstructions}}
{{.}}
{{/customInstructions}}

Your capabilities include:
{{#capabilities}}
- {{.}}
{{/capabilities}}

Always respond in {{responseLanguage}}.
      `.trim(),
      description: 'Default system prompt template'
    });
    
    // 工具使用提示模板
    this.registerTemplate({
      name: 'tool-use-prompt',
      content: `
You have access to the following tools:

{{#tools}}
Tool Name: {{name}}
Description: {{description}}
Parameters: {{parameters}}
---
{{/tools}}

When you need to use a tool, respond with a JSON object in the following format:
{"tool_name": "...", "arguments": {...}}

Only use tools when necessary to fulfill the user's request.
      `.trim(),
      description: 'Template for tool usage instructions'
    });
    
    // 内存检索提示模板
    this.registerTemplate({
      name: 'memory-query-prompt',
      content: `
Based on the user's query: "{{query}}"

Relevant context from memory:
{{#memoryFacts}}
- {{content}}
{{/memoryFacts}}

Use this information to provide a more personalized and informed response.
      `.trim(),
      description: 'Template for incorporating retrieved memory'
    });
  }
}

// 提示模板接口
interface PromptTemplate {
  name: string;
  content: string;
  description: string;
  variables?: string[];
}

// 模板引擎接口
interface TemplateEngine {
  render(template: string, context: Record<string, any>): string;
}

// Mustache模板引擎实现
class MustacheTemplateEngine implements TemplateEngine {
  render(template: string, context: Record<string, any>): string {
    // 简化的Mustache实现
    // 在实际实现中，这里会使用真正的Mustache库
    let result = template;
    
    // 处理变量替换
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), String(value));
      }
    }
    
    // 处理简单条件和循环（简化版）
    // 这里只是概念性的实现，实际应该使用完整的模板引擎
    
    return result;
  }
}
```

## 使用量跟踪与计费

Clawdbot实现了详细的使用量跟踪和计费功能：

```typescript
// 使用量跟踪器
export class UsageTracker {
  private storage: UsageStorage;
  private pricing: PricingModel;
  
  constructor(storage: UsageStorage, pricing: PricingModel) {
    this.storage = storage;
    this.pricing = pricing;
  }
  
  // 记录使用量
  async recordUsage(record: UsageRecord): Promise<void> {
    // 计算成本
    const cost = this.calculateCost(record);
    record.cost = cost;
    
    // 保存记录
    await this.storage.save(record);
  }
  
  // 计算使用量成本
  private calculateCost(record: UsageRecord): number {
    const modelInfo = this.pricing.getModelPricing(record.model);
    if (!modelInfo) {
      return 0; // 未知模型，不收费
    }
    
    let cost = 0;
    
    // 输入token成本
    if (record.inputTokens && modelInfo.inputPricePerMillion) {
      cost += (record.inputTokens / 1_000_000) * modelInfo.inputPricePerMillion;
    }
    
    // 输出token成本
    if (record.outputTokens && modelInfo.outputPricePerMillion) {
      cost += (record.outputTokens / 1_000_000) * modelInfo.outputPricePerMillion;
    }
    
    // 次数成本（如果有）
    if (modelInfo.perCallPrice) {
      cost += modelInfo.perCallPrice;
    }
    
    return cost;
  }
  
  // 获取使用量报告
  async getUsageReport(filter: UsageFilter): Promise<UsageReport> {
    const records = await this.storage.query(filter);
    
    const report: UsageReport = {
      periodStart: filter.startDate,
      periodEnd: filter.endDate,
      totalRequests: records.length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      breakdown: {}
    };
    
    for (const record of records) {
      report.totalInputTokens += record.inputTokens || 0;
      report.totalOutputTokens += record.outputTokens || 0;
      report.totalCost += record.cost || 0;
      
      // 按模型分类统计
      const model = record.model;
      if (!report.breakdown[model]) {
        report.breakdown[model] = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0
        };
      }
      
      const modelStats = report.breakdown[model];
      modelStats.requests++;
      modelStats.inputTokens += record.inputTokens || 0;
      modelStats.outputTokens += record.outputTokens || 0;
      modelStats.cost += record.cost || 0;
    }
    
    return report;
  }
}

// 使用量记录接口
interface UsageRecord {
  id: string;
  timestamp: Date;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

// 使用量过滤器
interface UsageFilter {
  startDate: Date;
  endDate: Date;
  userId?: string;
  model?: string;
  provider?: string;
}

// 使用量报告
interface UsageReport {
  periodStart: Date;
  periodEnd: Date;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  breakdown: Record<string, ModelUsageStats>;
}

interface ModelUsageStats {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

// 定价模型
interface PricingModel {
  getModelPricing(model: string): ModelPricing | undefined;
}

interface ModelPricing {
  inputPricePerMillion: number;   // 每百万输入token的价格
  outputPricePerMillion: number;  // 每百万输出token的价格
  perCallPrice: number;          // 每次调用的价格
}

// 使用量存储接口
interface UsageStorage {
  save(record: UsageRecord): Promise<void>;
  query(filter: UsageFilter): Promise<UsageRecord[]>;
  getTotalUsage(filter: UsageFilter): Promise<number>;
}
```

## 总结

Clawdbot的模型集成与AI接口系统提供了全面的AI模型管理能力，具有以下关键特性：

1. **多提供商支持**：统一接口抽象了不同AI模型提供商
2. **智能路由**：根据需求和可用性自动选择最佳模型
3. **故障转移**：在模型或提供商不可用时自动切换
4. **提示工程**：灵活的模板系统优化AI交互
5. **使用量跟踪**：详细的用量统计和计费功能
6. **性能优化**：缓存、异步处理和批量操作

这种设计确保了Clawdbot能够充分利用各种AI模型的能力，同时提供高可用性和成本效益。

在下一课中，我们将探讨安全模型与权限控制，了解Clawdbot如何保护用户数据和系统安全。