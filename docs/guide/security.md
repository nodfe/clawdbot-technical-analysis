# 第9课：安全模型与权限控制

## 安全设计原则

Clawdbot的安全模型建立在多层防护的基础上，确保用户数据和系统安全。其核心设计原则包括：

1. **最小权限原则**：每个组件只拥有完成其任务所需的最低权限
2. **纵深防御**：多层安全措施，即使某一层被突破仍有其他层保护
3. **零信任模型**：默认不信任任何内部或外部请求，需持续验证
4. **安全默认**：安全配置默认开启，用户需主动选择降低安全性

### 安全架构概览

```typescript
// 安全架构接口
export interface SecurityArchitecture {
  authentication: AuthenticationSystem;
  authorization: AuthorizationSystem;
  encryption: EncryptionSystem;
  sandbox: SandboxingSystem;
  monitoring: SecurityMonitoringSystem;
}

// 安全配置接口
export interface SecurityConfig {
  auth: {
    mode: 'password' | 'oauth' | 'none';
    allowTailscale: boolean;
    password?: string;
    oauthProviders?: OAuthProvider[];
  };
  sandbox: {
    enabled: boolean;
    mode: 'off' | 'non-main';
    allowlist: string[];
    denylist: string[];
  };
  encryption: {
    enabled: boolean;
    algorithm: string;
    keyRotationInterval: number;
  };
  firewall: {
    enabled: boolean;
    rules: FirewallRule[];
  };
  audit: {
    enabled: boolean;
    logLevel: 'none' | 'basic' | 'detailed';
  };
}
```

## 权限验证机制

### 认证系统

Clawdbot提供了多种认证机制，确保只有授权用户才能访问系统：

