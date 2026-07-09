# Local, signed release for Vantage (npm run publish:release).
#
# WHY LOCAL: the Certum "Open Source Developer" cert signs via SimplySign - the private
# key lives in Certum's cloud and is only usable while SimplySign Desktop is logged in
# (mobile-app OTP, ~2h session). GitHub's cloud runners can't complete that OTP, so a
# fully-signed release can only be produced here. No signing secrets exist in CI or git.
# Full rationale + prerequisites: docs/signing.md.
#
# WHAT IT DOES (fail-closed - nothing is tagged/published unless the build verifies signed):
#   1. resolve gh; move to repo root
#   2. preflight: clean tree (unless -AllowDirty), HEAD pushed to <remote>
#   3. readiness: the Certum signing cert is present in Cert:\CurrentUser\My
#      (i.e. SimplySign is unlocked) - abort BEFORE building if not
#   4. compute the next version from tags + Conventional Commits (scripts/next-version.mjs)
#   5. idempotency: abort if the tag/Release already exists
#   6. build + sign (VANTAGE_REQUIRE_SIGNING=1 makes the sign hook throw if unsigned)
#   7. verify Authenticode (Valid, Certum issuer, "Open Source Developer" subject, timestamped)
#   8. create the tag at HEAD and publish the GitHub Release with the signed installer
#
# Usage:
#   npm run publish:release                 # build, sign, verify, tag, publish
#   npm run publish:release -- -DryRun      # build+sign+verify, then stop (no tag/Release)
#   npm run publish:release -- -AllowDirty  # allow an unclean working tree
param(
    [switch]$DryRun,
    [switch]$AllowDirty,
    [string]$Remote = 'origin'
)

$ErrorActionPreference = 'Stop'

function Assert-Signed([string]$File) {
    if (-not (Test-Path -LiteralPath $File)) { throw "expected signed file is missing: $File" }
    $sig = Get-AuthenticodeSignature -LiteralPath $File
    if ($sig.Status -ne 'Valid') {
        throw "signature not Valid for $File - $($sig.Status): $($sig.StatusMessage)"
    }
    $subject = $sig.SignerCertificate.Subject
    if ($sig.SignerCertificate.Issuer -notmatch 'Certum') {
        throw "unexpected issuer for $File - $($sig.SignerCertificate.Issuer)"
    }
    if ($subject -notmatch 'Open Source Developer') { throw "unexpected signer for $File - $subject" }
    if (-not $sig.TimeStamperCertificate) { throw "no RFC-3161 timestamp on $File" }
    Write-Host "  verified: $([System.IO.Path]::GetFileName($File)) - $subject"
}

# 1. gh + repo root -----------------------------------------------------------
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = 'C:\Program Files\GitHub CLI\gh.exe' }
if (-not (Test-Path -LiteralPath $gh)) {
    throw "GitHub CLI (gh) not found. Install it or add it to PATH."
}
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# 2. preflight ----------------------------------------------------------------
if (-not $AllowDirty -and (git status --porcelain)) {
    throw "working tree is not clean - commit/stash first, or pass -AllowDirty."
}
git fetch --tags $Remote | Out-Null
$head = (git rev-parse HEAD).Trim()
git merge-base --is-ancestor HEAD "$Remote/main"
if ($LASTEXITCODE -ne 0) {
    throw "HEAD ($head) is not pushed to $Remote/main - push it first (GitHub needs the commit to tag it)."
}

# 3. readiness: Certum cert present (SimplySign unlocked) ----------------------
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object {
        $_.Issuer -match 'Certum' -and $_.Subject -match 'Open Source Developer' -and $_.NotAfter -gt (Get-Date)
    } | Select-Object -First 1
if (-not $cert) {
    throw "No usable Certum signing cert in Cert:\CurrentUser\My. Open SimplySign Desktop and log in (mobile OTP), then retry. See docs/signing.md."
}
Write-Host "Signing cert: $($cert.Subject)  [thumbprint $($cert.Thumbprint), expires $($cert.NotAfter.ToString('yyyy-MM-dd'))]"

# 4. compute version ----------------------------------------------------------
$info = (node scripts/next-version.mjs --json | Out-String) | ConvertFrom-Json
$version = $info.version
$tag = $info.tag
Write-Host "Releasing $tag ($($info.level), from $(if ($info.lastTag) { $info.lastTag } else { '<no tag>' }))"

# 5. idempotency --------------------------------------------------------------
if (git tag -l $tag) { throw "tag $tag already exists locally." }
if (git ls-remote --tags $Remote "refs/tags/$tag") { throw "tag $tag already exists on $Remote." }
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $gh release view $tag *> $null
$ErrorActionPreference = $prevEAP
if ($LASTEXITCODE -eq 0) { throw "a GitHub Release $tag already exists." }

# 6-8. build, sign, verify, publish (restore package.json no matter what) ------
try {
    npm version $version --no-git-tag-version --allow-same-version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm version failed." }

    $env:VANTAGE_REQUIRE_SIGNING = '1' # sign hook throws instead of leaving files unsigned
    npm run release
    if ($LASTEXITCODE -ne 0) { throw "build/sign failed (see log above)." }

    $installer = "release/Vantage-Setup-$version.exe"
    Assert-Signed $installer
    Assert-Signed "release/win-unpacked/Vantage.exe" # inner exe (uninstaller signing is confirmed in the build log)

    if ($DryRun) {
        Write-Host "`nDry run OK: $version built and verified signed. No tag/Release created." -ForegroundColor Green
        return
    }

    $assets = @((Resolve-Path $installer).Path)
    $blockmap = "$installer.blockmap"
    if (Test-Path -LiteralPath $blockmap) { $assets += (Resolve-Path $blockmap).Path }

    & $gh release create $tag @assets --title "Vantage $version" --generate-notes --target $head
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed." }
    Write-Host "`nPublished $tag with a signed installer." -ForegroundColor Green
}
finally {
    Remove-Item Env:\VANTAGE_REQUIRE_SIGNING -ErrorAction SilentlyContinue
    git checkout -- package.json package-lock.json 2>$null # keep main at its floor version
}
