#!/bin/bash
# Enginehaus Workflow Enforcement Hook (PreToolUse: Edit|Write)
#
# Ensures an agent has claimed a task before making code changes.
# This is the "Structure > Instruction" principle in action:
# instead of telling agents to claim tasks, we block edits without one.
#
# Stdin receives JSON with tool_name, tool_input, etc.
# Exit 0 = allow, Exit 2 = block (stderr shown to Claude)

# Only enforce in Enginehaus-linked projects
if [ ! -f ".enginehaus/config.json" ]; then exit 0; fi

# Only enforce if enginehaus CLI is available
if ! command -v enginehaus &> /dev/null; then exit 0; fi

# Check if there's an active in-progress task
# Note: --json output is clean (no [enginehaus] prefix) when piped,
# so we can parse directly with python3 without line-skipping hacks.
IN_PROGRESS=$(enginehaus task list -s in-progress --json 2>/dev/null | python3 -c "
import json, sys
try:
    tasks = json.loads(sys.stdin.read())
    print(len(tasks))
except:
    print('0')
" 2>/dev/null)

if [ "$IN_PROGRESS" = "0" ] || [ -z "$IN_PROGRESS" ]; then
    echo '{"decision":"block","reason":"No task claimed. Run `enginehaus task next` or `enginehaus task claim <id>` before making code changes."}' >&2
    exit 2
fi

exit 0
