param([switch]$DryRun)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path "$ScriptDir\.."
Set-Location $RepoRoot

$Remote = "flujo-fondos-upstream"
$RemoteUrl = "https://github.com/pedroabba123/flujo-fondos.git"
$Branch = "master"
$Prefix = "services/flujo-fondos"

$existing = git remote
if ($existing -notcontains $Remote) {
  Write-Host "Agregando remote $Remote -> $RemoteUrl"
  git remote add $Remote $RemoteUrl
}

Write-Host "Fetching $Remote/$Branch..."
git fetch $Remote $Branch

if ($DryRun) {
  Write-Host ""
  Write-Host "=== Ultimos 20 commits upstream ==="
  git log "$Remote/$Branch" --oneline -20 | Out-Host

  $LastSync = (git log --grep="^Squashed '$Prefix" -1 --pretty=format:"%H %ad %s" --date=short)
  if ($LastSync) {
    Write-Host ""
    Write-Host "=== Ultimo sync local ==="
    Write-Host $LastSync
  }

  $LastSubtreeCommit = (git log --grep="Squashed '$Prefix" -1 --pretty=format:"%s" | Select-String -Pattern "from commit ([a-f0-9]+)").Matches.Groups[1].Value
  if ($LastSubtreeCommit) {
    Write-Host ""
    Write-Host "=== Commits upstream desde el ultimo sync ($LastSubtreeCommit) ==="
    git log "$LastSubtreeCommit..$Remote/$Branch" --oneline 2>$null | Out-Host
  }
  Write-Host ""
  Write-Host "DRY RUN: no se aplico nada. Corre sin -DryRun para sincronizar."
  exit 0
}

$dirty = git status --porcelain
if ($dirty) {
  Write-Error "Working tree has uncommitted changes. Commit o stash antes de sincronizar."
  exit 1
}

$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($currentBranch -eq "main" -or $currentBranch -eq "master") {
  Write-Warning "Estas en branch $currentBranch. Se recomienda hacer el sync en una branch dedicada (ej. chore/sync-flujo-fondos)."
  $confirm = Read-Host "Continuar igual? (y/N)"
  if ($confirm -ne "y") { exit 0 }
}

Write-Host "Pulling $Remote/$Branch into $Prefix (squash)..."
git subtree pull --prefix=$Prefix $Remote $Branch --squash -m "chore(flujo-fondos): sync upstream"

Write-Host ""
Write-Host "Sync completo. Proximos pasos:"
Write-Host "  1. git log -3 --oneline                      # ver el merge commit + squash"
Write-Host "  2. git diff HEAD~1 -- $Prefix                # revisar cambios"
Write-Host "  3. cd $Prefix && npm install && npm run build  # validar build local si toca"
Write-Host "  4. railway up --service flujo-fondos --detach  # deploy a Railway"
