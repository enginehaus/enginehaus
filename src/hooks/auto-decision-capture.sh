#!/bin/bash
# Enginehaus Auto-Decision Capture Hook (PostToolUse: Bash)
#
# Detects implicit decisions in git commit messages that weren't
# logged through `enginehaus decision log`. When an agent commits
# with messages containing decision language ("chose X over Y",
# "switched to", "replaced", etc.), this hook nudges them to
# capture the rationale properly.
#
# Stdin receives JSON with tool_input.command, tool_response, etc.

# Only in Enginehaus projects
if [ ! -f ".enginehaus/config.json" ]; then exit 0; fi

# Read stdin
INPUT=$(cat)

# Extract the command
COMMAND=$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    data = json.loads(sys.stdin.read())
    print(data.get('tool_input', {}).get('command', ''))
except:
    print('')
" 2>/dev/null)

# Skip if empty
if [ -z "$COMMAND" ]; then exit 0; fi

# Only check git commit commands
if ! printf '%s' "$COMMAND" | grep -qE 'git\s+commit'; then exit 0; fi

# Extract the commit message — use grep to avoid shell/python quoting hell
# Pull everything after -m "..." or -m '...'
COMMIT_MSG=$(printf '%s' "$COMMAND" | sed -n 's/.*-m *["'"'"']\(.*\)["'"'"'].*/\1/p' | head -1)

if [ -z "$COMMIT_MSG" ]; then exit 0; fi

# Check for decision language in the commit message
HAS_DECISION=false

# Explicit choice language
if printf '%s' "$COMMIT_MSG" | grep -qiE '(chose|choose|picked|selected|decided|opted)\s+(for\s+|to\s+)?'; then
    HAS_DECISION=true
fi

# Replacement/migration language
if printf '%s' "$COMMIT_MSG" | grep -qiE '(switch|migrat|replac|swap|mov)(e|ed|ing)?\s+(from\s+|to\s+)'; then
    HAS_DECISION=true
fi

# Tradeoff language (require context around "over" to avoid false positives)
if printf '%s' "$COMMIT_MSG" | grep -qiE '(chose.*over|picked.*over|instead of|rather than|trade.?off|versus|vs\.)'; then
    HAS_DECISION=true
fi

# Architecture keywords
if printf '%s' "$COMMIT_MSG" | grep -qiE '(refactor|restructure|redesign|rearchitect)'; then
    HAS_DECISION=true
fi

if [ "$HAS_DECISION" = true ]; then
    TRUNCATED=$(printf '%.80s' "$COMMIT_MSG")
    echo "[enginehaus] This commit contains decision language. Consider capturing the rationale:"
    printf '  enginehaus decision log "%s" \\\n' "$TRUNCATED"
    echo '    -r "<why this approach>" -c architecture'
    echo "  Decisions logged now appear in future task context automatically."
fi

exit 0
