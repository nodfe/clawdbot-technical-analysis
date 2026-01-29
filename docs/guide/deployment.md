# 第10课：部署、运维与最佳实践

## 部署策略

Clawdbot提供了多种部署选项，适应不同的使用场景和需求。无论是在个人设备上运行还是在云环境中部署，都需要考虑性能、安全性和可维护性。

### 本地部署

本地部署是最常见的使用方式，适合个人使用和开发测试：

```bash
# 1. 安装依赖
npm install -g moltbot@latest
# 或使用pnpm
pnpm add -g moltbot@latest

# 2. 初始化配置
moltbot onboard --install-daemon

# 3. 启动服务
moltbot gateway --port 18789 --verbose

# 4. 配置开机自启（可选）
moltbot gateway --install-daemon
```

#### 本地部署配置示例

```json
{
  "agent": {
    "model": "anthropic/claude-3-5-sonnet-20241022",
    "workspace": "~/clawd"
  },
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "auth": {
      "mode": "password",
      "password": "your-secure-password"
    },
    "controlUi": {
      "enabled": true
    }
  },
  "channels": {
    "whatsapp": {
      "enabled": true,
      "dmPolicy": "pairing",
      "allowFrom": ["+1234567890"]
    }
  },
  "agents": {
    "defaults": {
      "workspace": "~/clawd",
      "sandbox": {
        "mode": "non-main",
        "allowlist": ["read", "write", "edit", "sessions_list", "sessions_history", "sessions_send"],
        "denylist": ["browser", "canvas", "nodes", "cron", "gateway"]
      }
    }
  }
}
```

### 云端部署

对于需要远程访问或团队协作的场景，可以部署到云端：

```bash
# 使用Docker部署
docker run -d \
  --name moltbot \
  -p 18789:18789 \
  -v ~/.clawdbot:/root/.clawdbot \
  -v ~/clawd:/root/clawd \
  -e CLAWDBOT_GATEWAY_PASSWORD=your-password \
  ghcr.io/moltbot/moltbot:latest

# 或使用Docker Compose
```

#### Docker Compose示例

```yaml
version: '3.8'

services:
  moltbot:
    image: ghcr.io/moltbot/moltbot:latest
    container_name: moltbot
    ports:
      - "18789:18789"
    volumes:
      - ~/.clawdbot:/root/.clawdbot
      - ~/clawd:/root/clawd
    environment:
      - CLAWDBOT_GATEWAY_PASSWORD=your-secure-password
      - CLAWDBOT_AGENT_MODEL=anthropic/claude-3-5-sonnet-20241022
    restart: unless-stopped
    networks:
      - moltbot-net

networks:
  moltbot-net:
    driver: bridge
```

### Tailscale部署

利用Tailscale可以安全地暴露本地服务到互联网：

```javascript
// 配置文件中启用Tailscale
{
  "gateway": {
    "tailscale": {
      "mode": "serve",  // 或 "funnel" 用于公共访问
      "resetOnExit": true
    }
  }
}
```

## 运维要点

### 监控和日志

有效的监控和日志记录是运维工作的基础：

```typescript
// 日志配置
export interface LogConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
  transports: LogTransport[];
  retention: {
    days: number;
    maxSize: string;  // 如 "100MB"
  };
}

// 日志传输器接口
interface LogTransport {
  type: 'file' | 'console' | 'syslog' | 'http';
  config: Record<string, any>;
}

// 监控指标接口
export interface Metrics {
  gateway: {
    uptime: number;
    activeConnections: number;
    requestsPerSecond: number;
    errorRate: number;
  };
  agents: {
    activeSessions: number;
    averageResponseTime: number;
    tokenUsage: {
      input: number;
      output: number;
      total: number;
    };
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkIO: {
      in: number;
      out: number;
    };
  };
}
```

### 备份和恢复

定期备份是确保数据安全的重要措施：

