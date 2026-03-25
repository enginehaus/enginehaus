# Enginehaus Post-Commit Reminder Hook (PostToolUse: Bash) (PowerShell)
#
# After a git commit, reminds the agent to run tests and push.
# Only triggers on Bash calls that contain "git commit".
#
# Stdin receives JSON with tool_input.command, tool_response, etc.

# Only in Enginehaus projects
if (-not (Test-Path ".enginehaus/config.json")) { exit 0 }

# Read stdin to check if this was a git commit
try {
    $input = [Console]::In.ReadToEnd()
    $data = $input | ConvertFrom-Json
    $command = $data.tool_input.command
} catch {
    exit 0
}

if ($command -match "git commit") {
    Write-Output "[enginehaus] Commit detected. Before completing this task:"
    Write-Output "  1. Run tests: npm test"
    Write-Output "  2. Push: git push"
    Write-Output '  3. Complete: enginehaus task complete <id> -s "summary"'
}

exit 0
