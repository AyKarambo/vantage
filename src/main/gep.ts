import { app as electronApp } from 'electron';
import { EventEmitter } from 'events';
import type { GepMessage } from '../core/model';

/**
 * Minimal shape of the Overwolf Game Events Package we rely on. Typed locally so
 * we are not coupled to a specific @overwolf/ow-electron-packages-types version.
 * See modules/gep.d.ts in that package for the full interface.
 */
interface GepApi extends EventEmitter {
  setRequiredFeatures(gameId: number, features: string[] | undefined): Promise<void>;
  getInfo(gameId: number): Promise<any>;
  getSupportedGames?(): Promise<{ name: string; id: number }[]>;
}

export interface GepStatus {
  gameRunning: boolean;
  enabled: boolean;
  lastError?: string;
  /** The loaded GEP package version (from the package manager), e.g. '309.0.0'. */
  gepVersion?: string;
  /** A fixed GEP package is downloaded and awaiting a restart to apply. */
  updateStaged?: boolean;
}

/** A GEP info update / game event as delivered to the listeners. */
interface RawGepData {
  gameId?: number;
  feature?: string;
  category?: string;
  key?: string;
  value?: unknown;
}

/**
 * Wraps the Overwolf GEP package: waits for it to be ready, enables Overwatch
 * when detected, requests all features, and re-emits normalized {@link GepMessage}s.
 *
 * Emits: 'message' (GepMessage), 'status' (GepStatus), 'log' (string, ...args).
 *
 * Extends EventEmitter deliberately — an idiomatic Node push-source; the injectable, testable seam is `pipeline.feed` one level up.
 */
export class GepService extends EventEmitter {
  private gep?: GepApi;
  private status: GepStatus = { gameRunning: false, enabled: false };

  constructor(private readonly overwatchGameId: number) {
    super();
    this.registerPackageManager();
  }

  getStatus(): GepStatus {
    return { ...this.status };
  }

  async getActiveInfo(): Promise<any> {
    if (!this.gep || !this.status.gameRunning) return null;
    return this.gep.getInfo(this.overwatchGameId);
  }

  private get packages(): any {
    return (electronApp as any).overwolf?.packages;
  }

  private registerPackageManager(): void {
    const packages = this.packages;
    if (!packages) {
      this.emit('log', 'overwolf.packages unavailable — is this running under ow-electron?');
      return;
    }
    packages.on('ready', (_e: unknown, packageName: string, version: string) => {
      if (packageName !== 'gep') return;
      this.status = { ...this.status, gepVersion: version };
      this.emit('log', `gep package ready: ${version}`);
      this.checkPendingUpdates();
      this.onGepReady();
    });
    // A fixed GEP package that landed WHILE we were running: capture the new
    // version and re-arm live (onGepReady re-arms setRequiredFeatures when a game
    // is up). Best-effort — updates that need a restart come via the event below.
    packages.on('updated', (_e: unknown, packageName: string, version: string) => {
      if (packageName !== 'gep') return;
      this.status = { ...this.status, gepVersion: version, updateStaged: false };
      this.emit('log', `gep package updated at runtime: ${version} — re-arming`);
      this.onGepReady();
    });
    // A fixed GEP package is downloaded but needs a restart to apply → the app
    // surfaces a "restart to apply" prompt (never auto-restarts).
    packages.on('package-update-pending', (_e: unknown, info: Array<{ name?: string; version?: string }>) => {
      if (!Array.isArray(info) || !info.some((p) => p?.name === 'gep')) return;
      this.status = { ...this.status, updateStaged: true };
      this.emit('log', 'gep package update staged — restart to apply');
      this.emit('status', this.getStatus());
    });
  }

  /** Was a GEP package fix already staged at startup (needs a restart)? Defensive —
   *  older package-manager builds may lack `hasPendingUpdates`. */
  private checkPendingUpdates(): void {
    try {
      const fn = this.packages?.hasPendingUpdates;
      if (typeof fn !== 'function') return;
      const res = fn.call(this.packages) as { hasPendingUpdate?: boolean; details?: Array<{ name?: string }> };
      const staged = Boolean(res?.hasPendingUpdate) && (res.details ?? []).some((p) => p?.name === 'gep');
      if (staged) {
        this.status = { ...this.status, updateStaged: true };
        this.emit('log', 'gep package update already staged at startup — restart to apply');
      }
    } catch (err) {
      this.emit('log', 'hasPendingUpdates check failed', String(err));
    }
  }

