$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$installer = Join-Path $repoRoot 'scripts/install-native-helper.ps1'
$dummyExe = Join-Path $PSHOME 'pwsh.exe'
if (-not (Test-Path -LiteralPath $dummyExe -PathType Leaf)) { $dummyExe = (Get-Command powershell.exe).Source }
. $installer -ExtensionId 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -HelperExePath $dummyExe

$evidenceRoot = Join-Path $repoRoot 'artifacts/extraction-native'
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$caseRoot = Join-Path $evidenceRoot ('installer-rollback-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $caseRoot | Out-Null
try {
    $manifestPath = Join-Path $caseRoot 'native-host.json'
    $configPath = Join-Path $caseRoot 'config.json'
    $oldManifest = '{"name":"com.queuecat.helper","path":"old.exe"}'
    $oldConfig = '{"sevenZipPath":"old-7z.exe"}'
    [IO.File]::WriteAllText($manifestPath, $oldManifest, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($configPath, $oldConfig, [Text.UTF8Encoding]::new($false))
    $mockRegistry = @{ value = 'old-manifest-path' }
    $commit = { $mockRegistry.value = 'new-manifest-path'; throw 'injected registry failure' }.GetNewClosure()
    $rollback = { $mockRegistry.value = 'old-manifest-path' }.GetNewClosure()
    try {
        Invoke-InstallFilesTransaction -DataDir $caseRoot -ManifestPath $manifestPath -ConfigPath $configPath `
            -ManifestContent '{"name":"com.queuecat.helper","path":"new.exe"}' `
            -ConfigContent '{"sevenZipPath":"new-7z.exe"}' -RegistryBackupContent '{"mock":"old"}' `
            -CommitRegistration $commit -RollbackRegistration $rollback
        throw 'Fault injection did not fail as expected.'
    } catch {
        if ($_.Exception.Message -eq 'Fault injection did not fail as expected.') { throw }
    }
    if ([IO.File]::ReadAllText($manifestPath) -ne $oldManifest) { throw 'Old manifest was not restored.' }
    if ([IO.File]::ReadAllText($configPath) -ne $oldConfig) { throw 'Old config was not restored.' }
    if ($mockRegistry.value -ne 'old-manifest-path') { throw 'Mock registration was not restored.' }
    if (@(Get-ChildItem -LiteralPath $caseRoot -Directory -Filter '.install-backup-*').Count -ne 0) { throw 'Successful rollback left unnecessary backup files.' }

    $newRoot = Join-Path $caseRoot 'first-install'
    New-Item -ItemType Directory -Path $newRoot | Out-Null
    $newManifest = Join-Path $newRoot 'native-host.json'
    $newConfig = Join-Path $newRoot 'config.json'
    $noop = { }
    $fail = { throw 'injected registry failure' }
    try {
        Invoke-InstallFilesTransaction -DataDir $newRoot -ManifestPath $newManifest -ConfigPath $newConfig `
            -ManifestContent '{"name":"com.queuecat.helper"}' -ConfigContent '{"sevenZipPath":"7z.exe"}' `
            -RegistryBackupContent '{"mock":"none"}' `
            -CommitRegistration $fail -RollbackRegistration $noop
        throw 'First-install fault injection did not fail as expected.'
    } catch {
        if ($_.Exception.Message -eq 'First-install fault injection did not fail as expected.') { throw }
    }
    if ((Test-Path -LiteralPath $newManifest) -or (Test-Path -LiteralPath $newConfig)) { throw 'Failed first install left partial files.' }
    Write-Output "Installer rollback smoke passed without touching the registry: $caseRoot"
} finally {
    Write-Output "Isolated rollback fixtures retained for inspection: $caseRoot"
}