```bash
# 备份脚本示例
#!/bin/bash

BACKUP_DIR="/backup/moltbot"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p $BACKUP_DIR/$DATE

# 备份配置文件
cp -r ~/.clawdbot $BACKUP_DIR/$DATE/config

# 备份工作区
cp -r ~/clawd $BACKUP_DIR/$DATE/workspace

# 备份会话数据
cp -r ~/.clawdbot/state/agents $BACKUP_DIR/$DATE/sessions

# 压缩备份
cd $BACKUP_DIR
tar -czf moltbot_backup_$DATE.tar.gz $DATE/

# 清理超过30天的备份
find $BACKUP_DIR -name "moltbot_backup_*.tar.gz" -mtime +30 -delete

echo "Backup completed: moltbot_backup_$DATE.tar.gz"
```

### 性能调优

针对不同负载场景进行性能优化：

```typescript
// 性能配置示例
export interface PerformanceConfig {
  gateway: {
    maxConnections: number;
    connectionTimeout: number;
    requestTimeout: number;
    rateLimiting: {
      enabled: boolean;
      requestsPerMinute: number;
      burstSize: number;
    };
  };
  agents: {
    maxConcurrentRuns: number;
    sessionCacheSize: number;
    memoryLimit: number; // MB
    gcThreshold: number; // MB
  };
  tools: {
    exec: {
      maxProcesses: number;
      timeout: number;
      sandbox: boolean;
    };
    browser: {
      maxInstances: number;
      memoryLimit: number;
      timeout: number;
    };
  };
}
```

## 性能优化

### 资源管理

合理配置资源使用，避免系统过载：

```typescript
// 资源管理器
export class ResourceManager {
  private config: PerformanceConfig;
  private activeResources: Map<string, ResourceUsage> = new Map();
  
  constructor(config: PerformanceConfig) {
    this.config = config;
    this.setupResourceMonitoring();
  }
  
  async acquireResource(type: ResourceType, id: string, requirements: ResourceRequirements): Promise<boolean> {
    // 检查系统资源是否足够
    const systemStatus = await this.getSystemStatus();
    if (!this.hasSufficientResources(systemStatus, requirements)) {
      return false;
    }
    
    // 检查同类型资源是否已达上限
    const activeOfType = Array.from(this.activeResources.values())
      .filter(r => r.type === type)
      .length;
      
    if (type === 'agent' && activeOfType >= this.config.agents.maxConcurrentRuns) {
      return false;
    }
    
    // 记录资源使用
    this.activeResources.set(id, {
      type,
      requirements,
      acquiredAt: new Date()
    });
    
    return true;
  }
  
  releaseResource(id: string): void {
    this.activeResources.delete(id);
  }
  
  private async getSystemStatus(): Promise<SystemStatus> {
    const memory = process.memoryUsage();
    const cpus = os.cpus();
    
    return {
      memoryUsage: memory.rss,
      memoryAvailable: os.freemem(),
      cpuUsage: this.getCurrentCpuUsage(),
      diskUsage: await this.getDiskUsage(),
      activeConnections: this.getActiveGatewayConnections()
    };
  }
  
  private hasSufficientResources(status: SystemStatus, requirements: ResourceRequirements): boolean {
    if (requirements.memory && status.memoryAvailable < requirements.memory) {
      return false;
    }
    
    if (requirements.cpu && status.cpuUsage > (1 - requirements.cpu)) {
      return false;
    }
    
    return true;
  }
  
  private getCurrentCpuUsage(): number {
    // 简化的CPU使用率计算
    return 0.5; // 实际实现需要更复杂的计算
  }
  
  private async getDiskUsage(): Promise<number> {
    // 获取磁盘使用情况
    return 0.6; // 实际实现需要使用系统命令
  }
  
  private getActiveGatewayConnections(): number {
    // 获取活跃的网关连接数
    return 0; // 需要从网关实例获取
  }
  
  private setupResourceMonitoring(): void {
    // 设置定期资源监控
    setInterval(async () => {
      const status = await this.getSystemStatus();
      if (status.memoryUsage > this.config.agents.memoryLimit * 0.8) {
        // 触发垃圾回收
        this.triggerGarbageCollection();
      }
    }, 5000); // 每5秒检查一次
  }
  
  private triggerGarbageCollection(): void {
    if (global.gc) {
      global.gc();
    }
  }
}

interface ResourceUsage {
  type: ResourceType;
  requirements: ResourceRequirements;
  acquiredAt: Date;
}

type ResourceType = 'agent' | 'browser' | 'exec' | 'memory' | 'disk';

interface ResourceRequirements {
  memory?: number;    // bytes
  cpu?: number;       // 0-1 (fraction of core)
  disk?: number;      // bytes
  network?: number;   // bytes/sec
}

interface SystemStatus {
  memoryUsage: number;
  memoryAvailable: number;
  cpuUsage: number;
  diskUsage: number;
  activeConnections: number;
}
```

