# Lesson 9: Security Model & Permissions

## Security Design Principles

Clawdbot operates on a "Local-First" and "User-Controlled" security philosophy. Since the agent runs on your device, it has potential access to sensitive data. The security model ensures that this access is controlled and safe.

### Principles
1.  **Least Privilege**: Agents only get access to the tools they need.
2.  **Sandbox Isolation**: Risky operations are sandboxed.
3.  **User Approval**: Sensitive actions (like paying money or deleting files) require explicit user confirmation.

## Permission Verification Mechanism

Every tool execution passes through a permission check layer.

```typescript
// Permission check
function checkPermission(agent: Agent, tool: string, params: any): boolean {
  const policy = securityConfig.policies[agent.role];
  
  if (policy.allowlist.includes(tool)) return true;
  if (policy.denylist.includes(tool)) return false;
  
  // Default to asking the user
  return askUserConfirmation(agent, tool, params);
}
```

## Sandbox Isolation Strategy

For executing code (e.g., Python scripts or shell commands), Clawdbot uses sandboxing technologies.

### Docker / Container Sandbox
Code execution happens inside a Docker container, isolating it from the host file system and network.

```typescript
// Executing code in sandbox
await docker.run('node:18', ['node', '-e', userCode], {
  NetworkDisabled: true, // No internet access
  Binds: ['/tmp/input:/input:ro'] // Read-only input
});
```

### Process Isolation
For lighter-weight isolation, Clawdbot can run processes as a low-privilege user.

## Data Protection Measures

### Encryption at Rest
Session logs and memory files can be encrypted on disk using AES-256.

### PII Redaction
Before sending logs to cloud monitoring (if enabled), Personally Identifiable Information (PII) like emails and phone numbers can be automatically redacted.

```typescript
// PII Redaction
function redactLogs(log: string) {
  return log.replace(/\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/g, '[EMAIL_REDACTED]');
}
```

## Summary

Security is paramount when giving an AI agent agency. Clawdbot's multi-layered approach—from permission checks to sandboxing—ensures that you can trust your assistant to be helpful without being dangerous.

In the final lesson, we will cover Deployment, Operations, and Best Practices for running Clawdbot in production.
