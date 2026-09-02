import { h, render } from '../../dom';
import type { AccountSummary, PlacementRunSummary, RankSummary, Role } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { button, card, confirmButton, pill, select } from '../../components/primitives';
import { openModal } from '../../components/overlay';
import { openPlacementComplete, maybeConfirmPlacementRank } from '../../app/placementComplete';
import { roleLabel } from '../../format';
import { TIERS } from '../../../../src/core/rank';
import { roleStatus } from '../../roleStatus';
import { store } from '../../store';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'tank', label: 'Tank' }, { value: 'damage', label: 'Damage' },
  { value: 'support', label: 'Support' }, { value: 'openQ', label: 'Open Queue' },
];
const DIVISIONS = [5, 4, 3, 2, 1];

/**
 * Accounts manager — create/edit/delete the accounts you log matches against
 * (a battleTag → label mapping) and, per account, view and set the per-role rank
 * anchors the calculated-rank engine tracks from.
 */
export function accountsCard(): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '12px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));

  const reload = (): void => {
    void Promise.all([bridge.listAccounts(), bridge.getRanks(), bridge.getPlacements()])
      .then(([accounts, ranks, placements]) => paint(accounts, ranks, placements));
  };

  function paint(accounts: AccountSummary[], ranks: RankSummary[], placements: PlacementRunSummary[]): void {
    render(body,
      accounts.length
        ? h('div', { class: 'stack', style: { gap: '10px' } }, ...accounts.map((a) =>
            accountRow(a, ranks.filter((r) => r.account === a.label), placements.filter((p) => p.account === a.label))))
        : h('div', { class: 'hint' }, 'No accounts yet — add one below so you can pick it when logging a match.'),
      addForm(),
    );
  }

  function accountRow(a: AccountSummary, accRanks: RankSummary[], accPlacements: PlacementRunSummary[]): HTMLElement {
    const row = h('div', { class: 'account-row' });
    const gameCount = `${a.games} ${a.games === 1 ? 'game' : 'games'}`;
    // Sub-line: configured shows its BattleTag; detected accounts explain why
    // they're here (Unknown = no captured tag; raw tag = detected, unlabelled).
    const subLine = a.kind === 'configured'
      ? `${a.battleTag} · ${gameCount}`
      : a.kind === 'unknown'
        ? `${gameCount} · no captured BattleTag`
        : `${gameCount} · detected, unlabelled`;

    const view = (): void => {
      // Per-kind actions: configured accounts rename (Edit) + drop the label
      // (Delete, non-destructive); detected raw tags can be Labelled or have
      // their data deleted; the Unknown bucket can only be deleted (no tag to
      // label against). Every data-deleting action goes through the confirm.
      // "Set rank" first — it's the one action every account offers regardless
      // of kind, and the per-role rows below cover everything role-specific.
      const actions: Node[] = [button('Set rank', { variant: 'ghost', onClick: () => openSetRank(a.label, accRanks, reload) })];
      if (a.kind === 'configured') {
        actions.push(button('Edit', { variant: 'ghost', onClick: edit }));
        actions.push(button('Delete', { variant: 'ghost', onClick: () => void bridge.deleteAccount(a.battleTag).then(reload) }));
      } else {
        if (a.kind === 'unlabeled') actions.push(button('Label', { variant: 'soft', onClick: label }));
        actions.push(button('Delete…', { variant: 'ghost', onClick: () => confirmDestructiveDelete(a) }));
      }
      render(row,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('div', { style: { flex: '1', minWidth: '0' } },
            h('div', { style: { fontSize: '13px', fontWeight: '600' } }, a.label),
            h('div', { class: 'u-dim mono', style: { fontSize: '11px' } }, subLine),
          ),
          ...actions,
        ),
        rolesBlock(a.label, accRanks, accPlacements, reload),
      );
    };
    const edit = (): void => {
      const bt = h('input', { class: 'vt-input', type: 'text', value: a.battleTag }) as HTMLInputElement;
      const lb = h('input', { class: 'vt-input', type: 'text', value: a.label }) as HTMLInputElement;
      render(row,
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' } },
          labelled('BattleTag', bt), labelled('Display name', lb),
          button('Save', { variant: 'primary', onClick: () => {
            const battleTag = bt.value.trim(); if (!battleTag) return;
            void bridge.saveAccount({ battleTag, label: lb.value.trim() || battleTag, previousBattleTag: a.battleTag }).then(reload);
          } }),
          button('Cancel', { variant: 'ghost', onClick: view }),
        ),
      );
    };
    // Labelling a detected raw-tag account: the BattleTag is fixed (it's the key
    // its history rows adopt the label from) — only a display name is asked for.
    const label = (): void => {
      const lb = h('input', { class: 'vt-input', type: 'text', placeholder: 'Display name' }) as HTMLInputElement;
      render(row,
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' } },
          h('div', { style: { minWidth: '160px' } },
            h('div', { class: 'field-label' }, 'BattleTag'),
            h('div', { class: 'u-dim mono', style: { fontSize: '12px', padding: '6px 0' } }, a.battleTag),
          ),
          labelled('Display name', lb),
          button('Save', { variant: 'primary', onClick: () => {
            const name = lb.value.trim(); if (!name) return;
            void bridge.saveAccount({ battleTag: a.battleTag, label: name }).then(reload);
          } }),
          button('Cancel', { variant: 'ghost', onClick: view }),
        ),
      );
    };
    view();
    return row;
  }

  /**
   * Confirm gate for the IRREVERSIBLE deletion of a detected-unlabelled account
   * (a raw BattleTag or the Unknown bucket). Cancel makes zero changes; Delete
   * fires the destructive IPC, reloads the manager, and reconciles the persisted
   * account filter so the UI never points at a gone account.
   */
  function confirmDestructiveDelete(a: AccountSummary): void {
    const noun = a.games === 1 ? 'match' : 'matches';
    const who = a.kind === 'unknown' ? 'with no captured BattleTag' : `logged under “${a.label}”`;
    openModal((close) => h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '420px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Delete account data?'),
      h('div', { class: 'hint' },
        `This permanently deletes ${a.games} ${noun} ${who}, along with any rank anchors for it. This can’t be undone.`),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Cancel', { variant: 'ghost', onClick: close }),
        h('button', {
          class: 'btn btn--primary',
          style: { background: 'var(--loss-text, #d1495b)', borderColor: 'transparent', color: '#fff' },
          on: { click: () => void bridge.deleteDetectedAccount(a.battleTag).then(() => {
            close();
            reload();
            reconcileAfterDelete(a.battleTag);
          }) },
        }, `Delete ${a.games} ${noun}`),
      ),
    ));
  }

  /** After a destructive delete, drop the dashboard's account filter back to All
   *  if it was pointing at the deleted account; otherwise just refetch so the
   *  account leaves the switcher and options. */
  function reconcileAfterDelete(account: string): void {
    if (store.get().filters.account === account) store.setFilters({ account: 'all' });
    else void store.refresh();
  }

  /**
   * One line per role: status (rank, or placement progress) plus whatever
   * actions that state offers. Shown only for roles this account already
   * tracks — a rank anchor and/or a run — so an untouched role doesn't add a
   * row nobody asked for. Replaces the old rank-pill row + a SEPARATE
   * placement-controls row per role, which routinely said the same thing
   * twice: a completed run showed both its real rank (in the pill row) and a
   * static "Placements complete" pill (in the row below) at once.
   */
  function rolesBlock(account: string, accRanks: RankSummary[], accPlacements: PlacementRunSummary[], onDone: () => void): Node | null {
    const roles = ROLE_OPTIONS
      .map((o) => o.value)
      .filter((role) => accRanks.some((r) => r.role === role) || accPlacements.some((p) => p.role === role));
    // Every role this account does NOT yet track. Until this existed, a track
    // with neither a rank nor a run had no way into placements at all: it never
    // got a row, and the Start / backdate buttons live on the row (issue #200).
    // Deliberately one button rather than four empty rows — an account with one
    // anchored role is the common case, and padding it with three "no rank yet"
    // rows would cost more than it explains.
    const untracked = ROLE_OPTIONS.map((o) => o.value).filter((role) => !roles.includes(role));
    const startOther = untracked.length
      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '5px 0', borderTop: roles.length ? '1px solid var(--border)' : undefined } },
          h('span', { class: 'hint', style: { fontSize: '11.5px' } },
            roles.length ? 'Another role to place?' : 'No rank set yet.'),
          button('Start placements…', {
            variant: 'ghost',
            title: 'Pick a role to place — for a role you have never queued, or a brand-new account.',
            onClick: () => openRoleStart(account, untracked, onDone),
          }),
        )
      : null;
    if (!roles.length && !startOther) return h('div', { class: 'hint', style: { marginTop: '6px' } }, 'No rank set yet.');
    return h('div', { class: 'stack', style: { gap: '0px', marginTop: '4px' } },
      ...roles.map((role) => roleRow(
        account, role,
        accRanks.find((r) => r.role === role),
        accPlacements.find((p) => p.role === role),
        onDone,
      )),
      startOther,
    );
  }

  /** One (account, role) track's status + controls; see {@link rolesBlock}. */
  function roleRow(
    account: string, role: Role, rank: RankSummary | undefined, run: PlacementRunSummary | undefined, onDone: () => void,
  ): HTMLElement {
    // Every action here can move the anchor a track reads its computed rank
    // from (start/reset/cancel restore or replace it, complete sets a fresh
    // one) — reload the accounts card AND refresh the dashboard store, same
    // as openSetRank's save path, so the sidebar chip and Overview KPI don't
    // go stale.
    const refresh = (): void => { onDone(); void store.refresh(); };
    const roleTag = h('span', { class: 'u-dim', style: { fontSize: '11.5px', width: '56px', flex: '0 0 auto' } }, roleLabel(role));
    // roleStatus only ever takes an OPEN run — a completed one has already told
    // its story via the anchor it wrote, which `rank` carries.
    const openRun = run && !run.completed ? run : undefined;
    const status = roleStatus(rank, openRun, run?.completed === true);
    const statusEl = pill(status.text, 'accent');
    const placedTag = status.tone === 'placed'
      ? h('span', { class: 'u-dim', style: { fontSize: '10px' } }, 'placed')
      : null;
    const rowStyle = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const, padding: '5px 0', borderTop: '1px solid var(--border)' };

    if (!run) {
      return h('div', { style: rowStyle },
        roleTag, statusEl,
        button('Start placements', {
          variant: 'ghost',
          title: 'Counts the next 10 competitive matches on this track as placements.',
          onClick: () => void bridge.startPlacementRun({ account, role }).then(() => {
            refresh();
            // A fresh run can't finish on its own start, but that question
            // belongs to maybeConfirmPlacementRank, not a guess here — same
            // trigger the backdated start below uses, which CAN finish instantly.
            void maybeConfirmPlacementRank({ account, role, onDone: refresh });
          }),
        }),
        button('Start from an earlier match…', {
          variant: 'ghost',
          title: 'Backdate the run — for when the placements were already under way before you started tracking them.',
          onClick: () => openBackdateStart(account, role, refresh),
        }),
      );
    }

    // Reset and Cancel both throw away the run's progress and, for a COMPLETED
    // run, the confirmed rank it produced — the one thing this task exists to
    // make undoable. A stray click here is worse than most destructive actions
    // in the app (it silently reverts a rank the player may have already told
    // Notion or a teammate about), so both go through the same two-click
    // confirmButton guard the match-delete flows use, in every run state.
    const resetBtn = confirmButton({
      label: 'Reset to begin',
      confirmLabel: 'Reset — replay from match 1?',
      variant: 'ghost',
      title: 'Rewinds this run to its start and restores the rank the track had before it. The run stays open to replay.',
      confirmTitle: "Restarts the run from match 1 and restores the pre-run rank — undoes the confirmed rank too, if this run finished. Can't be undone.",
      onConfirm: (reset) => void bridge.resetPlacementRun({ account, role }).then(refresh).catch(() => reset()),
    });
    const cancelBtn = confirmButton({
      label: 'Cancel',
      confirmLabel: 'Cancel — remove this run?',
      variant: 'ghost',
      title: 'Restores the rank the track had before this run and removes the run — its matches return to normal ±% tracking.',
      confirmTitle: "Removes the run and hands its matches back to ±% tracking — undoes the confirmed rank too, if this run finished. Can't be undone.",
      onConfirm: (reset) => void bridge.cancelPlacementRun({ account, role }).then(refresh).catch(() => reset()),
    });

    // Re-pick where the run starts. "Reset to begin" rewinds to the run's OWN
    // startedAt, which is no help when that instant is the mistake — a run
    // started a few matches late, or after the placements had already begun.
    // Same picker the not-yet-started track offers, so "I forgot to start it"
    // and "I started it in the wrong place" have the same answer.
    const restartBtn = button('Change start match…', {
      variant: 'ghost',
      title: 'Move this run to start at an earlier match — for when it was started late, or on the wrong game.',
      // Always `true` here: this branch only renders when a run exists, so the
      // picker is always REPLACING one rather than opening a first.
      onClick: () => openBackdateStart(account, role, refresh, true),
    });

    const actions: Node[] = [restartBtn, resetBtn, cancelBtn];
    if (!run.completed) {
      // Same reveal-rank confirmation the 10th placement match opens from
      // log-match.ts — one dialog for "the game just showed me a rank",
      // whether that happens naturally at match 10 or the player forces it
      // here. Seeded with the run's latest prediction, same as there.
      const openReveal = (): void => openPlacementComplete({ account, role, suggestion: run.latestPrediction, onDone: refresh });
      actions.push(
        run.awaitingRank
          // The run already counted out its ten matches — "early" would be a
          // lie, and this is the CTA the player is actually here for.
          ? button('Confirm revealed rank', {
              variant: 'primary',
              title: 'Overwatch has revealed your rank for this run — enter exactly what it showed you.',
              onClick: openReveal,
            })
          : button('Finish early', {
              variant: 'ghost',
              title: 'End this run before its ten matches, using the rank Overwatch reveals now.',
              onClick: openReveal,
            }),
      );
    }

    const drifted = run.completed && run.drifted
      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginLeft: '64px' } },
          h('span', { class: 'hint', style: { fontSize: '11px' } }, 'The matches this run counted have changed since it finished.'),
          button('Recount', { variant: 'ghost', onClick: () => void bridge.recountPlacementRun({ account, role }).then(refresh) }),
        )
      : null;

    return h('div', { class: 'stack', style: { gap: '2px' } },
      h('div', { style: rowStyle },
        roleTag, statusEl, placedTag,
        ...actions,
      ),
      drifted,
    );
  }

  function addForm(): HTMLElement {
    const bt = h('input', { class: 'vt-input', type: 'text', placeholder: 'BattleTag, e.g. You#1234' }) as HTMLInputElement;
    const lb = h('input', { class: 'vt-input', type: 'text', placeholder: 'Display name (optional)' }) as HTMLInputElement;
    return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '12px' } },
      labelled('BattleTag', bt), labelled('Display name', lb),
      button('Add account', { variant: 'soft', onClick: () => {
        const battleTag = bt.value.trim(); if (!battleTag) return;
        void bridge.saveAccount({ battleTag, label: lb.value.trim() || battleTag }).then(reload);
      } }),
    );
  }

  reload();
  return card({ title: 'Accounts', sub: 'used when logging a match; rank is tracked per role, per account' }, body);
}