### 缓存策略

实施多级缓存以提高性能：

```typescript
// 多级缓存系统
export class MultiLevelCache {
  private memoryCache: Map<string, CacheItem> = new Map();
  private diskCache: DiskCache;
  private ttl: number;
  
  constructor(ttl: number = 300000) { // 5分钟默认TTL
    this.ttl = ttl;
    this.diskCache = new DiskCache('./cache');
    this.setupCacheEviction();
  }
  
  async get(key: string): Promise<any | null> {
    // 首先检查内存缓存
    const memItem = this.memoryCache.get(key);
    if (memItem && !this.isExpired(memItem)) {
      return memItem.value;
    }
    
    // 然后检查磁盘缓存
    const diskValue = await this.diskCache.get(key);
    if (diskValue !== null) {
      // 将磁盘缓存项提升到内存缓存
      this.memoryCache.set(key, {
        value: diskValue,
        timestamp: Date.now(),
        ttl: this.ttl
      });
      return diskValue;
    }
    
    return null;
  }
  
  async set(key: string, value: any): Promise<void> {
    // 设置内存缓存
    this.memoryCache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: this.ttl
    });
    
    // 设置磁盘缓存
    await this.diskCache.set(key, value);
  }
  
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    await this.diskCache.delete(key);
  }
  
  private isExpired(item: CacheItem): boolean {
    return Date.now() - item.timestamp > item.ttl;
  }
  
  private setupCacheEviction(): void {
    // 定期清理过期项
    setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.memoryCache.entries()) {
        if (now - item.timestamp > item.ttl) {
          this.memoryCache.delete(key);
        }
      }
    }, 60000); // 每分钟清理一次
  }
}

interface CacheItem {
  value: any;
  timestamp: number;
  ttl: number;
}

// 磁盘缓存实现
class DiskCache {
  private cacheDir: string;
  
  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  async get(key: string): Promise<any | null> {
    const filePath = path.join(this.cacheDir, this.hashKey(key) + '.json');
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      
      if (Date.now() - data.timestamp > data.ttl) {
        await fs.unlink(filePath);
        return null;
      }
      
      return data.value;
    } catch (error) {
      return null;
    }
  }
  
  async set(key: string, value: any): Promise<void> {
    const filePath = path.join(this.cacheDir, this.hashKey(key) + '.json');
    const data = {
      value,
      timestamp: Date.now(),
      ttl: 300000 // 5分钟
    };
    await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
  }
  
  async delete(key: string): Promise<void> {
    const filePath = path.join(this.cacheDir, this.hashKey(key) + '.json');
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // 文件不存在也正常
    }
  }
  
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}
```

## 故障排除与调试

### 常见问题诊断

