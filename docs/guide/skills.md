# 第6课：技能(Skills)系统与插件架构

## 技能系统设计

Clawdbot的技能(Skills)系统是一个模块化功能扩展框架，允许开发者创建可重用的功能模块。技能系统是Clawdbot生态系统的重要组成部分，提供了将复杂功能打包成可重用单元的能力。

### 技能架构概览

技能系统基于文件系统组织，每个技能都是一个独立的目录，包含技能定义、实现代码和相关资源：

```
~/clawd/skills/
├── my-skill/
│   ├── SKILL.md          # 技能文档和元数据
│   ├── skill.mjs         # 技能实现代码（可选）
│   ├── assets/           # 技能资源文件
│   └── config.json       # 技能配置（可选）
└── another-skill/
    ├── SKILL.md
    └── implementation.js
```

### 技能定义规范

每个技能都通过`SKILL.md`文件定义，该文件包含技能的元数据和描述：

```typescript
// 技能解析器示例
export interface SkillDefinition {
  name: string;                    // 技能名称
  description: string;             // 技能描述
  version: string;                 // 版本号
  author: string;                  // 作者信息
  dependencies?: string[];         // 依赖的其他技能
  files: string[];                 // 技能包含的文件
  entryPoint?: string;             // 入口文件
  tags?: string[];                 // 技能标签
  category?: string;               // 技能分类
}

// 技能解析实现
export async function parseSkillDefinition(skillPath: string): Promise<SkillDefinition> {
  const skillDocPath = path.join(skillPath, 'SKILL.md');
  const skillDocContent = await fs.readFile(skillDocPath, 'utf-8');
  
  // 解析技能文档，提取元数据
  const metadata = extractSkillMetadata(skillDocContent);
  
  // 查找技能相关文件
  const files = await findSkillFiles(skillPath);
  
  return {
    name: metadata.name,
    description: metadata.description,
    version: metadata.version || '1.0.0',
    author: metadata.author,
    dependencies: metadata.dependencies || [],
    files,
    entryPoint: metadata.entryPoint,
    tags: metadata.tags || [],
    category: metadata.category
  };
}

// 提取技能元数据
function extractSkillMetadata(content: string): Partial<SkillDefinition> {
  // 从技能文档中提取元数据
  const nameMatch = content.match(/#+\s+([^\n]+)/);
  const descriptionMatch = content.match(/##\s+Description\s*\n+([^\n#]+)/);
  const versionMatch = content.match(/version:\s*([^\n]+)/i);
  const authorMatch = content.match(/author:\s*([^\n]+)/i);
  
  return {
    name: nameMatch?.[1]?.trim(),
    description: descriptionMatch?.[1]?.trim(),
    version: versionMatch?.[1]?.trim(),
    author: authorMatch?.[1]?.trim()
  };
}
```

## 技能注册与管理

### 技能注册表

Clawdbot使用集中式的技能注册表来管理所有已安装的技能：

```typescript
// 技能注册表实现
export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private skillRootDir: string;
  
  constructor(skillRootDir: string) {
    this.skillRootDir = skillRootDir;
  }
  
  // 注册单个技能
  async registerSkill(skillPath: string): Promise<boolean> {
    try {
      const skillDef = await parseSkillDefinition(skillPath);
      const skillId = this.generateSkillId(skillDef);
      
      if (this.skills.has(skillId)) {
        console.warn(`Skill ${skillId} is already registered, skipping...`);
        return false;
      }
      
      // 验证技能依赖
      if (!(await this.verifyDependencies(skillDef))) {
        throw new Error(`Missing dependencies for skill: ${skillId}`);
      }
      
      this.skills.set(skillId, skillDef);
      console.log(`Registered skill: ${skillId}`);
      return true;
    } catch (error) {
      console.error(`Failed to register skill at ${skillPath}:`, error);
      return false;
    }
  }
  
  // 批量注册技能
  async registerAllSkills(): Promise<number> {
    const skillDirs = await this.findSkillDirectories();
    let registeredCount = 0;
    
    for (const skillDir of skillDirs) {
      if (await this.registerSkill(skillDir)) {
        registeredCount++;
      }
    }
    
    return registeredCount;
  }
  
  // 获取技能
  getSkill(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }
  
  // 获取所有技能
  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }
  
  // 查找技能目录
  private async findSkillDirectories(): Promise<string[]> {
    const entries = await fs.readdir(this.skillRootDir, { withFileTypes: true });
    const skillDirs: string[] = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(this.skillRootDir, entry.name);
        const skillDocPath = path.join(skillPath, 'SKILL.md');
        
        // 检查是否存在SKILL.md文件
        try {
          await fs.access(skillDocPath);
          skillDirs.push(skillPath);
        } catch {
          // 如果没有SKILL.md，则不是有效技能
          continue;
        }
      }
    }
    
    return skillDirs;
  }
  
  // 验证技能依赖
  private async verifyDependencies(skillDef: SkillDefinition): Promise<boolean> {
    if (!skillDef.dependencies || skillDef.dependencies.length === 0) {
      return true;
    }
    
    for (const dep of skillDef.dependencies) {
      if (!this.skills.has(dep)) {
        console.error(`Missing dependency: ${dep} for skill ${skillDef.name}`);
        return false;
      }
    }
    
    return true;
  }
  
  // 生成技能ID
  private generateSkillId(skillDef: SkillDefinition): string {
    // 基于技能名称和版本生成唯一ID
    return `${skillDef.name}@${skillDef.version}`;
  }
}
```