```typescript
// 认证系统接口
export interface AuthenticationSystem {
  authenticate(request: AuthRequest): Promise<AuthResult>;
  createSession(credentials: Credentials): Promise<Session>;
  validateSession(token: string): Promise<Session | null>;
  revokeSession(sessionId: string): Promise<void>;
}

// 认证请求
export interface AuthRequest {
  method: string;
  headers: Record<string, string>;
  body?: any;
  remoteAddr?: string;
}

// 认证结果
export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  sessionId?: string;
  permissions: Permission[];
  error?: string;
}

// 凭证接口
export interface Credentials {
  type: 'password' | 'token' | 'oauth' | 'apikey';
  value: string;
  provider?: string;
}

// 会话接口
export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  permissions: Permission[];
  ip: string;
  userAgent?: string;
}

// 权限定义
export interface Permission {
  resource: string;
  action: string;
  scope: 'global' | 'channel' | 'session' | 'user';
  condition?: string;
}

// 基础认证实现
export class BasicAuthenticationSystem implements AuthenticationSystem {
  private sessions: Map<string, Session> = new Map();
  private users: Map<string, User> = new Map();
  private config: SecurityConfig;
  
  constructor(config: SecurityConfig) {
    this.config = config;
    this.loadUsers();
  }
  
  async authenticate(request: AuthRequest): Promise<AuthResult> {
    // 检查IP白名单
    if (this.config.firewall?.enabled) {
      const ipCheck = this.checkIPWhitelist(request.remoteAddr);
      if (!ipCheck.allowed) {
        return {
          authenticated: false,
          error: `IP ${request.remoteAddr} is blocked`
        };
      }
    }
    
    // 检查认证头
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      return {
        authenticated: false,
        error: 'No authentication header provided'
      };
    }
    
    // 解析认证类型
    const [authType, authValue] = authHeader.split(' ', 2);
    
    switch (authType.toLowerCase()) {
      case 'bearer':
        return await this.authenticateBearerToken(authValue);
      case 'basic':
        return await this.authenticateBasicAuth(authValue);
      case 'apikey':
        return await this.authenticateApiKey(authValue);
      default:
        return {
          authenticated: false,
          error: `Unsupported authentication type: ${authType}`
        };
    }
  }
  
  async createSession(credentials: Credentials): Promise<Session> {
    // 验证凭据
    const user = await this.validateCredentials(credentials);
    if (!user) {
      throw new Error('Invalid credentials');
    }
    
    // 生成会话ID
    const sessionId = this.generateSessionId();
    
    // 创建会话
    const session: Session = {
      id: sessionId,
      userId: user.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小时后过期
      permissions: user.permissions,
      ip: credentials['ip'] || 'unknown'
    };
    
    this.sessions.set(sessionId, session);
    
    return session;
  }
  
  async validateSession(token: string): Promise<Session | null> {
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }
    
    // 检查会话是否过期
    if (new Date() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    
    // 刷新会话过期时间
    session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return session;
  }
  
  async revokeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
  
  private async validateCredentials(credentials: Credentials): Promise<User | null> {
    switch (credentials.type) {
      case 'password':
        return await this.validatePassword(credentials.value);
      case 'token':
        return await this.validateToken(credentials.value);
      case 'apikey':
        return await this.validateApiKey(credentials.value);
      default:
        return null;
    }
  }
  
  private async validatePassword(password: string): Promise<User | null> {
    // 这里应该是安全的密码验证逻辑
    // 使用bcrypt或其他安全的哈希算法
    for (const [_, user] of this.users) {
      if (await this.verifyPassword(password, user.hashedPassword)) {
        return user;
      }
    }
    return null;
  }
  
  private async validateToken(token: string): Promise<User | null> {
    // JWT令牌验证逻辑
    try {
      // 这里应该使用实际的JWT库进行验证
      const decoded = this.decodeJWT(token);
      return this.users.get(decoded.userId) || null;
    } catch {
      return null;
    }
  }
  
  private async validateApiKey(apiKey: string): Promise<User | null> {
    // API密钥验证逻辑
    for (const [_, user] of this.users) {
      if (user.apiKeys?.includes(this.hashApiKey(apiKey))) {
        return user;
      }
    }
    return null;
  }
  
  private async authenticateBearerToken(token: string): Promise<AuthResult> {
    const session = await this.validateSession(token);
    if (!session) {
      return {
        authenticated: false,
        error: 'Invalid or expired token'
      };
    }
    
    return {
      authenticated: true,
      userId: session.userId,
      sessionId: session.id,
      permissions: session.permissions
    };
  }
  
  private async authenticateBasicAuth(encoded: string): Promise<AuthResult> {
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const [username, password] = decoded.split(':', 2);
      
      const user = await this.validatePassword(password);
      if (!user || user.username !== username) {
        return {
          authenticated: false,
          error: 'Invalid credentials'
        };
      }
      
      const session = await this.createSession({
        type: 'password',
        value: password
      });
      
      return {
        authenticated: true,
        userId: user.id,
        sessionId: session.id,
        permissions: user.permissions
      };
    } catch {
      return {
        authenticated: false,
        error: 'Invalid basic auth format'
      };
    }
  }
  
  private async authenticateApiKey(apiKey: string): Promise<AuthResult> {
    const user = await this.validateApiKey(apiKey);
    if (!user) {
      return {
        authenticated: false,
        error: 'Invalid API key'
      };
    }
    
    const session = await this.createSession({
      type: 'apikey',
      value: apiKey
    });
    
    return {
      authenticated: true,
      userId: user.id,
      sessionId: session.id,
      permissions: user.permissions
    };
  }
  
  private checkIPWhitelist(ip?: string): { allowed: boolean; reason?: string } {
    if (!ip || !this.config.firewall?.rules) {
      return { allowed: true };
    }
    
    for (const rule of this.config.firewall.rules) {
      if (this.ipInRange(ip, rule.cidr)) {
        return {
          allowed: rule.action === 'allow',
          reason: rule.action === 'allow' ? 'Whitelisted' : 'Blocked by firewall'
        };
      }
    }
    
    // 默认拒绝
    return { allowed: false, reason: 'IP not in whitelist' };
  }
  
  private ipInRange(ip: string, cidr: string): boolean {
    // 简化的IP范围检查
    // 实际实现应使用专用的IP处理库
    return true; // 简化实现
  }
  
  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private decodeJWT(token: string): any {
    // 简化的JWT解码
    // 实际实现应使用专用JWT库
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT');
    return JSON.parse(Buffer.from(parts[1], 'base64').toString());
  }
  
  private hashApiKey(apiKey: string): string {
    // 简化的API密钥哈希
    // 实际实现应使用安全的哈希算法
    return apiKey;
  }
  
  private async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    // 简化的密码验证
    // 实际实现应使用bcrypt或其他安全算法
    return password === hashedPassword;
  }
  
  private async loadUsers(): Promise<void> {
    // 从配置或数据库加载用户
    // 简化实现
    this.users.set('default-user', {
      id: 'default-user',
      username: 'default',
      hashedPassword: 'hashed-password',
      permissions: [
        { resource: '*', action: '*', scope: 'global' }
      ],
      apiKeys: ['default-api-key']
    });
  }
}

// 用户接口
interface User {
  id: string;
  username: string;
  hashedPassword: string;
  permissions: Permission[];
  apiKeys?: string[];
}

// 防火墙规则
interface FirewallRule {
  cidr: string;
  action: 'allow' | 'deny';
  description?: string;
}
```

### 授权系统

授权系统控制已认证用户可以访问哪些资源和执行哪些操作：

