# 第7课：内存与状态管理

## 内存管理系统

Clawdbot的内存管理系统是其智能交互能力的核心，它不仅负责存储对话历史，还管理长期记忆、上下文信息和状态数据。该系统设计考虑了性能、持久性和扩展性。

### 内存架构概览

内存系统分为几个层次：

1. **短期记忆**：当前会话的对话历史
2. **中期记忆**：跨会话的上下文信息
3. **长期记忆**：持久化的知识和个人信息

```typescript
// 内存系统接口定义
export interface MemorySystem {
  // 短期记忆管理
  getSessionMemory(sessionId: string): SessionMemory;
  saveSessionMemory(sessionId: string, memory: SessionMemory): Promise<void>;
  clearSessionMemory(sessionId: string): Promise<void>;
  
  // 长期记忆管理
  storeMemory(memory: MemoryEntry): Promise<string>;
  retrieveMemories(query: string, options?: MemoryQueryOptions): Promise<MemoryEntry[]>;
  updateMemory(memoryId: string, updates: Partial<MemoryEntry>): Promise<void>;
  deleteMemory(memoryId: string): Promise<void>;
  
  // 记忆压缩与管理
  compactMemory(sessionId: string): Promise<CompactResult>;
  pruneOldMemories(retentionPolicy: RetentionPolicy): Promise<void>;
}

// 内存条目定义
export interface MemoryEntry {
  id: string;
  type: 'fact' | 'experience' | 'preference' | 'knowledge';
  content: string;
  embedding?: number[];           // 语义向量表示
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  importance: number;             // 重要性评分 (0-1)
  relevance: number;              // 相关性评分 (0-1)
  sourceSession?: string;         // 来源会话
  expiresAt?: Date;              // 过期时间
}

// 会话内存定义
export interface SessionMemory {
  sessionId: string;
  history: Message[];
  context: Record<string, any>;
  metadata: SessionMetadata;
  createdAt: Date;
  lastAccessed: Date;
  size: number;                   // 内存大小（字节）
  tokenCount: number;             // Token数量
}
```

### 会话持久化

会话持久化是内存系统的重要组成部分，确保对话历史在重启后仍然可用：

