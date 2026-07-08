# Signs ONE built artifact with the SSL.com IV cert via eSigner CodeSignTool (post-hoc).
#
# NOTE: this is NOT the release path. The primary path is the build itself —
# scripts/esigner-sign.cjs runs inside `npm run release` whenever the ES_* env vars
# are set, and signs the app exe, the uninstaller AND the installer. All of those
# must be signed for the Overwolf gaming packages (GEP) to load in distributed
# builds; signing only the installer after the fact does NOT satisfy that.
# Use this script to re-sign a single stray artifact, nothing more.
#
# Prerequisites (see docs/signing.md):
#   - CodeSignTool unzipped, $env:CODE_SIGN_TOOL_PATH pointing at its directory
#     (download: https://www.ssl.com/download/codesigntool-for-windows/ — the zip
#     has no top-level folder, extract into a dedicated dir)
#   - $env:ES_USERNAME / ES_PASSWORD / ES_CREDENTIAL_ID / ES_TOTP_SECRET set
#
# Usage:
#   npm run sign:local                       # newest .exe in release/
#   npm run sign:local -- -Path <file.exe>

param([string]$Path)

$required = 'ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET', 'CODE_SIGN_TOOL_PATH'
$missing = $required | Where-Object { -not (Get-Item "env:$_" -ErrorAction SilentlyContinue).Value }
if ($missing) {
    Write-Error "Missing env vars: $($missing -join ', '). See docs/signing.md."
    exit 1
}

if (-not $Path) {
    $installer = Get-ChildItem -Path 'release' -Filter '*.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) {
        Write-Error "No .exe found in release/. Run 'npm run release' first (with ES_* env set, that already signs everything)."
        exit 1
    }
    $Path = $installer.FullName
}
$Path = (Resolve-Path $Path).Path

$toolDir = $env:CODE_SIGN_TOOL_PATH
$jar = Get-ChildItem -Path (Join-Path $toolDir 'jar') -Filter 'code_sign_tool*.jar' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jar) {
    Write-Error "No code_sign_tool jar under $toolDir — is CODE_SIGN_TOOL_PATH an unzipped CodeSignTool?"
    exit 1
}
# Prefer the JDK bundled in the CodeSignTool zip; fall back to PATH java.
$java = Get-ChildItem -Path $toolDir -Directory -Filter 'jdk*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'bin\java.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $java) { $java = 'java' }

Write-Host "Signing $Path via eSigner..."
Push-Location $toolDir  # CodeSignTool resolves conf/ and jar/ relative to its own directory
try {
    $output = & $java -jar $jar.FullName sign `
        "-credential_id=$env:ES_CREDENTIAL_ID" `
        "-username=$env:ES_USERNAME" `
        "-password=$env:ES_PASSWORD" `
        "-totp_secret=$env:ES_TOTP_SECRET" `
        "-input_file_path=$Path" `
        "-override=true" | Out-String
} finally {
    Pop-Location
}

# CodeSignTool can exit 0 on failure — trust the success marker, not the exit code.
if ($output -notmatch 'Code signed successfully') {
    Write-Error "CodeSignTool did not report success:`n$($output.Trim())"
    exit 1
}

$sig = Get-AuthenticodeSignature $Path
if ($sig.Status -ne 'Valid') {
    Write-Error "Signature verification failed: $($sig.Status) — $($sig.StatusMessage)"
    exit 1
}
Write-Host "Signed: $Path"
Write-Host "  by:   $($sig.SignerCertificate.Subject)"