```typescript
// 授权系统接口
export interface AuthorizationSystem {
  checkPermission(userId: string, permission: Permission): Promise<boolean>;
  getEffectivePermissions(userId: string): Promise<Permission[]>;
  addPermission(userId: string, permission: Permission): Promise<void>;
  removePermission(userId: string, permission: Permission): Promise<void>;
}

// RBAC（基于角色的访问控制）实现
export class RBACAuthorizationSystem implements AuthorizationSystem {
  private roles: Map<string, Role> = new Map();
  private userRoles: Map<string, string[]> = new Map();
  private permissions: Map<string, Permission[]> = new Map();
  
  constructor() {
    this.initializeDefaultRoles();
  }
  
  async checkPermission(userId: string, requestedPermission: Permission): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);
    
    // 检查是否有完全匹配的权限
    for (const perm of userPermissions) {
      if (this.permissionMatches(perm, requestedPermission)) {
        return true;
      }
    }
    
    return false;
  }
  
  async getEffectivePermissions(userId: string): Promise<Permission[]> {
    return await this.getUserPermissions(userId);
  }
  
  async addPermission(userId: string, permission: Permission): Promise<void> {
    const permissions = this.permissions.get(userId) || [];
    permissions.push(permission);
    this.permissions.set(userId, permissions);
  }
  
  async removePermission(userId: string, permission: Permission): Promise<void> {
    const permissions = this.permissions.get(userId) || [];
    const filtered = permissions.filter(perm => !this.permissionsEqual(perm, permission));
    this.permissions.set(userId, filtered);
  }
  
  private async getUserPermissions(userId: string): Promise<Permission[]> {
    const userRoleIds = this.userRoles.get(userId) || [];
    const permissions: Permission[] = [];
    
    // 添加用户直接拥有的权限
    const userDirectPermissions = this.permissions.get(userId) || [];
    permissions.push(...userDirectPermissions);
    
    // 添加用户角色的权限
    for (const roleId of userRoleIds) {
      const role = this.roles.get(roleId);
      if (role) {
        permissions.push(...role.permissions);
      }
    }
    
    // 去重
    return this.dedupePermissions(permissions);
  }
  
  private permissionMatches(userPerm: Permission, requestedPerm: Permission): boolean {
    // 检查资源匹配
    if (userPerm.resource !== '*' && userPerm.resource !== requestedPerm.resource) {
      return false;
    }
    
    // 检查操作匹配
    if (userPerm.action !== '*' && userPerm.action !== requestedPerm.action) {
      return false;
    }
    
    // 检查作用域匹配
    if (userPerm.scope !== 'global' && userPerm.scope !== requestedPerm.scope) {
      return false;
    }
    
    // 检查条件（如果有的话）
    if (userPerm.condition && requestedPerm.condition) {
      return this.evaluateCondition(userPerm.condition, requestedPerm.condition);
    }
    
    return true;
  }
  
  private permissionsEqual(a: Permission, b: Permission): boolean {
    return a.resource === b.resource && 
           a.action === b.action && 
           a.scope === b.scope;
  }
  
  private dedupePermissions(perms: Permission[]): Permission[] {
    const seen = new Set<string>();
    const unique: Permission[] = [];
    
    for (const perm of perms) {
      const key = `${perm.resource}:${perm.action}:${perm.scope}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(perm);
      }
    }
    
    return unique;
  }
  
  private evaluateCondition(condition: string, value: string): boolean {
    // 简化的条件评估
    // 实际实现可能需要更复杂的表达式解析
    return condition === value;
  }
  
  private initializeDefaultRoles(): void {
    // 管理员角色
    this.roles.set('admin', {
      id: 'admin',
      name: 'Administrator',
      permissions: [
        { resource: '*', action: '*', scope: 'global' }
      ]
    });
    
    // 用户角色
    this.roles.set('user', {
      id: 'user',
      name: 'Standard User',
      permissions: [
        { resource: 'agent', action: 'read', scope: 'global' },
        { resource: 'agent', action: 'write', scope: 'own' },
        { resource: 'session', action: 'read', scope: 'own' },
        { resource: 'session', action: 'write', scope: 'own' },
        { resource: 'tool', action: 'execute', scope: 'allowed' }
      ]
    });
    
    // 只读角色
    this.roles.set('viewer', {
      id: 'viewer',
      name: 'Viewer',
      permissions: [
        { resource: 'agent', action: 'read', scope: 'global' },
        { resource: 'session', action: 'read', scope: 'global' }
      ]
    });
  }
}

// 角色接口
interface Role {
  id: string;
  name: string;
  permissions: Permission[];
}
```

## 沙箱隔离策略

### 沙箱系统设计

Clawdbot的沙箱系统是其安全模型的核心组件，用于隔离不同会话和用户的操作：

```typescript
// 沙箱系统接口
export interface SandboxingSystem {
  createSandbox(sessionId: string, config: SandboxConfig): Promise<Sandbox>;
  runInSandbox(sandbox: Sandbox, command: Command): Promise<CommandResult>;
  destroySandbox(sandboxId: string): Promise<void>;
}

// 沙箱配置
export interface SandboxConfig {
  enabled: boolean;
  mode: 'none' | 'process' | 'container';
  allowlist: string[];
  denylist: string[];
  resourceLimits: ResourceLimits;
  networkPolicy: NetworkPolicy;
  filesystemPolicy: FilesystemPolicy;
}

// 沙箱接口
export interface Sandbox {
  id: string;
  sessionId: string;
  config: SandboxConfig;
  status: 'created' | 'running' | 'stopped';
  createdAt: Date;
}

// 命令接口
export interface Command {
  executable: string;
  args: string[];
  env: Record<string, string>;
  timeout?: number;
  cwd?: string;
}

// 命令结果
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  resourcesUsed: ResourceUsage;
  error?: string;
}

// 资源限制
export interface ResourceLimits {
  cpuQuota?: number;          // CPU配额 (0.1 = 10% CPU)
  memoryLimit?: number;       // 内存限制 (bytes)
  diskLimit?: number;         // 磁盘限制 (bytes)
  processLimit?: number;      // 进程数量限制
  networkLimit?: number;      // 网络流量限制 (bytes)
  timeLimit?: number;         // 执行时间限制 (ms)
}

// 网络策略
export interface NetworkPolicy {
  enabled: boolean;
  allowInbound: boolean;
  allowOutbound: boolean;
  allowedHosts: string[];
  blockedHosts: string[];
  allowedPorts: number[];
  blockedPorts: number[];
}

// 文件系统策略
export interface FilesystemPolicy {
  readOnly: boolean;
  allowedPaths: string[];
  blockedPaths: string[];
  maxSize: number;            // 最大文件大小 (bytes)
  maxFiles: number;           // 最大文件数量
}

// 资源使用情况
export interface ResourceUsage {
  cpuTimeMs: number;
  memoryPeakBytes: number;
  diskUsedBytes: number;
  networkInBytes: number;
  networkOutBytes: number;
}

