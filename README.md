# Enginehaus

[![npm version](https://badge.fury.io/js/enginehaus.svg)](https://www.npmjs.org/package/enginehaus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Agents are getting smarter. They still don't know your project.**

Not the decisions behind it. Not what was tried and rejected. Not why things are shaped the way they are. Enginehaus builds that institutional knowledge structurally — consumed and contributed to with every task, decision, and artifact. It compounds.

Works with any MCP client — auto-configures Claude Code, Cursor, VS Code, Gemini CLI, and [more](docs/MULTI-LLM.md).

## Quick Start

```bash
npm install -g enginehaus
cd /path/to/your/project
enginehaus init
```

`init` detects your AI tools and configures MCP automatically. Restart your AI tool, then say:

> "Get my briefing"

That's it. You're coordinating.

### From Source

```bash
git clone https://github.com/enginehaus/enginehaus.git
cd enginehaus
npm install && npm run build && npm link

cd /path/to/your/project
enginehaus init
```

## The Core Loop

```bash
# Pick up work (creates branch, loads full context)
enginehaus task next

# Capture decisions as you go
enginehaus decision log "Chose SQLite over Postgres" \
  -r "Simpler deployment, sufficient for single-node" \
  -c architecture

# Finish cleanly (checks for uncommitted/unpushed work)
enginehaus task complete <id> -s "What you did and why"
```

When the next session starts — same agent or different, same tool or different — every decision, every phase, every file change is already loaded. No re-explanation. No conflicting choices.

## What You Get

**Cross-agent memory.** Decisions and context persist across sessions and tools. The second agent doesn't re-discover what the first one decided.

**Reliability loops.** Uncommitted changes block completion. Unpushed work is flagged. Quality gates enforce what instructions can't.

**Works everywhere.** `enginehaus init` auto-detects your tools and configures MCP + workflow hooks. Full hook enforcement for Claude Code, Cursor, VS Code, Gemini CLI, and Cline. MCP auto-config for Claude Desktop, Kiro, LM Studio, and more. HTTP/REST API for anything else.

**Decision Archaeology.** Every architectural choice, tradeoff, and rationale — searchable, auditable, permanent. Next week or next month, any agent can retrieve the reasoning behind any decision.

## Configuration

`enginehaus init` handles this automatically. For manual setup:

| Tool | MCP Config | Hooks | Auto-configured |
|------|-----------|-------|-----------------|
| Claude Code | `.mcp.json` | Full | Yes |
| Cursor | `.cursor/mcp.json` | Full | Yes |
| VS Code / Copilot | `.vscode/mcp.json` | Full | Yes |
| Gemini CLI | `.gemini/settings.json` | Full | Yes |
| Cline | `.clinerules/hooks/hooks.json` | Full | Hooks only |
| Claude Desktop | Global config | — | Yes |
| Kiro CLI | `.kiro/settings/mcp.json` | — | Yes |
| LM Studio | `~/.lmstudio/mcp.json` | — | Yes |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | — | Manual |
| Any MCP client | Varies | — | `enginehaus setup --show-config` |

Run `enginehaus setup --show-config` for any tool's config. Works with anything that speaks MCP or HTTP (`enginehaus serve` on port 47470).

## CLI Reference

```bash
enginehaus init                         # Set up current directory
enginehaus briefing                     # Project status with insights
enginehaus task list                    # What needs doing
enginehaus task next                    # Claim next priority
enginehaus task complete <id> -s "..."  # Finish with summary
enginehaus decision log "..." -r "..." -c architecture
enginehaus decision list                # What's been decided
enginehaus doctor                       # Diagnose your setup
enginehaus serve                        # Wheelhaus web console + REST API (experimental)
```

## Development

```bash
git clone https://github.com/enginehaus/enginehaus.git
cd enginehaus
npm install && npm run build

npm run watch           # Development mode
npm test                # 1140+ tests
```

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

---

[Documentation](docs/) | [Quick Start](docs/QUICK-START.md) | [Power User Guide](docs/POWER-USER.md) | [enginehaus.dev](https://enginehaus.dev) | [Issues](https://github.com/enginehaus/enginehaus/issues)