/** A small label-over-control wrapper for the account inline forms. */
function labelled(label: string, control: Node): HTMLElement {
  return h('div', { style: { minWidth: '160px' } }, h('div', { class: 'field-label' }, label), control);
}

/** Modal to set/replace the one-time rank anchor for a role on an account. */
function openSetRank(account: string, ranks: RankSummary[], onDone: () => void): void {
  openModal((close) => {
    const state = { role: 'damage' as Role, tier: 'Gold', division: 3, pct: '' };
    const seed = (role: Role): void => {
      const ex = ranks.find((r) => r.role === role);
      state.role = role;
      if (ex) {
        state.tier = ex.tier;
        state.division = ex.division;
        // Seed the % from the tracked rank (a negative protected buffer seeds as-is —
        // the picker accepts negatives and its hint explains rank protection).
        state.pct = String(Math.round(ex.progressPct));
      }
    };
    seed(state.role);

    const host = h('div', { class: 'stack', style: { gap: '10px' } });
    const paint = (): void => {
      render(host,
        labelled('Role', select(ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })), state.role, (v) => { seed(v as Role); paint(); })),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          labelled('Tier', select(TIERS.map((t) => ({ value: t, label: t })), state.tier, (v) => (state.tier = v))),
          labelled('Division', select(DIVISIONS.map((d) => ({ value: String(d), label: `Div ${d}` })), String(state.division), (v) => (state.division = Number(v)))),
          labelled('% into division', numField(state.pct, (v) => (state.pct = v))),
        ),
      );
    };
    paint();

    return h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '440px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, `Set rank — ${account}`),
      h('div', { class: 'hint' }, 'Set your current rank once; logged competitive matches move it from here. Editing re-anchors from the value you enter. A negative % means you’re in rank protection.'),
      host,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Save', { variant: 'primary', onClick: () => {
          void bridge.setRankAnchor({ account, role: state.role, tier: state.tier, division: state.division, progressPct: Number(state.pct) || 0 })
            // onDone reloads the accounts card; store.refresh re-fetches the dashboard
            // snapshot so the always-visible sidebar chip + Overview Rank KPI update live.
            .then(() => { close(); onDone(); void store.refresh(); });
        } }),
        button('Cancel', { variant: 'ghost', onClick: close }),
      ),
    );
  });
}

