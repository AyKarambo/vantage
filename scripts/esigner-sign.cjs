// electron-builder custom Windows sign hook — SSL.com eSigner (CodeSignTool).
//
// Wired via package.json `build.win.signtoolOptions.sign`; ow-electron-builder invokes it
// once per signable file during `npm run release` (app exe → uninstaller → installer,
// serialized by the builder's signingQueue). Each successful call consumes ONE eSigner
// signing credit, so the config pins signingHashAlgorithms to ["sha256"] (the default
// sha1+sha256 dual pass would sign every file twice for an identical result).
//
// Behavior without credentials: logs a warning and leaves the file unsigned, so local
// dev builds and CI runs without the ES_* secrets keep working exactly as before.
//
// Required env (see docs/signing.md for where each value comes from):
//   ES_USERNAME          SSL.com account username
//   ES_PASSWORD          SSL.com account password
//   ES_CREDENTIAL_ID     eSigner signing credential id (order page / get_credential_ids)
//   ES_TOTP_SECRET       the QR "secret code" from eSigner enrollment (enables headless OTP)
//   CODE_SIGN_TOOL_PATH  directory of an unzipped CodeSignTool (bundles its own JDK)
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');

const ENV_VARS = ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET'];
const SIGN_TIMEOUT_MS = 5 * 60 * 1000; // eSigner is usually seconds, occasionally stalls
const ATTEMPTS = 2; // one retry for transient OAuth/scan hiccups

/** Prefer the JDK bundled inside the CodeSignTool zip (jdk-<ver>/bin/java.exe), else PATH java. */
function findJava(toolDir) {
  const jdk = readdirSync(toolDir, { withFileTypes: true }).find(
    (e) => e.isDirectory() && e.name.toLowerCase().startsWith('jdk')
  );
  if (jdk) {
    const exe = path.join(toolDir, jdk.name, 'bin', 'java.exe');
    if (existsSync(exe)) return exe;
  }
  return 'java';
}

/** Locate jar/code_sign_tool-<ver>.jar inside the CodeSignTool directory. */
function findJar(toolDir) {
  const jarDir = path.join(toolDir, 'jar');
  if (!existsSync(jarDir)) return null;
  const jar = readdirSync(jarDir).find((f) => /^code_sign_tool.*\.jar$/i.test(f));
  return jar ? path.join(jarDir, jar) : null;
}

/** electron-builder CustomWindowsSign hook: sign configuration.path in place. */
exports.default = async function sign(configuration) {
  const file = configuration.path;
  const base = path.basename(file);

  // Guard against the sha1+sha256 dual pass: signingHashAlgorithms is pinned to
  // ["sha256"] in package.json, but if that pin is ever removed the second (nested)
  // pass would just re-sign the same file and burn another credit — skip it.
  if (configuration.isNest) return;

  // eSigner's pre-signing malware scan false-positives on NSIS's elevate helper and
  // refuses to sign it ("code object is a malware"). Skipping it is the established
  // practice among eSigner users (Alephium, Vortex); an unsigned elevate.exe is fine.
  if (base.toLowerCase() === 'elevate.exe') {
    console.log(`  • esigner-sign: skipping ${base} (eSigner malware-scan false positive)`);
    return;
  }

  const missing = ENV_VARS.filter((k) => !process.env[k]);
  const toolDir = process.env.CODE_SIGN_TOOL_PATH;
  if (missing.length === ENV_VARS.length && !toolDir) {
    console.warn(
      `  • esigner-sign: ${base} left UNSIGNED — eSigner env not configured. ` +
        'Distributed builds must be signed or the Overwolf gaming packages (GEP) will not load; see docs/signing.md.'
    );
    return;
  }
  if (missing.length > 0 || !toolDir) {
    // Partial configuration is a mistake, not a dev build — fail loudly.
    throw new Error(
      `esigner-sign: incomplete eSigner configuration — missing ${[...missing, ...(toolDir ? [] : ['CODE_SIGN_TOOL_PATH'])].join(', ')}`
    );
  }
  const jar = findJar(toolDir);
  if (!jar) {
    throw new Error(`esigner-sign: no code_sign_tool jar under ${toolDir} — is CODE_SIGN_TOOL_PATH an unzipped CodeSignTool?`);
  }

  const args = [
    '-jar',
    jar,
    'sign',
    `-credential_id=${process.env.ES_CREDENTIAL_ID}`,
    `-username=${process.env.ES_USERNAME}`,
    `-password=${process.env.ES_PASSWORD}`,
    `-totp_secret=${process.env.ES_TOTP_SECRET}`,
    `-input_file_path=${path.resolve(file)}`,
    '-override=true', // sign in place; without it CodeSignTool prompts interactively and hangs CI
  ];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = spawnSync(findJava(toolDir), args, {
      cwd: toolDir, // CodeSignTool resolves conf/ and jar/ relative to its own directory
      env: { ...process.env, CODE_SIGN_TOOL_PATH: toolDir },
      encoding: 'utf8',
      timeout: SIGN_TIMEOUT_MS,
      windowsHide: true,
    });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    // CodeSignTool can exit 0 on failure — trust the success marker, not the exit code.
    if (res.status === 0 && out.includes('Code signed successfully')) {
      console.log(`  • esigner-sign: signed ${base}`);
      return;
    }
    // Keep the error short and free of argv (it carries credentials).
    const tail = out.trim().split(/\r?\n/).slice(-5).join('\n');
    if (attempt < ATTEMPTS) {
      console.warn(`  • esigner-sign: attempt ${attempt} failed for ${base}, retrying…\n${tail}`);
      continue;
    }
    throw new Error(`esigner-sign: CodeSignTool failed for ${base} (exit ${res.status}):\n${tail}`);
  }
};