```typescript
// 会话存储管理器
export class SessionStorageManager {
  private storagePath: string;
  private cache: Map<string, SessionMemory> = new Map();
  private maxCacheSize: number;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  
  constructor(storagePath: string, options: { maxCacheSize?: number; autoSaveIntervalMs?: number } = {}) {
    this.storagePath = storagePath;
    this.maxCacheSize = options.maxCacheSize ?? 100; // 默认缓存100个会话
    
    // 确保存储目录存在
    fs.mkdirSync(this.storagePath, { recursive: true });
    
    // 设置自动保存间隔
    if (options.autoSaveIntervalMs) {
      this.autoSaveInterval = setInterval(() => {
        this.flushCache();
      }, options.autoSaveIntervalMs);
    }
  }
  
  // 获取会话内存
  async getSession(sessionId: string): Promise<SessionMemory | null> {
    // 首先检查缓存
    if (this.cache.has(sessionId)) {
      const session = this.cache.get(sessionId)!;
      session.lastAccessed = new Date();
      return session;
    }
    
    // 从磁盘加载
    const sessionPath = this.getSessionPath(sessionId);
    try {
      const content = await fs.readFile(sessionPath, 'utf-8');
      const session = JSON.parse(content) as SessionMemory;
      
      // 验证和修复会话数据
      const validatedSession = this.validateAndRepairSession(session);
      
      // 添加到缓存
      if (this.cache.size >= this.maxCacheSize) {
        // 简单的LRU策略：删除最早访问的项
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) {
          this.cache.delete(oldestKey);
        }
      }
      
      this.cache.set(sessionId, validatedSession);
      return validatedSession;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 会话文件不存在
        return null;
      }
      throw error;
    }
  }
  
  // 保存会话内存
  async saveSession(sessionId: string, session: SessionMemory): Promise<void> {
    // 更新元数据
    session.updatedAt = new Date();
    session.lastAccessed = new Date();
    
    // 验证会话大小
    const serialized = JSON.stringify(session);
    session.size = Buffer.byteLength(serialized);
    
    // 添加到缓存
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(sessionId, session);
    
    // 立即保存到磁盘
    const sessionPath = this.getSessionPath(sessionId);
    await fs.writeFile(sessionPath, serialized, 'utf-8');
  }
  
  // 删除会话
  async deleteSession(sessionId: string): Promise<void> {
    // 从缓存中删除
    this.cache.delete(sessionId);
    
    // 从磁盘删除
    const sessionPath = this.getSessionPath(sessionId);
    try {
      await fs.unlink(sessionPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  
  // 验证和修复会话
  private validateAndRepairSession(session: SessionMemory): SessionMemory {
    // 确保必需字段存在
    if (!session.metadata) {
      session.metadata = {
        agentId: 'default',
        channelId: 'unknown',
        createdAt: session.createdAt,
        lastActivity: session.lastAccessed
      };
    }
    
    // 验证历史记录
    if (!Array.isArray(session.history)) {
      session.history = [];
    }
    
    // 计算token数量（简化版本）
    session.tokenCount = this.calculateTokenCount(session.history);
    
    // 计算大小
    const serialized = JSON.stringify(session);
    session.size = Buffer.byteLength(serialized);
    
    return session;
  }
  
  // 计算token数量
  private calculateTokenCount(messages: Message[]): number {
    // 简化的token计算 - 实际实现可能使用更精确的tokenizer
    const text = messages.map(msg => msg.content).join(' ');
    return Math.ceil(text.length / 4); // 粗略估算
  }
  
  // 获取会话文件路径
  private getSessionPath(sessionId: string): string {
    return path.join(this.storagePath, `${sessionId}.json`);
  }
  
  // 刷新缓存到磁盘
  private async flushCache(): Promise<void> {
    for (const [sessionId, session] of this.cache) {
      try {
        const sessionPath = this.getSessionPath(sessionId);
        const serialized = JSON.stringify(session);
        await fs.writeFile(sessionPath, serialized, 'utf-8');
      } catch (error) {
        console.error(`Failed to save session ${sessionId} to disk:`, error);
      }
    }
  }
  
  // 清理资源
  cleanup(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
    this.flushCache();
  }
}
```

### 上下文压缩与管理

为了应对长对话导致的上下文膨胀，Clawdbot实现了智能的上下文压缩机制：

