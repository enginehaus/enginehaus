# Adding a New MCP Client to Enginehaus

Enginehaus uses a plugin-style architecture for client support. Adding a new MCP client requires **15–25 lines of code** across 2–5 files, depending on whether the client supports hooks.

## Tier System

- **Tier 1**: Full support — MCP config + hooks (workflow enforcement, session start, commit reminders)
- **Tier 2**: MCP config only — the client connects to Enginehaus but has no hook system

Most desktop apps (Claude Desktop, LM Studio) are Tier 2. CLI tools and editors with hook APIs (Claude Code, Cursor, Gemini CLI) are Tier 1.

## Adding a Tier 2 Client (MCP Only)

### 1. Client Detection — `src/hooks/client-detection.ts`

Add the client ID to the `ClientId` type:

```typescript
export type ClientId =
  | 'claude-code'
  | 'your-client'  // Add here
  // ...
```

Add detection logic in `detectClients()`. Use filesystem checks — we care about what's installed, not what's running:

```typescript
// Your Client: ~/.your-client/ or config directory
if (existsSync(path.join(home, '.your-client')) ||
    existsSync(path.join(home, 'Library', 'Application Support', 'Your Client'))) {
  clients.push({
    id: 'your-client',
    name: 'Your Client',
    tier: 2,
    configPath: path.join(home, '.your-client', 'mcp.json'),
    hooksSupported: { preToolUse: false, postToolUse: false, sessionStart: false },
  });
}
```

**Detection strategy**: Check for config directories, settings files, or `commandExists('yourclient')`. Prefer filesystem checks over process detection.

### 2. MCP Config Patching — `src/bin/commands/onboarding-commands.ts`

Add a block in the `init` command so `enginehaus init` configures the client automatically:

```typescript
// N. Your Client — global config (only if detected)
if (existsSync(path.join(os.homedir(), '.your-client'))) {
  mcpResults['Your Client'] = {
    status: patchMcpConfig(
      path.join(os.homedir(), '.your-client', 'mcp.json'),
      'mcpServers',      // The key in the JSON where MCP servers are listed
      stdioConfig,       // Use stdioConfig for local, bareConfig for global/desktop
      true,              // true = create file if missing
    ),
  };
}
```

**Config key**: Most clients use `mcpServers`. VS Code uses `servers`. Check the client's docs.

**Config type**: Use `stdioConfig` for project-scoped clients (CLI tools). Use `bareConfig` for global clients (desktop apps) since they don't run from a project directory.

### 3. Setup Display — `src/bin/commands/setup-commands.ts`

Add to `--show-config` output so users can manually configure:

```typescript
console.log('\n─── Your Client (~/.your-client/mcp.json) ───');
console.log(JSON.stringify({ mcpServers: { enginehaus: stdioConfig } }, null, 2));
```

**Done.** That's a Tier 2 client — typically ~15 lines across 3 files.

---

## Adding a Tier 1 Client (MCP + Hooks)

Do everything above, plus:

### 4. Hook Generator — `src/hooks/generators/your-client.ts`

Create a new file:

```typescript
import { createHookGenerator, ClientHookConfig } from './config-hook-generator.js';

export const yourClientConfig: ClientHookConfig = {
  configPath: '.your-client/settings.json',
  hooksKey: 'hooks',  // Where hooks live in the config JSON
  hookDefs: [
    {
      hookType: 'SessionStart',        // Client's event name
      scriptName: 'session-start',     // Script in ~/.enginehaus/hooks/
      matcher: {},                     // No matcher for session start
      label: 'SessionStart',
    },
    {
      hookType: 'PreToolUse',          // Or 'BeforeTool' for Gemini-style
      scriptName: 'enforce-workflow',
      matcher: 'Edit|Write',          // Regex — which tools to intercept
      label: 'PreToolUse (enforce-workflow)',
    },
    {
      hookType: 'PostToolUse',         // Or 'AfterTool' for Gemini-style
      scriptName: 'post-commit-reminder',
      matcher: 'Bash',
      label: 'PostToolUse (post-commit-reminder)',
    },
  ],
};

export const yourClientGenerator = createHookGenerator(yourClientConfig);
```

**Key differences between clients**:
- Hook event names vary: Claude Code uses `PreToolUse`/`PostToolUse`, Gemini uses `BeforeTool`/`AfterTool`, Cline uses `write_to_file|apply_diff`
- Matcher patterns are regex matching tool names
- The `hooksKey` path can be nested: VS Code Copilot uses `github.copilot.chat.hooks`

### 5. Register — `src/hooks/install.ts`

Import and register the generator:

```typescript
import { yourClientGenerator } from './generators/your-client.js';

const generators: Record<string, HookGenerator> = {
  // ...existing clients...
  'your-client': yourClientGenerator,
};
```

### 6. Update detection tier — `src/hooks/client-detection.ts`

Change `tier: 2` to `tier: 1` and set hook support flags:

```typescript
tier: 1,
hooksSupported: { preToolUse: true, postToolUse: true, sessionStart: true },
```

---

## Testing

```bash
# Build
npm run build

# Verify detection
node -e "const { detectClients } = require('./build/hooks/client-detection.js'); detectClients(process.cwd()).forEach(c => console.log(c.name, c.tier))"

# Test hook installation
enginehaus hooks install

# Test init (creates config files)
# Use a scratch directory:
mkdir /tmp/test-project && cd /tmp/test-project
npx enginehaus init
```

## File Reference

| File | Purpose |
|------|---------|
| `src/hooks/client-detection.ts` | Filesystem detection of installed clients |
| `src/hooks/generators/config-hook-generator.ts` | Universal hook install/uninstall factory |
| `src/hooks/generators/<client>.ts` | Client-specific hook config (Tier 1 only) |
| `src/hooks/install.ts` | Generator registry |
| `src/bin/commands/onboarding-commands.ts` | MCP config patching during `init` |
| `src/bin/commands/setup-commands.ts` | Manual config display |
| `~/.enginehaus/hooks/*.sh` | Shared hook scripts (not client-specific) |

## Design Principles

- **Detection is filesystem-based** — no process spawning, no network calls
- **Parameterization over repetition** — all clients share the same install/uninstall logic
- **Hook scripts are shared** — `enforce-workflow.sh` runs for every client, the generator just wires it up
- **Additive, not destructive** — `init` patches configs, never overwrites them
- **Duplicate-safe** — installation checks if hooks already exist before adding
