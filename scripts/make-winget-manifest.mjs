// Generate the winget-pkgs manifest set (3 YAML files) for a Vantage release.
//
// Vantage is distributed via `winget install AyKarambo.Vantage` alongside the direct .exe.
// A winget package is three YAML files — version / defaultLocale / installer — under
// manifests/<letter>/<Publisher>/<Package>/<version>/. This script emits them from
// package.json + the published GitHub Release asset, so cutting a new winget version is one
// command instead of hand-editing YAML.
//
//   node scripts/make-winget-manifest.mjs                     # latest v* release tag; resolves
//                                                             # the release asset via `gh`
//   node scripts/make-winget-manifest.mjs --version 0.30.0    # a specific version
//   node scripts/make-winget-manifest.mjs --url <url> --sha256 <HEX>   # offline / explicit
//   node scripts/make-winget-manifest.mjs --out <dir>         # override output directory
//
// The installer is an electron-builder NSIS build → winget `InstallerType: nullsoft`, for which
// winget auto-applies the `/S` silent switch (no explicit InstallerSwitches needed). Output lands
// under packaging/winget/manifests/… — validate with `winget validate` and submit per
// docs/winget.md. This script only GENERATES; opening the microsoft/winget-pkgs PR is a
// deliberate manual step (see docs/winget.md).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_VERSION = '1.12.0';
const PACKAGE_IDENTIFIER = 'AyKarambo.Vantage';
const DEFAULT_REPO = 'AyKarambo/vantage';
const PACKAGE_LOCALE = 'en-US';
// Packaging metadata that isn't in package.json (winget wants a rich, discoverable listing).
const TAGS = ['overwatch', 'overwolf', 'gaming', 'stats', 'coaching', 'esports', 'analytics'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// --- args ---------------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
// A flag written without a value (e.g. `--version` with nothing after it) parses to `true`.
// That's a mistake for flags that take a value, so fail loudly instead of silently falling back.
const VALUE_FLAGS = ['version', 'repo', 'tag', 'out', 'url', 'sha256', 'release-date'];
for (const f of VALUE_FLAGS) {
  if (args[f] === true) {
    console.error(`make-winget-manifest: --${f} needs a value`);
    process.exit(1);
  }
}
/** A flag's string value, or `fallback` when the flag was omitted. */
const str = (v, fallback) => (v === undefined ? fallback : v);

function git(gitArgs) {
  return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();
}
// Releases are tag-driven; package.json stays at its floor version (publish-release.ps1 bumps it
// only transiently), so the default version is the latest v* release tag, not pkg.version.
function latestReleaseVersion() {
  try {
    return git(['describe', '--tags', '--match', 'v*', '--abbrev=0']).replace(/^v/, '');
  } catch {
    return pkg.version; // no v* tag yet
  }
}

const version = str(args.version, latestReleaseVersion());
const repo = str(args.repo, DEFAULT_REPO); // owner/name
const tag = str(args.tag, `v${version}`);
const productName = pkg.build?.productName ?? pkg.name; // "Vantage" → asset "Vantage-Setup-<v>.exe"
const [publisherFolder, packageFolder] = PACKAGE_IDENTIFIER.split('.');
const letter = publisherFolder[0].toLowerCase();
const outDir = str(
  args.out,
  join(root, 'packaging', 'winget', 'manifests', letter, publisherFolder, packageFolder, version)
);

function gh(ghArgs) {
  return execFileSync('gh', ghArgs, { cwd: root, encoding: 'utf8' }).trim();
}

// --- resolve the installer asset (url + sha256 + release date) ----------------------------
function downloadAndHash() {
  const dir = mkdtempSync(join(tmpdir(), 'vantage-winget-'));
  try {
    console.error('  release asset has no digest — downloading it to compute SHA-256…');
    gh(['release', 'download', tag, '--repo', repo, '--pattern', `${productName}-Setup-${version}.exe`, '--dir', dir, '--clobber']);
    const file = join(dir, `${productName}-Setup-${version}.exe`);
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function resolveInstaller() {
  // Explicit override: fully offline, trust the caller's URL + hash.
  if (str(args.url, null) && str(args.sha256, null)) {
    return { url: args.url, sha256: String(args.sha256).toUpperCase(), releaseDate: str(args['release-date'], null) };
  }
  let release;
  try {
    release = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'assets,publishedAt']));
  } catch {
    console.error(`make-winget-manifest: could not read release ${tag} from ${repo} via gh.`);
    console.error('  Ensure `gh` is authenticated and the release exists, or pass --url <installer-url> --sha256 <HEX>.');
    process.exit(1);
  }
  const assetName = `${productName}-Setup-${version}.exe`;
  const asset = (release.assets || []).find((a) => a.name === assetName);
  if (!asset) {
    const names = (release.assets || []).map((a) => a.name).join(', ') || '(none)';
    console.error(`make-winget-manifest: asset "${assetName}" not found on release ${tag}. Present: ${names}`);
    process.exit(1);
  }
  const url = str(args.url, asset.url);
  let sha256 = str(args.sha256, (asset.digest || '').replace(/^sha256:/, ''));
  if (!sha256) sha256 = downloadAndHash(); // GitHub digest absent → verify the bytes ourselves
  const releaseDate = str(args['release-date'], release.publishedAt ? release.publishedAt.slice(0, 10) : null);
  return { url, sha256: sha256.toUpperCase(), releaseDate };
}

