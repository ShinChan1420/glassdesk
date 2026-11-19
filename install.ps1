# Builds the Workmate Desk installer, installs it for the current user and starts it.
# Also removes the old "GlassDesk" copy and, when PowerToys Command Palette is present,
# (re)installs the Everhour dock extension. Run again any time to update.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 1. build "dist\Workmate Desk Setup <version>.exe" (wizard installer with desktop + Start menu shortcuts)
npx electron-builder --win nsis
if ($LASTEXITCODE) { throw 'Build failed' }
$setup = Get-ChildItem dist -Filter 'Workmate Desk Setup *.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# 2. close running copies (old and new name) so files can be replaced
$running = Get-Process 'GlassDesk', 'Workmate Desk' -ErrorAction SilentlyContinue
if ($running) { $running | Stop-Process -Force; $running | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500 }

# 3. remove the copy from before the rename (its data folder is kept and reused)
$old = Join-Path $env:LOCALAPPDATA 'Programs\GlassDesk'
if (Test-Path $old) { Remove-Item $old -Recurse -Force }
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\GlassDesk.lnk') -Force -ErrorAction SilentlyContinue
foreach ($name in 'electron.app.GlassDesk', 'io.glassdesk.app') {
  Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $name -ErrorAction SilentlyContinue
}

# 4. install silently: same result as clicking through the wizard with the defaults
Start-Process $setup.FullName -ArgumentList '/S' -Wait
$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Depth 2 -Filter 'Workmate Desk.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw 'Installed, but Workmate Desk.exe was not found' }

# 5. Command Palette dock extension (optional: needs PowerToys, Visual Studio and Developer Mode)
if (Get-AppxPackage Microsoft.CommandPalette -ErrorAction SilentlyContinue) {
  try {
    $msbuild = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -prerelease -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
    & $msbuild cmdpal-dock\GlassDeskDock.sln /restore /p:Configuration=Debug /p:Platform=x64 /v:quiet /nologo
    if ($LASTEXITCODE) { throw 'extension build failed' }
    $layout = Get-ChildItem cmdpal-dock\GlassDeskDock\bin\x64\Debug -Recurse -Filter AppxManifest.xml | Select-Object -First 1
    $dock = Join-Path $env:LOCALAPPDATA 'Programs\Workmate Desk Dock'
    Get-AppxPackage GlassDeskDock | Remove-AppxPackage -ErrorAction SilentlyContinue
    if (Test-Path $dock) { Remove-Item $dock -Recurse -Force }
    Copy-Item $layout.DirectoryName $dock -Recurse
    Add-AppxPackage -Register (Join-Path $dock 'AppxManifest.xml') -ForceUpdateFromAnyVersion
    Write-Host 'Command Palette dock extension installed. In Command Palette run "Reload" to pick it up.'
  } catch { Write-Warning "Skipped the Command Palette extension: $($_.Exception.Message)" }
}

# 6. start it through Explorer. Run from inside a packaged app (e.g. the Claude desktop app's terminal), a
# direct Start-Process would inherit that app's private AppData and the settings would land in a hidden copy.
Start-Process explorer.exe -ArgumentList "`"$($exe.FullName)`""
Write-Host "Installed: $($exe.FullName)"
