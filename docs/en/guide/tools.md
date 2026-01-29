# Lesson 5: Tool System & Extension Mechanisms

## Built-in Tool System

Clawdbot provides a rich set of built-in tools that agents can use to interact with the external world. These tools are the bridge between the AI model's decision-making and actual execution.

### Tool Registry

Tools are managed through a central registry:

```typescript
// Tool registry interface
interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
}

// Tool definition
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: any, context: ToolContext) => Promise<any>;
}
```

### Core Tools Overview

#### 1. File System Tools
- `read`: Read file contents. Supports text and images.
- `write`: Write content to a file.
- `edit`: Precisely replace text in a file.

#### 2. Execution Tools
- `exec`: Execute shell commands.
- `process`: Manage background processes.

#### 3. Browser Tools
- `browser`: Control a headless browser for web interactions.

#### 4. Node Tools
- `nodes`: Manage and control connected nodes (devices).

#### 5. Scheduler Tools
- `cron`: Manage scheduled tasks.

## Browser Control Tools

The browser tool is one of the most powerful capabilities of Clawdbot, allowing agents to browse the web, interact with pages, and capture screenshots.

### Browser Architecture

Clawdbot uses Playwright or Puppeteer as the underlying browser engine, providing a simplified control interface:

```typescript
// Browser tool implementation logic
async function browserTool(params: BrowserParams) {
  const { action, url, selector, text } = params;
  
  switch (action) {
    case 'navigate':
      await page.goto(url);
      break;
    case 'click':
      await page.click(selector);
      break;
    case 'type':
      await page.type(selector, text);
      break;
    case 'screenshot':
      return await page.screenshot();
    // ... other actions
  }
}
```

### Browser Session Management

Browser sessions are isolated to ensure that one agent's browsing data does not leak to others:

```typescript
// Create isolated browser context
const context = await browser.newContext({
  userAgent: 'Clawdbot/1.0',
  viewport: { width: 1280, height: 720 }
});
const page = await context.newPage();
```

## Canvas Visualization System

The Canvas tool allows agents to render HTML/JS content for the user, useful for creating dashboards, charts, or interactive UIs.

### Canvas Rendering

```typescript
// Canvas tool usage
await tools.canvas.present({
  html: '<h1>Hello from Clawdbot</h1>',
  width: 800,
  height: 600
});
```

### Interaction Handling

Canvas supports bi-directional interaction, allowing users to click elements in the rendered canvas and send events back to the agent.

```typescript
// Handling canvas events
gateway.on('canvas.event', (event) => {
  // Dispatch event to relevant agent session
  agent.handleEvent(event);
});
```

## Node System

The Node system allows Clawdbot to connect to and control other devices running the Clawdbot Node client.

### Node Discovery & Pairing

Nodes are discovered via local network (mDNS) or Tailscale:

```typescript
// Node discovery
nodeService.on('node:discovered', (node) => {
  console.log(`Discovered node: ${node.id} at ${node.address}`);
});

// Node pairing
await nodeService.pair(nodeId, pairingCode);
```

### Remote Execution

Once paired, the agent can execute commands or tools on the remote node:

```typescript
// Execute command on remote node
await tools.nodes.run({
  node: 'living-room-pc',
  command: 'systemctl restart nginx'
});
```

## Tool Extension Mechanism

Developers can extend Clawdbot's capabilities by adding custom tools.

### Creating Custom Tools

```typescript
// Define a custom weather tool
const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string' }
    },
    required: ['location']
  },
  execute: async ({ location }) => {
    const apiKey = process.env.WEATHER_API_KEY;
    const response = await fetch(`https://api.weather.com/v1?q=${location}&key=${apiKey}`);
    return await response.json();
  }
};

// Register the tool
registry.register(weatherTool);
```

## Summary

The tool system is what makes Clawdbot an "agent" rather than just a chatbot. Through file operations, browser control, and node management, it can perform real-world tasks. The extensible design allows users to customize their assistant's capabilities according to their needs.

In the next lesson, we will explore the Skills system and Plugin architecture, which are higher-level abstractions for packaging tools and behaviors.
