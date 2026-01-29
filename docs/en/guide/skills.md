# Lesson 6: Skills System & Plugin Architecture

## Skills System Design

The Skills system is a higher-level abstraction in Clawdbot. While Tools provide atomic operations (like "read file" or "click button"), Skills package tools, prompts, and logic into reusable capabilities (like "GitHub Management" or "Daily Briefing").

### Skill Definition

A Skill typically consists of:
1.  **SKILL.md**: A description file that the Agent reads to understand how to use the skill.
2.  **Tools**: Custom tools provided by the skill.
3.  **Resources**: Scripts, templates, or assets needed by the skill.

### Skill Discovery & Loading

The Agent scans the `skills/` directory to discover available skills:

```typescript
// Skill discovery logic
async function discoverSkills(skillsDir: string) {
  const skills = [];
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillPath = path.join(skillsDir, entry.name);
      if (await fs.exists(path.join(skillPath, 'SKILL.md'))) {
        skills.push(loadSkill(skillPath));
      }
    }
  }
  return skills;
}
```

## Skill Registration & Management

### Dynamic Skill Activation

Agents don't load all skills at once to save context window. They read skill descriptions and load them on demand.

```typescript
// <available_skills>
//   <skill>
//     <name>github</name>
//     <description>Interact with GitHub using the gh CLI...</description>
//     <location>...</location>
//   </skill>
// </available_skills>
```

When an agent decides to use a skill, it calls the `read` tool on the skill's `SKILL.md` file.

### Skill Context Injection

Once loaded, the skill's instructions are injected into the agent's context:

```typescript
// Injecting skill context
async function injectSkill(agent: Agent, skill: Skill) {
  const content = await fs.readFile(skill.skillMdPath, 'utf8');
  agent.addToContext({
    role: 'system',
    content: `You have loaded the ${skill.name} skill.\n${content}`
  });
}
```

## Plugin Architecture

Plugins are the mechanism for extending the core Clawdbot platform, including Channels, Gateway methods, and Hooks.

### Plugin Lifecycle

1.  **Load**: Plugin is loaded at startup from `extensions/` or `node_modules`.
2.  **Initialize**: Plugin's `init` function is called with the Gateway context.
3.  **Register**: Plugin registers new channels, tools, or API endpoints.
4.  **Shutdown**: Cleanup resources on stop.

### Extension Points

Plugins can extend almost every part of the system:

```typescript
// Example: Registering a custom API endpoint via plugin
export function myPlugin(ctx: PluginContext) {
  ctx.gateway.registerMethod('my.custom.method', async (params) => {
    return { success: true, data: 'Hello from plugin' };
  });
  
  ctx.events.on('session.created', (session) => {
    console.log('New session created via plugin hook');
  });
}
```

## External Extension Mechanisms

Clawdbot also supports external extensions via:

1.  **MCP (Model Context Protocol)**: Support for the emerging MCP standard to connect with external tools.
2.  **HTTP Webhooks**: Receiving events from external services (e.g., GitHub Webhooks).
3.  **stdio Integration**: Running simple scripts as tools via standard input/output.

## Summary

The Skills and Plugin systems provide two layers of extensibility:
- **Skills**: Extend the AI's capabilities (cognitive & operational) dynamically.
- **Plugins**: Extend the Platform's infrastructure (channels, API, protocols).

Together, they allow Clawdbot to evolve from a simple chatbot into a specialized assistant for any domain.

In the next lesson, we will discuss Memory and State Management, which is crucial for maintaining continuity across long interactions.