### 技能生命周期管理

技能系统支持完整的生命周期管理，包括安装、启用、禁用和卸载：

```typescript
// 技能生命周期管理器
export class SkillLifecycleManager {
  private registry: SkillRegistry;
  private activeSkills: Set<string> = new Set();
  
  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }
  
  // 安装技能
  async installSkill(skillPath: string, options: { force?: boolean } = {}): Promise<boolean> {
    try {
      // 验证技能包
      if (!(await this.validateSkillPackage(skillPath))) {
        throw new Error(`Invalid skill package: ${skillPath}`);
      }
      
      // 注册技能
      const registered = await this.registry.registerSkill(skillPath);
      if (!registered && !options.force) {
        return false;
      }
      
      // 安装依赖
      await this.installDependencies(skillPath);
      
      console.log(`Installed skill: ${path.basename(skillPath)}`);
      return true;
    } catch (error) {
      console.error(`Failed to install skill:`, error);
      return false;
    }
  }
  
  // 启用技能
  async enableSkill(skillId: string): Promise<boolean> {
    const skillDef = this.registry.getSkill(skillId);
    if (!skillDef) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    
    // 检查依赖是否已启用
    if (!(await this.checkDependenciesEnabled(skillDef))) {
      throw new Error(`Required dependencies not enabled for skill: ${skillId}`);
    }
    
    // 执行技能初始化
    if (await this.initializeSkill(skillDef)) {
      this.activeSkills.add(skillId);
      console.log(`Enabled skill: ${skillId}`);
      return true;
    }
    
    return false;
  }
  
  // 禁用技能
  async disableSkill(skillId: string): Promise<boolean> {
    if (!this.activeSkills.has(skillId)) {
      return true; // 已经是禁用状态
    }
    
    const skillDef = this.registry.getSkill(skillId);
    if (skillDef) {
      // 执行技能清理
      await this.cleanupSkill(skillDef);
    }
    
    this.activeSkills.delete(skillId);
    console.log(`Disabled skill: ${skillId}`);
    return true;
  }
  
  // 验证技能包
  private async validateSkillPackage(skillPath: string): Promise<boolean> {
    const requiredFiles = ['SKILL.md'];
    for (const file of requiredFiles) {
      const filePath = path.join(skillPath, file);
      try {
        await fs.access(filePath);
      } catch {
        return false;
      }
    }
    return true;
  }
  
  // 初始化技能
  private async initializeSkill(skillDef: SkillDefinition): Promise<boolean> {
    if (skillDef.entryPoint) {
      try {
        // 动态导入技能入口点
        const skillModule = await import(path.join(path.dirname(skillDef.files[0]), skillDef.entryPoint));
        
        // 如果技能模块有初始化函数，则调用它
        if (skillModule.initialize && typeof skillModule.initialize === 'function') {
          await skillModule.initialize();
        }
        
        return true;
      } catch (error) {
        console.error(`Failed to initialize skill ${skillDef.name}:`, error);
        return false;
      }
    }
    
    return true;
  }
  
  // 清理技能
  private async cleanupSkill(skillDef: SkillDefinition): Promise<void> {
    if (skillDef.entryPoint) {
      try {
        const skillModule = await import(path.join(path.dirname(skillDef.files[0]), skillDef.entryPoint));
        
        // 如果技能模块有清理函数，则调用它
        if (skillModule.cleanup && typeof skillModule.cleanup === 'function') {
          await skillModule.cleanup();
        }
      } catch (error) {
        console.error(`Failed to cleanup skill ${skillDef.name}:`, error);
      }
    }
  }
}
```

## 插件化架构

### 插件系统设计

Clawdbot的插件架构允许第三方开发者扩展现有功能，插件系统与技能系统密切相关但有不同的关注点：

