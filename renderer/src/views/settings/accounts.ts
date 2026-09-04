import { h, render } from '../../dom';
import type { AccountSummary, PlacementRunSummary, RankSummary, Role } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { button, card, confirmButton, pill, select } from '../../components/primitives';
import { openModal } from '../../components/overlay';
import { openPlacementComplete, maybeConfirmPlacementRank } from '../../app/placementComplete';
import { roleLabel } from '../../format';
import { TIERS } from '../../../../src/core/rank';
import { ROLE_ORDER, accountRoleSummary, roleStatus } from '../../roleStatus';
import { store } from '../../store';

/** Full role names — the manage-ranks modal has room for "Open Queue" where the sidebar only has room for "Open Q". */
const ROLE_NAME: Readonly<Record<Role, string>> = { tank: 'Tank', damage: 'Damage', support: 'Support', openQ: 'Open Queue' };
const ROLE_OPTIONS: Array<{ value: Role; label: string }> = ROLE_ORDER.map((role) => ({ value: role, label: ROLE_NAME[role] }));
const DIVISIONS = [5, 4, 3, 2, 1];

/**
 * How a dialog opened FROM the manage-ranks modal hands control back. The modal
 * closes before opening any of them (overlays never stack in this file), so a
 * sub-dialog needs two things from it: `onChange` — a write landed, reload the
 * accounts card and the dashboard store — and `onReturn` — this dialog, and
 * anything it chained, is finished: bring the modal back so the user lands
 * where they were.
 */
interface RanksFlow {
  onChange: () => void;
  onReturn: () => void;
}

/**
 * Accounts manager — create/edit/delete the accounts you log matches against
 * (a battleTag → label mapping). The card itself only LISTS accounts, one
 * aligned grid row each with a compact per-role rank summary; everything
 * role-specific (rank anchors, placement runs) lives in the manage-ranks
 * modal behind each row's "Manage ranks…" button.
 */