// Docker容器沙箱实现
export class DockerSandboxSystem implements SandboxingSystem {
  private sandboxes: Map<string, Sandbox> = new Map();
  private docker: Docker;
  
  constructor(docker: Docker) {
    this.docker = docker;
  }
  
  async createSandbox(sessionId: string, config: SandboxConfig): Promise<Sandbox> {
    const sandboxId = `sb_${sessionId}_${Date.now()}`;
    
    // 创建Docker容器配置
    const containerConfig: Docker.ContainerCreateOptions = {
      Image: 'node:22-alpine',
      Cmd: ['/bin/sh'],  // 临时命令，容器将在需要时执行实际命令
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
      OpenStdin: false,
      StdinOnce: false,
      Env: ['NODE_ENV=sandbox'],
      HostConfig: {
        Binds: [],  // 挂载卷
        NetworkMode: config.networkPolicy.enabled ? 'bridge' : 'none',
        Memory: config.resourceLimits.memoryLimit,
        NanoCpus: config.resourceLimits.cpuQuota ? Math.floor(config.resourceLimits.cpuQuota * 1_000_000_000) : undefined,
        PidsLimit: config.resourceLimits.processLimit,
        Ulimits: [
          {
            Name: 'fsize',
            Hard: config.filesystemPolicy.maxSize,
            Soft: config.filesystemPolicy.maxSize
          }
        ]
      },
      Labels: {
        'clawdbot.session.id': sessionId,
        'clawdbot.sandbox.id': sandboxId
      }
    };
    
    // 设置文件系统挂载
    if (config.filesystemPolicy.allowedPaths.length > 0) {
      const binds = config.filesystemPolicy.allowedPaths.map(path => `${path}:${path}:ro`);
      containerConfig.HostConfig!.Binds = binds;
    }
    
    // 创建容器
    const container = await this.docker.createContainer(containerConfig);
    
    // 启动容器
    await container.start();
    
    const sandbox: Sandbox = {
      id: sandboxId,
      sessionId,
      config,
      status: 'running',
      createdAt: new Date()
    };
    
    this.sandboxes.set(sandboxId, sandbox);
    
    return sandbox;
  }
  
  async runInSandbox(sandbox: Sandbox, command: Command): Promise<CommandResult> {
    if (sandbox.status !== 'running') {
      throw new Error(`Sandbox ${sandbox.id} is not running`);
    }
    
    // 验证命令是否被允许
    if (!(await this.validateCommand(sandbox, command))) {
      return {
        success: false,
        stdout: '',
        stderr: 'Command not allowed by sandbox policy',
        exitCode: 1,
        executionTimeMs: 0,
        resourcesUsed: {
          cpuTimeMs: 0,
          memoryPeakBytes: 0,
          diskUsedBytes: 0,
          networkInBytes: 0,
          networkOutBytes: 0
        },
        error: 'Command not allowed'
      };
    }
    
    // 执行命令
    const startTime = Date.now();
    
    try {
      const container = this.docker.getContainer(sandbox.id);
      
      // 在容器中执行命令
      const exec = await container.exec({
        Cmd: [command.executable, ...command.args],
        Env: Object.entries(command.env).map(([k, v]) => `${k}=${v}`),
        AttachStdout: true,
        AttachStderr: true
      });
      
      const result = await exec.start();
      
      const endTime = Date.now();
      
      return {
        success: true,
        stdout: result.output || '',
        stderr: result.stderr || '',
        exitCode: 0, // Docker exec API doesn't provide exit code directly
        executionTimeMs: endTime - startTime,
        resourcesUsed: await this.getResourceUsage(sandbox.id)
      };
    } catch (error) {
      const endTime = Date.now();
      
      return {
        success: false,
        stdout: '',
        stderr: (error as Error).message,
        exitCode: 1,
        executionTimeMs: endTime - startTime,
        resourcesUsed: await this.getResourceUsage(sandbox.id),
        error: (error as Error).message
      };
    }
  }
  
  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }
    
    try {
      const container = this.docker.getContainer(sandboxId);
      await container.stop();
      await container.remove();
    } catch (error) {
      console.error(`Failed to destroy sandbox ${sandboxId}:`, error);
    }
    
    this.sandboxes.delete(sandboxId);
  }
  
  private async validateCommand(sandbox: Sandbox, command: Command): Promise<boolean> {
    // 检查可执行文件是否在允许列表中
    if (sandbox.config.allowlist.length > 0) {
      const exeName = path.basename(command.executable);
      if (!sandbox.config.allowlist.includes(exeName)) {
        return false;
      }
    }
    
    // 检查可执行文件是否在拒绝列表中
    if (sandbox.config.denylist.length > 0) {
      const exeName = path.basename(command.executable);
      if (sandbox.config.denylist.includes(exeName)) {
        return false;
      }
    }
    
    // 检查网络访问
    if (command.executable === 'curl' || command.executable === 'wget') {
      if (!sandbox.config.networkPolicy.allowOutbound) {
        return false;
      }
    }
    
    // 检查文件系统访问
    if (command.executable === 'rm' || command.executable === 'mv') {
      // 检查参数中的路径是否被允许
      for (const arg of command.args) {
        if (arg.startsWith('/')) { // 是绝对路径
          const allowed = sandbox.config.filesystemPolicy.allowedPaths.some(allowedPath => 
            arg.startsWith(allowedPath)
          );
          if (!allowed) {
            return false;
          }
        }
      }
    }
    
    return true;
  }
  
  private async getResourceUsage(containerId: string): Promise<ResourceUsage> {
    try {
      const stats = await this.docker.getContainer(containerId).stats({ stream: false });
      
      return {
        cpuTimeMs: stats.cpu_stats?.cpu_usage?.total_usage || 0,
        memoryPeakBytes: stats.memory_stats?.max_usage || 0,
        diskUsedBytes: 0, // Docker API doesn't provide disk usage directly
        networkInBytes: stats.networks ? Object.values(stats.networks).reduce((sum, net) => sum + net.rx_bytes, 0) : 0,
        networkOutBytes: stats.networks ? Object.values(stats.networks).reduce((sum, net) => sum + net.tx_bytes, 0) : 0
      };
    } catch {
      // 如果无法获取资源使用情况，返回默认值
      return {
        cpuTimeMs: 0,
        memoryPeakBytes: 0,
        diskUsedBytes: 0,
        networkInBytes: 0,
        networkOutBytes: 0
      };
    }
  }
}

