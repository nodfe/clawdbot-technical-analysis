# Lesson 3: Multi-Channel System

## Supported Communication Channels

One of Clawdbot's core features is its multi-channel system, supporting a wide range of communication platforms:

- **WhatsApp**: Web API via Baileys library
- **Telegram**: Based on grammY framework
- **Discord**: Using discord.js library
- **Slack**: Via Slack Bolt framework
- **Google Chat**: Using official API
- **Signal**: Via signal-cli
- **iMessage**: Native macOS integration
- **BlueBubbles**: Extension plugin
- **Microsoft Teams**: Extension plugin
- **Matrix**: Extension plugin
- **Zalo**: Extension plugin
- **WebChat**: Built-in web interface

## Channel Abstraction Layer Design

Clawdbot manages various communication channels uniformly through a set of carefully designed abstraction layers, allowing core functionality to be reused across platforms.

### Channel Plugin Architecture

Let's look at the implementation of the WhatsApp channel:

```typescript
// Simplified version from extensions/whatsapp/src/channel.ts
import { getWhatsAppRuntime } from "./runtime.js";

export const whatsappPlugin: ChannelPlugin<ResolvedWhatsAppAccount> = {
  id: "whatsapp",
  meta: {
    // Channel metadata
    name: "WhatsApp",
    showConfigured: false,
    quickstartAllowFrom: true,
    forceAccountBinding: true,
    preferSessionLookupForAnnounceTarget: true,
  },
  // Channel lifecycle management
  onboarding: whatsappOnboardingAdapter,
  // Agent tool definition
  agentTools: () => [getWhatsAppRuntime().channel.whatsapp.createLoginTool()],
  // Pairing functionality
  pairing: {
    idLabel: "whatsappSenderId",
  },
  // Feature capabilities declaration
  capabilities: {
    chatTypes: ["direct", "group"],  // Supports direct messages and group chats
    polls: true,                     // Supports polls
    reactions: true,                 // Supports reactions/emojis
    media: true,                     // Supports media files
  },
  // Configuration reload pattern
  reload: { configPrefixes: ["web"], noopPrefixes: ["channels.whatsapp"] },
  gatewayMethods: ["web.login.start", "web.login.wait"],
  // Configuration schema
  configSchema: buildChannelConfigSchema(WhatsAppConfigSchema),
  // Configuration management
  config: {
    listAccountIds: (cfg) => listWhatsAppAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveWhatsAppAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultWhatsAppAccountId(cfg),
    // ... more config methods
  },
  // Security management
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      // Define direct message policy
      return {
        policy: account.dmPolicy ?? "pairing",  // Defaults to pairing mode
        allowFrom: account.allowFrom ?? [],
        policyPath: `channels.whatsapp.dmPolicy`,
        allowFromPath: "channels.whatsapp.",
        approveHint: formatPairingApproveHint("whatsapp"),
        normalizeEntry: (raw) => normalizeE164(raw),
      };
    },
    // ... more security config
  },
  // Group functionality
  groups: {
    resolveRequireMention: resolveWhatsAppGroupRequireMention,
    resolveToolPolicy: resolveWhatsAppGroupToolPolicy,
    // ...
  },
  // Outbound message functionality
  outbound: {
    deliveryMode: "gateway",  // Deliver via gateway
    chunker: (text, limit) => getWhatsAppRuntime().channel.text.chunkText(text, limit),
    chunkerMode: "text",
    textChunkLimit: 4000,
    pollMaxOptions: 12,
    // Message sending function
    sendText: async ({ to, text, accountId, deps, gifPlayback }) => {
      const send = deps?.sendWhatsApp ?? getWhatsAppRuntime().channel.whatsapp.sendMessageWhatsApp;
      const result = await send(to, text, {
        verbose: false,
        accountId: accountId ?? undefined,
        gifPlayback,
      });
      return { channel: "whatsapp", ...result };
    },
    // ... other outbound methods
  },
  // Gateway integration
  gateway: {
    startAccount: async (ctx) => {
      // Start WhatsApp account listener
      return getWhatsAppRuntime().channel.whatsapp.monitorWebChannel(
        /* params */
      );
    },
    // Login and logout functionality
    loginWithQrStart: async ({ accountId, force, timeoutMs, verbose }) => 
      await getWhatsAppRuntime().channel.whatsapp.startWebLoginWithQr({/* ... */}),
    // ... other methods
  },
};
```

