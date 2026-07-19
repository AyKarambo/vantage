import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PipeClient } from './pipeClient';
import { runTool, type ToolRegistrar } from './server';

/**
 * The write surface: only what the user could type into the app by hand.
 *
 * Nothing here fabricates game facts from outside Overwolf's GEP feed — a
 * logged match is a *manual* entry, exactly as if it had been typed into the
 * Log Match card, and the app records it through that same pipeline.
 *
 * Two annotation tiers. Additive tools carry `destructiveHint: false`;
 * irreversible ones carry `destructiveHint: true`, which is what prompts the
 * MCP client to ask the user before running them. That client prompt — not the
 * `confirm` argument — is what actually puts the user in the loop; `confirm`
 * stops the op being reached incidentally and makes intent explicit.
 */

const ADDITIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

const result = z.enum(['Win', 'Loss', 'Draw']);
const role = z.enum(['damage', 'tank', 'support', 'openQ']);
const grade = z.enum(['hit', 'partial', 'missed']);
const grades = z.record(z.string(), grade).describe('Target id → hit | partial | missed.');

/** Mirrors MatchMental — the after-game feel flags. */
const mental = z
  .object({
    tilt: z.boolean().optional(),
    toxicMates: z.boolean().optional(),
    leaverMyTeam: z.boolean().optional(),
    leaverEnemyTeam: z.boolean().optional(),
    comms: z.enum(['positive', 'neutral', 'negative']).optional(),
  })
  .describe('After-game feel flags.');

const confirm = z
  .boolean()
  .describe(
    'Must be true, and only after the user has explicitly agreed to THIS action. '
    + 'Never set it on your own initiative.',
  );