```typescript
// 上下文压缩器
export class ContextCompressor {
  private sessionStorage: SessionStorageManager;
  private maxTokens: number;
  private summaryThreshold: number;
  
  constructor(sessionStorage: SessionStorageManager, options: {
    maxTokens?: number;
    summaryThreshold?: number;
  } = {}) {
    this.sessionStorage = sessionStorage;
    this.maxTokens = options.maxTokens ?? 8000; // 默认最大8000 tokens
    this.summaryThreshold = options.summaryThreshold ?? 0.8; // 80%阈值
  }
  
  // 压缩会话上下文
  async compactSession(sessionId: string, options: {
    targetCompressionRatio?: number;
    preserveRecent?: number;
    summarizeOld?: boolean;
  } = {}): Promise<CompactResult> {
    const session = await this.sessionStorage.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    const originalTokenCount = session.tokenCount;
    
    // 检查是否需要压缩
    if (originalTokenCount < this.maxTokens * this.summaryThreshold) {
      return {
        compressed: false,
        reason: 'Token count below compression threshold',
        originalTokenCount,
        newTokenCount: originalTokenCount,
        compressionRatio: 1
      };
    }
    
    // 确定保留最近的消息数量
    const preserveRecent = options.preserveRecent ?? 10; // 默认保留最近10条消息
    
    // 分离需要保留和可以压缩的消息
    const recentMessages = session.history.slice(-preserveRecent);
    const olderMessages = session.history.slice(0, -preserveRecent);
    
    let compressedMessages: Message[] = [...recentMessages];
    let summaryAdded = false;
    
    if (olderMessages.length > 0 && options.summarizeOld !== false) {
      // 生成摘要
      const summary = await this.generateContextSummary(olderMessages);
      
      // 添加摘要消息
      compressedMessages.unshift({
        id: `summary-${Date.now()}`,
        role: 'system',
        content: `Previous conversation summary: ${summary}`,
        timestamp: new Date(Math.min(...olderMessages.map(m => m.timestamp.getTime())))
      });
      
      summaryAdded = true;
    }
    
    // 创建新的会话对象
    const newSession: SessionMemory = {
      ...session,
      history: compressedMessages,
      tokenCount: this.calculateTokenCount(compressedMessages),
      metadata: {
        ...session.metadata,
        lastCompacted: new Date(),
        compressionCount: (session.metadata.compressionCount || 0) + 1
      }
    };
    
    // 保存压缩后的会话
    await this.sessionStorage.saveSession(sessionId, newSession);
    
    const newTokenCount = newSession.tokenCount;
    const compressionRatio = newTokenCount / originalTokenCount;
    
    return {
      compressed: true,
      reason: summaryAdded ? 'Context summary applied' : 'Messages removed',
      originalTokenCount,
      newTokenCount,
      compressionRatio,
      summaryAdded
    };
  }
  
  // 生成上下文摘要
  private async generateContextSummary(messages: Message[]): Promise<string> {
    // 这里通常会调用AI模型来生成摘要
    // 简化实现：提取关键信息
    const content = messages.map(m => m.content).join('\n');
    
    // 实际实现中，这里会调用语言模型来生成高质量摘要
    // 例如：使用Claude或其他模型来总结对话要点
    
    // 简化版本：返回内容的截断版本
    if (content.length <= 500) {
      return content;
    }
    
    // 提取关键句子（简化实现）
    const sentences = content.split(/[.!?]+/);
    const keySentences = sentences.filter(s => s.trim().length > 10);
    return keySentences.slice(0, 10).join('. ') + '.';
  }
  
  // 计算token数量
  private calculateTokenCount(messages: Message[]): number {
    const text = messages.map(msg => msg.content).join(' ');
    return Math.ceil(text.length / 4); // 粗略估算
  }
}

// 压缩结果接口
export interface CompactResult {
  compressed: boolean;
  reason: string;
  originalTokenCount: number;
  newTokenCount: number;
  compressionRatio: number;
  summaryAdded?: boolean;
}
```

### 记忆机制实现

长期记忆系统允许Clawdbot记住重要信息并在后续交互中使用：