// Node.js进程沙箱实现（替代方案）
export class ProcessSandboxSystem implements SandboxingSystem {
  private sandboxes: Map<string, ProcessSandbox> = new Map();
  
  async createSandbox(sessionId: string, config: SandboxConfig): Promise<Sandbox> {
    const sandboxId = `proc_${sessionId}_${Date.now()}`;
    
    // 创建进程沙箱
    const processSandbox: ProcessSandbox = {
      id: sandboxId,
      sessionId,
      config,
      status: 'created',
      childProcess: null,
      startTime: new Date()
    };
    
    this.sandboxes.set(sandboxId, processSandbox);
    
    const sandbox: Sandbox = {
      id: sandboxId,
      sessionId,
      config,
      status: 'running',
      createdAt: new Date()
    };
    
    return sandbox;
  }
  
  async runInSandbox(sandbox: Sandbox, command: Command): Promise<CommandResult> {
    const procSandbox = this.sandboxes.get(sandbox.id);
    if (!procSandbox) {
      throw new Error(`Sandbox ${sandbox.id} not found`);
    }
    
    // 验证命令
    if (!(await this.validateCommand(sandbox, command))) {
      return {
        success: false,
        stdout: '',
        stderr: 'Command not allowed by sandbox policy',
        exitCode: 1,
        executionTimeMs: 0,
        resourcesUsed: {
          cpuTimeMs: 0,
          memoryPeakBytes: 0,
          diskUsedBytes: 0,
          networkInBytes: 0,
          networkOutBytes: 0
        },
        error: 'Command not allowed'
      };
    }
    
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      // 设置超时
      const timeout = command.timeout || 30000; // 默认30秒
      
      const child = spawn(command.executable, command.args, {
        env: { ...process.env, ...command.env },
        cwd: command.cwd || os.tmpdir(),
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      procSandbox.childProcess = child;
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        procSandbox.childProcess = null;
        const endTime = Date.now();
        
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code || 0,
          executionTimeMs: endTime - startTime,
          resourcesUsed: this.getCurrentResourceUsage(child.pid)
        });
      });
      
      // 设置超时
      setTimeout(() => {
        if (child.pid) {
          process.kill(child.pid, 'SIGTERM');
          setTimeout(() => {
            if (child.pid) {
              process.kill(child.pid, 'SIGKILL'); // 强制终止
            }
          }, 5000);
        }
        
        resolve({
          success: false,
          stdout,
          stderr: `Command timed out after ${timeout}ms`,
          exitCode: 124, // 超时退出码
          executionTimeMs: timeout,
          resourcesUsed: this.getCurrentResourceUsage(child.pid),
          error: 'Command timed out'
        });
      }, timeout);
    });
  }
  
  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }
    
    if (sandbox.childProcess && !sandbox.childProcess.killed) {
      try {
        process.kill(sandbox.childProcess.pid, 'SIGTERM');
        setTimeout(() => {
          if (sandbox.childProcess && !sandbox.childProcess.killed) {
            process.kill(sandbox.childProcess.pid, 'SIGKILL');
          }
        }, 5000);
      } catch (error) {
        console.error(`Failed to terminate process for sandbox ${sandboxId}:`, error);
      }
    }
    
    this.sandboxes.delete(sandboxId);
  }
  
  private async validateCommand(sandbox: Sandbox, command: Command): Promise<boolean> {
    // 与Docker沙箱类似的验证逻辑
    if (sandbox.config.allowlist.length > 0) {
      const exeName = path.basename(command.executable);
      if (!sandbox.config.allowlist.includes(exeName)) {
        return false;
      }
    }
    
    if (sandbox.config.denylist.length > 0) {
      const exeName = path.basename(command.executable);
      if (sandbox.config.denylist.includes(exeName)) {
        return false;
      }
    }
    
    // 这里可以添加更多特定于进程沙箱的验证
    return true;
  }
  
  private getCurrentResourceUsage(pid?: number): ResourceUsage {
    if (!pid) {
      return {
        cpuTimeMs: 0,
        memoryPeakBytes: 0,
        diskUsedBytes: 0,
        networkInBytes: 0,
        networkOutBytes: 0
      };
    }
    
    try {
      const usage = process.memoryUsage();
      return {
        cpuTimeMs: 0, // Node.js doesn't provide easy CPU time access
        memoryPeakBytes: usage.heapTotal,
        diskUsedBytes: 0, // Difficult to track in Node.js
        networkInBytes: 0,
        networkOutBytes: 0
      };
    } catch {
      return {
        cpuTimeMs: 0,
        memoryPeakBytes: 0,
        diskUsedBytes: 0,
        networkInBytes: 0,
        networkOutBytes: 0
      };
    }
  }
}