/**
 * Backdated start: pick an already-logged match to count as placement 1.
 *
 * The case this exists for is "I was four games in before I started tracking" —
 * without it, those games stay ordinary ±% matches and the run reads four short
 * forever. Reclassifying is non-destructive: each match keeps its recorded ±% in
 * the data, it is merely ignored while the run is open, so cancelling the run
 * puts the rank back exactly as it was.
 *
 * The list comes from the dashboard snapshot rather than a dedicated read — this
 * screen already holds it, and a run can only start from a match recent enough
 * to be in view anyway.
 */
function openBackdateStart(account: string, role: Role, onDone: () => void, replacesRun = false): void {
  const rows = (store.get().data?.matches ?? [])
    .filter((m) => m.account === account && m.role === role)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 15);

  openModal((close) => h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '460px', maxWidth: '92vw' } },
    h('div', { style: { fontSize: '15px', fontWeight: '600' } },
      `${replacesRun ? 'Move placements to start from' : 'Start placements from'} — ${roleLabel(role)} on ${account}`),
    h('div', { class: 'hint' },
      'Pick the match that was your first placement. It and every later competitive match on this track count '
      + 'toward the run; their logged ±% stays in your data but is ignored while the run is open.'),
    ...(replacesRun
      ? [h('div', { class: 'hint' },
          'This replaces where the current run starts — the run itself, and the rank it had before, are kept. '
          + 'Predicted ranks you already entered stay on their matches.')]
      : []),
    h('div', { class: 'hint u-dim' },
      'Shows this track’s matches within your current dashboard filter — widen the time range if the one you want isn’t listed.'),
    ...(rows.length
      ? [h('div', { class: 'stack', style: { gap: '6px', maxHeight: '320px', overflowY: 'auto' } },
          ...rows.map((m) => button(
            `${new Date(m.timestamp).toLocaleString()} · ${m.result} · ${m.map}`,
            {
              variant: 'ghost',
              class: 'btn--block',
              onClick: () => void bridge.startPlacementRun({ account, role, fromMatchId: m.matchId })
                .then(() => {
                  close();
                  onDone();
                  void store.refresh();
                  // Opened AFTER this modal's own close, never nested inside
                  // it. Backdating onto already-logged matches can reach the
                  // target instantly, so the run may be finished the moment
                  // it starts.
                  void maybeConfirmPlacementRank({ account, role, onDone });
                }),
            },
          )))]
      : [h('div', { class: 'hint' }, 'No matches logged for this track yet — start the run and log as you play.')]),
    h('div', { style: { display: 'flex', gap: '10px' } }, button('Cancel', { variant: 'ghost', onClick: close })),
  ));
}

