#!/bin/bash
# Enginehaus Post-Commit Reminder Hook (PostToolUse: Bash)
#
# After a git commit, reminds the agent to run tests and push.
# Only triggers on Bash calls that contain "git commit".
#
# Stdin receives JSON with tool_input.command, tool_response, etc.

# Only in Enginehaus projects
if [ ! -f ".enginehaus/config.json" ]; then exit 0; fi

# Read stdin to check if this was a git commit
INPUT=$(cat)

# Check if the command was a git commit
COMMAND=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.loads(sys.stdin.read())
    print(data.get('tool_input', {}).get('command', ''))
except:
    print('')
" 2>/dev/null)

if echo "$COMMAND" | grep -q "git commit"; then
    echo "[enginehaus] Commit detected. Before completing this task:"
    echo "  1. Run tests: npm test"
    echo "  2. Push: git push"
    echo "  3. Complete: enginehaus task complete <id> -s \"summary\""
fi

exit 0
