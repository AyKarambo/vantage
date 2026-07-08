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
      this.emit('log', `gep package ready: ${version}`);
      this.onGepReady();
    });
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
      this.status = { gameRunning: true, enabled: true };
      this.emit('status', this.getStatus());
      // undefined = request all available features for the game
      this.gep!.setRequiredFeatures(gameId, undefined).catch((err) =>
        this.emit('log', 'setRequiredFeatures failed', String(err)),
      );
    });

    this.gep.on('game-exit', (_e: unknown, gameId: number) => {
      if (gameId !== this.overwatchGameId) return;
      this.status = { gameRunning: false, enabled: false };
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
