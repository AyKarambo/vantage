import { app, desktopCapturer, net, protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

/**
 * Best-effort end-of-match screenshots.
 *
 * Capture is strictly opportunistic: every failure path (missing recorder
 * package, no game window, protocol issues, filesystem errors) is a silently
 * logged no-op — the detail page's gallery simply stays collapsed. Nothing
 * here is load-bearing and nothing ever throws out of this module.
 *
 * Files land under `<root>/<matchId>/…` (root = userData/data/screenshots) and
 * are served to the renderer through the read-only `vantage-media://` custom
 * protocol, scoped to that directory — no remote code, nothing leaves the
 * device (guardrails #4/#5).
 */

const SCHEME = 'vantage-media';
const HOST = 'screenshots';
/** Wait for the end-of-match screen to be up before capturing. */
const CAPTURE_DELAY_MS = 2000;
/** Never hang the pipeline on an unresponsive capture API. */
const CAPTURE_TIMEOUT_MS = 8000;

/** Narrow, feature-detected view of the (untyped) ow-electron recorder package. */
interface RecorderLike {
  captureScreenshot?: (options?: unknown) => unknown;
  takeScreenshot?: (options?: unknown) => unknown;
}

export class ScreenshotService {
  constructor(
    private readonly root: string,
    private readonly log: (...args: unknown[]) => void = () => {},
  ) {}

  /**
   * Register the read-only media protocol (call once, after app ready).
   * Serves only files that resolve inside the screenshots root.
   */
  registerProtocol(): void {
    try {
      protocol.handle(SCHEME, (request) => this.serve(request.url));
    } catch (err) {
      this.log('media protocol registration failed', String(err));
    }
  }

  private serve(rawUrl: string): Response | Promise<Response> {
    try {
      const url = new URL(rawUrl);
      if (url.host !== HOST) return notFound();
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(this.root, rel);
      const inside = file.startsWith(path.resolve(this.root) + path.sep);
      if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound();
      return net.fetch(pathToFileURL(file).toString());
    } catch (err) {
      this.log('media request failed', rawUrl, String(err));
      return notFound();
    }
  }

  /**
   * Schedule a capture ~2s after match end (so the end-of-match screen is on
   * display) and hand back stored paths relative to the screenshots root.
   * Fire-and-forget: never throws, never blocks the match pipeline.
   */
  capture(matchId: string, onSaved: (relPaths: string[]) => void): void {
    setTimeout(() => {
      this.captureNow(matchId)
        .then((paths) => {
          if (paths.length) onSaved(paths);
        })
        .catch((err) => this.log('screenshot capture failed', String(err)));
    }, CAPTURE_DELAY_MS);
  }

  private async captureNow(matchId: string): Promise<string[]> {
    const viaRecorder = await this.tryRecorder(matchId);
    if (viaRecorder.length) return viaRecorder;
    return this.tryDesktopCapturer(matchId);
  }

  /**
   * Preferred path: the ow-electron `recorder` package, purely feature-detected
   * at runtime (it ships no local typings and may not be provisioned at all).
   * We only invoke explicitly screenshot-named methods, expect them to write
   * the file we point them at, and verify the file exists before trusting it.
   */
  private async tryRecorder(matchId: string): Promise<string[]> {
    try {
      const owApp = app as unknown as {
        overwolf?: { packages?: Record<string, unknown> };
      };
      const recorder = owApp.overwolf?.packages?.['recorder'] as RecorderLike | undefined;
      if (!recorder) return [];
      const fn = [recorder.captureScreenshot, recorder.takeScreenshot]
        .find((f) => typeof f === 'function');
      if (!fn) {
        this.log('recorder package present but exposes no screenshot API — skipping');
        return [];
      }
      const file = this.targetFile(matchId);
      await withTimeout(
        Promise.resolve(fn.call(recorder, { filePath: file })),
        CAPTURE_TIMEOUT_MS,
      );
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        this.log('screenshot captured via recorder package', file);
        return [this.relPath(matchId, file)];
      }
      return [];
    } catch (err) {
      this.log('recorder screenshot failed — falling back', String(err));
      return [];
    }
  }

  /** Fallback: an Electron desktopCapturer grab of the game window. */
  private async tryDesktopCapturer(matchId: string): Promise<string[]> {
    try {
      const sources = await withTimeout(
        desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 2560, height: 1440 },
        }),
        CAPTURE_TIMEOUT_MS,
      );
      const game = sources.find((s) => /overwatch/i.test(s.name));
      if (!game) {
        this.log('no game window found — skipping screenshot');
        return [];
      }
      const png = game.thumbnail?.toPNG();
      if (!png || !png.length) return [];
      const file = this.targetFile(matchId);
      fs.writeFileSync(file, png);
      this.log('screenshot captured via desktopCapturer', file);
      return [this.relPath(matchId, file)];
    } catch (err) {
      this.log('desktopCapturer screenshot failed', String(err));
      return [];
    }
  }

  /** `<root>/<matchId>/end-of-match.png`, directories created on demand. */
  private targetFile(matchId: string): string {
    const dir = path.join(this.root, sanitize(matchId));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'end-of-match.png');
  }

  /** Path relative to the screenshots root, forward-slashed for storage. */
  private relPath(matchId: string, file: string): string {
    return `${sanitize(matchId)}/${path.basename(file)}`;
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

/** Match ids become directory names — strip anything path-hostile. */
function sanitize(matchId: string): string {
  return matchId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}