### Channel Plugin Interface Definition

As seen from the type definition, channel plugins need to implement multiple adapter interfaces:

```typescript
// Core interface definition for channel plugins
export type ChannelPlugin<ResolvedAccount = any> = {
  id: ChannelId;                    // Unique channel identifier
  meta: ChannelMeta;                // Channel metadata
  capabilities: ChannelCapabilities; // Feature capabilities
  defaults?: {                      // Default configuration
    queue?: {
      debounceMs?: number;          // Queue debounce time
    };
  };
  reload?: {                        // Reload configuration
    configPrefixes: string[];
    noopPrefixes?: string[];
  };
  onboarding?: ChannelOnboardingAdapter;     // Onboarding adapter
  config: ChannelConfigAdapter<ResolvedAccount>; // Configuration adapter
  configSchema?: ChannelConfigSchema;        // Configuration schema
  setup?: ChannelSetupAdapter;               // Setup adapter
  pairing?: ChannelPairingAdapter;           // Pairing adapter
  security?: ChannelSecurityAdapter<ResolvedAccount>; // Security adapter
  groups?: ChannelGroupAdapter;              // Group adapter
  outbound?: ChannelOutboundAdapter;         // Outbound adapter
  gatewayMethods?: string[];                 // Gateway methods
  gateway?: ChannelGatewayAdapter<ResolvedAccount>; // Gateway adapter
  // ... more adapters
};
```

## WhatsApp Channel Implementation Details

Let's dive into the implementation details of the WhatsApp channel:

### 1. Configuration Management

WhatsApp channel configuration management includes account management and security policies:

```typescript
config: {
  listAccountIds: (cfg) => listWhatsAppAccountIds(cfg),
  resolveAccount: (cfg, accountId) => resolveWhatsAppAccount({ cfg, accountId }),
  defaultAccountId: (cfg) => resolveDefaultWhatsAppAccountId(cfg),
  // Enable/disable account
  setAccountEnabled: ({ cfg, accountId, enabled }) => {
    const accountKey = accountId || DEFAULT_ACCOUNT_ID;
    const accounts = { ...cfg.channels?.whatsapp?.accounts };
    const existing = accounts[accountKey] ?? {};
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        whatsapp: {
          ...cfg.channels?.whatsapp,
          accounts: {
            ...accounts,
            [accountKey]: {
              ...existing,
              enabled,
            },
          },
        },
      };
    };
  },
  // Other config methods...
},
```

### 2. Security Policy

The WhatsApp channel implements strict security policies, defaulting to pairing mode to prevent unauthorized access:

```typescript
security: {
  resolveDmPolicy: ({ cfg, accountId, account }) => {
    return {
      policy: account.dmPolicy ?? "pairing",  // Default pairing policy
      allowFrom: account.allowFrom ?? [],     // Allowlist
      policyPath: `${basePath}dmPolicy`,      // Policy path
      allowFromPath: basePath,                // Allowlist path
      approveHint: formatPairingApproveHint("whatsapp"), // Pairing hint
      normalizeEntry: (raw) => normalizeE164(raw), // Normalize input
    };
  },
  // Collect security warnings
  collectWarnings: ({ account, cfg }) => {
    const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
    const groupPolicy = account.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
    if (groupPolicy !== "open") return [];
    // Return security warning message
    return [
      `- WhatsApp groups: groupPolicy="open" allows any member in allowed groups to trigger...`
    ];
  },
},
```

### 3. Message Routing Mechanism

The WhatsApp channel implements intelligent message routing and target resolution:

```typescript
outbound: {
  resolveTarget: ({ to, allowFrom, mode }) => {
    const trimmed = to?.trim() ?? "";
    const allowListRaw = (allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
    const hasWildcard = allowListRaw.includes("*");
    const allowList = allowListRaw
      .filter((entry) => entry !== "*")
      .map((entry) => normalizeWhatsAppTarget(entry))
      .filter((entry): entry is string => Boolean(entry));

    if (trimmed) {
      const normalizedTo = normalizeWhatsAppTarget(trimmed);
      if (!normalizedTo) {
        if ((mode === "implicit" || mode === "heartbeat") && allowList.length > 0) {
          return { ok: true, to: allowList[0] };  // Use first allowlist entry
        }
        return {
          ok: false,
          error: missingTargetError(
            "WhatsApp",
            "<E.164|group JID> or channels.whatsapp.allowFrom[0]",
          ),
        };
      }
      
      // Handle group JID
      if (isWhatsAppGroupJid(normalizedTo)) {
        return { ok: true, to: normalizedTo };
      }
      
      // Handle regular message
      if (mode === "implicit" || mode === "heartbeat") {
        if (hasWildcard || allowList.length === 0) {
          return { ok: true, to: normalizedTo };
        }
        if (allowList.includes(normalizedTo)) {
          return { ok: true, to: normalizedTo };
        }
        return { ok: true, to: allowList[0] };
      }
      return { ok: true, to: normalizedTo };
    }

    if (allowList.length > 0) {
      return { ok: true, to: allowList[0] };
    }
    return {
      ok: false,
      error: missingTargetError(
        "WhatsApp",
        "<E.164|group JID> or channels.whatsapp.allowFrom[0]",
      ),
    };
  },
  // Send text message
  sendText: async ({ to, text, accountId, deps, gifPlayback }) => {
    const send = deps?.sendWhatsApp ?? getWhatsAppRuntime().channel.whatsapp.sendMessageWhatsApp;
    const result = await send(to, text, {
      verbose: false,
      accountId: accountId ?? undefined,
      gifPlayback,
    });
    return { channel: "whatsapp", ...result };
  },
},
```

## Message Routing Mechanism

Clawdbot's message routing mechanism ensures that messages are correctly passed between different channels:

### 1. Channel Identification and Normalization

The system uses standardized target identification and normalization mechanisms:

```typescript
// Message target normalization
messaging: {
  normalizeTarget: normalizeWhatsAppMessagingTarget,
  targetResolver: {
    looksLikeId: looksLikeWhatsAppTargetId,
    hint: "<E.164|group JID>",  // Target format hint
  },
},
```

### 2. Directory Service

Channels implement directory services to support user and group lookup:

```typescript
directory: {
  self: async ({ cfg, accountId }) => {
    // Get current account info
    const account = resolveWhatsAppAccount({ cfg, accountId });
    const { e164, jid } = getWhatsAppRuntime().channel.whatsapp.readWebSelfId(account.authDir);
    const id = e164 ?? jid;
    if (!id) return null;
    return {
      kind: "user",
      id,
      name: account.name,
      raw: { e164, jid },
    };
  },
  listPeers: async (params) => listWhatsAppDirectoryPeersFromConfig(params),
  listGroups: async (params) => listWhatsAppDirectoryGroupsFromConfig(params),
},
```

### 3. Heartbeat Detection

The system implements heartbeat detection mechanisms to ensure channel availability:

```typescript
heartbeat: {
  checkReady: async ({ cfg, accountId, deps }) => {
    if (cfg.web?.enabled === false) {
      return { ok: false, reason: "whatsapp-disabled" };
    }
    const account = resolveWhatsAppAccount({ cfg, accountId });
    const authExists = await (deps?.webAuthExists ??
      getWhatsAppRuntime().channel.whatsapp.webAuthExists)(account.authDir);
    if (!authExists) {
      return { ok: false, reason: "whatsapp-not-linked" };
    }
    const listenerActive = deps?.hasActiveWebListener
      ? deps.hasActiveWebListener()
      : Boolean(getWhatsAppRuntime().channel.whatsapp.getActiveWebListener());
    if (!listenerActive) {
      return { ok: false, reason: "whatsapp-not-running" };
    }
    return { ok: true, reason: "ok" };
  },
  resolveRecipients: ({ cfg, opts }) => resolveWhatsAppHeartbeatRecipients(cfg, opts),
},
```

## Summary

Clawdbot's multi-channel system achieves unified support for multiple communication platforms through a carefully designed plugin architecture. Each channel follows the same interface specification but can implement platform-specific functionality. This design makes adding new communication channels relatively simple while maintaining overall system consistency and security.

In the next lesson, we will delve into the architecture of the Agent system, including session management, tool invocation, and the sandbox security model.