```typescript
// 长期记忆管理器
export class LongTermMemoryManager {
  private memoryStorePath: string;
  private embeddingsEnabled: boolean;
  private maxMemories: number;
  private retentionPolicy: RetentionPolicy;
  
  constructor(options: {
    memoryStorePath: string;
    embeddingsEnabled?: boolean;
    maxMemories?: number;
    retentionPolicy?: RetentionPolicy;
  }) {
    this.memoryStorePath = options.memoryStorePath;
    this.embeddingsEnabled = options.embeddingsEnabled ?? true;
    this.maxMemories = options.maxMemories ?? 10000;
    this.retentionPolicy = options.retentionPolicy ?? {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1年
      minImportance: 0.3,
      autoPrune: true
    };
    
    // 确保存储目录存在
    fs.mkdirSync(this.memoryStorePath, { recursive: true });
  }
  
  // 存储记忆
  async storeMemory(content: string, options: {
    type?: MemoryType;
    tags?: string[];
    importance?: number;
    sourceSession?: string;
    expiresAt?: Date;
  } = {}): Promise<string> {
    const memoryId = this.generateMemoryId();
    
    const memory: MemoryEntry = {
      id: memoryId,
      type: options.type ?? 'fact',
      content,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: options.tags ?? [],
      importance: Math.max(0, Math.min(1, options.importance ?? 0.5)), // 限制在0-1之间
      relevance: 1.0, // 新记忆的相关性最高
      sourceSession: options.sourceSession,
      expiresAt: options.expiresAt
    };
    
    // 计算嵌入向量（如果启用）
    if (this.embeddingsEnabled) {
      memory.embedding = await this.calculateEmbedding(content);
    }
    
    // 保存到存储
    await this.saveMemory(memory);
    
    // 检查是否需要修剪
    if (this.retentionPolicy.autoPrune) {
      await this.pruneOldMemories();
    }
    
    return memoryId;
  }
  
  // 检索记忆
  async retrieveMemories(query: string, options: MemoryQueryOptions = {}): Promise<MemoryEntry[]> {
    // 计算查询的嵌入向量
    let queryEmbedding: number[] | undefined;
    if (this.embeddingsEnabled) {
      queryEmbedding = await this.calculateEmbedding(query);
    }
    
    // 获取所有记忆
    const allMemories = await this.getAllMemories();
    
    // 应用过滤器
    let filteredMemories = allMemories.filter(memory => {
      // 检查过期时间
      if (memory.expiresAt && memory.expiresAt < new Date()) {
        return false;
      }
      
      // 检查类型过滤
      if (options.types && !options.types.includes(memory.type)) {
        return false;
      }
      
      // 检查标签过滤
      if (options.tags && !options.tags.some(tag => memory.tags.includes(tag))) {
        return false;
      }
      
      // 检查最小重要性
      if (options.minImportance && memory.importance < options.minImportance) {
        return false;
      }
      
      return true;
    });
    
    // 使用语义相似度排序（如果有嵌入向量）
    if (queryEmbedding) {
      filteredMemories = filteredMemories.map(memory => {
        if (memory.embedding) {
          const similarity = this.cosineSimilarity(queryEmbedding!, memory.embedding);
          return { ...memory, relevance: similarity };
        }
        return memory;
      }).sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    } else {
      // 回退到关键词匹配
      filteredMemories = filteredMemories.map(memory => {
        const relevance = this.keywordRelevance(query, memory.content);
        return { ...memory, relevance };
      }).sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    }
    
    // 应用数量限制
    if (options.limit) {
      filteredMemories = filteredMemories.slice(0, options.limit);
    }
    
    return filteredMemories;
  }
  
  // 更新记忆
  async updateMemory(memoryId: string, updates: Partial<MemoryEntry>): Promise<void> {
    const memory = await this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    
    const updatedMemory = {
      ...memory,
      ...updates,
      updatedAt: new Date()
    } as MemoryEntry;
    
    await this.saveMemory(updatedMemory);
  }
  
  // 删除记忆
  async deleteMemory(memoryId: string): Promise<void> {
    const memoryPath = this.getMemoryPath(memoryId);
    try {
      await fs.unlink(memoryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  
  // 修剪旧记忆
  async pruneOldMemories(policy?: RetentionPolicy): Promise<void> {
    const effectivePolicy = policy || this.retentionPolicy;
    const allMemories = await this.getAllMemories();
    
    const now = new Date();
    const memoriesToDelete: string[] = [];
    
    for (const memory of allMemories) {
      // 检查过期时间
      if (memory.expiresAt && memory.expiresAt < now) {
        memoriesToDelete.push(memory.id);
        continue;
      }
      
      // 检查年龄
      const age = now.getTime() - memory.createdAt.getTime();
      if (effectivePolicy.maxAge && age > effectivePolicy.maxAge && 
          memory.importance < (effectivePolicy.minImportance || 0.3)) {
        memoriesToDelete.push(memory.id);
        continue;
      }
    }
    
    // 删除选中的记忆
    for (const memoryId of memoriesToDelete) {
      await this.deleteMemory(memoryId);
    }
  }
  
  // 计算文本嵌入
  private async calculateEmbedding(text: string): Promise<number[]> {
    // 在实际实现中，这里会调用嵌入API
    // 如 OpenAI Embeddings API, Sentence Transformers等
    // 简化实现：返回伪嵌入
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text.toLowerCase());
    const embedding: number[] = [];
    
    // 简单的哈希嵌入（仅作演示）
    for (let i = 0; i < 1536; i++) { // 假设1536维嵌入
      embedding.push(encoded[i % encoded.length] / 255);
    }
    
    return embedding;
  }
  
  // 余弦相似度计算
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vector dimensions must match');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  // 关键词相关性计算
  private keywordRelevance(query: string, content: string): number {
    const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const contentLower = content.toLowerCase();
    
    let matches = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        matches++;
      }
    }
    
    return matches / queryWords.length;
  }
  
  // 保存记忆到文件
  private async saveMemory(memory: MemoryEntry): Promise<void> {
    const memoryPath = this.getMemoryPath(memory.id);
    const serialized = JSON.stringify(memory, null, 2);
    await fs.writeFile(memoryPath, serialized, 'utf-8');
  }
  
  // 获取记忆
  private async getMemory(memoryId: string): Promise<MemoryEntry | null> {
    const memoryPath = this.getMemoryPath(memoryId);
    try {
      const content = await fs.readFile(memoryPath, 'utf-8');
      return JSON.parse(content) as MemoryEntry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
  
  // 获取所有记忆
  private async getAllMemories(): Promise<MemoryEntry[]> {
    const files = await fs.readdir(this.memoryStorePath);
    const memories: MemoryEntry[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(this.memoryStorePath, file), 'utf-8');
          const memory = JSON.parse(content) as MemoryEntry;
          memories.push(memory);
        } catch (error) {
          console.error(`Failed to load memory from ${file}:`, error);
        }
      }
    }
    
    return memories;
  }
  
  // 获取记忆文件路径
  private getMemoryPath(memoryId: string): string {
    return path.join(this.memoryStorePath, `${memoryId}.json`);
  }
  
  // 生成记忆ID
  private generateMemoryId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 类型定义
export type MemoryType = 'fact' | 'experience' | 'preference' | 'knowledge';

export interface MemoryQueryOptions {
  types?: MemoryType[];
  tags?: string[];
  limit?: number;
  minImportance?: number;
}

export interface RetentionPolicy {
  maxAge?: number;              // 最大保留时间（毫秒）
  minImportance?: number;       // 最小重要性阈值
  autoPrune?: boolean;          // 是否自动修剪
}
```

