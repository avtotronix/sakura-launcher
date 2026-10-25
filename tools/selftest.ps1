$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot\..
npx tsc -p tsconfig.main.json; npx tsc -p tsconfig.preload.json
$env:SAKURA_SELFTEST = (Resolve-Path "tools\selftest.js").Path
& ".\node_modules\electron\dist\electron.exe" . 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -notmatch "cache|Cache|GPU process|gpu_" }
Remove-Item Env:SAKURA_SELFTEST
