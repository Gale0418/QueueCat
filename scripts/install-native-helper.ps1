[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string] $ExtensionId,

    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string] $HelperExePath,

    [Parameter()]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string] $SevenZipPath
)

$ErrorActionPreference = 'Stop'
$script:QueueCatHostName = 'com.queuecat.helper'

function Assert-OwnedInstallFiles {
    param(
        [Parameter(Mandatory = $true)] [string] $ManifestPath,
        [Parameter(Mandatory = $true)] [string] $ConfigPath,
        [Parameter(Mandatory = $true)] [string] $HostName
    )

    if (Test-Path -LiteralPath $ManifestPath) {
        try { $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json }
        catch { throw "Refusing to replace unreadable native host manifest: $ManifestPath" }
        if ($manifest.name -ne $HostName) { throw "Refusing to replace a manifest not owned by QueueCat: $ManifestPath" }
    }
    if (Test-Path -LiteralPath $ConfigPath) {
        try { $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json }
        catch { throw "Refusing to replace unreadable helper config: $ConfigPath" }
        if ($null -eq $config) { throw "Refusing to replace invalid helper config: $ConfigPath" }
        $properties = @($config.PSObject.Properties.Name)
        if (@($properties | Where-Object { $_ -ne 'sevenZipPath' }).Count -gt 0) {
            throw "Refusing to replace helper config containing fields not owned by QueueCat: $ConfigPath"
        }
    }
}

function Invoke-InstallFilesTransaction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $DataDir,
        [Parameter(Mandatory = $true)] [string] $ManifestPath,
        [Parameter(Mandatory = $true)] [string] $ConfigPath,
        [Parameter(Mandatory = $true)] [string] $ManifestContent,
        [AllowNull()] [string] $ConfigContent,
        [Parameter(Mandatory = $true)] [string] $RegistryBackupContent,
        [Parameter(Mandatory = $true)] [scriptblock] $CommitRegistration,
        [Parameter(Mandatory = $true)] [scriptblock] $RollbackRegistration
    )

    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    Assert-OwnedInstallFiles -ManifestPath $ManifestPath -ConfigPath $ConfigPath -HostName $script:QueueCatHostName

    $backupDir = Join-Path $DataDir ('.install-backup-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backupDir | Out-Null
    $hadManifest = Test-Path -LiteralPath $ManifestPath -PathType Leaf
    $hadConfig = Test-Path -LiteralPath $ConfigPath -PathType Leaf
    $manifestBackup = Join-Path $backupDir 'native-host.json'
    $configBackup = Join-Path $backupDir 'config.json'
    $registryBackup = Join-Path $backupDir 'native-registration.json'
    $manifestTemp = "$ManifestPath.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
    $configTemp = "$ConfigPath.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
    $filesTouched = $false
    $registrationAttempted = $false
    try {
        if ($hadManifest) { Copy-Item -LiteralPath $ManifestPath -Destination $manifestBackup }
        if ($hadConfig) { Copy-Item -LiteralPath $ConfigPath -Destination $configBackup }
        [IO.File]::WriteAllText($registryBackup, $RegistryBackupContent, [Text.UTF8Encoding]::new($false))

        [IO.File]::WriteAllText($manifestTemp, $ManifestContent, [Text.UTF8Encoding]::new($false))
        if ($null -ne $ConfigContent) {
            [IO.File]::WriteAllText($configTemp, $ConfigContent, [Text.UTF8Encoding]::new($false))
        }
        Move-Item -LiteralPath $manifestTemp -Destination $ManifestPath -Force
        $filesTouched = $true
        if ($null -ne $ConfigContent) {
            Move-Item -LiteralPath $configTemp -Destination $ConfigPath -Force
        } elseif (Test-Path -LiteralPath $ConfigPath) {
            Remove-Item -LiteralPath $ConfigPath -Force
        }

        $registrationAttempted = $true
        & $CommitRegistration
        Remove-Item -LiteralPath $backupDir -Recurse -Force
    } catch {
        $failure = $_.Exception.Message
        $rollbackErrors = [Collections.Generic.List[string]]::new()
        if ($registrationAttempted) {
            try { & $RollbackRegistration } catch { $rollbackErrors.Add("registry: $($_.Exception.Message)") }
        }
        if ($filesTouched) {
            foreach ($entry in @(
                @{ path = $ManifestPath; backup = $manifestBackup; existed = $hadManifest },
                @{ path = $ConfigPath; backup = $configBackup; existed = $hadConfig }
            )) {
                try {
                    if ($entry.existed) {
                        $restoreTemp = "$($entry.path).restore-$PID-$([guid]::NewGuid().ToString('N'))"
                        Copy-Item -LiteralPath $entry.backup -Destination $restoreTemp
                        Move-Item -LiteralPath $restoreTemp -Destination $entry.path -Force
                    } elseif (Test-Path -LiteralPath $entry.path) {
                        Remove-Item -LiteralPath $entry.path -Force
                    }
                } catch {
                    $rollbackErrors.Add("$($entry.path): $($_.Exception.Message)")
                }
            }
        }
        if ($rollbackErrors.Count -gt 0) {
            throw "Install failed: $failure. Rollback was incomplete ($($rollbackErrors -join '; ')); backups retained at $backupDir."
        }
        Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
        throw "Install failed; previous QueueCat files and registration were restored: $failure"
    } finally {
        Remove-Item -LiteralPath $manifestTemp,$configTemp -Force -ErrorAction SilentlyContinue
    }
}

