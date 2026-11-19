# Runs one unattended Claude Code pass over Hiwar that continues the current goal when this
# session is idle (for example after a usage limit). Registered as the Windows scheduled task "Hiwar continuation" (every 3 hours).
# It never commits or pushes. Output: .data/continuation.log
$ErrorActionPreference = "Continue"
$root = "D:\work\my\Hiwar"
Set-Location $root
New-Item -ItemType Directory -Force "$root\.data" | Out-Null
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';C:\Program Files\Docker\Docker\resources\bin'
# Skip this pass while another session is working: any source file changed in the last 20 minutes.
$recent = Get-ChildItem -Recurse -File "$root\apps\web\src","$root\services","$root\infra" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-20) } | Select-Object -First 1
if ($recent) { "=== $(Get-Date -Format s) skipped: $($recent.FullName) changed recently" | Out-File -Append -Encoding utf8 "$root\.data\continuation.log"; exit 0 }
$prompt = @'
Continue the Hiwar goal in D:\work\my\Hiwar, following CLAUDE.md: "UI is complete, architecture follows docs/00-input-requirements/tech-stack.md, AI features implemented from docs/00-input-requirements/ai-capabilities-module.zip".
Read the project memory notes first (ai-module-and-platform-plan, ai-module-merge-steps): they hold the decided design and the current checkpoint. Continue from that checkpoint: merge the AI module's core into apps/web (keep its import paths, Hiwar-styled components/ui, adapters for session, host features and schema, routes under /ops/ai), get `npx tsc --noEmit`, `npx eslint src` and `npx vitest run` passing in apps/web, then move to the platform step (kind + Helm) when the merge is done.
Cap memory for any container or process you start, stop what you started, update the memory note when a checkpoint is done, and append one dated line to docs/10-project-management/progress-log.md. Do not commit or push.
'@
$log = "$root\.data\continuation.log"
"=== $(Get-Date -Format s)" | Out-File -Append -Encoding utf8 $log
& "C:\Users\hassan\.local\bin\claude.exe" -p $prompt --permission-mode acceptEdits `
  --allowedTools "Bash(docker compose:*)" "Bash(npx:*)" "Bash(npm:*)" "Bash(uv run:*)" "Bash(py -3:*)" `
  "PowerShell(docker compose:*)" "PowerShell(npx:*)" "PowerShell(npm:*)" "PowerShell(uv run:*)" "PowerShell(py -3:*)" `
  "Read" "Edit" "Write" "Glob" "Grep" 2>&1 | Out-File -Append -Encoding utf8 $log
