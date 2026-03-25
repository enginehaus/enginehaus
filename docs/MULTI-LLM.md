# Multi-LLM Setup Guide

Enginehaus works with any AI coding tool that supports MCP (Model Context Protocol) or can make HTTP requests to REST APIs. This guide covers setup for popular platforms.

## Being Honest About Support Tiers

**Most tools auto-configure.** Run `enginehaus init` in your project and it detects your AI tools, creates MCP configs, and installs workflow hooks automatically.

**Hooks enforce structure.** Claude Code, Cursor, VS Code, Gemini CLI, and Cline get full workflow enforcement — quality gates, session start briefings, decision capture. Other MCP clients get the coordination tools without hooks.

**HTTP works for everything else.** Any tool that can make HTTP requests can use the REST API via `enginehaus serve`.

### Support Tiers

| Tier | Tools | Setup | Experience |
|------|-------|-------|------------|
| **Tier 1: MCP + Hooks** | Claude Code, Cursor, VS Code/Copilot, Gemini CLI, Cline | `enginehaus init` | Full enforcement |
| **Tier 2: MCP auto-configured** | Claude Desktop, Kiro, LM Studio | `enginehaus init` | Full features, no hooks |
| **Tier 3: MCP manual** | Windsurf, Continue.dev, Zed, others | `enginehaus setup --show-config` | Full features |
| **Tier 4: HTTP/REST** | Any HTTP client | `enginehaus serve` | Most features |

### Quick Start

```bash
enginehaus init              # Auto-configures all detected tools
enginehaus setup --show-config   # Show manual config for any tool
enginehaus serve             # Start REST API for HTTP-based tools
```

---

## Quick Reference

| Platform | MCP | Hooks | Auto-configured |
|----------|-----|-------|-----------------|
| Claude Code | Yes | Full | Yes |
| Cursor | Yes | Full | Yes |
| VS Code / Copilot | Yes | Full | Yes |
| Gemini CLI | Yes | Full | Yes |
| Cline | — | Full | Hooks only |
| Claude Desktop | Yes | — | Yes |
| Kiro CLI | Yes | — | Yes |
| LM Studio | Yes | — | Yes |
| Windsurf | Yes | — | Manual |
| Any MCP client | Yes | — | `enginehaus setup --show-config` |
| Any HTTP client | REST | — | `enginehaus serve` |

---

## Claude Code (Auto-configured)

Claude Code uses `.mcp.json` in your project root. Created automatically by `enginehaus init`.

### Config File

```
your-project/.mcp.json
```

### Configuration (auto-generated)

```json
{
  "mcpServers": {
    "enginehaus": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/enginehaus/build/index.js"]
    }
  }
}
```

### Verification

In Claude Code, the MCP tools appear automatically. You should see 100+ Enginehaus tools available.

---

## Claude Desktop (Full Support)

Claude Desktop uses the same MCP protocol as Claude Code.

### Config File Location

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

### Configuration

