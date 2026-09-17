<#
.SYNOPSIS
  Make FocusLoop start automatically when you sign in to Windows.

.DESCRIPTION
  Creates (or removes) a shortcut in your personal Startup folder:

    %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

  Windows launches everything in that folder at login, so this is the supported
  way to auto-start a desktop app on Windows and it needs no code change and no
  administrator rights.

  Nothing here touches the FocusLoop source tree, and nothing is changed until you
  run this script yourself.

.PARAMETER Remove
  Delete the shortcut instead of creating it.

.PARAMETER Target
  What the shortcut should launch. Defaults to `scripts\start-focusloop.cmd`,
  which builds and runs from source.

  Point it at an installed copy instead if you would rather auto-start the
  packaged app:

    .\focusloop-startup.ps1 -Target "$env:LOCALAPPDATA\Programs\FocusLoop\FocusLoop.exe"

.PARAMETER Force
  Overwrite an existing shortcut without asking.

.EXAMPLE
  # Auto-start the development build at every login
  .\focusloop-startup.ps1

.EXAMPLE
  # Undo it
  .\focusloop-startup.ps1 -Remove
#>
[CmdletBinding()]
param(
  [switch] $Remove,
  [string] $Target,
  [switch] $Force
)

$ErrorActionPreference = 'Stop'

$startupDir = [Environment]::GetFolderPath('Startup')
$linkPath = Join-Path $startupDir 'FocusLoop.lnk'
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  if (Test-Path -LiteralPath $linkPath) {
    Remove-Item -LiteralPath $linkPath -Force
    Write-Host "Removed:  $linkPath"
    Write-Host 'FocusLoop will no longer start automatically.'
  }
  else {
    Write-Host "Nothing to remove: $linkPath does not exist."
  }
  return
}

if ([string]::IsNullOrWhiteSpace($Target)) {
  $Target = Join-Path $PSScriptRoot 'start-focusloop.cmd'
}

if (-not (Test-Path -LiteralPath $Target)) {
  throw "Target not found: $Target"
}

if ((Test-Path -LiteralPath $linkPath) -and -not $Force) {
  Write-Host "A shortcut already exists: $linkPath"
  Write-Host 'Re-run with -Force to overwrite it, or with -Remove to delete it.'
  return
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $Target
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = 'Launch FocusLoop'
# Launching a .cmd opens a console window; keep it out of the way at login.
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host "Created:  $linkPath"
Write-Host "Target:   $Target"
Write-Host "Workdir:  $repoRoot"
Write-Host ''
Write-Host 'FocusLoop will start at your next Windows sign-in.'
Write-Host 'Undo at any time with:  .\focusloop-startup.ps1 -Remove'
