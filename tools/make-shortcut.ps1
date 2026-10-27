$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop "Sakura Launcher.lnk"

# Remove old shortcut if exists
if (Test-Path $ShortcutPath) {
    Remove-Item $ShortcutPath -Force
}

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "D:\Projects\Sakura-Launcher\release\win-unpacked\Sakura Launcher.exe"
$Shortcut.WorkingDirectory = "D:\Projects\Sakura-Launcher\release\win-unpacked"
$Shortcut.Description = "Sakura Launcher - Minecraft Launcher"
$Shortcut.IconLocation = "D:\Projects\Sakura-Launcher\icon.ico,0"
$Shortcut.Save()

Write-Host "Shortcut created at: $ShortcutPath"
Write-Host "Target: $($Shortcut.TargetPath)"
Write-Host "IconLocation: $($Shortcut.IconLocation)"