export function accountsCard(): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '12px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));

  const reload = (): void => {
    void Promise.all([bridge.listAccounts(), bridge.getRanks(), bridge.getPlacements()])
      .then(([accounts, ranks, placements]) => paint(accounts, ranks, placements));
  };
  // Every rank/placement write can move the anchor a track reads its computed
  // rank from — reload this card AND refresh the dashboard store, so the
  // always-visible sidebar chip and the Overview Rank KPI never go stale.
  const changed = (): void => { reload(); void store.refresh(); };

  function paint(accounts: AccountSummary[], ranks: RankSummary[], placements: PlacementRunSummary[]): void {
    render(body,
      accounts.length
        ? h('div', { class: 'acct-grid' },
            h('div', { class: 'acct-grid-head' },
              h('span', null, 'Account'),
              h('span', { class: 'acct-grid-games' }, 'Games'),
              h('span', null, 'Ranks'),
              h('span', null, ''),
            ),
            ...accounts.map((a) => accountRow(a, ranks, placements)))
        : h('div', { class: 'hint' }, 'No accounts yet — add one below so you can pick it when logging a match.'),
      addForm(),
    );
  }

  function accountRow(a: AccountSummary, ranks: RankSummary[], placements: PlacementRunSummary[]): HTMLElement {
    const row = h('div', { class: 'acct-grid-row' });
    // Sub-line: configured shows its BattleTag; detected accounts explain why
    // they're here (Unknown = no captured tag; raw tag = detected, unlabelled).
    // The game count has its own column now.
    const subLine = a.kind === 'configured'
      ? a.battleTag
      : a.kind === 'unknown'
        ? 'no captured BattleTag'
        : 'detected, unlabelled';

    const view = (): void => {
      // "Manage ranks…" first — the one action every account offers regardless
      // of kind. Then per kind: configured accounts rename (Edit) + drop the
      // label (Delete, keeps the matches); detected raw tags can be Labelled or
      // have their data deleted; the Unknown bucket can only be deleted (no tag
      // to label against). Every data-deleting action goes through the confirm.
      const actions: Node[] = [
        button('Manage ranks…', {
          variant: 'soft',
          title: 'Rank anchors and placement runs for every role on this account.',
          onClick: () => openManageRanks(a.label, changed),
        }),
      ];
      if (a.kind === 'configured') {
        actions.push(button('Edit', { variant: 'ghost', onClick: edit }));
        actions.push(button('Delete', {
          variant: 'ghost',
          title: 'Forgets the display name only — logged matches are kept and show up under the BattleTag again.',
          onClick: () => void bridge.deleteAccount(a.battleTag).then(changed),
        }));
      } else {
        if (a.kind === 'unlabeled') actions.push(button('Label', { variant: 'ghost', onClick: label }));
        actions.push(button('Delete…', { variant: 'ghost', onClick: () => confirmDestructiveDelete(a) }));
      }
      render(row,
        h('div', { class: 'acct-grid-name-cell' },
          h('div', { class: 'acct-grid-name' }, a.label),
          h('div', { class: 'acct-grid-sub mono' }, subLine),
        ),
        h('div', { class: 'acct-grid-games' }, String(a.games)),
        h('div', { class: 'acct-role-summary' }, ...roleChips(a.label, ranks, placements)),
        h('div', { class: 'acct-grid-actions' }, ...actions),
      );
    };
    const edit = (): void => {
      const bt = h('input', { class: 'vt-input', type: 'text', value: a.battleTag }) as HTMLInputElement;
      const lb = h('input', { class: 'vt-input', type: 'text', value: a.label }) as HTMLInputElement;
      render(row,
        h('div', { class: 'acct-grid-form' },
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
        h('div', { class: 'acct-grid-form' },
          h('div', { class: 'acct-form-field' },
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

  /** The per-role chips of one list row; an account that tracks nothing gets one muted "No rank yet". */
  function roleChips(account: string, ranks: RankSummary[], placements: PlacementRunSummary[]): Node[] {
    const chips = accountRoleSummary(account, ranks, placements);
    if (!chips.length) return [h('span', { class: 'acct-role-chip is-empty' }, 'No rank yet')];
    return chips.map((c) => h('span', { class: `acct-role-chip is-${c.tone}` }, c.text));
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
        button(`Delete ${a.games} ${noun}`, {
          class: 'btn--danger',
          onClick: () => void bridge.deleteDetectedAccount(a.battleTag).then(() => {
            close();
            reload();
            reconcileAfterDelete(a.battleTag);
          }),
        }),
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

  function addForm(): HTMLElement {
    const bt = h('input', { class: 'vt-input', type: 'text', placeholder: 'BattleTag, e.g. You#1234' }) as HTMLInputElement;
    const lb = h('input', { class: 'vt-input', type: 'text', placeholder: 'Display name (optional)' }) as HTMLInputElement;
    return h('div', { class: 'acct-add-form' },
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

/** A small label-over-control wrapper for the account forms. */
function labelled(label: string, control: Node): HTMLElement {
  return h('div', { class: 'acct-form-field' }, h('div', { class: 'field-label' }, label), control);
}

/**
 * The manage-ranks modal for one account: all four roles, one grid row each —
 * role | status | actions — where every row offers exactly the controls its
 * state allows (start a run; change its start, reset, cancel, finish it; recount
 * a drifted one). Replaces the per-role control rows that used to sit inline
 * under every account in the list.
 *
 * Repaints itself from a fresh `getRanks()` / `getPlacements()` read after every
 * write, and tells the card (`onChange`) so the list and the dashboard store
 * follow. Anything that needs a dialog of its own — Set rank, the backdate
 * picker, the reveal-rank confirmation — closes this modal first and reopens
 * it once done, so overlays never stack and the user lands back here.
 */
function openManageRanks(account: string, onChange: () => void): void {
  openModal((close) => {
    const host = h('div', { class: 'rank-modal-rows' }, h('div', { class: 'hint' }, 'Loading…'));
    let ranks: RankSummary[] = [];
    /** False until the first read lands — `ranks` is not yet an answer, only an empty default. */
    let loaded = false;

    const read = (): Promise<readonly [RankSummary[], PlacementRunSummary[]]> =>
      Promise.all([bridge.getRanks(), bridge.getPlacements()])
        .then(([r, p]) => [r.filter((x) => x.account === account), p.filter((x) => x.account === account)] as const);
    // A failed read must say so rather than leaving the rows on "Loading…" (or,
    // after a write, showing the state from before it) with no way forward.
    const repaint = (): Promise<void> =>
      read().then(
        ([r, p]) => { ranks = r; loaded = true; paint(r, p); },
        () => {
          render(host, h('div', { class: 'hint' },
            'Could not read this account’s ranks. Close and reopen this dialog to try again.'));
        },
      );

    // A write that stays inside this modal: the card + store refresh, and the
    // rows repaint from a fresh read rather than a locally patched summary.
    const afterWrite = (): void => { onChange(); void repaint(); };

    const reopen = (): void => openManageRanks(account, onChange);
    const flow: RanksFlow = { onChange, onReturn: reopen };
    /** Leave for a dialog of its own: close first — overlays never stack — then open it. */
    const leaveFor = (open: () => void): void => { close(); open(); };

    // After a run START. A run can be finished the moment it starts (a
    // backdated start onto already-logged matches reaches ten instantly; a
    // start-now run can't, but that is maybeConfirmPlacementRank's call, not a
    // guess here). That prompt is its own modal, so this one has to close
    // before it opens — and the only way to know whether it WILL open, without
    // it opening on top of this modal, is the same fresh read the repaint
    // needs anyway. Awaiting → close, hand over, come back once confirmed;
    // otherwise just repaint in place.
    const settleStart = (role: Role): void => {
      onChange();
      void read().then(
        ([r, p]) => {
          if (p.find((x) => x.role === role)?.awaitingRank) {
            close();
            void maybeConfirmPlacementRank({ account, role, onDone: () => { onChange(); reopen(); }, onDismiss: reopen })
              .then((asked) => { if (!asked) reopen(); });
          } else {
            ranks = r;
            paint(r, p);
          }
        },
        // The run DID start (the write resolved); only the follow-up read failed,
        // so say so here rather than leaving the row claiming it never started.
        () => void repaint(),
      );
    };

    function paint(r: RankSummary[], p: PlacementRunSummary[]): void {
      render(host, ...ROLE_ORDER.map((role) => roleRow(role, r.find((x) => x.role === role), p.find((x) => x.role === role))));
    }

    /** One (account, role) track's status + the controls its state offers. */
    function roleRow(role: Role, rank: RankSummary | undefined, run: PlacementRunSummary | undefined): HTMLElement {
      // roleStatus only ever takes an OPEN run — a completed one has already
      // told its story via the anchor it wrote, which `rank` carries.
      const openRun = run && !run.completed ? run : undefined;
      const status = roleStatus(rank, openRun, run?.completed === true);
      const statusEl = h('div', { class: 'rank-modal-status' },
        status.tone === 'empty' ? h('span', { class: 'u-dim' }, status.text) : pill(status.text, 'accent'),
        status.tone === 'placed' ? h('span', { class: 'rank-modal-placed u-dim' }, 'placed') : null,
      );

      const actions: Node[] = [];
      let note: HTMLElement | null = null;
      if (!run) {
        actions.push(
          button('Start placements', {
            variant: 'ghost',
            title: 'Counts the next 10 competitive matches on this track as placements.',
            onClick: () => void bridge.startPlacementRun({ account, role }).then(() => settleStart(role)),
          }),
          button('Start from an earlier match…', {
            variant: 'ghost',
            title: 'Backdate the run — for when the placements were already under way before you started tracking them.',
            onClick: () => leaveFor(() => openBackdateStart(account, role, flow)),
          }),
        );
      } else {
        // Re-pick where the run starts. "Reset to begin" rewinds to the run's
        // OWN startedAt, which is no help when that instant is the mistake — a
        // run started a few matches late, or after the placements had already
        // begun. Same picker the not-yet-started track offers, so "I forgot to
        // start it" and "I started it in the wrong place" have the same answer.
        // Always `true` here: this branch only renders when a run exists, so the
        // picker is always REPLACING one rather than opening a first.
        const repick = (): void => leaveFor(() => openBackdateStart(account, role, flow, true, run.completed));
        actions.push(
          run.completed
            // Re-picking the start of a FINISHED run reopens it, which throws
            // away the rank its completion confirmed — the same loss Reset and
            // Cancel guard, so it gets the same two-click guard and wording.
            ? confirmButton({
                label: 'Change start match…',
                confirmLabel: 'Change start — reopen this run?',
                variant: 'ghost',
                title: 'Move this finished run to start at an earlier match. It reopens the run.',
                confirmTitle: "Reopens the run from the match you pick and restores the pre-run rank — undoes the confirmed rank. Can't be undone.",
                onConfirm: () => repick(),
              })
            : button('Change start match…', {
                variant: 'ghost',
                title: 'Move this run to start at an earlier match — for when it was started late, or on the wrong game.',
                onClick: repick,
              }),
        );
        // Reset and Cancel both throw away the run's progress and, for a
        // COMPLETED run, the confirmed rank it produced — the one thing this
        // modal exists to make undoable. A stray click here is worse than most
        // destructive actions in the app (it silently reverts a rank the player
        // may have already told Notion or a teammate about), so both go through
        // the same two-click confirmButton guard the match-delete flows use, in
        // every run state.
        actions.push(confirmButton({
          label: 'Reset to begin',
          confirmLabel: 'Reset — replay from match 1?',
          variant: 'ghost',
          title: 'Rewinds this run to its start and restores the rank the track had before it. The run stays open to replay.',
          confirmTitle: "Restarts the run from match 1 and restores the pre-run rank — undoes the confirmed rank too, if this run finished. Can't be undone.",
          onConfirm: (reset) => void bridge.resetPlacementRun({ account, role }).then(afterWrite).catch(() => reset()),
        }));
        actions.push(confirmButton({
          label: 'Cancel run',
          confirmLabel: 'Cancel — remove this run?',
          variant: 'ghost',
          title: 'Restores the rank the track had before this run and removes the run — its matches return to normal ±% tracking.',
          confirmTitle: "Removes the run and hands its matches back to ±% tracking — undoes the confirmed rank too, if this run finished. Can't be undone.",
          onConfirm: (reset) => void bridge.cancelPlacementRun({ account, role }).then(afterWrite).catch(() => reset()),
        }));
        if (!run.completed) {
          // Same reveal-rank confirmation the 10th placement match opens from
          // log-match.ts — one dialog for "the game just showed me a rank",
          // whether that happens naturally at match 10 or the player forces it
          // here. Seeded with the run's latest prediction, same as there.
          const openReveal = (): void => leaveFor(() => openPlacementComplete({
            account, role, suggestion: run.latestPrediction, onDone: () => { onChange(); reopen(); }, onDismiss: reopen,
          }));
          actions.push(
            run.awaitingRank
              // The run already counted out its ten matches — "early" would be
              // a lie, and this is the CTA the player is actually here for.
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
        if (run.completed && run.drifted) {
          note = h('div', { class: 'rank-modal-note' },
            h('span', { class: 'hint' }, 'The matches this run counted have changed since it finished.'),
            button('Recount', { variant: 'ghost', onClick: () => void bridge.recountPlacementRun({ account, role }).then(afterWrite) }),
          );
        }
      }

      return h('div', { class: 'rank-modal-row' },
        h('span', { class: 'rank-modal-role' }, ROLE_NAME[role]),
        statusEl,
        h('div', { class: 'rank-modal-actions' }, ...actions),
        note,
      );
    }

    void repaint();

    return h('div', { class: 'stack rank-modal' },
      h('div', { class: 'rank-modal-head' },
        h('div', { class: 'rank-modal-title' }, `Ranks & placements — ${account}`),
        button('Set rank…', {
          variant: 'soft',
          title: 'Set or replace the rank anchor for a role — the point logged matches move it from.',
          // Disabled until the first read lands: the picker seeds each role from
          // `ranks`, and an empty array would look like "no rank set" and offer
          // to overwrite one the account actually has.
          disabled: !loaded,
          onClick: () => leaveFor(() => openSetRank(account, ranks, flow)),
        }),
      ),
      h('div', { class: 'hint' },
        'Set a rank once per role; logged competitive matches move it from there. A placement run counts the next '
        + 'ten matches on a role instead and takes the rank the game reveals at the end.'),
      host,
      h('div', { class: 'rank-modal-foot' }, button('Close', { variant: 'ghost', onClick: close })),
    );
  }, { panelClass: 'modal-card--ranks' });
}

/** Modal to set/replace the one-time rank anchor for a role on an account. */
function openSetRank(account: string, ranks: RankSummary[], flow: RanksFlow): void {
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
            // onChange reloads the accounts card and re-fetches the dashboard
            // snapshot (sidebar chip + Overview Rank KPI); onReturn brings the
            // manage-ranks modal back, repainted from the new anchor.
            .then(() => { close(); flow.onChange(); flow.onReturn(); });
        } }),
        button('Cancel', { variant: 'ghost', onClick: () => { close(); flow.onReturn(); } }),
      ),
    );
    // Escape / backdrop is a Cancel too: come back to the manage-ranks modal.
  }, { onDismiss: flow.onReturn });
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
function openBackdateStart(account: string, role: Role, flow: RanksFlow, replacesRun = false, reopensRun = false): void {
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
          reopensRun
            ? 'This run has already finished. Moving its start REOPENS it and undoes the rank you confirmed — '
              + 'the track goes back to the rank it had before the run, and counts out its ten matches again.'
            : 'This replaces where the current run starts — the run itself, and the rank it had before, are kept. '
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
                  flow.onChange();
                  // Opened AFTER this modal's own close, never nested inside
                  // it. Backdating onto already-logged matches can reach the
                  // target instantly, so the run may be finished the moment
                  // it starts — and the manage modal only comes back once
                  // that question is settled, so it never sits under the
                  // reveal-rank dialog.
                  void maybeConfirmPlacementRank({ account, role, onDone: () => { flow.onChange(); flow.onReturn(); }, onDismiss: flow.onReturn })
                    .then((asked) => { if (!asked) flow.onReturn(); });
                }),
            },
          )))]
      : [h('div', { class: 'hint' }, 'No matches logged for this track yet — start the run and log as you play.')]),
    h('div', { style: { display: 'flex', gap: '10px' } }, button('Cancel', { variant: 'ghost', onClick: () => { close(); flow.onReturn(); } })),
  ), { onDismiss: flow.onReturn });
}

function numField(value: string, onChange: (v: string) => void): HTMLInputElement {
  return h('input', {
    class: 'vt-input mono', type: 'number', step: '1', value, placeholder: '0–100, or -19 if protected',
    on: { input: (e) => onChange((e.target as HTMLInputElement).value) },
  }) as HTMLInputElement;
}
