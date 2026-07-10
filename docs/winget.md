# winget distribution — Vantage

**Chosen path: publish to the community [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
repo so `winget install AyKarambo.Vantage` works, alongside the direct `.exe` download.**
Submitting is free and requires no extra signing beyond what we already do — the installer is
already Certum-signed and hosted on GitHub Releases (see [docs/signing.md](signing.md)). This
is **distribution only**: no change to how Vantage is built, signed, or run, and no impact on
the GEP-only account-safety promise ([README → Account safety](../README.md#account-safety)).

> **Gate before you submit:** a `winget-pkgs` PR is a public, hard-to-reverse action, and the
> `PackageIdentifier` is **immutable once merged**. Do **not** open the PR until the two
> human gates below (Overwolf ToS + clean-VM silent install) pass.

## Why winget

- One command to install (`winget install AyKarambo.Vantage`) and to update
  (`winget upgrade`), and it works in scripted / unattended machine setups.
- Discoverable to terminal-first users without hunting the Releases page or clicking through
  SmartScreen.
- Free, reversible, and low-effort — a manifest is three small YAML files, generated for us by
  [scripts/make-winget-manifest.mjs](../scripts/make-winget-manifest.mjs).

winget does **not** remove SmartScreen warnings — that's a reputation matter tied to the
signature, covered in [signing.md → SmartScreen expectations](signing.md#smartscreen-expectations-be-honest-with-yourself).
A winget install runs the same signed installer a manual download would.

## The package identity

| winget field        | value                                             | why |
|---------------------|---------------------------------------------------|-----|
| `PackageIdentifier` | `AyKarambo.Vantage`                               | matches the GitHub owner/repo; **immutable** after the first merge |
| `Publisher`         | `Timo Seikel`                                     | human publisher name (`package.json` `author`) |
| signed publisher    | `Open Source Developer Timo Seikel`               | the cert CN — a Certum "Open Source Developer" artifact, not the `Publisher` field |
| `InstallerType`     | `nullsoft`                                        | electron-builder NSIS; winget applies `/S` automatically (no explicit switches) |
| `Scope`             | `user`                                            | `nsis.perMachine: false` → per-user install |
| `Architecture`      | `x64`                                             | the only build target |
| `ManifestVersion`   | `1.12.0`                                          | current winget schema |
| on-disk path        | `manifests/a/AyKarambo/Vantage/<version>/`        | letter `a` = first char of the identifier |

`ProductCode` is intentionally **omitted** from the initial manifest — the NSIS ARP GUID can't
be derived without a test install, and winget correlates by `PackageName`/`Publisher`. Once you
have a sandbox/VM install, add the real `ProductCode` (or let `wingetcreate`/`komac`
auto-detect it) to tighten `winget upgrade`/`winget list` matching.

## Generating the manifest

```bash
npm run make:winget                        # defaults to the latest v* release tag
npm run make:winget -- --version 0.30.0    # or a specific version
```

This reads `package.json` for metadata, resolves the installer URL + SHA-256 from the published
`v<version>` GitHub Release (via `gh release view`; it falls back to downloading and hashing if
the asset digest is missing), and writes the three files under
`packaging/winget/manifests/a/AyKarambo/Vantage/<version>/`:

- `AyKarambo.Vantage.yaml` — version
- `AyKarambo.Vantage.locale.en-US.yaml` — defaultLocale (publisher, license, description, tags)
- `AyKarambo.Vantage.installer.yaml` — installer (URL, SHA-256, nullsoft, x64/user)

Offline / explicit override (no `gh` call):

```bash
npm run make:winget -- --version 0.30.0 \
  --url https://github.com/AyKarambo/vantage/releases/download/v0.30.0/Vantage-Setup-0.30.0.exe \
  --sha256 <HEX>
```

Then validate locally (needs the winget client, Windows):

```powershell
winget validate --manifest "packaging\winget\manifests\a\AyKarambo\Vantage\0.30.0"
# → "Manifest validation succeeded."
```

## Submission runbook

Numbered, fail-closed — each step gates the next.

1. **Confirm Overwolf permits third-party redistribution** *(gate — do this first)*. Verify
   the current Overwolf developer/distribution terms allow redistributing an ow-electron app
   installer via a third-party channel (winget) rather than exclusively through Overwolf's own
   store. If unclear, confirm with your Overwolf DevRel contact. **If it's not permitted, stop
   — the rest is moot.** Record the outcome (issue comment on #123 or a note here).
2. **Verify the silent install on a clean VM** *(gate)*. `winget-pkgs` CI installs the package
   unattended in Windows Sandbox and fails the PR (`Validation-Unattended-Failed`) if it
   prompts. On a clean Windows 10/11 VM:
   ```powershell
   .\Vantage-Setup-0.30.0.exe /S      # must complete with ZERO dialogs, then the app launches
   ```
   electron-builder NSIS honours `/S`, but confirm it on the actual signed asset before
   submitting.
3. **Generate + validate** the manifest for the released version (commands above). Commit the
   staged copy under `packaging/winget/`.
4. **Submit the PR** with a first-party tool and a **classic** GitHub PAT (`public_repo` scope
   — fine-grained PATs currently fail at PR creation upstream). One package + one version per
   PR.
   ```powershell
   winget install Microsoft.WingetCreate      # once
   wingetcreate submit --token <classic-PAT> "packaging\winget\manifests\a\AyKarambo\Vantage\0.30.0"
   ```
   Equivalent from-scratch form: `wingetcreate new <installer-url> --submit --token <PAT>`.
   > Keep the PAT out of shell history: set `$env:WINGET_CREATE_GITHUB_TOKEN` (wingetcreate) or
   > `$env:GITHUB_TOKEN` (komac) instead of passing `--token` on the command line.
5. **Wait for `winget-pkgs` CI + moderator review**, then merge. Community review latency
   varies (hours to days) and is outside our control.
6. **Verify live** on a clean machine after merge:
   ```powershell
   winget install AyKarambo.Vantage
   winget list Vantage                # shows the installed package
   ```

## Keeping it updated

For each new release, regenerate and submit a version bump. The low-friction path is
[komac](https://github.com/russellbanks/Komac) (needs the same classic `public_repo` PAT):

```bash
komac update AyKarambo.Vantage --version 0.31.0 \
  --urls https://github.com/AyKarambo/vantage/releases/download/v0.31.0/Vantage-Setup-0.31.0.exe \
  --submit
```

komac downloads the asset, computes the SHA-256, carries prior-version metadata forward, and
opens the PR. This is currently a **manual post-release step**. Wiring it to run automatically
after `npm run publish:release` (on the GitHub Release being published — komac only needs the
already-signed asset URL + a token, so it's decoupled from the local-only signing) is tracked
as a follow-up (`winget-auto-update`).

## What only you can do (manual)

The repo can generate and validate the manifest; these require infra or are outward-facing:

- ⏳ **Confirm Overwolf ToS** permits third-party redistribution (step 1) — a human/DevRel call.
- ⏳ **Run `/S` on a clean VM** (step 2) — needs a throwaway Windows environment.
- ⏳ **Open the `winget-pkgs` PR** (step 4) — public action; needs the ToS gate passed + a
  classic PAT you hold. Never auto-submitted from CI.
- ⏳ **Verify the live install** after the community merge (step 6).

## Notes & decisions

- The installer is **already signed** and GitHub-Release-hosted, so issue #14's
  "unsigned installer / SmartScreen block" framing is superseded — the manifest points at a
  signed asset. Reputation still accrues over time; see [signing.md](signing.md#smartscreen-expectations-be-honest-with-yourself).
- **Microsoft Store (MSIX)** and **Chocolatey** are separate paths, out of scope here (the
  Store's runtime/auto-update model conflicts with the Overwolf runtime — see
  [signing.md → History](signing.md#history--alternatives)).
- Source research: [#14](https://github.com/AyKarambo/vantage/issues/14); spec + plan:
  [#123](https://github.com/AyKarambo/vantage/issues/123).
