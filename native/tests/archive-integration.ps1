[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })] [string] $HelperExePath,
    [Parameter(Mandatory = $true)] [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })] [string] $SevenZipPath,
    [Parameter(Mandatory = $false)] [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })] [string] $RarExePath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$evidenceRoot = Join-Path $repoRoot 'artifacts/extraction-native'
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$caseRoot = Join-Path $evidenceRoot ("integration-" + [guid]::NewGuid().ToString('N'))
$stateRoot = Join-Path $caseRoot 'state'
$downloadRoot = Join-Path $caseRoot 'isolated-download-fixtures'
New-Item -ItemType Directory -Path $stateRoot,$downloadRoot -Force | Out-Null
$oldHome = $env:QUEUECAT_HELPER_HOME
$env:QUEUECAT_HELPER_HOME = $stateRoot
[IO.File]::WriteAllText((Join-Path $stateRoot 'config.json'), (@{ sevenZipPath = (Resolve-Path -LiteralPath $SevenZipPath).Path } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$helper = (Resolve-Path -LiteralPath $HelperExePath).Path
$seven = (Resolve-Path -LiteralPath $SevenZipPath).Path
$password = 'QueueCat-Integration-Secret-42'

function Invoke-Helper([hashtable] $Request) {
    $json = $Request | ConvertTo-Json -Compress -Depth 6
    $payload = [Text.Encoding]::UTF8.GetBytes($json)
    $prefix = [BitConverter]::GetBytes([uint32]$payload.Length)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $helper
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [Diagnostics.Process]::Start($psi)
    $proc.StandardInput.BaseStream.Write($prefix, 0, 4)
    $proc.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
    $proc.StandardInput.BaseStream.Close()
    $frame = [byte[]]::new(4)
    $offset = 0
    while ($offset -lt 4) { $n = $proc.StandardOutput.BaseStream.Read($frame, $offset, 4 - $offset); if ($n -le 0) { throw 'Truncated native helper response header.' }; $offset += $n }
    $length = [BitConverter]::ToUInt32($frame, 0)
    if ($length -gt 1048576) { throw 'Native helper response exceeded protocol limit.' }
    $data = [byte[]]::new($length); $offset = 0
    while ($offset -lt $data.Length) { $n = $proc.StandardOutput.BaseStream.Read($data, $offset, $data.Length - $offset); if ($n -le 0) { throw 'Truncated native helper response body.' }; $offset += $n }
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { throw "Native helper exited with $($proc.ExitCode): $($proc.StandardError.ReadToEnd())" }
    return ([Text.Encoding]::UTF8.GetString($data) | ConvertFrom-Json)
}

function Invoke-7Zip([string[]] $Arguments) {
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $seven
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    foreach ($arg in $Arguments) { $psi.ArgumentList.Add($arg) }
    $proc = [Diagnostics.Process]::Start($psi)
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { throw "7-Zip fixture creation failed with code $($proc.ExitCode). $($stderrTask.Result)" }
}

function Invoke-Rar([string[]] $Arguments) {
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = (Resolve-Path -LiteralPath $RarExePath).Path
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    foreach ($arg in $Arguments) { $psi.ArgumentList.Add($arg) }
    $proc = [Diagnostics.Process]::Start($psi)
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { throw "RAR test fixture creation failed with exit code $($proc.ExitCode). $($stderrTask.Result)" }
}

function Wait-Job([string] $Id) {
    for ($i = 0; $i -lt 300; $i++) {
        $state = Invoke-Helper @{ op = 'status'; id = $Id }
        if ($state.status -eq 'complete' -or $state.status -eq 'failed') { return $state }
        Start-Sleep -Milliseconds 200
    }
    throw 'Extraction job did not settle within 60 seconds.'
}

function New-ExpiredSecretFixture([string] $Id) {
    $secrets = Join-Path $stateRoot 'secrets'
    New-Item -ItemType Directory -Path $secrets -Force | Out-Null
    $path = Join-Path $secrets "$Id.bin"
    [IO.File]::WriteAllBytes($path, [byte[]](1,2,3,4))
    [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::UtcNow.AddDays(-8))
    return $path
}

try {
    $plain = Join-Path $downloadRoot 'fixture.txt'
    [IO.File]::WriteAllText($plain, ('QueueCat archive isolation fixture ' * 12000), [Text.UTF8Encoding]::new($false))
    $archive = Join-Path $downloadRoot 'fixture.7z'
    Invoke-7Zip @('a','-y',"-p$password",'-mhe=on',$archive,$plain)
    $secret = Invoke-Helper @{ op = 'store-secret'; id = 'integration-secret'; password = $password }
    if (-not $secret.ok) { throw "store-secret failed: $($secret.errorCode)" }

    $expiredPing = New-ExpiredSecretFixture 'expired-ping'
    [void](Invoke-Helper @{ op = 'ping' })
    if (Test-Path -LiteralPath $expiredPing) { throw 'ping did not collect the expired secret fixture.' }
    $expiredStore = New-ExpiredSecretFixture 'expired-store'
    $storeTrigger = Invoke-Helper @{ op = 'store-secret'; id = 'cleanup-trigger'; password = $password }
    if (-not $storeTrigger.ok -or (Test-Path -LiteralPath $expiredStore)) { throw 'store-secret did not collect the expired secret fixture.' }
    $expiredStatus = New-ExpiredSecretFixture 'expired-status'
    $missingStatus = Invoke-Helper @{ op = 'status'; id = 'cleanup-status-missing' }
    if ($missingStatus.errorCode -ne 'job-not-found' -or (Test-Path -LiteralPath $expiredStatus)) { throw 'status did not collect expired secrets while preserving missing-job behavior.' }
    $expiredStartSecret = New-ExpiredSecretFixture 'expired-start'
    $expiredStart = Invoke-Helper @{ op = 'start'; id = 'expired-secret-job'; paths = @($archive); secretId = 'expired-start' }
    if ($expiredStart.errorCode -ne 'secret-expired' -or (Test-Path -LiteralPath $expiredStartSecret)) { throw 'start did not reject and remove an expired secret.' }
    if (Test-Path -LiteralPath (Join-Path $stateRoot 'jobs/expired-secret-job.json')) { throw 'Expired-secret rejection persisted a job state.' }
    $cleanedStartSecret = New-ExpiredSecretFixture 'cleaned-before-start'
    [void](Invoke-Helper @{ op = 'ping' })
    $cleanedStart = Invoke-Helper @{ op = 'start'; id = 'cleaned-secret-job'; paths = @($archive); secretId = 'cleaned-before-start' }
    if ($cleanedStart.errorCode -ne 'secret-not-found' -or (Test-Path -LiteralPath $cleanedStartSecret)) { throw 'start did not report a previously collected secret as unavailable for password re-entry.' }
    if (Test-Path -LiteralPath (Join-Path $stateRoot 'jobs/cleaned-secret-job.json')) { throw 'Missing-secret rejection persisted a job state.' }

    New-Item -ItemType Directory -Path (Join-Path $stateRoot 'jobs') -Force | Out-Null
    for ($i = 0; $i -lt 4; $i++) {
        $busyState = @{
            id = "capacity-fixture-$i"; paths = @($archive); sourceFingerprints = @();
            secretId = 'integration-secret'; status = 'queued'; workerPid = $PID
        } | ConvertTo-Json -Compress -Depth 5
        [IO.File]::WriteAllText((Join-Path $stateRoot "jobs/capacity-fixture-$i.json"), $busyState, [Text.UTF8Encoding]::new($false))
    }
    $capacity = Invoke-Helper @{ op = 'start'; id = 'capacity-rejected'; paths = @($archive); secretId = 'integration-secret' }
    if ($capacity.ok -or $capacity.errorCode -ne 'worker-capacity') { throw "Worker cap was not enforced: $($capacity.errorCode)" }
    if (Test-Path -LiteralPath (Join-Path $stateRoot 'jobs/capacity-rejected.json')) { throw 'Capacity rejection persisted an orphan queued job.' }
    Get-ChildItem -LiteralPath (Join-Path $stateRoot 'jobs') -Filter 'capacity-fixture-*.json' -File | Remove-Item -Force

    $started = Invoke-Helper @{ op = 'start'; id = 'encrypted-single'; paths = @($archive); secretId = 'integration-secret' }
    if (-not $started.ok) { throw "start failed: $($started.errorCode)" }
    $done = Wait-Job 'encrypted-single'
    if ($done.status -ne 'complete') { throw "encrypted archive failed: $($done.errorCode)" }
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw 'Original archive was removed.' }
    $extracted = Join-Path $done.outputDir 'fixture.txt'
    if (-not (Test-Path -LiteralPath $extracted -PathType Leaf)) { throw 'Extracted fixture was not found.' }
    if ([IO.File]::ReadAllText($extracted) -ne [IO.File]::ReadAllText($plain)) { throw 'Extracted contents did not match.' }
    $jobJson = Get-Content -LiteralPath (Join-Path $stateRoot 'jobs/encrypted-single.json') -Raw
    if ($jobJson.Contains($password)) { throw 'Job state unexpectedly contains the plaintext password.' }
    $sameJob = Invoke-Helper @{ op = 'start'; id = 'encrypted-single'; paths = @($archive); secretId = 'integration-secret' }
    if ($sameJob.status -ne 'complete' -or $sameJob.outputDir -ne $done.outputDir) { throw 'Retrying the same job id did not return its existing result.' }
    [void](Invoke-Helper @{ op = 'forget-secret'; id = 'integration-secret' })
    $replayWithoutSecret = Invoke-Helper @{ op = 'start'; id = 'encrypted-single'; paths = @($archive); secretId = 'integration-secret' }
    if ($replayWithoutSecret.status -ne 'complete' -or $replayWithoutSecret.outputDir -ne $done.outputDir) { throw 'A completed job did not replay after its secret was forgotten.' }
    $replayConflictWithoutSecret = Invoke-Helper @{ op = 'start'; id = 'encrypted-single'; paths = @($plain); secretId = 'integration-secret' }
    if ($replayConflictWithoutSecret.errorCode -ne 'job-conflict') { throw 'A completed job accepted conflicting paths after its secret was forgotten.' }
    $restoreSecret = Invoke-Helper @{ op = 'store-secret'; id = 'integration-secret'; password = $password }
    if (-not $restoreSecret.ok) { throw 'Could not restore the integration secret after replay checks.' }
    $secondJob = Invoke-Helper @{ op = 'start'; id = 'encrypted-single-again'; paths = @($archive); secretId = 'integration-secret' }
    if (-not $secondJob.ok) { throw "Second extraction start failed: $($secondJob.errorCode)" }
    $secondDone = Wait-Job 'encrypted-single-again'
    if ($secondDone.status -ne 'complete' -or $secondDone.outputDir -eq $done.outputDir) { throw 'A second extraction overwrote or reused the first output directory.' }
    if ([IO.File]::ReadAllText($extracted) -ne [IO.File]::ReadAllText($plain)) { throw 'The first extraction changed after a second job.' }

    $wrongSecret = Invoke-Helper @{ op = 'store-secret'; id = 'wrong-password-secret'; password = 'not-the-archive-password' }
    if (-not $wrongSecret.ok) { throw 'Could not store the isolated wrong-password fixture secret.' }
    $failedStart = Invoke-Helper @{ op = 'start'; id = 'failed-replay'; paths = @($archive); secretId = 'wrong-password-secret' }
    if (-not $failedStart.ok) { throw "Failed-job fixture could not start: $($failedStart.errorCode)" }
    $failedDone = Wait-Job 'failed-replay'
    if ($failedDone.status -ne 'failed') { throw 'Wrong-password fixture unexpectedly extracted successfully.' }
    [void](Invoke-Helper @{ op = 'forget-secret'; id = 'wrong-password-secret' })
    $failedReplay = Invoke-Helper @{ op = 'start'; id = 'failed-replay'; paths = @($archive); secretId = 'wrong-password-secret' }
    if ($failedReplay.status -ne 'failed' -or $failedReplay.errorCode -ne $failedDone.errorCode) { throw 'A failed job did not replay its recorded error after its secret was forgotten.' }
    $failedConflict = Invoke-Helper @{ op = 'start'; id = 'failed-replay'; paths = @($archive); secretId = 'integration-secret' }
    if ($failedConflict.errorCode -ne 'job-conflict') { throw 'A failed job accepted a conflicting secret id after its original secret was forgotten.' }

    $volumeSource = Join-Path $downloadRoot 'volume-source.bin'
    $random = [byte[]]::new(400000)
    [Security.Cryptography.RandomNumberGenerator]::Fill($random)
    [IO.File]::WriteAllBytes($volumeSource, $random)
    $volumeBase = Join-Path $downloadRoot 'split.7z'
    Invoke-7Zip @('a','-y','-v96k',$volumeBase,$volumeSource)
    $volumes = @(Get-ChildItem -LiteralPath $downloadRoot -Filter 'split.7z.*' -File | Sort-Object Name | ForEach-Object FullName)
    if ($volumes.Count -lt 2 -or -not $volumes[0].EndsWith('.001')) { throw '7-Zip did not produce the expected numbered split fixture.' }
    $incomplete = Invoke-Helper @{ op = 'start'; id = 'split-incomplete'; paths = @($volumes[0]); secretId = 'integration-secret' }
    if (-not $incomplete.ok) { throw "incomplete-volume start was rejected too early: $($incomplete.errorCode)" }
    $incompleteDone = Wait-Job 'split-incomplete'
    if ($incompleteDone.status -ne 'failed' -or $incompleteDone.errorCode -notin @('archive-preflight-failed','archive-test-failed')) { throw "Incomplete volume set was not rejected by preflight: $($incompleteDone.status) $($incompleteDone.errorCode)" }
    $split = Invoke-Helper @{ op = 'start'; id = 'split-complete'; paths = $volumes; secretId = 'integration-secret' }
    if (-not $split.ok) { throw "complete split start failed: $($split.errorCode)" }
    $splitDone = Wait-Job 'split-complete'
    if ($splitDone.status -ne 'complete') { throw "complete split archive failed: $($splitDone.errorCode)" }
    $conflict = Invoke-Helper @{ op = 'start'; id = 'encrypted-single'; paths = $volumes; secretId = 'integration-secret' }
    if ($conflict.ok -or $conflict.errorCode -ne 'job-conflict') { throw 'A job id accepted different source paths.' }
    foreach ($volume in $volumes) { if (-not (Test-Path -LiteralPath $volume -PathType Leaf)) { throw 'An original split archive volume was removed.' } }

    $zipBase = Join-Path $downloadRoot 'zip-split.zip'
    Invoke-7Zip @('a','-tzip','-y','-v96k',$zipBase,$volumeSource)
    $zipVolumes = @(Get-ChildItem -LiteralPath $downloadRoot -Filter 'zip-split.zip.*' -File | Sort-Object Name | ForEach-Object FullName)
    if ($zipVolumes.Count -lt 2 -or -not $zipVolumes[0].EndsWith('.001')) { throw '7-Zip did not produce numbered split ZIP volumes.' }
    $zipStart = Invoke-Helper @{ op = 'start'; id = 'split-zip'; paths = $zipVolumes; secretId = 'integration-secret' }
    if (-not $zipStart.ok) { throw "split ZIP start failed: $($zipStart.errorCode)" }
    $zipDone = Wait-Job 'split-zip'
    if ($zipDone.status -ne 'complete') { throw "split ZIP extraction failed: $($zipDone.errorCode)" }
    if (-not (Test-Path -LiteralPath (Join-Path $zipDone.outputDir 'volume-source.bin') -PathType Leaf)) { throw 'Split ZIP output file was missing.' }
    foreach ($volume in $zipVolumes) { if (-not (Test-Path -LiteralPath $volume -PathType Leaf)) { throw 'An original split ZIP volume was removed.' } }

    if ($RarExePath) {
        $rarPayload = [byte[]]::new(3 * 1024 * 1024)
        [Security.Cryptography.RandomNumberGenerator]::Fill($rarPayload)
        $rarSource = Join-Path $downloadRoot 'rar-source.bin'
        [IO.File]::WriteAllBytes($rarSource, $rarPayload)
        $rarSourceHash = (Get-FileHash -LiteralPath $rarSource -Algorithm SHA256).Hash
        $singleRar = Join-Path $downloadRoot 'encrypted-single.rar'
        Invoke-Rar @('a','-y','-cfg-','-ep',"-hp$password",'-m0',$singleRar,$rarSource)
        $singleRarHash = (Get-FileHash -LiteralPath $singleRar -Algorithm SHA256).Hash
        $singleRarStart = Invoke-Helper @{ op = 'start'; id = 'rar-encrypted-single'; paths = @($singleRar); secretId = 'integration-secret' }
        if (-not $singleRarStart.ok) { throw "Encrypted RAR start failed: $($singleRarStart.errorCode)" }
        $singleRarDone = Wait-Job 'rar-encrypted-single'
        if ($singleRarDone.status -ne 'complete') { throw "Encrypted RAR extraction failed: $($singleRarDone.errorCode)" }
        $singleRarOutput = Join-Path $singleRarDone.outputDir 'rar-source.bin'
        if (-not (Test-Path -LiteralPath $singleRarOutput -PathType Leaf)) { throw 'Encrypted RAR output file was missing.' }
        if ((Get-FileHash -LiteralPath $singleRarOutput -Algorithm SHA256).Hash -ne $rarSourceHash) { throw 'Encrypted RAR output did not match its input.' }
        if ((Get-FileHash -LiteralPath $singleRar -Algorithm SHA256).Hash -ne $singleRarHash) { throw 'The original encrypted RAR changed during extraction.' }

        $wrongRarSecret = Invoke-Helper @{ op = 'store-secret'; id = 'rar-wrong-password'; password = 'not-the-rar-password' }
        if (-not $wrongRarSecret.ok) { throw 'Could not store isolated wrong-password RAR fixture secret.' }
        $wrongRarStart = Invoke-Helper @{ op = 'start'; id = 'rar-wrong-password'; paths = @($singleRar); secretId = 'rar-wrong-password' }
        if (-not $wrongRarStart.ok) { throw "Wrong-password RAR job did not start: $($wrongRarStart.errorCode)" }
        $wrongRarDone = Wait-Job 'rar-wrong-password'
        if ($wrongRarDone.status -ne 'failed' -or -not $wrongRarDone.errorCode) { throw 'Wrong-password RAR did not visibly fail.' }
        [void](Invoke-Helper @{ op = 'forget-secret'; id = 'rar-wrong-password' })

        $splitRar = Join-Path $downloadRoot 'split-rar.rar'
        Invoke-Rar @('a','-y','-cfg-','-ep',"-hp$password",'-m0','-v1m',$splitRar,$rarSource)
        $rarVolumes = @(Get-ChildItem -LiteralPath $downloadRoot -Filter 'split-rar.part*.rar' -File | Sort-Object Name | ForEach-Object FullName)
        if ($rarVolumes.Count -lt 2 -or -not [IO.Path]::GetFileName($rarVolumes[0]).EndsWith('.part1.rar')) { throw "WinRAR did not create the expected numbered RAR volumes; found $($rarVolumes.Count)." }
        $rarVolumeHashes = @{}
        foreach ($volume in $rarVolumes) { $rarVolumeHashes[$volume] = (Get-FileHash -LiteralPath $volume -Algorithm SHA256).Hash }
        $splitRarStart = Invoke-Helper @{ op = 'start'; id = 'rar-encrypted-split'; paths = $rarVolumes; secretId = 'integration-secret' }
        if (-not $splitRarStart.ok) { throw "Encrypted split RAR start failed: $($splitRarStart.errorCode)" }
        $splitRarDone = Wait-Job 'rar-encrypted-split'
        if ($splitRarDone.status -ne 'complete') { throw "Encrypted split RAR extraction failed: $($splitRarDone.errorCode)" }
        $splitRarOutput = Join-Path $splitRarDone.outputDir 'rar-source.bin'
        if (-not (Test-Path -LiteralPath $splitRarOutput -PathType Leaf)) { throw 'Encrypted split RAR output file was missing.' }
        if ((Get-FileHash -LiteralPath $splitRarOutput -Algorithm SHA256).Hash -ne $rarSourceHash) { throw 'Encrypted split RAR output did not match its input.' }
        foreach ($volume in $rarVolumes) {
            if (-not (Test-Path -LiteralPath $volume -PathType Leaf) -or (Get-FileHash -LiteralPath $volume -Algorithm SHA256).Hash -ne $rarVolumeHashes[$volume]) { throw 'An original encrypted RAR volume was changed or removed.' }
        }
        Write-Output "RAR single-file, wrong-password, and $($rarVolumes.Count)-volume extraction passed using bundled 7-Zip. WinRAR was used only to create fixtures."
    } else {
        Write-Output 'RAR fixture checks skipped: pass -RarExePath to use a local RAR CLI for fixture creation.'
    }

    foreach ($orphanId in @('orphan-queued-null','orphan-queued-dead')) {
        $pidValue = if ($orphanId -eq 'orphan-queued-dead') { 4294967295 } else { $null }
        $state = @{ id = $orphanId; paths = @('C:\isolated\fixture.zip'); sourceFingerprints = @(); secretId = 'integration-secret'; status = 'queued'; workerPid = $pidValue } | ConvertTo-Json -Compress -Depth 5
        [IO.File]::WriteAllText((Join-Path $stateRoot "jobs/$orphanId.json"), $state, [Text.UTF8Encoding]::new($false))
        $orphan = Invoke-Helper @{ op = 'status'; id = $orphanId }
        if ($orphan.status -ne 'failed' -or $orphan.errorCode -ne 'worker-lost') { throw "Stale queued state was not reconciled safely: $orphanId" }
    }
    [IO.File]::WriteAllText((Join-Path $stateRoot 'jobs/damaged.json'), '{not-json', [Text.UTF8Encoding]::new($false))
    $damaged = Invoke-Helper @{ op = 'status'; id = 'damaged' }
    if ($damaged.ok -or $damaged.errorCode -ne 'job-state-invalid') { throw 'Corrupt job state was misreported as missing.' }

    Write-Output "Encrypted archive and explicit split-volume isolation passed. Evidence fixture: $caseRoot"
} finally {
    if ($null -eq $oldHome) { Remove-Item Env:QUEUECAT_HELPER_HOME -ErrorAction SilentlyContinue } else { $env:QUEUECAT_HELPER_HOME = $oldHome }
}
