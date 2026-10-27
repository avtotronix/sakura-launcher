$WshShell = New-Object -ComObject WScript.Shell

$Desktops = @(
    "C:\Users\pavlo\Desktop",
    "C:\Users\pavlo\OneDrive\Desktop"
)

foreach ($dir in $Desktops) {
    if (Test-Path $dir) {
        $lnk = Join-Path $dir "Sakura Launcher.lnk"
        $sc = $WshShell.CreateShortcut($lnk)
        $sc.TargetPath = "D:\Projects\Sakura-Launcher\release\win-unpacked\Sakura Launcher.exe"
        $sc.WorkingDirectory = "D:\Projects\Sakura-Launcher\release\win-unpacked"
        $sc.Description = "Sakura Launcher - Minecraft Launcher"
        $sc.IconLocation = "D:\Projects\Sakura-Launcher\icon.ico,0"
        $sc.Save()
        Write-Host "Updated shortcut at: $lnk"
    }
}
