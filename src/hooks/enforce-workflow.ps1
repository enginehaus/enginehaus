# Enginehaus Workflow Enforcement Hook (PreToolUse: Edit|Write) (PowerShell)
#
# Ensures an agent has claimed a task before making code changes.
# This is the "Structure > Instruction" principle in action:
# instead of telling agents to claim tasks, we block edits without one.
#
# Stdin receives JSON with tool_name, tool_input, etc.
# Exit 0 = allow, Exit 2 = block (stderr shown to Claude)

# Only enforce in Enginehaus-linked projects
if (-not (Test-Path ".enginehaus/config.json")) { exit 0 }

# Only enforce if enginehaus CLI is available
if (-not (Get-Command enginehaus -ErrorAction SilentlyContinue)) { exit 0 }

# Check if there's an active in-progress task
try {
    $output = enginehaus task list -s in-progress --json 2>$null
    # Skip the database info line if present
    $jsonStr = ($output | Where-Object { $_ -notmatch '^\[enginehaus\]' }) -join "`n"
    $tasks = $jsonStr | ConvertFrom-Json
    $count = @($tasks).Count
} catch {
    $count = 0
}

if ($count -eq 0) {
    [Console]::Error.WriteLine('{"decision":"block","reason":"No task claimed. Run `enginehaus task next` or `enginehaus task claim <id>` before making code changes."}')
    exit 2
}

exit 0