// 进程沙箱扩展接口
interface ProcessSandbox extends Sandbox {
  childProcess: ChildProcess | null;
  startTime: Date;
}
```

## 数据保护措施

### 数据加密系统

Clawdbot实现了端到端的数据加密，确保用户数据在传输和存储过程中的安全：

```typescript
// 加密系统接口
export interface EncryptionSystem {
  encrypt(data: string, key?: string): Promise<string>;
  decrypt(encryptedData: string, key?: string): Promise<string>;
  generateKey(): Promise<string>;
  rotateKey(oldKey: string, newKey: string): Promise<void>;
  validateKey(key: string): boolean;
}

// AES-GCM加密实现
export class AESEncryptionSystem implements EncryptionSystem {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32; // 256 bits
  private ivLength = 12;  // 96 bits (recommended for GCM)
  
  async encrypt(data: string, key?: string): Promise<string> {
    const cryptoKey = key || this.getKeyFromConfig();
    const bufferKey = Buffer.from(cryptoKey, 'base64');
    
    if (bufferKey.length !== this.keyLength) {
      throw new Error(`Invalid key length. Expected ${this.keyLength} bytes.`);
    }
    
    // 生成随机IV
    const iv = crypto.randomBytes(this.ivLength);
    
    // 创建加密器
    const cipher = crypto.createCipherGCM(this.algorithm, bufferKey, iv);
    
    // 加密数据
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // 获取认证标签
    const authTag = cipher.getAuthTag();
    
    // 组合IV、认证标签和加密数据
    const result = {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted
    };
    
    return JSON.stringify(result);
  }
  
  async decrypt(encryptedData: string, key?: string): Promise<string> {
    const cryptoKey = key || this.getKeyFromConfig();
    const bufferKey = Buffer.from(cryptoKey, 'base64');
    
    if (bufferKey.length !== this.keyLength) {
      throw new Error(`Invalid key length. Expected ${this.keyLength} bytes.`);
    }
    
    try {
      const parsed = JSON.parse(encryptedData);
      const iv = Buffer.from(parsed.iv, 'base64');
      const authTag = Buffer.from(parsed.authTag, 'base64');
      const encrypted = parsed.data;
      
      // 创建解密器
      const decipher = crypto.createDecipherGCM(this.algorithm, bufferKey, iv);
      decipher.setAuthTag(authTag);
      
      // 解密数据
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt data: Invalid format or authentication failed');
    }
  }
  
  async generateKey(): Promise<string> {
    const key = crypto.randomBytes(this.keyLength);
    return key.toString('base64');
  }
  
  async rotateKey(oldKey: string, newKey: string): Promise<void> {
    // 这里应该实现密钥轮换逻辑
    // 1. 获取所有需要重新加密的数据
    // 2. 使用旧密钥解密
    // 3. 使用新密钥重新加密
    // 4. 更新存储
    console.log('Key rotation initiated');
  }
  
  validateKey(key: string): boolean {
    try {
      const buffer = Buffer.from(key, 'base64');
      return buffer.length === this.keyLength && key.length > 0;
    } catch {
      return false;
    }
  }
  
  private getKeyFromConfig(): string {
    // 从配置中获取加密密钥
    // 在实际实现中，这应该从安全的位置获取密钥
    // 例如：环境变量、密钥管理服务、配置文件等
    const key = process.env.CLAWDBOT_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('Encryption key not configured');
    }
    return key;
  }
}

// 会话数据加密器
export class SessionDataEncryptor {
  private encryptionSystem: EncryptionSystem;
  
  constructor(encryptionSystem: EncryptionSystem) {
    this.encryptionSystem = encryptionSystem;
  }
  
  async encryptSessionData(sessionData: any): Promise<string> {
    const jsonString = JSON.stringify(sessionData);
    return await this.encryptionSystem.encrypt(jsonString);
  }
  
  async decryptSessionData(encryptedData: string): Promise<any> {
    const jsonString = await this.encryptionSystem.decrypt(encryptedData);
    return JSON.parse(jsonString);
  }
  
  async encryptMessageContent(content: string, sessionId: string): Promise<string> {
    // 使用会话特定的密钥或派生密钥
    const sessionKey = await this.deriveSessionKey(sessionId);
    return await this.encryptionSystem.encrypt(content, sessionKey);
  }
  
  async decryptMessageContent(encryptedContent: string, sessionId: string): Promise<string> {
    const sessionKey = await this.deriveSessionKey(sessionId);
    return await this.encryptionSystem.decrypt(encryptedContent, sessionKey);
  }
  
  private async deriveSessionKey(sessionId: string): Promise<string> {
    // 从主密钥派生会话特定的密钥
    // 使用HKDF或其他密钥派生函数
    const masterKey = process.env.CLAWDBOT_ENCRYPTION_KEY;
    if (!masterKey) {
      throw new Error('Master encryption key not available');
    }
    
    const salt = crypto.createHash('sha256').update(sessionId).digest();
    const derivedKey = crypto.pbkdf2Sync(
      masterKey, 
      salt, 
      100000, // 迭代次数
      32,     // 密钥长度
      'sha256'
    );
    
    return derivedKey.toString('base64');
  }
}