export const registerWriteTools: ToolRegistrar = (server: McpServer, client: PipeClient) => {
  // ---------------- additive ----------------

  server.registerTool(
    'vantage_log_match',
    {
      title: 'Log a match',
      description:
        'Record a match by hand, exactly as the Log Match card would. Use vantage_master_data first to '
        + 'resolve valid map and hero names. Omit playedAt for "just now"; it is clamped to the past.',
      inputSchema: {
        input: z.object({
          result,
          role,
          map: z.string(),
          gameType: z.string().describe('e.g. "Competitive".'),
          heroes: z.array(z.string()).optional(),
          account: z.string().optional(),
          srDelta: z.number().optional().describe('Signed SR/rank % for this competitive match, e.g. -19.'),
          performance: z.number().min(0).max(100).optional().describe('Self-rated performance 0-100.'),
          mental: mental.optional(),
          grades: grades.optional(),
          playedAt: z.number().optional().describe('Epoch ms the match ended; omit for now.'),
        }),
      },
      annotations: ADDITIVE,
    },
    async ({ input }) => runTool(() => client.call('logMatch', { input } as never)),
  );

  server.registerTool(
    'vantage_edit_match',
    {
      title: 'Edit a match',
      description:
        'Amend a stored match. Game facts (result/role/map/heroes/gameType) are editable on any match; '
        + 'changing them on an auto-tracked match stamps it as hand-edited. Only fields you supply change; '
        + 'srDelta/performance accept null to clear.',
      inputSchema: {
        input: z.object({
          matchId: z.string(),
          result: result.optional(),
          role: role.optional(),
          map: z.string().optional(),
          gameType: z.string().optional(),
          heroes: z.array(z.string()).optional().describe('Replacement hero list; [] clears.'),
          mental: mental.optional(),
          srDelta: z.number().nullable().optional(),
          performance: z.number().min(0).max(100).nullable().optional(),
          grades: grades.optional(),
        }),
      },
      annotations: ADDITIVE,
    },
    async ({ input }) => runTool(() => client.call('editMatch', { input } as never)),
  );

  server.registerTool(
    'vantage_save_review',
    {
      title: 'Save a match review',
      description: 'Attach target grades and feel flags to a tracked match — the Review screen read.',
      inputSchema: {
        input: z.object({
          matchId: z.string(),
          grades,
          flags: mental,
          performance: z.number().min(0).max(100).optional(),
          srDelta: z.number().nullable().optional(),
        }),
      },
      annotations: ADDITIVE,
    },
    async ({ input }) => runTool(() => client.call('saveReview', { input } as never)),
  );

  server.registerTool(
    'vantage_save_target',
    {
      title: 'Create an improvement target',
      description:
        "Add a target to the player's library. mode 'self' is graded by hand on Review; 'measured' is "
        + 'auto-graded from match stats by its rule.',
      inputSchema: {
        input: z.object({
          name: z.string(),
          mode: z.enum(['self', 'measured']),
          rule: z.string().describe('For measured targets, the rule expression; for self, the reminder text.'),
          roleScope: role.optional(),
          heroScope: z.string().optional(),
        }),
      },
      annotations: ADDITIVE,
    },
    async ({ input }) => runTool(() => client.call('saveTarget', { input } as never)),
  );

  server.registerTool(
    'vantage_update_target',
    {
      title: 'Edit an improvement target',
      description: 'Change a target’s name/mode/rule. Accrued grades and lifecycle state are preserved.',
      inputSchema: {
        input: z.object({
          id: z.string(),
          name: z.string(),
          mode: z.enum(['self', 'measured']),
          rule: z.string(),
          roleScope: role.optional(),
          heroScope: z.string().optional(),
        }),
      },
      annotations: ADDITIVE,
    },
    async ({ input }) => runTool(() => client.call('updateTarget', { input } as never)),
  );

  server.registerTool(
    'vantage_set_target_active',
    {
      title: 'Activate or deactivate a target',
      description: 'Controls whether the target is graded on the Review screen.',
      inputSchema: { id: z.string(), active: z.boolean() },
      annotations: { ...ADDITIVE, idempotentHint: true },
    },
    async ({ id, active }) => runTool(() => client.call('setTargetActive', { id, active })),
  );

  server.registerTool(
    'vantage_set_target_archived',
    {
      title: 'Archive or restore a target',
      description: 'Archiving is reversible and keeps the target’s accrued grades.',
      inputSchema: { id: z.string(), archived: z.boolean() },
      annotations: { ...ADDITIVE, idempotentHint: true },
    },
    async ({ id, archived }) => runTool(() => client.call('setTargetArchived', { id, archived })),
  );

  server.registerTool(
    'vantage_resolve_pending',
    {
      title: 'Resolve a "needs result" match',
      description:
        'Complete a held match whose outcome Overwatch never reported, by setting win/loss/draw. '
        + 'It then enters history through the normal pipeline.',
      inputSchema: { matchId: z.string(), result },
      annotations: ADDITIVE,
    },
    async ({ matchId, result: r }) => runTool(() => client.call('resolvePending', { matchId, result: r })),
  );

  // ---------------- destructive ----------------

  server.registerTool(
    'vantage_delete_target',
    {
      title: 'Delete a target permanently',
      description:
        'Permanently removes a target. Prefer vantage_set_target_archived, which is reversible and keeps '
        + 'its grades. Ask the user first.',
      inputSchema: { id: z.string(), confirm },
      annotations: DESTRUCTIVE,
    },
    async ({ id, confirm: c }) => runTool(() => client.call('deleteTarget', { id, confirm: c })),
  );

  server.registerTool(
    'vantage_dismiss_pending',
    {
      title: 'Dismiss a "needs result" match',
      description:
        "Drops a held match without recording it — the user's verdict that it wasn't a real game. "
        + 'It never enters history. Ask the user first.',
      inputSchema: { matchId: z.string(), confirm },
      annotations: DESTRUCTIVE,
    },
    async ({ matchId, confirm: c }) => runTool(() => client.call('dismissPending', { matchId, confirm: c })),
  );

  server.registerTool(
    'vantage_deactivate_all_targets',
    {
      title: 'Deactivate every active target',
      description:
        'Bulk "start a fresh focus" reset — deactivates every active target at once. Ask the user first.',
      inputSchema: { confirm },
      annotations: { ...DESTRUCTIVE, idempotentHint: true },
    },
    async ({ confirm: c }) => runTool(() => client.call('deactivateAllTargets', { confirm: c })),
  );

  server.registerTool(
    'vantage_clear_review',
    {
      title: 'Clear a match review',
      description: 'Removes the saved grades and feel flags from a match. Ask the user first.',
      inputSchema: { matchId: z.string(), confirm },
      annotations: DESTRUCTIVE,
    },
    async ({ matchId, confirm: c }) => runTool(() => client.call('clearReview', { matchId, confirm: c })),
  );
};