```typescript
// 诊断工具类
export class Diagnostics {
  static async diagnoseSystem(): Promise<DiagnosticsReport> {
    const report: DiagnosticsReport = {
      timestamp: new Date(),
      system: await this.getSystemInfo(),
      processes: await this.getProcessInfo(),
      network: await this.getNetworkInfo(),
      storage: await this.getStorageInfo(),
      issues: []
    };
    
    // 检查常见问题
    report.issues.push(...await this.checkCommonIssues(report));
    
    return report;
  }
  
  private static async getSystemInfo(): Promise<SystemInfo> {
    return {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      loadAverage: os.loadavg(),
      cpuCount: os.cpus().length,
      nodeVersion: process.version,
      moltbotVersion: '2026.1.27-beta.1'
    };
  }
  
  private static async getProcessInfo(): Promise<ProcessInfo> {
    return {
      pid: process.pid,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      argv: process.argv,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        CLAWDBOT_GATEWAY_PORT: process.env.CLAWDBOT_GATEWAY_PORT,
        CLAWDBOT_AGENT_MODEL: process.env.CLAWDBOT_AGENT_MODEL
      }
    };
  }
  
  private static async getNetworkInfo(): Promise<NetworkInfo> {
    const interfaces = os.networkInterfaces();
    const addresses: NetworkAddress[] = [];
    
    for (const [name, ifaceList] of Object.entries(interfaces)) {
      for (const iface of ifaceList || []) {
        if (!iface.internal && iface.family === 'IPv4') {
          addresses.push({
            name,
            address: iface.address,
            family: iface.family,
            mac: iface.mac
          });
        }
      }
    }
    
    return { addresses };
  }
  
  private static async getStorageInfo(): Promise<StorageInfo> {
    // 获取存储使用情况
    return {
      homeDir: os.homedir(),
      tempDir: os.tmpdir(),
      clawdDir: path.join(os.homedir(), 'clawd'),
      configDir: path.join(os.homedir(), '.clawdbot')
    };
  }
  
  private static async checkCommonIssues(report: DiagnosticsReport): Promise<Issue[]> {
    const issues: Issue[] = [];
    
    // 检查内存使用
    if (report.system.freeMemory / report.system.totalMemory < 0.1) {
      issues.push({
        severity: 'warning',
        category: 'system',
        title: 'Low memory available',
        description: `Only ${(report.system.freeMemory / 1024 / 1024).toFixed(2)} MB available`,
        recommendation: 'Consider closing other applications or upgrading hardware'
      });
    }
    
    // 检查磁盘空间
    const homeStat = await fs.stat(report.system.homeDir).catch(() => null);
    if (homeStat) {
      // 这里需要实际检查磁盘空间
    }
    
    // 检查端口占用
    if (report.processes.env.CLAWDBOT_GATEWAY_PORT) {
      const port = parseInt(report.processes.env.CLAWDBOT_GATEWAY_PORT);
      if (port) {
        const portInUse = await this.isPortInUse(port);
        if (portInUse) {
          issues.push({
            severity: 'error',
            category: 'network',
            title: 'Gateway port in use',
            description: `Port ${port} is already in use by another process`,
            recommendation: 'Change CLAWDBOT_GATEWAY_PORT or stop the conflicting process'
          });
        }
      }
    }
    
    return issues;
  }
  
  private static async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.close();
        resolve(false);
      });
      server.on('error', (err: any) => {
        server.close();
        resolve(err.code === 'EADDRINUSE');
      });
    });
  }
}

interface DiagnosticsReport {
  timestamp: Date;
  system: SystemInfo;
  processes: ProcessInfo;
  network: NetworkInfo;
  storage: StorageInfo;
  issues: Issue[];
}

interface SystemInfo {
  platform: string;
  arch: string;
  release: string;
  uptime: number;
  totalMemory: number;
  freeMemory: number;
  loadAverage: number[];
  cpuCount: number;
  nodeVersion: string;
  moltbotVersion: string;
}

interface ProcessInfo {
  pid: number;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
  argv: string[];
  env: Record<string, string | undefined>;
}

interface NetworkInfo {
  addresses: NetworkAddress[];
}

interface NetworkAddress {
  name: string;
  address: string;
  family: string;
  mac: string;
}

interface StorageInfo {
  homeDir: string;
  tempDir: string;
  clawdDir: string;
  configDir: string;
}

interface Issue {
  severity: 'info' | 'warning' | 'error';
  category: string;
  title: string;
  description: string;
  recommendation: string;
}
```

### 调试工具

