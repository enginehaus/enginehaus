# MCP Configuration Setup

**Get Enginehaus MCP tools working in under 5 minutes.**

The Enginehaus MCP server gives your AI agent access to coordination tools. This guide covers setup for both Claude Desktop and Claude Code.

---

## Quick Setup (Recommended)

### For Claude Code

```bash
# From your Enginehaus installation directory:
enginehaus setup --claude-code
```

This automatically configures Claude Code's MCP settings.

### For Claude Desktop

```bash
# From your Enginehaus installation directory:
enginehaus setup
```

This automatically configures Claude Desktop.

**After either command:** Restart the application to load the MCP server.

---

## Manual Configuration

If automatic setup doesn't work, use `--show-config` to get the exact JSON:

### Claude Code

```bash
enginehaus setup --show-config --claude-code
```

Then add the output to: `~/.config/claude-code/mcp_settings.json`

**Example configuration:**

```json
{
  "mcpServers": {
    "enginehaus": {
      "command": "node",
      "args": ["/path/to/enginehaus/build/index.js"],
      "env": {
        "PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

### Claude Desktop

```bash
enginehaus setup --show-config
```

Then add the output to the config file for your platform:

| Platform | Config File Location |
|----------|---------------------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/claude/claude_desktop_config.json` |

**Example configuration:**

```json
{
  "mcpServers": {
    "enginehaus": {
      "command": "node",
      "args": ["/path/to/enginehaus/build/index.js"]
    }
  }
}
```

---

## Verifying Setup

After restarting your application, verify Enginehaus is loaded:

### In Claude Code
The MCP tools should appear when you ask Claude to list available tools, or you can use:
```
What MCP tools do you have access to?
```

### In Claude Desktop
Check the MCP indicator in the conversation - it should show "enginehaus" as a connected server.

### Using the CLI
```bash
enginehaus doctor
```

This diagnoses your installation and shows any configuration issues.

---

## Troubleshooting

### "MCP server not found"

1. Make sure you've built Enginehaus: `npm run build`
2. Check the path in your config points to the actual `build/index.js` file
3. Restart the Claude application after config changes

### "Permission denied" during setup

On macOS/Linux, you may need to run:
```bash
sudo npm link
```

### Config file doesn't exist

The setup command will create the config file automatically. If manual setup:
1. Create the directory if needed
2. Create the JSON file with the mcpServers object

### Multiple projects

For Claude Code, update `PROJECT_ROOT` when switching projects:

```json
{
  "mcpServers": {
    "enginehaus": {
      "command": "node",
      "args": ["/path/to/enginehaus/build/index.js"],
      "env": {
        "PROJECT_ROOT": "/path/to/current/project"
      }
    }
  }
}
```

Or use `enginehaus setup --claude-code` from each project directory.

---

## Command Reference

| Command | Description |
|---------|-------------|
| `enginehaus setup` | Auto-configure Claude Desktop |
| `enginehaus setup --claude-code` | Auto-configure Claude Code |
| `enginehaus setup --show-config` | Output Claude Desktop config JSON |
| `enginehaus setup --show-config --claude-code` | Output Claude Code config JSON |
| `enginehaus setup --skip-claude` | Setup without modifying Claude config |
| `enginehaus doctor` | Diagnose installation issues |

---

## Next Steps

After MCP is configured:

1. Initialize your project: `enginehaus init`
2. Start a task: `enginehaus task next`
3. Or use MCP tools directly: `get_next_task()`

See the [Quick Start Guide](./QUICK-START.md) for the full workflow.