// 数据脱敏器
export class DataSanitizer {
  private sensitivePatterns: RegExp[];
  
  constructor() {
    // 定义敏感数据的正则表达式模式
    this.sensitivePatterns = [
      // 电子邮件
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      // 电话号码
      /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      // 信用卡号码
      /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
      // 身份证号码（中国）
      /\b\d{17}[\dXx]\b/g,
      // IP地址
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
      // API密钥（常见格式）
      /sk-[a-zA-Z0-9_-]{20,}/g,
      /api[_-]?key[:\s]+[a-zA-Z0-9_-]{20,}/gi,
      // 密码字段
      /(password|pwd|pass)[:\s]+[^\s,;.!]{6,}/gi
    ];
  }
  
  sanitize(text: string): string {
    let sanitized = text;
    
    for (const pattern of this.sensitivePatterns) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    
    return sanitized;
  }
  
  async sanitizeAsync(text: string): Promise<string> {
    // 异步版本，适用于大量数据的处理
    return this.sanitize(text);
  }
}
```

### 安全监控系统

Clawdbot实现了全面的安全监控，以检测和响应潜在的安全威胁：

```typescript
// 安全监控系统接口
export interface SecurityMonitoringSystem {
  logEvent(event: SecurityEvent): Promise<void>;
  detectAnomalies(events: SecurityEvent[]): AnomalyReport[];
  generateAlerts(anomalies: AnomalyReport[]): Alert[];
  respondToIncident(alert: Alert): Promise<void>;
}

// 安全事件接口
export interface SecurityEvent {
  id: string;
  timestamp: Date;
  type: SecurityEventType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  details: Record<string, any>;
  source: 'auth' | 'network' | 'filesystem' | 'tool' | 'model';
}

// 安全事件类型
export type SecurityEventType = 
  | 'login_attempt'
  | 'login_success'
  | 'login_failure'
  | 'unauthorized_access'
  | 'malicious_command'
  | 'data_exfiltration'
  | 'privilege_escalation'
  | 'brute_force_attack'
  | 'suspicious_activity'
  | 'config_change'
  | 'session_hijacking'
  | 'crypto_mismatch';

// 异常报告
export interface AnomalyReport {
  id: string;
  eventId: string;
  type: 'anomaly' | 'threat' | 'policy_violation';
  confidence: number; // 0-1
  description: string;
  suggestedAction: 'monitor' | 'warn' | 'block' | 'investigate';
  relatedEvents: string[];
}

// 警报接口
export interface Alert {
  id: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  affectedResources: string[];
  suggestedResponse: string[];
  autoResponseApplied: boolean;
}

// 安全监控实现
export class SecurityMonitor implements SecurityMonitoringSystem {
  private eventLog: SecurityEvent[] = [];
  private alertCallbacks: ((alert: Alert) => void)[] = [];
  private anomalyDetectors: AnomalyDetector[] = [];
  private config: SecurityConfig;
  
  constructor(config: SecurityConfig) {
    this.config = config;
    this.initializeDetectors();
  }
  
  async logEvent(event: SecurityEvent): Promise<void> {
    this.eventLog.push(event);
    
    // 限制日志大小
    if (this.eventLog.length > 10000) {
      this.eventLog = this.eventLog.slice(-5000); // 保留最近5000个事件
    }
    
    // 实时检测异常
    const anomalies = this.detectAnomalies([event]);
    const alerts = this.generateAlerts(anomalies);
    
    for (const alert of alerts) {
      await this.handleAlert(alert);
    }
  }
  
  detectAnomalies(events: SecurityEvent[]): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    
    for (const detector of this.anomalyDetectors) {
      const detectorReports = detector.analyze(events);
      reports.push(...detectorReports);
    }
    
    return reports;
  }
  
  generateAlerts(anomalies: AnomalyReport[]): Alert[] {
    const alerts: Alert[] = [];
    
    for (const anomaly of anomalies) {
      if (anomaly.confidence > 0.7) { // 高置信度异常生成警报
        const alert: Alert = {
          id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          severity: anomaly.confidence > 0.9 ? 'critical' : 'warning',
          title: `Security Anomaly Detected: ${anomaly.type}`,
          description: anomaly.description,
          affectedResources: [anomaly.eventId],
          suggestedResponse: this.getSuggestedResponses(anomaly),
          autoResponseApplied: false
        };
        
        alerts.push(alert);
      }
    }
    
    return alerts;
  }
  
  async respondToIncident(alert: Alert): Promise<void> {
    console.log(`Responding to security incident: ${alert.title}`);
    
    // 根据警报严重程度采取相应措施
    switch (alert.severity) {
      case 'critical':
        // 立即阻止相关用户或IP
        await this.blockUserOrIP(alert);
        break;
      case 'warning':
        // 增加监控强度
        this.increaseMonitoring(alert);
        break;
      case 'info':
        // 记录但不采取行动
        break;
    }
  }
  
  subscribe(callback: (alert: Alert) => void): void {
    this.alertCallbacks.push(callback);
  }
  
  private async handleAlert(alert: Alert): Promise<void> {
    // 生成警报
    for (const callback of this.alertCallbacks) {
      try {
        callback(alert);
      } catch (error) {
        console.error('Error in alert callback:', error);
      }
    }
    
    // 自动响应
    if (this.config.audit?.enabled) {
      await this.respondToIncident(alert);
    }
  }
  
  private initializeDetectors(): void {
    // 登录异常检测器
    this.anomalyDetectors.push(new LoginAnomalyDetector());
    
    // 命令异常检测器
    this.anomalyDetectors.push(new CommandAnomalyDetector());
    
    // 访问模式检测器
    this.anomalyDetectors.push(new AccessPatternDetector());
    
    // 数据访问检测器
    this.anomalyDetectors.push(new DataAccessDetector());
  }
  
  private getSuggestedResponses(anomaly: AnomalyReport): string[] {
    switch (anomaly.suggestedAction) {
      case 'block':
        return ['Block user/IP', 'Review access logs', 'Notify administrators'];
      case 'warn':
        return ['Monitor closely', 'Review user activity', 'Consider access restrictions'];
      case 'investigate':
        return ['Investigate thoroughly', 'Check related accounts', 'Review security policies'];
      default:
        return ['Monitor activity', 'Document incident'];
    }
  }
  
  private async blockUserOrIP(alert: Alert): Promise<void> {
    // 实现阻止逻辑
    console.log('Blocking user/IP based on alert:', alert.id);
  }
  
  private increaseMonitoring(alert: Alert): void {
    // 实现增加监控逻辑
    console.log('Increasing monitoring for alert:', alert.id);
  }
}