```typescript
// 调试工具
export class DebuggingTools {
  static async traceAgentRun(sessionId: string, runId: string): Promise<TraceResult> {
    // 追踪代理运行过程
    const trace: TraceResult = {
      sessionId,
      runId,
      startTime: new Date(),
      events: [],
      performance: {
        totalDuration: 0,
        modelCallTime: 0,
        toolExecutionTime: 0
      }
    };
    
    // 这里实现实际的追踪逻辑
    // 通常需要钩子函数或特殊标记的运行模式
    
    return trace;
  }
  
  static async inspectSession(sessionId: string): Promise<SessionInspection> {
    // 检查会话状态
    const sessionPath = path.join(os.homedir(), '.clawdbot', 'state', 'agents', 'main', 'sessions', `${sessionId}.json`);
    
    try {
      const content = await fs.readFile(sessionPath, 'utf8');
      const sessionData = JSON.parse(content);
      
      return {
        sessionId,
        exists: true,
        size: Buffer.byteLength(content),
        lastModified: (await fs.stat(sessionPath)).mtime,
        messageCount: Array.isArray(sessionData.history) ? sessionData.history.length : 0,
        tokenCount: sessionData.tokenCount || 0,
        metadata: sessionData.metadata || {}
      };
    } catch (error) {
      return {
        sessionId,
        exists: false,
        error: (error as Error).message
      };
    }
  }
  
  static async profileMemory(): Promise<MemoryProfile> {
    // 内存分析
    const usage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    
    return {
      processMemory: usage,
      heapStatistics: heapStats,
      heapCodeStatistics: v8.getHeapCodeStatistics(),
      totalMemory: usage.heapTotal,
      usedMemory: usage.heapUsed,
      externalMemory: usage.external
    };
  }
}

interface TraceResult {
  sessionId: string;
  runId: string;
  startTime: Date;
  events: TraceEvent[];
  performance: PerformanceMetrics;
}

interface TraceEvent {
  timestamp: Date;
  type: string;
  data: any;
}

interface PerformanceMetrics {
  totalDuration: number;
  modelCallTime: number;
  toolExecutionTime: number;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

interface SessionInspection {
  sessionId: string;
  exists: boolean;
  size?: number;
  lastModified?: Date;
  messageCount?: number;
  tokenCount?: number;
  metadata?: any;
  error?: string;
}

interface MemoryProfile {
  processMemory: NodeJS.MemoryUsage;
  heapStatistics: HeapStatistics;
  heapCodeStatistics: HeapCodeStatistics;
  totalMemory: number;
  usedMemory: number;
  externalMemory: number;
}

interface HeapStatistics {
  total_heap_size: number;
  total_heap_size_executable: number;
  total_physical_size: number;
  total_available_size: number;
  used_heap_size: number;
  heap_size_limit: number;
  malloced_memory: number;
  peak_malloced_memory: number;
  does_zap_garbage: DoesZapCodeSpaceFlag;
  number_of_native_contexts: number;
  number_of_detached_contexts: number;
  total_global_handles_size: number;
  used_global_handles_size: number;
}

interface HeapCodeStatistics {
  code_and_metadata_size: number;
  bytecode_and_metadata_size: number;
  external_script_source_size: number;
}

type DoesZapCodeSpaceFlag = 0 | 1;
```

## 最佳实践

### 配置管理

