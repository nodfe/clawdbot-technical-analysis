# Clawdbot Technical Deep Dive Series

## Table of Contents

### Lesson 1: Overview & Architecture Design
- Introduction & Core Concepts
- Architecture Overview
- Key Components
- Installation & Basic Configuration

### Lesson 2: Gateway Core Mechanism
- Gateway Design Philosophy
- WebSocket Protocol Implementation
- Control Plane & Session Management
- Configuration System Analysis

### Lesson 3: Multi-Channel System
- Supported Communication Channels
- Channel Abstraction Layer Design
- WhatsApp/Telegram/Slack/Discord Implementation
- Message Routing Mechanism

### Lesson 4: Agent System Architecture
- Agent Runtime Design
- Session Models & Context Management
- Tool Calling Mechanism
- Sandbox Security Model

### Lesson 5: Tools System & Extensions
- Built-in Tool System
- Browser Control Tools
- Canvas Visualization System
- Node System

### Lesson 6: Skills System & Plugin Architecture
- Skills System Design
- Skill Registration & Management
- Plugin Architecture
- External Extension Mechanisms

### Lesson 7: Memory & State Management
- Memory Management System
- Session Persistence
- Context Compression & Management
- Memory Mechanism Implementation

### Lesson 8: Model Integration & AI Interfaces
- Multi-Model Support Architecture
- Model Failover Mechanisms
- Prompt Engineering & Template System
- Usage Tracking & Billing

### Lesson 9: Security Model & Permissions
- Security Design Principles
- Permission Verification Mechanism
- Sandbox Isolation Strategy
- Data Protection Measures

### Lesson 10: Deployment, Operations & Best Practices
- Deployment Strategy
- Operational Essentials
- Performance Optimization
- Troubleshooting & Debugging
- Future Directions

---

# Lesson 1: Overview & Architecture Design

## Introduction & Core Concepts

Clawdbot (formerly Moltbot) is a personal AI assistant platform designed to run on your own devices. It receives and responds to messages through multiple communication channels (WhatsApp, Telegram, Slack, Discord, etc.) and provides a rich set of tools to accomplish various tasks.

### Core Features:
- **Multi-Channel Support**: Supports mainstream messaging apps.
- **Local Execution**: Data stays on your device.
- **Tool Integration**: Built-in tools for browser control, file operations, and more.
- **Security Design**: Sandbox mechanism ensures safety.
- **Extensibility**: Supports custom skills and plugins.

## Architecture Overview

Clawdbot employs a layered architecture design, comprising the following core components:

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
├─────────────────────────────────────────────────────────────┤
│  WhatsApp  │  Telegram  │  Discord  │  Slack  │  WebChat  │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                      Channel Adapter Layer                   │
├─────────────────────────────────────────────────────────────┤
│  WhatsApp  │  Telegram  │  Discord  │  Slack  │  Others   │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                      Gateway (Control Plane)                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  WebSocket Server | Session Mgmt | Config Mgmt | Events │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
        ┌─────────────────┐ ┌─────────┐ ┌─────────┐
        │    Agent Runtime │ │   CLI   │ │   UI    │
        │  (Pi RPC Mode)  │ │         │ │         │
        └─────────────────┘ └─────────┘ └─────────┘
                    │
                    ▼
        ┌───────────────────────────────────────────────────────┐
        │                      Tool Layer                        │
        ├───────────────────────────────────────────────────────┤
        │  Browser  │  Canvas  │  Nodes  │  File System  │ ... │
        └───────────────────────────────────────────────────────┘
```

## Key Components

### 1. Gateway
The Gateway acts as the control plane for the entire system, responsible for:
- WebSocket connection management
- Session state maintenance
- Configuration loading and updates
- Event dispatching and notification
- Tool access control

### 2. Agent
The Agent is the component that actually executes tasks, characterized by:
- Interaction with AI models
- Parsing and executing tool calls
- Maintaining conversation context
- Supporting sandbox mode

### 3. Channels
The Channel layer is responsible for integration with various communication platforms:
- Message sending/receiving
- User authentication
- Permission control
- Protocol translation

### 4. Tools
Provides various practical functions:
- File read/write operations
- Browser automation
- System command execution
- Scheduled task management

## Installation & Basic Configuration

### Requirements
- Node.js ≥ 22
- npm/pnpm/bun package manager

### Installation
```bash
npm install -g moltbot@latest
# or using pnpm
pnpm add -g moltbot@latest
```

### Initialization
```bash
moltbot onboard --install-daemon
```

### Basic Configuration Example
```json
{
  "agent": {
    "model": "anthropic/claude-opus-4-5"
  },
  "gateway": {
    "port": 18789
  }
}
```

## Summary

Clawdbot adopts a modular design, coordinating components through the Gateway as a central control plane. This architecture ensures system scalability while providing good security control.

In the next lesson, we will delve into the core mechanisms of the Gateway, including WebSocket protocol implementation and session management.
