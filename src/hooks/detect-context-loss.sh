#!/bin/bash
# Enginehaus Context Loss Detection Hook (PostToolUse: Bash)
#
# Detects when an agent appears to be re-discovering information that
# Enginehaus already knows — a sign of cognitive drift. Checks if Bash
# commands are exploring areas where decisions already exist.
#
# This is a soft signal, not a hard block. It nudges the agent to check
# Enginehaus context before re-investigating from scratch.
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

# Skip if empty or short
if [ -z "$COMMAND" ] || [ ${#COMMAND} -lt 10 ]; then exit 0; fi

# Only check exploration patterns — commands that suggest the agent
# is investigating something (not building/testing/committing)
IS_EXPLORATION=false

# Reading config/architecture files suggests context gathering
if printf '%s' "$COMMAND" | grep -qE '(cat|less|head|tail)\s+.*(config|settings|package\.json|tsconfig|\.env)'; then
    IS_EXPLORATION=true
fi

# Grepping for patterns/architecture suggests re-discovery
if printf '%s' "$COMMAND" | grep -qE '(grep|rg|ag)\s+.*(import|require|class\s|interface\s|type\s)'; then
    IS_EXPLORATION=true
fi

# Finding files by pattern
if printf '%s' "$COMMAND" | grep -qE '(find|fd)\s+.*-name'; then
    IS_EXPLORATION=true
fi

# Skip if not an exploration command
if [ "$IS_EXPLORATION" = false ]; then exit 0; fi

# Check if Enginehaus has relevant decisions — cache for 60s to avoid
# running a full CLI invocation on every qualifying Bash command
CACHE_FILE="/tmp/.enginehaus-decision-count-$$"
CACHE_TTL=60

if [ -f "$CACHE_FILE" ] && [ "$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))" -lt "$CACHE_TTL" ]; then
    DECISION_COUNT=$(cat "$CACHE_FILE")
else
    DECISION_COUNT=$(enginehaus decision list --json 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.loads(sys.stdin.read())
    print(len(data) if isinstance(data, list) else 0)
except:
    print('0')
" 2>/dev/null)
    printf '%s' "$DECISION_COUNT" > "$CACHE_FILE" 2>/dev/null
fi

if [ "$DECISION_COUNT" -gt "0" ] 2>/dev/null; then
    echo "[enginehaus] This looks like context gathering. Before re-investigating:"
    echo "  - Check existing decisions: enginehaus decision list"
    echo "  - Get full briefing: enginehaus briefing"
    echo "  - Check task context: enginehaus task show <id>"
    echo "  ($DECISION_COUNT decision(s) already recorded for this project)"
fi

exit 0