### 内存优化策略

为了提高内存系统的性能，Clawdbot实现了多种优化策略：

```typescript
// 内存优化器
export class MemoryOptimizer {
  private longTermMemory: LongTermMemoryManager;
  private sessionStorage: SessionStorageManager;
  
  constructor(longTermMemory: LongTermMemoryManager, sessionStorage: SessionStorageManager) {
    this.longTermMemory = longTermMemory;
    this.sessionStorage = sessionStorage;
  }
  
  // 提取重要信息到长期记忆
  async extractImportantInfo(sessionId: string): Promise<void> {
    const session = await this.sessionStorage.getSession(sessionId);
    if (!session) {
      return;
    }
    
    // 分析会话历史，找出重要信息
    const importantFacts = this.identifyImportantFacts(session.history);
    
    for (const fact of importantFacts) {
      await this.longTermMemory.storeMemory(fact.content, {
        type: fact.type,
        tags: fact.tags,
        importance: fact.importance,
        sourceSession: sessionId
      });
    }
    
    // 可选：从会话中移除已提取的信息以节省空间
    if (importantFacts.length > 0) {
      await this.compressSessionWithExtractions(sessionId, importantFacts);
    }
  }
  
  // 识别重要事实
  private identifyImportantFacts(messages: Message[]): ExtractedFact[] {
    const facts: ExtractedFact[] = [];
    
    for (const message of messages) {
      // 查找个人信息（姓名、偏好、联系方式等）
      const personalInfo = this.extractPersonalInfo(message.content);
      facts.push(...personalInfo.map(info => ({
        content: info,
        type: 'preference' as MemoryType,
        tags: ['personal', 'preference'],
        importance: 0.8
      })));
      
      // 查找事实性陈述
      const factsFromMessage = this.extractFacts(message.content);
      facts.push(...factsFromMessage.map(fact => ({
        content: fact,
        type: 'fact' as MemoryType,
        tags: ['fact'],
        importance: 0.6
      })));
    }
    
    return facts;
  }
  
  // 提取个人信息
  private extractPersonalInfo(content: string): string[] {
    // 简化的个人信息提取
    // 实际实现会使用NLP模型进行更准确的提取
    const patterns = [
      /my name is ([^,.\n]+)/gi,
      /I prefer ([^,.\n]+)/gi,
      /I like ([^,.\n]+)/gi,
      /I enjoy ([^,.\n]+)/gi,
      /my email is ([^,.\n]+)/gi,
      /my phone is ([^,.\n]+)/gi,
      /I work at ([^,.\n]+)/gi,
      /I live in ([^,.\n]+)/gi
    ];
    
    const matches: string[] = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        matches.push(match[1].trim());
      }
    }
    
    return matches;
  }
  
  // 提取事实
  private extractFacts(content: string): string[] {
    // 简化的事实提取
    // 实际实现会使用更复杂的NLP技术
    const sentences = content.split(/[.!?]+/);
    return sentences
      .map(s => s.trim())
      .filter(s => s.length > 10 && (s.includes('is') || s.includes('are') || s.includes('was') || s.includes('were')));
  }
  
  // 使用提取内容压缩会话
  private async compressSessionWithExtractions(sessionId: string, extractedFacts: ExtractedFact[]): Promise<void> {
    const session = await this.sessionStorage.getSession(sessionId);
    if (!session) {
      return;
    }
    
    // 从会话历史中移除已提取的信息
    const filteredHistory = session.history.map(message => {
      let content = message.content;
      
      for (const fact of extractedFacts) {
        // 移除已提取的文本片段
        content = content.replace(new RegExp(fact.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
      }
      
      return {
        ...message,
        content: content.trim()
      };
    }).filter(message => message.content.length > 0); // 移除空消息
    
    // 更新会话
    const updatedSession = {
      ...session,
      history: filteredHistory,
      tokenCount: this.calculateTokenCount(filteredHistory)
    };
    
    await this.sessionStorage.saveSession(sessionId, updatedSession);
  }
  
  private calculateTokenCount(messages: Message[]): number {
    const text = messages.map(msg => msg.content).join(' ');
    return Math.ceil(text.length / 4);
  }
}

interface ExtractedFact {
  content: string;
  type: MemoryType;
  tags: string[];
  importance: number;
}

// 消息接口
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  tokens?: number;
}

// 会话元数据
interface SessionMetadata {
  agentId: string;
  channelId: string;
  createdAt: Date;
  lastActivity: Date;
  lastCompacted?: Date;
  compressionCount?: number;
  tags?: string[];
}
```

## 总结

Clawdbot的内存与状态管理系统是一个多层次、智能化的数据管理框架，具有以下关键特性：

1. **分层存储**：短期、中期和长期记忆的清晰分离
2. **持久化支持**：会话和记忆数据的可靠存储
3. **智能压缩**：自动上下文压缩以管理token使用
4. **语义检索**：基于嵌入向量的相似性搜索
5. **生命周期管理**：自动过期和清理机制
6. **性能优化**：缓存、异步操作和批量处理

这种设计确保了Clawdbot能够在保持对话连贯性的同时，有效管理资源使用，提供持续的学习和记忆能力。

在下一课中，我们将深入探讨模型集成与AI接口，了解Clawdbot如何与各种AI模型进行交互。