```typescript
// 配置最佳实践
export class ConfigBestPractices {
  // 安全配置检查
  static validateSecureConfig(config: any): ValidationResult[] {
    const errors: ValidationResult[] = [];
    
    // 检查认证配置
    if (config.gateway?.auth?.mode === 'none') {
      errors.push({
        level: 'error',
        message: 'Gateway authentication is disabled (security risk)',
        recommendation: 'Set gateway.auth.mode to "password" or "oauth"'
      });
    }
    
    // 检查密码强度
    if (config.gateway?.auth?.password && config.gateway?.auth?.password.length < 12) {
      errors.push({
        level: 'warning',
        message: 'Gateway password is too short',
        recommendation: 'Use a strong password with at least 12 characters'
      });
    }
    
    // 检查沙箱配置
    if (config.agents?.defaults?.sandbox?.mode !== 'non-main') {
      errors.push({
        level: 'warning',
        message: 'Sandbox mode is not enabled for non-main sessions',
        recommendation: 'Set agents.defaults.sandbox.mode to "non-main" for better security'
      });
    }
    
    // 检查DM策略
    if (config.channels?.whatsapp?.dmPolicy !== 'pairing') {
      errors.push({
        level: 'warning',
        message: 'WhatsApp DM policy is not set to pairing (security risk)',
        recommendation: 'Set channels.whatsapp.dmPolicy to "pairing" to prevent spam'
      });
    }
    
    return errors;
  }
  
  // 性能配置建议
  static suggestPerformanceConfig(isProduction: boolean): SuggestedConfig {
    const baseConfig = {
      gateway: {
        maxConnections: isProduction ? 100 : 10,
        requestTimeout: 30000,
        rateLimiting: {
          enabled: isProduction,
          requestsPerMinute: isProduction ? 1000 : 100,
          burstSize: isProduction ? 100 : 10
        }
      },
      agents: {
        maxConcurrentRuns: isProduction ? 5 : 2,
        sessionCacheSize: isProduction ? 100 : 10,
        memoryLimit: isProduction ? 1024 : 512  // MB
      }
    };
    
    return baseConfig as SuggestedConfig;
  }
  
  // 安全配置模板
  static getSecureConfigTemplate(): any {
    return {
      "agent": {
        "model": "anthropic/claude-3-5-sonnet-20241022"
      },
      "gateway": {
        "port": 18789,
        "bind": "loopback",
        "auth": {
          "mode": "password",
          "password": "generate-a-very-secure-password"
        },
        "controlUi": {
          "enabled": true
        },
        "ssl": {
          "enabled": true,
          "certPath": "/path/to/certificate.pem",
          "keyPath": "/path/to/private-key.pem"
        }
      },
      "channels": {
        "whatsapp": {
          "dmPolicy": "pairing",
          "allowFrom": []
        }
      },
      "agents": {
        "defaults": {
          "sandbox": {
            "mode": "non-main",
            "allowlist": ["read", "write", "edit", "sessions_list"],
            "denylist": ["browser", "nodes", "gateway", "exec"]
          }
        }
      }
    };
  }
}

interface ValidationResult {
  level: 'error' | 'warning' | 'info';
  message: string;
  recommendation: string;
}

interface SuggestedConfig {
  gateway: {
    maxConnections: number;
    requestTimeout: number;
    rateLimiting: {
      enabled: boolean;
      requestsPerMinute: number;
      burstSize: number;
    };
  };
  agents: {
    maxConcurrentRuns: number;
    sessionCacheSize: number;
    memoryLimit: number;
  };
}
```

### 监控和告警