function Install-QueueCatNativeHelper {
    param(
        [Parameter(Mandatory = $true)] [string] $Id,
        [Parameter(Mandatory = $true)] [string] $HelperPath,
        [string] $EnginePath
    )
    if ($Id -notmatch '^[a-p]{32}$') { throw 'ExtensionId must be exactly 32 lowercase Chrome extension ID characters (a-p).' }
    $helperExe = (Resolve-Path -LiteralPath $HelperPath).Path
    if ([IO.Path]::GetExtension($helperExe) -ne '.exe') { throw 'HelperExePath must refer to an .exe file.' }
    $resolvedSevenZip = if ($EnginePath) { (Resolve-Path -LiteralPath $EnginePath).Path } else { $null }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable; no installer changes were made.' }
    if ($resolvedSevenZip -and [IO.Path]::GetExtension($resolvedSevenZip) -ne '.exe') { throw 'SevenZipPath must refer to an .exe file.' }
    $dataDir = Join-Path $env:LOCALAPPDATA 'QueueCatHelper'
    $manifestPath = Join-Path $dataDir 'native-host.json'
    $configPath = Join-Path $dataDir 'config.json'
    $registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$script:QueueCatHostName"

    $registryExisted = Test-Path -LiteralPath $registryPath
    $oldRegistryValue = $null
    if ($registryExisted) {
        $key = Get-Item -LiteralPath $registryPath
        $oldRegistryValue = [string]$key.GetValue('')
        if (-not $oldRegistryValue -or [IO.Path]::GetFullPath($oldRegistryValue) -ne [IO.Path]::GetFullPath($manifestPath)) {
            throw "Refusing to replace an existing native host registration at $registryPath."
        }
    }

    $manifest = [ordered]@{
        name = $script:QueueCatHostName
        description = 'QueueCat archive extraction helper'
        path = $helperExe
        type = 'stdio'
        allowed_origins = @("chrome-extension://$Id/")
    } | ConvertTo-Json -Depth 4
    $configContent = if ($resolvedSevenZip) {
        ([ordered]@{ sevenZipPath = $resolvedSevenZip } | ConvertTo-Json -Depth 3)
    } else {
        $null
    }
    $registryBackupContent = [ordered]@{
        path = $registryPath
        existed = $registryExisted
        defaultValue = $oldRegistryValue
    } | ConvertTo-Json -Depth 3

    $registryState = @{ created = $false; touched = $false }
    $commitRegistry = {
        $registryState.touched = $true
        if (-not $registryExisted) {
            New-Item -Path $registryPath | Out-Null
            $registryState.created = $true
        }
        Set-Item -LiteralPath $registryPath -Value $manifestPath
    }.GetNewClosure()
    $rollbackRegistry = {
        if ($registryState.touched) {
            if ($registryExisted) {
                Set-Item -LiteralPath $registryPath -Value $oldRegistryValue
            } elseif ($registryState.created -and (Test-Path -LiteralPath $registryPath)) {
                $createdKey = Get-Item -LiteralPath $registryPath
                if ([string]$createdKey.GetValue('') -eq $manifestPath) {
                    Remove-ItemProperty -LiteralPath $registryPath -Name '(default)' -ErrorAction SilentlyContinue
                    $createdKey = Get-Item -LiteralPath $registryPath
                }
                if ($createdKey.ValueCount -eq 0 -and $createdKey.SubKeyCount -eq 0) {
                    Remove-Item -LiteralPath $registryPath
                }
            }
        }
    }.GetNewClosure()

    Invoke-InstallFilesTransaction -DataDir $dataDir -ManifestPath $manifestPath -ConfigPath $configPath `
        -ManifestContent $manifest -ConfigContent $configContent -RegistryBackupContent $registryBackupContent `
        -CommitRegistration $commitRegistry -RollbackRegistration $rollbackRegistry
    Write-Output "QueueCat native helper registered for extension $Id."
}

if ($MyInvocation.InvocationName -ne '.') {
    Install-QueueCatNativeHelper -Id $ExtensionId -HelperPath $HelperExePath -EnginePath $SevenZipPath
}
