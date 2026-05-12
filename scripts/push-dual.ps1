<#
.SYNOPSIS
  Push full source to "private" remote, then refresh public clone (installer + README only).

.PARAMETER PublicClone
  Absolute path to your local clone of the PUBLIC (installer-only) repo.

.PARAMETER PrivateRemote
  Name of the git remote for the PRIVATE full-source repo (default: private).

.PARAMETER SkipBuild
  If set, do not run npm run dist:nsis (use when you already built).

.EXAMPLE
  .\scripts\push-dual.ps1 -PublicClone "C:\dev\releases\ComunityWatch-Windows-public"
#>
param(
  [Parameter(Mandatory = $true)][string]$PublicClone,
  [string]$PrivateRemote = "private",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $AppRoot

Write-Host "==> git push $PrivateRemote main (full source)"
git push "${PrivateRemote}" main
if ($LASTEXITCODE -ne 0) {
  throw "git push $PrivateRemote failed. Add the remote: git remote add $PrivateRemote <url>"
}

if (-not $SkipBuild) {
  Write-Host "==> npm run dist:nsis"
  npm run dist:nsis
  if ($LASTEXITCODE -ne 0) { throw "dist:nsis failed" }
}

$pub = (Resolve-Path $PublicClone).Path
$env:PUBLIC_RELEASE_DIR = $pub
Write-Host "==> npm run release:public -> $pub"
npm run release:public
if ($LASTEXITCODE -ne 0) { throw "release:public failed" }

Write-Host @"

==> PUBLIC repo — review and push (only README + releases should change):

  cd `"$pub`"
  git add README.md releases
  git status
  git commit -m `"Release (installer)`"
  git push public main

Use remote name `public` (git remote add public <public-repo-url> if missing).
"@
