[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string] $HelperExePath
)

$ErrorActionPreference = 'Stop'
$helper = (Resolve-Path -LiteralPath $HelperExePath).Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$smokeParent = Join-Path $repoRoot 'artifacts/extraction-native'
New-Item -ItemType Directory -Path $smokeParent -Force | Out-Null
$isolatedRoot = Join-Path $smokeParent ("smoke-state-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $isolatedRoot | Out-Null
$oldRoot = $env:QUEUECAT_HELPER_HOME
try {
    $env:QUEUECAT_HELPER_HOME = $isolatedRoot
    $payload = [Text.Encoding]::UTF8.GetBytes('{"op":"ping"}')
    $prefix = [BitConverter]::GetBytes([uint32]$payload.Length)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $helper
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [Diagnostics.Process]::Start($psi)
    $proc.StandardInput.BaseStream.Write($prefix, 0, $prefix.Length)
    $proc.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
    $proc.StandardInput.BaseStream.Write($prefix, 0, $prefix.Length)
    $proc.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
    $proc.StandardInput.BaseStream.Flush()
    $proc.StandardInput.Close()
    $replies = @()
    for ($frameIndex = 0; $frameIndex -lt 2; $frameIndex++) {
        $replyPrefix = [byte[]]::new(4)
        $offset = 0
        while ($offset -lt 4) {
            $count = $proc.StandardOutput.BaseStream.Read($replyPrefix, $offset, 4 - $offset)
            if ($count -le 0) { throw 'Helper did not return a complete native messaging frame header.' }
            $offset += $count
        }
        $replyLength = [BitConverter]::ToUInt32($replyPrefix, 0)
        if ($replyLength -gt 1048576) { throw 'Helper response exceeded the 1 MiB protocol limit.' }
        $replyBytes = [byte[]]::new($replyLength)
        $offset = 0
        while ($offset -lt $replyBytes.Length) {
            $count = $proc.StandardOutput.BaseStream.Read($replyBytes, $offset, $replyBytes.Length - $offset)
            if ($count -le 0) { throw 'Helper response frame was truncated.' }
            $offset += $count
        }
        $replies += ,([Text.Encoding]::UTF8.GetString($replyBytes) | ConvertFrom-Json)
    }
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { throw "Helper exited with code $($proc.ExitCode)." }
    foreach ($reply in $replies) { if (-not $reply.ok -or -not $reply.version -or $null -eq $reply.sevenZipAvailable) { throw 'Ping response does not match the native helper v1 contract.' } }
    Write-Output ("Two framed native messaging pings passed; version {0}, sevenZipAvailable={1}. Isolated state: {2}" -f $replies[0].version, $replies[0].sevenZipAvailable, $isolatedRoot)
} finally {
    if ($null -eq $oldRoot) { Remove-Item Env:QUEUECAT_HELPER_HOME -ErrorAction SilentlyContinue }
    else { $env:QUEUECAT_HELPER_HOME = $oldRoot }
    if (Test-Path -LiteralPath $isolatedRoot) { Remove-Item -LiteralPath $isolatedRoot -Recurse -Force }
}
