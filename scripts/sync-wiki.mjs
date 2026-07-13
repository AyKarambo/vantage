// Mirrors a defined set of "key pages" from docs/ into a local clone of the
// GitHub wiki repo (AyKarambo/vantage.wiki), so the wiki can be refreshed
// without hand-copying files. In-repo docs/ stays the canonical source —
// this script only ever WRITES INTO the local wiki clone you point it at; it
// never touches docs/, never runs git, and never pushes anywhere. Actually
// publishing the mirrored files (git add/commit/push in that clone) is a
// manual maintainer step — see docs/wiki-sync.md.
//
// Usage:
//   node scripts/sync-wiki.mjs <path-to-local-wiki-clone> [--dry-run]
//
// Example:
//   git clone https://github.com/AyKarambo/vantage.wiki.git ../vantage.wiki
//   node scripts/sync-wiki.mjs ../vantage.wiki
//   cd ../vantage.wiki && git add -A && git commit -m "sync from docs/" && git push
//
// Deliberately excludes the marketing/store-screenshot docs (overwolf-review,
// overwolf-submission) — those are maintainer-only submission material, not
// wiki content. See docs/wiki-sync.md for the key-page set and rationale.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

/**
 * The key-page set: `src` is relative to `docs/`, `dest` is the wiki page
 * filename (GitHub wiki convention: `Page-Title.md`, spaces become dashes).
 * Keep this list and docs/wiki-sync.md's table in sync when either changes.
 */
const KEY_PAGES = [
  { src: 'onboarding/README.md', dest: 'Home.md' },
  { src: 'onboarding/01-getting-started.md', dest: 'Getting-Started.md' },
  { src: 'onboarding/02-architecture.md', dest: 'Architecture.md' },
  { src: 'onboarding/03-codebase-tour.md', dest: 'Codebase-Tour.md' },
  { src: 'onboarding/04-common-tasks.md', dest: 'Common-Tasks.md' },
  { src: 'import.md', dest: 'Importing-Match-History.md' },
  { src: 'signing.md', dest: 'Release-Signing.md' },
];

const GENERATED_NOTE = (src) =>
  `<!-- Auto-mirrored from [\`docs/${src}\`](https://github.com/AyKarambo/vantage/blob/main/docs/${src}) ` +
  `by \`scripts/sync-wiki.mjs\`. Edit the source file in the main repo, not this page directly. -->\n\n`;

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const target = args.find((a) => !a.startsWith('--'));

  if (!target) {
    console.error('Usage: node scripts/sync-wiki.mjs <path-to-local-wiki-clone> [--dry-run]');
    console.error('See docs/wiki-sync.md for the key-page set and the full sync/publish process.');
    process.exit(1);
  }

  const targetDir = path.resolve(target);
  if (!fs.existsSync(targetDir)) {
    console.error(`✖ Target folder does not exist: ${targetDir}`);
    console.error('  Clone the wiki first, e.g.:');
    console.error('  git clone https://github.com/AyKarambo/vantage.wiki.git ' + target);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(targetDir, '.git'))) {
    console.warn(`⚠ ${targetDir} doesn't look like a git clone (no .git/) — continuing anyway,`);
    console.warn('  but you won\'t be able to commit/push the mirrored pages from there.');
  }

  let written = 0;
  for (const { src, dest } of KEY_PAGES) {
    const srcPath = path.join(DOCS_DIR, src);
    if (!fs.existsSync(srcPath)) {
      console.warn(`⚠ skipped ${src} — not found under docs/`);
      continue;
    }
    const body = fs.readFileSync(srcPath, 'utf8');
    const outPath = path.join(targetDir, dest);
    const outBody = GENERATED_NOTE(src) + body;

    if (dryRun) {
      console.log(`[dry-run] would write ${dest} (${outBody.length} bytes) from docs/${src}`);
    } else {
      fs.writeFileSync(outPath, outBody, 'utf8');
      console.log(`wrote ${dest} from docs/${src}`);
    }
    written++;
  }

  const verb = dryRun ? 'would be synced' : 'synced';
  console.log(`\n${dryRun ? '[dry-run] ' : ''}${written}/${KEY_PAGES.length} key pages ${verb} to ${targetDir}`);
  if (!dryRun) {
    console.log('Nothing was committed or pushed — review the diff in the wiki clone, then');
    console.log('`git add -A && git commit && git push` from there yourself.');
  }
}

main();
