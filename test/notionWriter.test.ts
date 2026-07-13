import { describe, it, expect, vi } from 'vitest';
import { NotionWriter, type ResolvedMatch } from '../src/notion/notionWriter';
import { emptyMatch } from '../src/core/model';
import type { MatchMental } from '../src/core/analytics';

/** A client whose pages.create/update just capture the payload they were sent. */
function stubClient() {
  const create = vi.fn().mockResolvedValue({ id: 'new-page-id' });
  const update = vi.fn().mockResolvedValue(undefined);
  return { client: { pages: { create, update } } as any, create, update };
}

/** A ResolvedMatch with the two subjective selects optionally set. */
function resolved(opts: { mental?: MatchMental; grade?: 'hit' | 'partial' | 'missed' } = {}): ResolvedMatch {
  return { record: emptyMatch('m1'), mental: opts.mental, improvementGrade: opts.grade };
}

const BOTH_SELECTS = new Set(['Comms', 'Improvement Target']);

describe('NotionWriter — "none" option for unset subjective selects (spec E2)', () => {
  it('writes the discovered None option (verbatim casing) for unset Comms + Improvement Target on CREATE', async () => {
    const { client, create } = stubClient();
    const writer = new NotionWriter(client, 'db', false, BOTH_SELECTS, false, undefined, {
      Comms: ['positive', 'None'],
      'Improvement Target': ['hit', 'None'],
    });

    await writer.createMatchPage(resolved()); // neither set

    const props = create.mock.calls[0][0].properties;
    expect(props['Comms']).toEqual({ select: { name: 'None' } });
    expect(props['Improvement Target']).toEqual({ select: { name: 'None' } });
  });

  it('writes the discovered None option for unset selects on UPDATE too', async () => {
    const { client, update } = stubClient();
    const writer = new NotionWriter(client, 'db', false, BOTH_SELECTS, false, undefined, {
      Comms: ['None'],
      'Improvement Target': ['None'],
    });

    await writer.updateMatchPage('page-1', resolved());

    const props = update.mock.calls[0][0].properties;
    expect(props['Comms']).toEqual({ select: { name: 'None' } });
    expect(props['Improvement Target']).toEqual({ select: { name: 'None' } });
  });

  it('matches the none option case-insensitively and echoes the DB casing verbatim', async () => {
    const { client, create } = stubClient();
    const writer = new NotionWriter(client, 'db', false, BOTH_SELECTS, false, undefined, {
      Comms: ['NONE'], // upper-cased in the DB
      'Improvement Target': ['none'], // lower-cased in the DB
    });

    await writer.createMatchPage(resolved());

    const props = create.mock.calls[0][0].properties;
    expect(props['Comms']).toEqual({ select: { name: 'NONE' } });
    expect(props['Improvement Target']).toEqual({ select: { name: 'none' } });
  });

  it('picks the FIRST none-like option when several exist', async () => {
    const { client, create } = stubClient();
    const writer = new NotionWriter(client, 'db', false, BOTH_SELECTS, false, undefined, {
      Comms: ['None', 'none'],
      'Improvement Target': [],
    });

    await writer.createMatchPage(resolved());

    expect(create.mock.calls[0][0].properties['Comms']).toEqual({ select: { name: 'None' } });
  });

  it('keeps blank behaviour (omit on create, select:null on update) when no none-like option exists — never auto-creates one', async () => {
    const { client, create, update } = stubClient();
    const writer = new NotionWriter(client, 'db', false, BOTH_SELECTS, false, undefined, {
      Comms: ['positive', 'abusive'], // no "none"
      'Improvement Target': ['hit', 'missed'],
    });

    await writer.createMatchPage(resolved());
    await writer.updateMatchPage('page-1', resolved());

    const createProps = create.mock.calls[0][0].properties;
    expect(createProps).not.toHaveProperty('Comms'); // omitted on create
    expect(createProps).not.toHaveProperty('Improvement Target');

    const updateProps = update.mock.calls[0][0].properties;
    expect(updateProps['Comms']).toEqual({ select: null }); // blanked on update
    expect(updateProps['Improvement Target']).toEqual({ select: null });
  });

  it('never overwrites a column that HAS a value with "none"', async () => {
    const { client, create } = stubClient();
    const writer = new NotionWriter(client, 'db', false, BOTH_SELECTS, false, undefined, {
      Comms: ['positive', 'None'],
      'Improvement Target': ['hit', 'None'],
    });

    await writer.createMatchPage(resolved({ mental: { comms: 'positive' }, grade: 'hit' }));

    const props = create.mock.calls[0][0].properties;
    expect(props['Comms']).toEqual({ select: { name: 'positive' } });
    expect(props['Improvement Target']).toEqual({ select: { name: 'hit' } });
  });

  it('does not apply the "none" rule to Leaver (Comms + Improvement Target only)', async () => {
    const { client, create } = stubClient();
    const writer = new NotionWriter(client, 'db', false, new Set(['Leaver']), false, undefined, {
      // Even if Leaver somehow offered a none option, the writer must not use it.
      Leaver: ['team', 'enemy', 'None'] as string[],
    } as any);

    await writer.createMatchPage(resolved()); // no leaver flags

    expect(create.mock.calls[0][0].properties).not.toHaveProperty('Leaver');
  });

  it('omits the selects entirely when the columns are not writable, regardless of options', async () => {
    const { client, create } = stubClient();
    const writer = new NotionWriter(client, 'db', false, new Set(), false, undefined, {
      Comms: ['None'],
      'Improvement Target': ['None'],
    });

    await writer.createMatchPage(resolved());

    const props = create.mock.calls[0][0].properties;
    expect(props).not.toHaveProperty('Comms');
    expect(props).not.toHaveProperty('Improvement Target');
  });
});