// 异常检测器接口
interface AnomalyDetector {
  analyze(events: SecurityEvent[]): AnomalyReport[];
}

// 登录异常检测器
class LoginAnomalyDetector implements AnomalyDetector {
  analyze(events: SecurityEvent[]): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    const loginFailures = events.filter(e => e.type === 'login_failure');
    
    // 检测暴力破解攻击
    const failureGroups = this.groupByUserId(loginFailures);
    for (const [userId, userFailures] of failureGroups.entries()) {
      if (userFailures.length >= 5) { // 5次失败登录
        const timeSpan = this.getTimeSpan(userFailures);
        if (timeSpan < 300000) { // 5分钟内的5次失败
          reports.push({
            id: `anomaly_${Date.now()}_${userId}`,
            eventId: userFailures[userFailures.length - 1].id,
            type: 'threat',
            confidence: 0.9,
            description: `Potential brute force attack detected for user ${userId}`,
            suggestedAction: 'block',
            relatedEvents: userFailures.map(f => f.id)
          });
        }
      }
    }
    
    return reports;
  }
  
  private groupByUserId(events: SecurityEvent[]): Map<string, SecurityEvent[]> {
    const groups = new Map<string, SecurityEvent[]>();
    for (const event of events) {
      const userId = event.userId || 'unknown';
      if (!groups.has(userId)) {
        groups.set(userId, []);
      }
      groups.get(userId)!.push(event);
    }
    return groups;
  }
  
  private getTimeSpan(events: SecurityEvent[]): number {
    if (events.length < 2) return 0;
    const sorted = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return sorted[sorted.length - 1].timestamp.getTime() - sorted[0].timestamp.getTime();
  }
}

// 命令异常检测器
class CommandAnomalyDetector implements AnomalyDetector {
  analyze(events: SecurityEvent[]): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    const toolEvents = events.filter(e => e.source === 'tool');
    
    for (const event of toolEvents) {
      if (event.details?.command) {
        const suspicious = this.isSuspiciousCommand(event.details.command);
        if (suspicious) {
          reports.push({
            id: `anomaly_${Date.now()}_${event.id}`,
            eventId: event.id,
            type: 'policy_violation',
            confidence: 0.8,
            description: `Suspicious command detected: ${event.details.command}`,
            suggestedAction: 'block',
            relatedEvents: [event.id]
          });
        }
      }
    }
    
    return reports;
  }
  
  private isSuspiciousCommand(command: string): boolean {
    const suspiciousPatterns = [
      /rm\s+-rf/,
      /chmod\s+777/,
      /dd\s+if=\/dev\/zero/,
      /mkfs\./,
      /shred\s+-vf/,
      />&\s*\/dev\/null/,
      /nohup\s+.*&/,
      /;.*;/  // 多个命令
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(command));
  }
}

// 访问模式检测器
class AccessPatternDetector implements AnomalyDetector {
  analyze(events: SecurityEvent[]): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    
    // 这里可以实现更复杂的访问模式分析
    // 例如：异常时间访问、异常频率访问等
    
    return reports;
  }
}

// 数据访问检测器
class DataAccessDetector implements AnomalyDetector {
  analyze(events: SecurityEvent[]): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    
    // 检测异常的数据访问模式
    // 例如：大量数据导出、异常路径访问等
    
    return reports;
  }
}
```

## 总结

Clawdbot的安全模型与权限控制系统提供了一个全面的安全框架，具有以下关键特性：

1. **多层认证**：支持多种认证方式，包括密码、令牌和API密钥
2. **RBAC授权**：基于角色的访问控制，灵活的权限管理
3. **沙箱隔离**：多级沙箱机制，隔离不同会话和用户的操作
4. **数据加密**：端到端加密，保护敏感数据
5. **安全监控**：实时监控和异常检测，快速响应安全威胁
6. **审计日志**：详细的操作记录，便于安全审查

这种综合性的安全设计确保了Clawdbot能够在开放的网络环境中安全运行，保护用户数据和系统免受各种安全威胁。

在最后一课中，我们将探讨部署、运维与最佳实践，了解如何在生产环境中有效使用Clawdbot。