```typescript
// 监控和告警系统
export class MonitoringSystem {
  private thresholds: Thresholds;
  private alertCallbacks: AlertCallback[] = [];
  
  constructor(thresholds: Thresholds) {
    this.thresholds = thresholds;
    this.setupMonitoring();
  }
  
  subscribe(callback: AlertCallback): void {
    this.alertCallbacks.push(callback);
  }
  
  private setupMonitoring(): void {
    // 设置定期检查
    setInterval(async () => {
      const metrics = await this.collectMetrics();
      const alerts = this.checkThresholds(metrics);
      
      for (const alert of alerts) {
        await this.triggerAlert(alert);
      }
    }, this.thresholds.checkInterval || 60000); // 默认每分钟检查
  }
  
  private async collectMetrics(): Promise<Metrics> {
    // 收集系统指标
    return {
      gateway: {
        uptime: process.uptime(),
        activeConnections: 0, // 需要从网关实例获取
        requestsPerSecond: 0,
        errorRate: 0
      },
      agents: {
        activeSessions: 0,
        averageResponseTime: 0,
        tokenUsage: {
          input: 0,
          output: 0,
          total: 0
        }
      },
      system: {
        cpuUsage: 0, // 实际实现需要获取系统指标
        memoryUsage: 0,
        diskUsage: 0,
        networkIO: {
          in: 0,
          out: 0
        }
      }
    };
  }
  
  private checkThresholds(metrics: Metrics): Alert[] {
    const alerts: Alert[] = [];
    
    // 检查CPU使用率
    if (metrics.system.cpuUsage > this.thresholds.cpuCritical) {
      alerts.push({
        level: 'critical',
        metric: 'system.cpuUsage',
        currentValue: metrics.system.cpuUsage,
        threshold: this.thresholds.cpuCritical,
        message: 'CPU usage is critically high'
      });
    } else if (metrics.system.cpuUsage > this.thresholds.cpuWarning) {
      alerts.push({
        level: 'warning',
        metric: 'system.cpuUsage',
        currentValue: metrics.system.cpuUsage,
        threshold: this.thresholds.cpuWarning,
        message: 'CPU usage is high'
      });
    }
    
    // 检查内存使用率
    if (metrics.system.memoryUsage > this.thresholds.memoryCritical) {
      alerts.push({
        level: 'critical',
        metric: 'system.memoryUsage',
        currentValue: metrics.system.memoryUsage,
        threshold: this.thresholds.memoryCritical,
        message: 'Memory usage is critically high'
      });
    }
    
    // 检查错误率
    if (metrics.gateway.errorRate > this.thresholds.errorRateCritical) {
      alerts.push({
        level: 'critical',
        metric: 'gateway.errorRate',
        currentValue: metrics.gateway.errorRate,
        threshold: this.thresholds.errorRateCritical,
        message: 'Error rate is critically high'
      });
    }
    
    return alerts;
  }
  
  private async triggerAlert(alert: Alert): Promise<void> {
    console.log(`ALERT [${alert.level.toUpperCase()}]: ${alert.message}`);
    console.log(`Metric: ${alert.metric}, Current: ${alert.currentValue}, Threshold: ${alert.threshold}`);
    
    for (const callback of this.alertCallbacks) {
      try {
        await callback(alert);
      } catch (error) {
        console.error('Error in alert callback:', error);
      }
    }
  }
}

interface Thresholds {
  cpuWarning: number;      // 0.8 = 80%
  cpuCritical: number;     // 0.95 = 95%
  memoryCritical: number;  // 0.9 = 90%
  errorRateCritical: number; // 0.1 = 10%
  checkInterval?: number;    // 毫秒
}

type AlertCallback = (alert: Alert) => Promise<void>;

interface Alert {
  level: 'warning' | 'critical';
  metric: string;
  currentValue: number;
  threshold: number;
  message: string;
}
```

## 未来发展方向

Clawdbot作为一个不断发展的平台，未来的发展方向包括：

1. **增强的AI集成**：支持更多模型提供商和更先进的AI功能
2. **分布式架构**：支持集群部署和负载均衡
3. **边缘计算**：在边缘设备上运行AI模型
4. **自动化运维**：更智能的自我监控和修复能力
5. **扩展的工具生态**：更多的内置工具和第三方集成

## 总结

通过这十课的深入学习，我们全面了解了Clawdbot的技术架构和实现原理：

1. **架构设计**：模块化设计，清晰的组件分离
2. **网关系统**：中央控制平面，统一接口管理
3. **多通道支持**：灵活的通信平台集成
4. **代理系统**：智能AI交互核心
5. **工具系统**：丰富的扩展能力
6. **技能系统**：可重用功能模块
7. **内存管理**：智能的状态和记忆管理
8. **模型集成**：多提供商支持和故障转移
9. **安全模型**：多层次防护体系
10. **部署运维**：生产就绪的最佳实践

Clawdbot的设计哲学是提供一个安全、灵活、可扩展的AI助手平台，让每个人都能在自己的设备上运行强大的AI助手。通过模块化的设计和丰富的扩展机制，它能够适应各种使用场景和需求。

掌握这些知识后，您将能够：
- 部署和配置Clawdbot
- 扩展其功能和工具
- 优化性能和安全性
- 有效地进行运维和故障排除
- 根据需要定制和修改系统

希望这个系列教程对您理解和使用Clawdbot有所帮助！