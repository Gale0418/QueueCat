[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$hostName = 'com.queuecat.helper'
$dataDir = Join-Path $env:LOCALAPPDATA 'QueueCatHelper'
$manifestPath = Join-Path $dataDir 'native-host.json'
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if (Test-Path -LiteralPath $registryPath) {
    $registeredPath = [string](Get-Item -LiteralPath $registryPath).GetValue('')
    if ($registeredPath -and [IO.Path]::GetFullPath($registeredPath) -eq [IO.Path]::GetFullPath($manifestPath)) {
        Remove-ItemProperty -LiteralPath $registryPath -Name '(default)' -ErrorAction SilentlyContinue
        $key = Get-Item -LiteralPath $registryPath
        if ($key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0) {
            Remove-Item -LiteralPath $registryPath
        }
        if (Test-Path -LiteralPath $manifestPath) {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            if ($manifest.name -eq $hostName) { Remove-Item -LiteralPath $manifestPath -Force }
        }
        Write-Output 'QueueCat native helper registration removed.'
    } else {
        Write-Output 'Registration belongs to another host; no registry value or file was changed.'
    }
} else {
    Write-Output 'QueueCat native helper is not registered.'
}