  private onGepReady(): void {
    this.gep = this.packages.gep as GepApi;
    this.gep.removeAllListeners();

    this.gep.on('game-detected', (e: { enable: () => void }, gameId: number, name: string) => {
      if (gameId !== this.overwatchGameId) {
        this.emit('log', `gep: ignoring non-tracked game ${name} (${gameId})`);
        return;
      }
      this.emit('log', `gep: Overwatch detected (${gameId}) — enabling`);
      e.enable();
      // Spread, don't replace: a fresh detect clears any stale error but must
      // preserve the package version + staged-update flag (else About and the
      // restart-to-apply banner get wiped the moment a game launches).
      this.status = { ...this.status, gameRunning: true, enabled: true, lastError: undefined };
      this.emit('status', this.getStatus());
      // undefined = request all available features for the game
      this.gep!.setRequiredFeatures(gameId, undefined).catch((err) =>
        this.emit('log', 'setRequiredFeatures failed', String(err)),
      );
    });

    this.gep.on('game-exit', (_e: unknown, gameId: number) => {
      if (gameId !== this.overwatchGameId) return;
      // Preserve the package version + staged-update flag across a game exit.
      this.status = { ...this.status, gameRunning: false, enabled: false, lastError: undefined };
      this.emit('status', this.getStatus());
    });

    this.gep.on('elevated-privileges-required', (_e: unknown, gameId: number) => {
      const msg = 'Overwatch is running as administrator — run this app as admin too to receive events.';
      this.status = { ...this.status, lastError: msg };
      this.emit('status', this.getStatus());
      this.emit('log', 'elevated-privileges-required', gameId);
    });

    this.gep.on('new-info-update', (_e: unknown, _gameId: number, data: RawGepData) => {
      this.dispatch('info', data);
    });

    this.gep.on('new-game-event', (_e: unknown, _gameId: number, data: RawGepData) => {
      this.dispatch('event', data);
    });

    this.gep.on('error', (_e: unknown, gameId: number, error: string) => {
      this.status = { ...this.status, lastError: error };
      this.emit('status', this.getStatus());
      this.emit('log', 'gep-error', gameId, error);
    });

    // Re-arm when re-entering onGepReady after a runtime package update while a
    // game is already up (first-ready has gameRunning=false, so this no-ops then).
    if (this.status.gameRunning) {
      this.gep.setRequiredFeatures(this.overwatchGameId, undefined).catch((err) =>
        this.emit('log', 'setRequiredFeatures (re-arm) failed', String(err)),
      );
    }

    this.emit('status', this.getStatus());
    this.logSupportedGames();
  }

  /** Diagnostic: ask GEP which games it currently supports and whether Overwatch is one. */
  private logSupportedGames(): void {
    const fn = this.gep?.getSupportedGames;
    if (!fn) {
      this.emit('log', 'gep: getSupportedGames not available in this build');
      return;
    }
    // getSupportedGames can hang indefinitely when the app isn't provisioned, so
    // race it against a timeout to get a definitive signal either way.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timed out after 6s (app not provisioned / not elevated?)')), 6000),
    );
    Promise.race([fn.call(this.gep), timeout])
      .then((games) => {
        const list = games as { name: string; id: number }[];
        this.emit('log', `gep: ${list.length} supported games`);
        const ow = list.find((g) => g.id === this.overwatchGameId);
        this.emit(
          'log',
          ow
            ? `gep: ✅ Overwatch (${this.overwatchGameId}) IS supported — waiting for game-detected`
            : `gep: ⚠ Overwatch (${this.overwatchGameId}) is NOT in the supported list (enable Overwatch for the app in the Overwolf console)`,
        );
      })
      .catch((err) => this.emit('log', 'gep: getSupportedGames failed/hung —', String(err)));
  }

  private dispatch(kind: 'info' | 'event', data: RawGepData): void {
    if (!data || !data.feature || !data.key) {
      this.emit('log', `gep: malformed ${kind} payload`, data as unknown);
      return;
    }
    const msg: GepMessage = {
      kind,
      feature: data.feature,
      category: data.category,
      key: data.key,
      value: data.value,
    };
    // Raw log so feature/key names can be verified against a real capture.
    this.emit('log', `gep ${kind}: ${msg.feature}.${msg.key} =`, msg.value);
    this.emit('message', msg);
  }
}