```typescript
// 插件接口定义
export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  activate: (context: PluginContext) => Promise<void>;
  deactivate: () => Promise<void>;
  dependencies?: string[];
}

// 插件上下文
export interface PluginContext {
  gateway: any;                    // 网关实例
  agent: any;                      // 代理实例
  tools: any;                      // 工具注册表
  config: any;                     // 配置管理器
  logger: any;                     // 日志记录器
  events: any;                     // 事件系统
}

// 插件管理器
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private activePlugins: Set<string> = new Set();
  private pluginRootDir: string;
  
  constructor(pluginRootDir: string) {
    this.pluginRootDir = pluginRootDir;
  }
  
  // 加载插件
  async loadPlugin(pluginPath: string): Promise<boolean> {
    try {
      // 动态导入插件模块
      const pluginModule = await import(pluginPath);
      
      if (!pluginModule.default || typeof pluginModule.default !== 'object') {
        throw new Error(`Invalid plugin export in ${pluginPath}`);
      }
      
      const plugin: Plugin = pluginModule.default;
      
      // 验证插件接口
      if (!this.validatePluginInterface(plugin)) {
        throw new Error(`Invalid plugin interface: ${plugin.id}`);
      }
      
      // 检查依赖
      if (!(await this.checkPluginDependencies(plugin))) {
        throw new Error(`Unmet dependencies for plugin: ${plugin.id}`);
      }
      
      this.plugins.set(plugin.id, plugin);
      console.log(`Loaded plugin: ${plugin.name} (${plugin.id})`);
      return true;
    } catch (error) {
      console.error(`Failed to load plugin from ${pluginPath}:`, error);
      return false;
    }
  }
  
  // 激活插件
  async activatePlugin(pluginId: string, context: PluginContext): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }
    
    try {
      await plugin.activate(context);
      this.activePlugins.add(pluginId);
      console.log(`Activated plugin: ${pluginId}`);
      return true;
    } catch (error) {
      console.error(`Failed to activate plugin ${pluginId}:`, error);
      return false;
    }
  }
  
  // 停用插件
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return true; // 插件不存在，视为已停用
    }
    
    try {
      await plugin.deactivate();
      this.activePlugins.delete(pluginId);
      console.log(`Deactivated plugin: ${pluginId}`);
      return true;
    } catch (error) {
      console.error(`Failed to deactivate plugin ${pluginId}:`, error);
      return false;
    }
  }
  
  // 验证插件接口
  private validatePluginInterface(plugin: Plugin): boolean {
    const requiredFields: (keyof Plugin)[] = ['id', 'name', 'version', 'description', 'author', 'activate', 'deactivate'];
    
    for (const field of requiredFields) {
      if (!(field in plugin)) {
        return false;
      }
    }
    
    return typeof plugin.activate === 'function' && typeof plugin.deactivate === 'function';
  }
  
  // 检查插件依赖
  private async checkPluginDependencies(plugin: Plugin): Promise<boolean> {
    if (!plugin.dependencies || plugin.dependencies.length === 0) {
      return true;
    }
    
    for (const dep of plugin.dependencies) {
      if (!this.activePlugins.has(dep)) {
        console.error(`Missing dependency plugin: ${dep} for plugin: ${plugin.id}`);
        return false;
      }
    }
    
    return true;
  }
}
```

### 技能与插件的关系

技能和插件虽然概念相似，但有不同的应用场景：

```typescript
// 技能和插件关系管理器
export class SkillPluginRelationManager {
  private skillRegistry: SkillRegistry;
  private pluginManager: PluginManager;
  
  constructor(skillRegistry: SkillRegistry, pluginManager: PluginManager) {
    this.skillRegistry = skillRegistry;
    this.pluginManager = pluginManager;
  }
  
  // 技能可以包含插件
  async linkSkillToPlugin(skillId: string, pluginId: string): Promise<boolean> {
    const skill = this.skillRegistry.getSkill(skillId);
    if (!skill) {
      return false;
    }
    
    // 更新技能定义以包含插件引用
    const updatedFiles = [...skill.files, `plugin:${pluginId}`];
    
    // 这里可以实现具体的关联逻辑
    console.log(`Linked skill ${skillId} to plugin ${pluginId}`);
    return true;
  }
  
  // 获取技能的插件依赖
  getSkillPlugins(skillId: string): string[] {
    const skill = this.skillRegistry.getSkill(skillId);
    if (!skill) {
      return [];
    }
    
    // 从技能定义中提取插件依赖
    return skill.files
      .filter(file => file.startsWith('plugin:'))
      .map(file => file.substring(7)); // 移除 'plugin:' 前缀
  }
}
```

## 外部扩展机制

### 扩展点设计

Clawdbot提供了多种扩展点，允许开发者在不同层面扩展系统功能：

