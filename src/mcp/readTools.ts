import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PipeClient } from './pipeClient';
import { runTool, toolError, type ToolRegistrar } from './server';

/**
 * The read surface: everything a coach can learn about the player.
 *
 * Every tool is annotated `readOnlyHint: true` and `openWorldHint: false` — the
 * data never leaves the machine and nothing here mutates. Results arrive
 * wrapped in the app's read envelope, so the `demo` flag rides along with the
 * payload and the model can see when it is looking at generated sample data.
 */

/** Mirrors DashboardFilters — the same filter bar the app's own screens use. */
const filters = z
  .object({
    account: z.string().describe("Account name, or 'all'.").optional(),
    role: z.string().describe("'all' | tank | damage | support | openQ.").optional(),
    days: z
      .union([z.number(), z.literal('all'), z.object({ season: z.string() })])
      .describe("Trailing day count, 'all' time, or { season: 'S:YYYY-MM-DD' }.")
      .optional(),
  })
  .describe('Optional filter set; omit for the default window.')
  .optional();

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export const registerReadTools: ToolRegistrar = (server: McpServer, client: PipeClient) => {
  server.registerTool(
    'vantage_dashboard',
    {
      title: 'Vantage dashboard',
      description:
        'The full coaching picture for a filter set: map and hero priority, win/loss trend, streak, '
        + 'session recap, mental/tilt signals and active improvement targets. Start here.',
      inputSchema: { filters },
      annotations: READ_ONLY,
    },
    async ({ filters: f }) => runTool(() => client.call('dashboard', { filters: f })),
  );

  server.registerTool(
    'vantage_hero_detail',
    {
      title: 'Hero detail',
      description: 'Per-hero stats over the filtered, competitive-only history.',
      inputSchema: { hero: z.string().describe('Hero name, e.g. "Tracer".'), filters },
      annotations: READ_ONLY,
    },
    async ({ hero, filters: f }) => runTool(() => client.call('heroDetail', { hero, filters: f })),
  );

  server.registerTool(
    'vantage_match_detail',
    {
      title: 'Match detail',
      description:
        'Full drill-down for one match: heroes, roster, rank movement and target grades. '
        + 'Returns null data when the id is unknown.',
      inputSchema: { matchId: z.string().describe('Match id from a dashboard or match list.'), filters },
      annotations: READ_ONLY,
    },
    async ({ matchId, filters: f }) => runTool(() => client.call('matchDetail', { matchId, filters: f })),
  );

  server.registerTool(
    'vantage_player_history',
    {
      title: 'Player history',
      description:
        'Every stored match shared with a given player (teammate or opponent), by BattleTag or name. '
        + 'Useful for "how do I do when X is on my team?".',
      inputSchema: { name: z.string().describe('Player name or BattleTag.') },
      annotations: READ_ONLY,
    },
    async ({ name }) => runTool(() => client.call('playerHistory', { name })),
  );

  server.registerTool(
    'vantage_ranks',
    {
      title: 'Current ranks',
      description: 'Computed current rank per tracked account and role.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runTool(() => client.call('ranks', {})),
  );

  server.registerTool(
    'vantage_master_data',
    {
      title: 'Heroes, maps and seasons',
      description:
        'The effective hero/map/season catalog. Use it to resolve valid names before logging a match.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runTool(() => client.call('masterData', {})),
  );

  server.registerTool(
    'vantage_status',
    {
      title: 'Live tracking status',
      description: 'Whether Overwatch is being tracked right now, and the connection/data-flow state.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runTool(() => client.call('status', {})),
  );

  // A resource as well as a tool: an MCP client can attach a resource as
  // ambient context without the model having to decide to call something, which
  // suits "what should I work on?" better than a tool round-trip.
  server.registerResource(
    'dashboard',
    'vantage://dashboard',
    {
      title: 'Vantage dashboard snapshot',
      description:
        "The current dashboard payload for the default window, including the `demo` flag. "
        + 'Read this for instant context on the player without calling a tool.',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const data = await client.call('dashboard', {});
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        // A resource read has no isError channel, so the failure is surfaced as
        // its content — the model still gets a usable explanation.
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: toolError(err).content[0].text }],
        };
      }
    },
  );
};
