# Enginehaus SessionStart Hook (PowerShell)
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
if (-not (Get-Command enginehaus -ErrorAction SilentlyContinue)) {
    Write-Output "=== ENGINEHAUS: CLI not found ==="
    Write-Output "Enginehaus is not installed or not in PATH."
    Write-Output "Install with: npm install -g enginehaus"
    Write-Output ""
    exit 0
}

Write-Output "=== ENGINEHAUS CONTEXT (auto-loaded) ==="
Write-Output ""

# Get briefing — auto-detects project from cwd, falls back to active project
$briefing = enginehaus briefing 2>$null

if (-not $briefing) {
    Write-Output "No project detected for this directory."
    Write-Output "Link with: enginehaus link"
    Write-Output "Or init:   enginehaus init"
    Write-Output ""
    Write-Output "=== END ENGINEHAUS CONTEXT ==="
    exit 0
}

Write-Output $briefing
Write-Output ""
Write-Output "=== END ENGINEHAUS CONTEXT ==="
Write-Output ""
Write-Output "WORKFLOW CHECKLIST (enforced — edits blocked without claimed task):"
Write-Output "  1. CLAIM: enginehaus task next  (or  enginehaus task claim <id>)"
Write-Output "  2. BRANCH: git checkout -b feature/<task-id-prefix>-<short-description>"
Write-Output '  3. DECIDE: enginehaus decision log "..." -r "..." -c architecture'
Write-Output "  4. TEST: npm test  (before committing)"
Write-Output "  5. COMMIT & PUSH: git commit && git push"
Write-Output '  6. COMPLETE: enginehaus task complete <id> -s "summary"'

exit 0