```json
{
  "mcpServers": {
    "enginehaus": {
      "command": "npx",
      "args": ["enginehaus"],
      "env": {
        "PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

### Verification

1. Restart Claude Desktop after saving the config
2. Click the tools icon (hammer) in the chat input
3. Look for "enginehaus" in the available tools list
4. Try: "What tasks are available?" - Claude should use `list_tasks`

---

## Cursor (Auto-configured)

Cursor uses `.cursor/mcp.json` in your project root. Created automatically by `enginehaus init`.

### Config File

```
your-project/.cursor/mcp.json
```

### Configuration (auto-generated)

```json
{
  "mcpServers": {
    "enginehaus": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/enginehaus/build/index.js"]
    }
  }
}
```

### Verification

1. Restart Cursor after running `enginehaus init`
2. Open Command Palette (Cmd/Ctrl + Shift + P)
3. Type "MCP" to see MCP-related commands
4. Check that enginehaus tools appear

---

## Continue.dev (Full Support)

Continue.dev supports MCP natively and can also use the REST API.

### Option A: MCP Configuration

**Config File Location:**
```
~/.continue/config.json
```

**Configuration:**

```json
{
  "mcpServers": [
    {
      "name": "enginehaus",
      "command": "npx",
      "args": ["enginehaus"],
      "env": {
        "PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  ]
}
```

### Option B: REST API Configuration

First, start the Enginehaus server:

```bash
enginehaus serve
# Starts REST API on http://localhost:47470
```

Then configure Continue to use the API:

```json
{
  "customCommands": [
    {
      "name": "tasks",
      "description": "List Enginehaus tasks",
      "prompt": "Fetch tasks from http://localhost:47470/api/tasks"
    }
  ]
}
```

### Verification

In VS Code with Continue installed:
1. Open the Continue sidebar
2. Type `/tasks` or ask "What tasks are available?"
3. Verify that Enginehaus responds with task data

---

## Cloudflare Tunnel (Remote Access)

For ChatGPT custom GPTs and other cloud-based tools that can't reach localhost, use the tunnel script:

```bash
npm run tunnel
```

This:
1. Starts the Enginehaus HTTP server
2. Creates a temporary public HTTPS URL via Cloudflare
3. Generates an API key for authentication

**Output example:**
```
Generated API key (save this!):
a1b2c3d4e5f6...

Starting Cloudflare Tunnel...
Your MCP server will be available at: https://random-words.trycloudflare.com
```

**Use in ChatGPT/Gemini:**
- Endpoint: The `trycloudflare.com` URL
- Header: `X-API-Key: <your-generated-key>`

**Prerequisites:**
- `cloudflared` CLI installed: `brew install cloudflare/cloudflare/cloudflared`

**Note:** Tunnel URLs are temporary and change each time. For persistent access, configure a reverse proxy or deploy to your infrastructure.

---

## ChatGPT (HTTP Required)

ChatGPT doesn't support MCP directly. Use the REST API through custom GPTs.

### Start the REST API Server

```bash
enginehaus serve
# REST API: http://localhost:47470
# Web UI:   http://localhost:4747
```

### Custom GPT Configuration

Create a Custom GPT with this action schema:

```yaml
openapi: 3.0.0
info:
  title: Enginehaus API
  version: 1.0.0
servers:
  - url: http://localhost:47470/api
paths:
  /tasks:
    get:
      operationId: listTasks
      summary: List all tasks
      responses:
        '200':
          description: List of tasks
  /tasks/{id}:
    get:
      operationId: getTask
      summary: Get task details
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
  /tasks/next:
    get:
      operationId: getNextTask
      summary: Get next priority task
  /decisions:
    get:
      operationId: listDecisions
      summary: List decisions
```

### Verification

1. In your Custom GPT, ask "What tasks are available?"
2. The GPT should call the `/tasks` endpoint
3. You should see your Enginehaus tasks in the response

**Note:** ChatGPT support is partial because it cannot use stdio-based MCP tools. Some features like automatic git integration require the full MCP connection.

---

## Gemini (HTTP Required)

Gemini can interact with Enginehaus via the REST API.

### Start the REST API Server

```bash
enginehaus serve
```

### Using with Gemini API

```python
import google.generativeai as genai
import requests

# Fetch tasks and stats from Enginehaus
def get_enginehaus_context():
    tasks = requests.get("http://localhost:47470/api/tasks/next").json()
    stats = requests.get("http://localhost:47470/api/stats").json()
    return {"next_task": tasks.get("task"), "stats": stats}

# Use in Gemini prompt
context = get_enginehaus_context()
model = genai.GenerativeModel('gemini-pro')
response = model.generate_content(f"""
Given this project context:
{context}

What should I work on next?
""")
```

### Verification

1. Run the Python script above
2. Gemini should respond with task recommendations based on Enginehaus data

---

## Generic REST API Setup

For any tool that can make HTTP requests, use the REST API.

### Start the Server

```bash
enginehaus serve
# REST API: http://localhost:47470
# Web UI:   http://localhost:4747
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/tasks` | GET | List all tasks |
| `/api/tasks/next` | GET | Get next priority task |
| `/api/tasks/:id` | GET | Get task by ID |
| `/api/tasks` | POST | Create a task |
| `/api/tasks/:id/claim` | POST | Claim a task |
| `/api/tasks/:id/complete` | POST | Complete a task |
| `/api/tasks/:id/release` | POST | Release a claimed task |
| `/api/decisions` | GET | List decisions |
| `/api/decisions` | POST | Log a decision |
| `/api/stats` | GET | Get task/session statistics |
| `/api/events` | GET | Get recent events (in-memory) |

### Example: List Tasks

```bash
curl http://localhost:47470/api/tasks
```

### Example: Get Next Task

```bash
curl http://localhost:47470/api/tasks/next
```

### Example: Claim a Task

```bash
curl -X POST http://localhost:47470/api/tasks/abc123/claim \
  -H "Content-Type: application/json" \
  -d '{"agentId": "my-agent"}'
```

### Example: Complete a Task

```bash
curl -X POST http://localhost:47470/api/tasks/abc123/complete \
  -H "Content-Type: application/json" \
  -d '{"summary": "Implemented feature X"}'
```

### Example: Log a Decision

```bash
curl -X POST http://localhost:47470/api/decisions \
  -H "Content-Type: application/json" \
  -d '{"decision": "Use approach X", "rationale": "Because Y", "category": "architecture"}'
```

---

## Events API

Get recent in-memory events (useful for polling-based updates):

```bash
curl http://localhost:47470/api/events
```

Response includes recent events with types like:
- `task:created` - New task added
- `task:claimed` - Task claimed by an agent
- `task:completed` - Task completed
- `decision:logged` - Decision recorded

### Polling Example

```javascript
// Poll for updates every 5 seconds
async function pollEvents() {
  const response = await fetch('http://localhost:47470/api/events?limit=10');
  const { events } = await response.json();

  events.forEach(event => {
    console.log('Event:', event.type, event.payload);
  });
}

setInterval(pollEvents, 5000);
```

**Note:** Real-time Server-Sent Events (SSE) streaming is planned for a future release.

---

## Troubleshooting

### MCP Tools Not Appearing

1. **Restart your AI tool** after changing config
2. **Check config file syntax** - JSON must be valid
3. **Verify npx works**: Run `npx enginehaus --version` in terminal
4. **Check PROJECT_ROOT** - Must be an absolute path

### REST API Not Responding

1. **Check server is running**: `enginehaus serve`
2. **Check ports**: Default is 47470 (API) and 4747 (web)
3. **Port in use?**: Try `enginehaus serve --api-port 47471`

### "Tool not found" Errors

1. **Reinstall**: `npm install -g enginehaus`
2. **Check PATH**: Ensure npm global bin is in PATH
3. **Use absolute path**: Replace `npx enginehaus` with full path to the binary

### Permission Errors on macOS

```bash
# If you see "operation not permitted" errors:
xattr -d com.apple.quarantine $(which enginehaus)
```

---

## Feature Comparison by Platform

| Feature | Claude Code | Claude Desktop | Cursor | Continue | REST API |
|---------|-------------|----------------|--------|----------|----------|
| List tasks | Yes | Yes | Yes | Yes | Yes |
| Claim/complete tasks | Yes | Yes | Yes | Yes | Yes |
| Auto git workflow | Yes | Partial | Partial | No | No |
| Decision logging | Yes | Yes | Yes | Yes | Yes |
| Real-time events | Yes | Yes | Yes | Partial | Polling |
| Quality gates | Yes | Yes | Yes | No | No |
| Context synthesis | Yes | Yes | Yes | Partial | Yes |

**Legend:**
- **Yes**: Fully supported
- **Partial**: Works but with limitations
- **No**: Not available (platform limitation)

---

## Getting Help

- **GitHub Issues**: [github.com/enginehaus/enginehaus/issues](https://github.com/enginehaus/enginehaus/issues)
- **Documentation**: [enginehaus.dev/docs](https://enginehaus.dev/docs)
- **CLI Help**: `enginehaus --help`