function numField(value: string, onChange: (v: string) => void): HTMLInputElement {
  return h('input', {
    class: 'vt-input mono', type: 'number', step: '1', value, placeholder: '0–100, or -19 if protected',
    on: { input: (e) => onChange((e.target as HTMLInputElement).value) },
  }) as HTMLInputElement;
}

/**
 * Pick which role to place, for an account whose roles Vantage tracks no rank
 * or run for. Those tracks get no row of their own (a row is built from a rank
 * or a run), so without this there was no way to start a run on them at all —
 * the manual half of issue #200.
 *
 * Offers the same two starts the role row does: start now, or pick the match
 * the placements actually began at.
 */
function openRoleStart(account: string, roles: Role[], onDone: () => void): void {
  const refresh = (): void => { onDone(); void store.refresh(); };
  openModal((close) => h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '420px', maxWidth: '92vw' } },
    h('div', { style: { fontSize: '15px', fontWeight: '600' } }, `Start placements — ${account}`),
    h('div', { class: 'hint' },
      'Which role are you placing? Vantage tracks no rank for these yet, so a run counts the next 10 competitive '
      + 'matches on that role and takes the rank the game reveals at the end.'),
    h('div', { class: 'stack', style: { gap: '6px' } },
      ...roles.map((role) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('span', { class: 'u-dim', style: { fontSize: '11.5px', width: '56px', flex: '0 0 auto' } }, roleLabel(role)),
        button('Start now', {
          variant: 'ghost',
          onClick: () => void bridge.startPlacementRun({ account, role }).then(() => {
            close();
            refresh();
            void maybeConfirmPlacementRank({ account, role, onDone: refresh });
          }),
        }),
        button('From an earlier match…', {
          variant: 'ghost',
          // Closed first: the picker is its own modal, and stacking one overlay
          // inside another is what the rest of this file carefully avoids.
          onClick: () => { close(); openBackdateStart(account, role, refresh); },
        }),
      )),
    ),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
      button('Cancel', { variant: 'ghost', onClick: close }),
    ),
  ));
}
