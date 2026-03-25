# 🚀 Enginehaus Quick Start Guide

Get from zero to coordinated AI coding in **under 5 minutes**.

## One-Command Setup

```bash
git clone https://github.com/enginehaus/enginehaus.git
cd enginehaus
npm install && npm run build && npm run setup
```

**That's it!** The `setup` command automatically:
- ✅ Builds the project
- ✅ Links CLI globally (`enginehaus` and `eh` commands)
- ✅ Configures your AI tools (Claude Desktop/Claude Code)
- ✅ Verifies everything works

> **Note**: Restart your AI tool after setup to load the MCP server.

## Initialize Your Project

```bash
cd /path/to/your/project
enginehaus init
```

The `init` command automatically:
- 🔍 Detects your tech stack from `package.json`, `Cargo.toml`, etc.
- 🎯 Identifies your project domain (web, api, mobile, etc.)
- 📁 Creates `.enginehaus/` directory marker
- 📝 Generates `CLAUDE.md` with project-specific guidelines
- 🎯 Creates a welcome task to guide your first session

You can also specify a name: `enginehaus init "My Awesome Project"`

## Start Coordinating

```bash
enginehaus briefing    # See project health and overview
enginehaus task list   # View all available tasks
enginehaus task next   # Claim the next priority task
```

## The 4-Step Coordination Loop

### 1️⃣ **Start Work**
```bash
enginehaus task next
```
Automatically claims the highest priority task and gets full context.

### 2️⃣ **During Implementation** 
Use Enginehaus MCP tools in your AI coding session:
- `log_decision` - Record important architectural choices
- `add_task` - Add discovered work (don't do extra work silently!)
- `get_briefing` - Refresh your understanding

### 3️⃣ **Found Extra Work?**
```bash
enginehaus task add -t "Discovered: API needs rate limiting" -p medium
```
Don't silently do extra work - create a task so it's tracked!

### 4️⃣ **Complete**
```bash
enginehaus task complete <id> -s "Implemented OAuth flow with 1.2s average time"
```
Automatically commits changes, pushes to remote, and generates PR description.

## 🎬 Your First Coordinated Session

### Step 1: Add a Task (in Claude Code)

```
Use the add_task tool to create your first task:
- Title: "Set up TypeScript project structure"  
- Description: "Initialize TypeScript with proper configuration and basic folder structure"
- Priority: "high"
- Files: ["tsconfig.json", "src/", "tests/"]
```

### Step 2: Start Implementation

```
Use the start_work tool
```

Enginehaus automatically:
- ✅ Claims the task for your session
- ✅ Creates a git branch: `feature/task-abc123-typescript-setup`
- ✅ Provides full context and quality requirements

### Step 3: Implement Normally

Just code normally! When you reach milestones:
```
Use update_progress to log phase completions
```

### Step 4: Complete

```
Use complete_task_smart with:
- taskId: (from start_work)
- summary: "TypeScript project structure configured with strict mode and test setup"
```

Enginehaus automatically:
- 🎯 Runs quality gates (compilation, linting)
- 📝 Creates comprehensive commit message
- 🚀 Pushes to remote repository
- 📋 Generates PR description with context

## 🛠️ Common Commands

```bash
# Quick health check
enginehaus status        # Current context and active project
enginehaus stats         # Task/session statistics  
enginehaus health        # Full system health check

# Task management
enginehaus task show <id>    # Detailed task information
enginehaus task release <id> # Unclaim without completing

# Project management  
enginehaus project list      # All projects
enginehaus project active    # Set active project
```

## 🧪 Quick Verification

Verify your setup works:

```bash
# 1. Check CLI is installed
enginehaus --version

# 2. Check MCP server is available (in Claude Code)
/mcp
# You should see "enginehaus" with 30+ tools

# 3. Test task creation
echo 'Testing Enginehaus...'
enginehaus task add -t "Test task" -p low
enginehaus task list
```

## 🔧 Configuration

Most configuration is automatic, but you can customize:

### Project-Specific Settings

Create `.enginehaus/config.json` in your project:

```json
{
  "quality": {
    "gates": ["npm run build", "npm test", "npm run lint"],
    "enforceOnCompletion": true
  },
  "git": {
    "autoPush": true,
    "prTemplate": "detailed"
  },
  "domain": "web"
}
```

### AI Tool Configuration

For manual MCP configuration (if `setup` didn't work):

**Claude Code** (`~/.config/claude-code/mcp_settings.json`):
```json
{
  "mcpServers": {
    "enginehaus": {
      "command": "npx",
      "args": ["enginehaus"],
      "env": {
        "PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

## 🆘 Troubleshooting

### CLI Not Found
```bash
# Reinstall globally
npm install -g enginehaus

# Or use npx
npx enginehaus --version
```

### MCP Tools Not Appearing
1. **Restart your AI tool** after configuration changes
2. **Check config syntax** - JSON must be valid
3. **Verify installation**: `npx enginehaus --version`
4. **Check PROJECT_ROOT** - Must be absolute path

### Git Operations Failing
```bash
# Configure git (if not already)
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# Check remote is set
git remote -v
```

### Quality Gates Failing
```bash
# Check what's failing
enginehaus validate

# Test each gate manually
npm run build    # Does this pass?
npm test         # Does this pass?  
npm run lint     # Does this pass?
```

### Permission Errors (macOS)
```bash
# Fix macOS quarantine issues
xattr -d com.apple.quarantine $(which enginehaus)
```

## 🎯 Pro Tips

### For Product Managers
- Record strategic decisions early - they provide context for everything
- Include concrete business metrics (revenue, conversion, retention)
- Be specific about timelines and stakeholders

### For Developers (AI Agents)
- Always call `start_work` first - it provides full context
- Use `log_decision` for important technical choices
- Let quality gates run automatically on completion
- Don't silently do extra work - create tasks instead

### For Team Leads
- Use phase-based progression for complex features
- Set appropriate quality gates for your project type
- Review the generated PRs for completeness

## 🚀 What's Next?

1. **Try a full feature** using the Product → UX → Technical → Implementation flow
2. **Customize quality gates** for your specific project needs
3. **Set up integrations** with Linear/Jira (coming soon)
4. **Explore the REST API** for custom tool integrations

## 📚 Learn More

- 📖 [Full Documentation](../README.md)
- 🔧 [Multi-LLM Setup Guide](MULTI-LLM.md)
- 🤝 [Contributing Guidelines](../../CONTRIBUTING.md)
- 🐛 [Report Issues](https://github.com/enginehaus/enginehaus/issues)

---

Happy coordinating! 🎉 Your AI coding sessions are now enterprise-grade.