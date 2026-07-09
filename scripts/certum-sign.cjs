// electron-builder custom Windows sign hook — Certum "Open Source Developer" cert
// via SimplySign (cloud HSM exposed as a Windows virtual smart card).
//
// Wired via package.json `build.win.signtoolOptions.sign`; ow-electron-builder invokes
// it once per signable file during `npm run release` (app exe → elevate.exe →
// uninstaller → installer). Signing is LOCAL: it only works on a machine where you're
// logged into SimplySign Desktop (mobile-app OTP), which mounts the Certum signing cert
// into `Cert:\CurrentUser\My`. There is no headless/CI path — see docs/signing.md.
//
// How it signs: `certificateSha1` + `rfc3161TimeStampServer` in signtoolOptions make
// electron-builder resolve the cert from the store and hand us a fully-formed signtool
// command via `configuration.computeSignToolArgs(true)` (e.g.
//   sign /tr http://time.certum.pl /sha1 <thumb> /s My /fd sha256 /td sha256 /d Vantage /du <site> /debug <file>
// ). We just run it against signtool.exe. No secrets, no PFX, no env credentials — the
// private key stays in Certum's cloud and the OTP stays on your phone.
//
// Behaviour when the cert is absent (SimplySign not logged in): the file is left
// UNSIGNED with a warning, so dev builds and CI still produce an installer — UNLESS
// VANTAGE_REQUIRE_SIGNING=1 (set by scripts/publish-release.ps1), in which case we throw
// so a release can never publish silently unsigned.
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');

const SIGN_TIMEOUT_MS = 5 * 60 * 1000; // bound a PIN-dialog hang -> fail, don't block forever
const ATTEMPTS = 2; // one retry for a transient smart-card hiccup

/**
 * Locate a usable signtool.exe. Prefer an explicit SIGNTOOL_PATH (Windows SDK override),
 * then electron-builder's bundled winCodeSign copy (no SDK install needed), then PATH.
 */
function findSigntool() {
  if (process.env.SIGNTOOL_PATH) return path.resolve(process.env.SIGNTOOL_PATH);
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (existsSync(cache)) {
    // Prefer the named `winCodeSign-<ver>` dir over the hashed download dirs.
    const dirs = readdirSync(cache)
      .filter((d) => !d.endsWith('.7z'))
      .sort((a, b) => Number(b.startsWith('winCodeSign-')) - Number(a.startsWith('winCodeSign-')));
    for (const d of dirs) {
      const exe = path.join(cache, d, 'windows-10', 'x64', 'signtool.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return 'signtool';
}

/** electron-builder CustomWindowsSign hook: sign configuration.path in place. */
exports.default = async function sign(configuration) {
  const base = path.basename(configuration.path);

  // signingHashAlgorithms is pinned to ["sha256"], so the loop runs once and isNest is
  // never true; guard anyway so a config change can't trigger a wasteful second pass.
  if (configuration.isNest) return;

  const strict = process.env.VANTAGE_REQUIRE_SIGNING === '1';

  // cscInfo is populated only when the Certum cert was found in the store (i.e. you're
  // logged into SimplySign Desktop). When it's null, computeSignToolArgs() can't build a
  // command — leave the file unsigned (dev/CI) or fail loudly (release path).
  if (!configuration.cscInfo) {
    const msg =
      `certum-sign: ${base} — Certum signing cert not found in Cert:\\CurrentUser\\My. ` +
      'Log into SimplySign Desktop (mobile OTP) first; see docs/signing.md.';
    if (strict) throw new Error(msg);
    console.warn(`  • ${msg} Leaving UNSIGNED.`);
    return;
  }

  const args = configuration.computeSignToolArgs(true); // full signtool argv from config
  const tool = findSigntool();

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = spawnSync(tool, args, {
      encoding: 'utf8',
      timeout: SIGN_TIMEOUT_MS,
      windowsHide: true,
    });
    if (res.status === 0) {
      console.log(`  • certum-sign: signed ${base}`);
      return;
    }
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
    const tail = [res.error?.message, ...out.split(/\r?\n/)].filter(Boolean).slice(-6).join('\n');
    if (attempt < ATTEMPTS) {
      console.warn(`  • certum-sign: attempt ${attempt} failed for ${base}, retrying…\n${tail}`);
      continue;
    }
    throw new Error(`certum-sign: signtool failed for ${base} (exit ${res.status}):\n${tail}`);
  }
};
