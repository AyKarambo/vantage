# Signs the Vantage installer with a Certum cert via SimplySign Desktop.
#
# Prerequisites:
#   - SimplySign Desktop is running and connected (enter the OTP from the SimplySign
#     mobile app first — this activates the virtual smart card for ~2 hours).
#   - signtool.exe is on PATH (comes with the Windows SDK / Visual Studio Build Tools).
#
# Usage:
#   npm run release
#   npm run sign:local -- -Thumbprint <your cert thumbprint>
# (or set $env:CERTUM_THUMBPRINT once and just run `npm run sign:local`)

param(
    [string]$Thumbprint = $env:CERTUM_THUMBPRINT,
    [string]$InstallerPath
)

if (-not $Thumbprint) {
    Write-Error "No certificate thumbprint given. Pass -Thumbprint <thumbprint> or set `$env:CERTUM_THUMBPRINT. Find it via 'certutil -store My' while SimplySign Desktop is connected."
    exit 1
}

if (-not $InstallerPath) {
    $installer = Get-ChildItem -Path "release" -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $installer) {
        Write-Error "No installer found in release/. Run 'npm run release' first."
        exit 1
    }
    $InstallerPath = $installer.FullName
}

& signtool sign /sha1 $Thumbprint /fd sha256 /tr http://time.certum.pl /td sha256 "$InstallerPath"
if ($LASTEXITCODE -ne 0) {
    Write-Error "signtool sign failed (exit $LASTEXITCODE)."
    exit $LASTEXITCODE
}

& signtool verify /pa /v "$InstallerPath"
