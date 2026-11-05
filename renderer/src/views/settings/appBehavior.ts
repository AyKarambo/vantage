import { h, render } from '../../dom';
import type { AppInfo, AppUiSettings } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { button, card, select, toggleRow } from '../../components/primitives';
import { toast } from '../../components/toast';
import { infoTip } from '../../components/infoTip';
import { captureFocus } from '../../focusMemory';
import { formatClaudeDesktopMcpConfig } from '../../../../src/core/mcpConfig';
import { ZOOM_OPTIONS, ZOOM_DEFAULT, syncZoom } from '../../zoom';
import { store } from '../../store';
import type { ViewContext } from '../view';

/** localStorage flag: once the Dev Mode easter egg is unlocked, it stays unlocked. */
const DEV_UNLOCK_KEY = 'vantage.devUnlocked';
const TAPS_TO_UNLOCK = 5;
// Module scope so the count survives a Settings re-render (which rebuilds this
// whole card and would otherwise reset a per-instance counter mid-sequence).
let unlockTaps = 0;
/** The last settings + build info this card painted — survives re-renders so the card never collapses back to "Loading…". */
let cached: { settings: AppUiSettings; info: AppInfo | null } | null = null;

function readUnlocked(): boolean {
  try {
    return localStorage.getItem(DEV_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Close-to-tray + run-at-login + demo data — plus a hidden Dev Mode section. */
export function appBehaviorCard(ctx: ViewContext): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  // AppInfo is a build-constant (packaged / devMode); fetched alongside settings.
  let info: AppInfo | null = null;
  let last: AppUiSettings | null = null;
  // Dev Mode is a hidden feature: revealed only once the easter egg is unlocked,
  // or when the app is already running in Dev Mode (so it can be turned off).
  let unlocked = readUnlocked();

  // The dev-key input is created ONCE so a repaint (from an unrelated toggle)
  // re-inserts the same node, preserving its value. It saves on `change`
  // (blur/Enter) — never through the paint cycle — so typing is never cut off.
  const devKeyInput = h('input', {
    class: 'vt-input',
    type: 'password',
    placeholder: 'Paste your Overwolf dev key',
  }) as HTMLInputElement;
  const devKeyHint = h('div', { class: 'hint', style: { marginTop: '6px' } },
    'Stored at ~/.ow-cli/dev-key (never in the app or git). Restart Vantage to apply.');
  devKeyInput.addEventListener('change', () => {
    void bridge.setDevKey(devKeyInput.value).then((r) => {
      devKeyInput.value = '';
      devKeyHint.textContent = r.hasKey
        ? 'Dev key saved at ~/.ow-cli/dev-key. Restart Vantage to apply.'
        : 'Dev key cleared. Restart Vantage to apply.';
    });
  });

  const load = (): void => {
    void Promise.all([bridge.getAppSettings(), bridge.getAppInfo()]).then(([s, i]) => {
      info = i;
      paint(s);
    });
  };
  // Repaint from the last read at once (#339): a Settings re-render (any
  // Coaching toggle refreshes the snapshot) rebuilds this card, and a
  // "Loading…" stub in its place shrank the page for a tick — enough for the
  // shell's scroll restore to be clamped, which read as the page jumping.
  if (cached) {
    info = cached.info;
    paint(cached.settings);
  }
  load();

  // demoPreference changes the dashboard payload (badge, targets, KPIs), so it
  // needs a store refetch; the other toggles don't touch the dashboard.
  const refetchIfDemo = (p: Partial<AppUiSettings>): void => {
    if (p.demoPreference !== undefined) void store.refresh();
  };

  // Settings apply instantly; the chip flips to show the new state, so no toast.
  function apply(patch: Partial<AppUiSettings>): void {
    void bridge.setAppSettings(patch).then((applied) => {
      paint(applied);
      refetchIfDemo(patch);
    });
  }

  /** The resolved bridge path + a one-click Claude Desktop config copy, shown while MCP is on (W4). */
function mcpBridgeBlock(bridgePath: string): HTMLElement {
  return h('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
    h('code', { class: 'mono u-dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, bridgePath),
    button('Copy Claude Desktop config', {
      variant: 'ghost',
      title: 'Copies the mcpServers JSON block Claude Desktop’s config file expects.',
      onClick: () => {
        void navigator.clipboard.writeText(formatClaudeDesktopMcpConfig(bridgePath)).then(
          () => toast('Config copied to clipboard'),
          () => toast('Couldn’t copy — clipboard unavailable'),
        );
      },
    }),
  );
}

function devModeSection(s: AppUiSettings): HTMLElement {
    const packaged = info?.packaged ?? false;
    // Reveal on any attempt this run, not just a confirmed one — a *failed*
    // dev-mode auth (the exact case this section's toggle is most useful for)
    // must not stay hidden behind the easter egg.
    const show = unlocked || (info?.devModeAttempted ?? false);
    return h('div', { class: show ? 'stack' : 'hidden', style: { gap: '10px', marginTop: '4px' } },
      h('div', { style: { fontSize: '11.5px', fontWeight: '600', color: 'var(--text-1)' } }, 'Dev Mode'),
      // Packaged builds can never run Dev Mode → show it disabled (K3, still
      // announced as a real switch), not a fake "on" (AC5: never a silent no-op).
      toggleRow({
        label: packaged ? 'Dev Mode (unavailable)' : 'Dev Mode',
        on: !packaged && s.devMode,
        disabled: packaged,
        onChange: () => apply({ devMode: !s.devMode }),
        info: packaged
          ? 'Dev Mode only runs in the unpackaged dev build, not the installed one.'
          : 'When on, the launcher loads real Overwatch (GEP) data using your dev key.',
        hint: packaged ? undefined : 'Applies on the next launch.',
      }),
      // The dev-key field is meaningless in a packaged build; hide it there.
      h('div', { class: packaged ? 'hidden' : '' }, devKeyInput, devKeyHint),
    );
  }

  /**
   * Each row is **Label** ⓘ · control (#339): the "what does this do / why"
   * prose sits behind the ⓘ, and the muted line underneath is kept only for a
   * fact the decision needs — what closing the window does right now, that
   * demo data has no effect, that the MCP pipe is reachable while it's on.
   */
  function paint(s: AppUiSettings): void {
    last = s;
    cached = { settings: s, info };
    // A toggle here repaints this card in place, which replaces the switch the
    // player just pressed — put focus back on its replacement.
    const focus = captureFocus(body);
    render(body,
      toggleRow({
        label: 'Keep Vantage in the tray on close',
        on: s.closeToTray,
        onChange: () => apply({ closeToTray: !s.closeToTray }),
        hint: s.closeToTray
          ? 'Closing the window (✕) keeps tracking games in the background.'
          : 'Closing the window (✕) quits Vantage entirely.',
      }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('span', { class: 'toggle-row-label' }, 'Text size',
          infoTip('Zooms the whole app. Also Ctrl+= / Ctrl+- to step, Ctrl+Shift+0 to reset — see the ? cheatsheet.',
            { label: 'About Text size' })),
        select(
          ZOOM_OPTIONS.map((o) => ({ value: String(o.value), label: o.label })),
          String(s.uiZoom ?? ZOOM_DEFAULT),
          (v) => { syncZoom(Number(v)); apply({ uiZoom: Number(v) }); },
        ),
      ),
      toggleRow({
        label: 'Run at login',
        on: s.runAtLogin,
        onChange: () => apply({ runAtLogin: !s.runAtLogin }),
        info: 'Starts hidden in the tray so it never steals focus from a game.',
      }),
      toggleRow({
        label: 'Demo data',
        on: s.demoPreference === 'on',
        onChange: () => apply({ demoPreference: s.demoPreference === 'on' ? 'off' : 'on' }),
        info: 'Preloads a realistic sample season to explore the app. Real data always wins: once you have tracked '
          + 'games this has no visible effect, and applies again only if your history is empty.',
        hint: ctx.data.hasRealHistory ? 'No visible effect — you have tracked games.' : undefined,
      }),
      toggleRow({
        label: 'GEP alerts',
        on: s.gepNotifications,
        onChange: () => apply({ gepNotifications: !s.gepNotifications }),
        info: 'Notifies you when Overwatch game events go down (an Overwolf outage) and when they recover. '
          + 'The in-app banner shows either way.',
      }),
      toggleRow({
        label: 'Live kill feed',
        on: s.liveKillFeed,
        onChange: () => apply({ liveKillFeed: !s.liveKillFeed }),
        info: 'Shows the kill feed on the Live screen. Off stops the feed being sent to the window at all; the '
          + 'scoreboard, per-team totals and players-you’ve-met section stay as they are.',
      }),
      toggleRow({
        label: 'Open Live on match start',
        on: s.autoSwitchToLive,
        onChange: () => apply({ autoSwitchToLive: !s.autoSwitchToLive }),
        info: 'Switches to the Live screen when a match starts. Never pulls Vantage in front of your game.',
      }),
      toggleRow({
        label: 'Open Review on match end',
        on: s.autoSwitchToReview,
        onChange: () => apply({ autoSwitchToReview: !s.autoSwitchToReview }),
        info: 'Opens that game’s Review page when the match ends — or Needs result, if no result came through. '
          + 'Never pulls Vantage in front of your game.',
      }),
      h('div', null,
        toggleRow({
          label: 'MCP endpoint',
          on: s.mcpEnabled,
          onChange: () => apply({ mcpEnabled: !s.mcpEnabled }),
          info: 'Lets an AI assistant (Claude Desktop or Claude Code) read your stats and log matches, reviews and '
            + 'targets for you, over a local-only connection. Nothing is sent anywhere by Vantage itself. Takes '
            + 'effect immediately.',
          // Say plainly what having this on exposes — the pipe is reachable by
          // any program running as this user — as the one inline line, since
          // it's the fact that should decide whether to leave it on.
          hint: s.mcpEnabled ? 'Any program running as you can reach it while on — turn it off when unused.' : undefined,
        }),
        // W4 — turning the toggle on used to leave you to find the absolute
        // bridge path by hand from the README; the main process already
        // resolves it (packaged vs dev), so show it and offer the exact
        // Claude Desktop config block instead of making anyone type it.
        s.mcpEnabled && info?.mcpBridgePath ? mcpBridgeBlock(info.mcpBridgePath) : null,
      ),
      devModeSection(s),
    );
    focus.restore();
  }

  const cardEl = card({ title: 'App behavior' }, body);
  // Easter egg: clicking the card header TAPS_TO_UNLOCK times reveals Dev Mode.
  // The whole header is the hit target (not just the title text) so it's easy to
  // find, and `unlockTaps` lives at module scope so a Settings re-render — which
  // rebuilds this card — doesn't reset progress mid-sequence. Not advertised.
  const head = cardEl.querySelector('.card-head') as HTMLElement | null;
  if (head) {
    head.addEventListener('click', () => {
      if (unlocked) return;
      unlockTaps += 1;
      if (unlockTaps < TAPS_TO_UNLOCK) return;
      unlocked = true;
      unlockTaps = 0;
      try {
        localStorage.setItem(DEV_UNLOCK_KEY, '1');
      } catch {
        /* storage unavailable — session-only unlock still works */
      }
      if (last) paint(last);
    });
  }
  return cardEl;
}
