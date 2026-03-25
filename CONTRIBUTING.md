# Contributing to Enginehaus

Thanks for your interest in contributing. Whether it is a bug report, a new feature, or a documentation fix, we appreciate the help.

## Quick Setup

```bash
git clone https://github.com/enginehaus/enginehaus.git
cd enginehaus
npm install
npm run build     # eslint + tsc (TypeScript strict mode)
npm test          # vitest, 1140+ tests
```

Use `npm run watch` for continuous compilation during development.

## Development Workflow

1. **Branch from main.** Use descriptive names: `feature/wheelhaus-panel-timeline`, `fix/session-cleanup-leak`.
2. **Write tests.** Every new feature or bug fix should include tests. We use Vitest.
3. **Run the full suite** before pushing: `npm test`.
4. **Open a pull request** against `main`. Keep PRs focused on a single change.

## Code Style

- **TypeScript strict mode** is enabled. Avoid `any` unless absolutely necessary.
- **SQL safety:** Always use prepared statements with parameterized queries via better-sqlite3. Never build SQL with string concatenation or template literals.
- **Input validation:** Every MCP tool handler must validate its inputs using the validation module (`src/validation/`).
- **Event emission:** Significant state changes must emit events through the event system. This keeps the audit trail intact and lets other components react.

## Where Contributions Are Especially Welcome

### Multi-Client Testing

Enginehaus supports multiple AI clients (Claude Code, Cursor, Windsurf, Kiro, and more). Testing and reporting how different clients interact with the MCP server is extremely valuable. If you use a client we do not yet support, open an issue describing your experience.

### New Wheelhaus Panels

Wheelhaus is the composable dashboard layer. Each panel is a self-contained data view. Ideas for useful panels -- metrics visualization, dependency graphs, timeline views -- are welcome as issues or PRs.

### Quality Gate Implementations

The quality gate system is extensible. New gates that check for common issues (test coverage thresholds, commit message format, dependency freshness) are a great way to contribute.

### Documentation Improvements

Clearer explanations, better examples, and corrections to existing docs are always appreciated.

### Bug Reports and Friction Reports

If something is confusing, slow, or broken, open an issue. Friction reports -- things that technically work but feel wrong -- are just as useful as bug reports. Describe what you expected, what happened, and any workaround you found.

## Issues and Pull Requests

- **Issues:** https://github.com/enginehaus/enginehaus/issues
- Before starting significant work, open an issue to discuss the approach.
- Reference the relevant issue number in your PR description.
- Keep PR descriptions concise: what changed and why.
- New features must include tests. Aim for coverage of both success and error paths.

## Commit Messages

We use conventional commits:

```
feat: add OAuth provider configuration
fix: resolve memory leak in session cleanup (fixes #123)
docs: improve quick start guide
test: add integration tests for quality gates
```

## Dogfooding

Enginehaus uses itself for project coordination. When working on this codebase, you can use Enginehaus to claim tasks, log decisions, and track progress. This is optional for external contributors, but it is how the core team works and it helps surface rough edges.

```bash
enginehaus task next                    # Claim highest priority task
enginehaus decision log "Why X" -r "rationale" -c architecture
enginehaus task complete <id> -s "Summary of changes"
```

## License

Enginehaus is MIT licensed. By contributing, you agree that your contributions will be licensed under the same terms.