```typescript
// 扩展点接口
export interface ExtensionPoint<T = any> {
  id: string;
  name: string;
  description: string;
  register: (extension: T) => void;
  unregister: (extensionId: string) => void;
  getExtensions: () => T[];
}

// 扩展管理器
export class ExtensionManager {
  private extensionPoints: Map<string, ExtensionPoint> = new Map();
  
  // 注册扩展点
  registerExtensionPoint<T>(point: ExtensionPoint<T>): void {
    this.extensionPoints.set(point.id, point);
  }
  
  // 获取扩展点
  getExtensionPoint<T>(id: string): ExtensionPoint<T> | undefined {
    return this.extensionPoints.get(id) as ExtensionPoint<T>;
  }
  
  // 系统预定义的扩展点
  initializeDefaultExtensionPoints(): void {
    // 工具扩展点
    this.registerExtensionPoint({
      id: 'tools',
      name: 'Tools',
      description: 'Extend available tools',
      register: (tool: any) => {
        // 注册工具到全局工具库
        globalToolRegistry.register(tool);
      },
      unregister: (toolId: string) => {
        // 从全局工具库移除工具
        globalToolRegistry.unregister(toolId);
      },
      getExtensions: () => {
        return globalToolRegistry.list();
      }
    });
    
    // 消息处理器扩展点
    this.registerExtensionPoint({
      id: 'message-handlers',
      name: 'Message Handlers',
      description: 'Extend message processing capabilities',
      register: (handler: any) => {
        // 注册消息处理器
        messageProcessor.addHandler(handler);
      },
      unregister: (handlerId: string) => {
        // 移除消息处理器
        messageProcessor.removeHandler(handlerId);
      },
      getExtensions: () => {
        return messageProcessor.getHandlers();
      }
    });
    
    // 事件监听器扩展点
    this.registerExtensionPoint({
      id: 'event-listeners',
      name: 'Event Listeners',
      description: 'Extend event handling capabilities',
      register: (listener: any) => {
        // 注册事件监听器
        eventSystem.addListener(listener);
      },
      unregister: (listenerId: string) => {
        // 移除事件监听器
        eventSystem.removeListener(listenerId);
      },
      getExtensions: () => {
        return eventSystem.getListeners();
      }
    });
  }
}
```

### 扩展市场集成

Clawdbot还支持从外部源获取技能和插件：

```typescript
// 技能市场客户端
export class SkillMarketClient {
  private baseUrl: string;
  private apiKey?: string;
  
  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }
  
  // 搜索技能
  async searchSkills(query: string, options: { tags?: string[], author?: string } = {}): Promise<SkillDefinition[]> {
    const params = new URLSearchParams({
      q: query,
      ...(options.tags && { tags: options.tags.join(',') }),
      ...(options.author && { author: options.author })
    });
    
    const response = await fetch(`${this.baseUrl}/api/v1/skills?${params}`, {
      headers: this.buildHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to search skills: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  // 下载技能
  async downloadSkill(skillId: string, destination: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/api/v1/skills/${skillId}/download`, {
      headers: this.buildHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download skill: ${response.statusText}`);
    }
    
    // 将下载的技能包保存到指定位置
    const buffer = await response.arrayBuffer();
    await fs.writeFile(destination, Buffer.from(buffer));
    
    return true;
  }
  
  // 安装远程技能
  async installRemoteSkill(skillId: string, installPath: string): Promise<boolean> {
    const tempPath = path.join(os.tmpdir(), `skill-${skillId}-${Date.now()}.zip`);
    
    try {
      // 下载技能
      if (!(await this.downloadSkill(skillId, tempPath))) {
        return false;
      }
      
      // 解压技能到目标位置
      await this.extractSkill(tempPath, installPath);
      
      // 验证并安装技能
      const lifecycleManager = new SkillLifecycleManager(/* registry */);
      return await lifecycleManager.installSkill(installPath);
    } finally {
      // 清理临时文件
      try {
        await fs.unlink(tempPath);
      } catch (error) {
        console.warn(`Failed to clean up temp file: ${tempPath}`, error);
      }
    }
  }
  
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'Clawdbot-SkillClient/1.0'
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }
  
  private async extractSkill(archivePath: string, extractPath: string): Promise<void> {
    // 实现技能包解压逻辑
    // 这里可能需要使用 zip 库或其他归档格式处理库
    console.log(`Extracting skill from ${archivePath} to ${extractPath}`);
  }
}
```

## 总结

Clawdbot的技能和插件系统提供了强大而灵活的扩展能力，具有以下关键特性：

1. **模块化设计**：技能和插件都是独立的模块，易于开发和维护
2. **标准化接口**：明确定义的接口规范，确保兼容性
3. **依赖管理**：完善的依赖关系处理，确保功能完整
4. **生命周期控制**：完整的安装、启用、禁用、卸载流程
5. **扩展点机制**：多层级的扩展能力，满足不同需求
6. **市场集成**：支持从外部源获取和安装扩展

这种设计使得Clawdbot成为一个高度可扩展的平台，社区可以轻松创建和分享新的功能模块。

在下一课中，我们将探讨内存与状态管理系统，深入了解Clawdbot如何处理会话持久化、上下文管理和记忆机制。