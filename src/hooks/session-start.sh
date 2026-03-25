#!/bin/bash
# Enginehaus SessionStart Hook
#
# This script runs automatically when Claude Code starts a session.
# It injects project context so Claude "wakes up smart" without
# the human needing to know anything about Enginehaus.
#
# Output from this script is automatically added to Claude's context.
#
# Project detection: uses `enginehaus briefing` which auto-detects
# the project from cwd (matching registered project root paths).
# No .enginehaus/config.json required.

# Check if enginehaus is available
if ! command -v enginehaus &> /dev/null; then
  echo "=== ENGINEHAUS: CLI not found ==="
  echo "Enginehaus is not installed or not in PATH."
  echo "Install with: npm install -g enginehaus"
  echo ""
  exit 0
fi

echo "=== ENGINEHAUS CONTEXT (auto-loaded) ==="
echo ""

# Get briefing — auto-detects project from cwd, falls back to active project
BRIEFING=$(enginehaus briefing 2>/dev/null)

if [ -z "$BRIEFING" ]; then
  echo "No project detected for this directory."
  echo "Link with: enginehaus link"
  echo "Or init:   enginehaus init"
  echo ""
  echo "=== END ENGINEHAUS CONTEXT ==="
  exit 0
fi

# Strip ANSI escape codes — hook output goes to LLM context, not a terminal.
# Gemini CLI and other tools show raw \u001b[...] sequences instead of colors.
BRIEFING=$(printf '%s' "$BRIEFING" | sed $'s/\x1b\\[[0-9;]*m//g')

echo "$BRIEFING"
echo ""
echo "=== END ENGINEHAUS CONTEXT ==="
echo ""
echo "WORKFLOW CHECKLIST (enforced — edits blocked without claimed task):"
echo "  1. CLAIM: Pick from the menu above, or enginehaus task next"
echo "  2. BRANCH: git checkout -b feature/<task-id-prefix>-<short-description>"
echo "  3. DECIDE: enginehaus decision log \"...\" -r \"...\" -c architecture"
echo "  4. TEST: npm test  (before committing)"
echo "  5. COMMIT & PUSH: git commit && git push"
echo "  6. COMPLETE: enginehaus task complete <id> -s \"summary\""
echo ""
echo "  💡 Log decisions from CONVERSATION too, not just code."
echo "     Positioning calls, tradeoffs, and 'not yet' decisions are valuable context."
echo "     Use --tags for unattached strategic decisions (e.g., --tags positioning,launch)"

exit 0
