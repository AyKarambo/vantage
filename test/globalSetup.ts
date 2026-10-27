import { generateChangelogModule } from '../scripts/build-changelog.mjs';

/** Writes renderer/src/generated/changelog.ts (git-ignored) before any test imports the renderer. */
export default function setup(): void {
  generateChangelogModule();
}
