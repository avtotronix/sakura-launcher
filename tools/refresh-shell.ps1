$code = @'
using System;
using System.Runtime.InteropServices;
public class Shell {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
'@
Add-Type -TypeDefinition $code
[Shell]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Host "Shell refreshed successfully."