// --- YAML emit (dependency-free; matches winget's schema) ---------------------------------
const schema = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${MANIFEST_VERSION}.schema.json`;
const header = '# Generated by scripts/make-winget-manifest.mjs — see docs/winget.md';
/** Double-quoted YAML scalar, safe for free text (colons, unicode, quotes). */
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function versionManifest() {
  return [
    header,
    schema('version'),
    '',
    `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
    `PackageVersion: ${version}`,
    `DefaultLocale: ${PACKAGE_LOCALE}`,
    'ManifestType: version',
    `ManifestVersion: ${MANIFEST_VERSION}`,
    '',
  ].join('\n');
}

function localeManifest() {
  return [
    header,
    schema('defaultLocale'),
    '',
    `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
    `PackageVersion: ${version}`,
    `PackageLocale: ${PACKAGE_LOCALE}`,
    `Publisher: ${q(pkg.author)}`,
    `PublisherUrl: https://github.com/${publisherFolder}`,
    `PublisherSupportUrl: https://github.com/${repo}/issues`,
    `Author: ${q(pkg.author)}`,
    `PackageName: ${q(productName)}`,
    `PackageUrl: https://github.com/${repo}`,
    `License: ${q(pkg.license)}`,
    `LicenseUrl: https://github.com/${repo}/blob/main/LICENSE`,
    `Copyright: ${q(`Copyright © ${pkg.author}`)}`,
    `ShortDescription: ${q(pkg.description)}`,
    `Moniker: ${packageFolder.toLowerCase()}`,
    'Tags:',
    ...TAGS.map((t) => `- ${t}`),
    'ManifestType: defaultLocale',
    `ManifestVersion: ${MANIFEST_VERSION}`,
    '',
  ].join('\n');
}

function installerManifest({ url, sha256, releaseDate }) {
  const lines = [
    header,
    schema('installer'),
    '',
    `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
    `PackageVersion: ${version}`,
    'InstallerType: nullsoft', // electron-builder NSIS → winget applies /S automatically
    'InstallModes:',
    '- silent',
    '- silentWithProgress',
    'UpgradeBehavior: install',
  ];
  if (releaseDate) lines.push(`ReleaseDate: ${releaseDate}`);
  lines.push(
    'Installers:',
    '- Architecture: x64',
    '  Scope: user', // perMachine:false → per-user install
    `  InstallerUrl: ${url}`,
    `  InstallerSha256: ${sha256}`,
    'ManifestType: installer',
    `ManifestVersion: ${MANIFEST_VERSION}`,
    ''
  );
  return lines.join('\n');
}

// --- write --------------------------------------------------------------------------------
const installer = resolveInstaller();
mkdirSync(outDir, { recursive: true });
const files = {
  [`${PACKAGE_IDENTIFIER}.yaml`]: versionManifest(),
  [`${PACKAGE_IDENTIFIER}.locale.${PACKAGE_LOCALE}.yaml`]: localeManifest(),
  [`${PACKAGE_IDENTIFIER}.installer.yaml`]: installerManifest(installer),
};
for (const [name, body] of Object.entries(files)) {
  writeFileSync(join(outDir, name), body);
}

console.log(`✓ winget manifest for ${PACKAGE_IDENTIFIER} ${version} → ${outDir}`);
console.log(`  installer: ${installer.url}`);
console.log(`  sha256:    ${installer.sha256}`);
console.log('\nNext: validate, then submit (see docs/winget.md):');
console.log(`  winget validate --manifest "${outDir}"`);
