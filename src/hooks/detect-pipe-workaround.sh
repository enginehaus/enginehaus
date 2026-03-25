#!/bin/bash
# Enginehaus Pipe Workaround Detection (PostToolUse: Bash)
#
# Detects when agents pipe `enginehaus` CLI output through scripts,
# which signals a feature gap in the CLI. Logs the pattern for
# surfacing in `enginehaus doctor` and `analyze recommendations`.
#
# Structure > Instruction: instead of telling agents "don't pipe",
# we detect it and fix the CLI.
#
# Stdin receives JSON with tool_name, tool_input, etc.
# This is notification-only (exit 0 always).

# Only log in Enginehaus-linked projects
if [ ! -f ".enginehaus/config.json" ]; then exit 0; fi
if ! command -v enginehaus &> /dev/null; then exit 0; fi

# Read the tool input from stdin
INPUT=$(cat)

# Extract the command from the Bash tool input
COMMAND=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.loads(sys.stdin.read())
    cmd = data.get('tool_input', {}).get('command', '')
    print(cmd)
except:
    pass
" 2>/dev/null)

# Check if it's an enginehaus command piped through something
if echo "$COMMAND" | grep -qE 'enginehaus\s+.*\|'; then
    # Extract the enginehaus subcommand and the pipe target
    SUBCMD=$(echo "$COMMAND" | grep -oE 'enginehaus\s+\S+(\s+\S+)?' | head -1)
    PIPE_TARGET=$(echo "$COMMAND" | sed 's/.*|//' | awk '{print $1}')

    # Log it as a metric (best-effort, don't block on failure)
    enginehaus decision log \
        "CLI pipe workaround detected: \`$SUBCMD | $PIPE_TARGET\` — consider adding native CLI support for this pattern" \
        -r "Auto-detected by pipe-workaround hook" \
        -c pattern \
        --tags cli-gap,auto-detected \
        2>/dev/null &
fi

exit 0
