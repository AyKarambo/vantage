import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseCredentials,
  devKeyFromFile,
  apiKeyFromFile,
  resolveOwCredentials,
} from '../scripts/lib/owCredentials.mjs';

// All fixtures live under a temp dir — never the real ~/.ow-cli — and are
// passed in via the credentialFiles/devKeyFiles override params, which is the
// whole point of resolveOwCredentials() staying pure (no process.env reads
// unless an `env` object is explicitly passed, no hardcoded home dir).
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owcreds-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeCredentials(contents: string): string {
  const file = path.join(dir, 'credentials');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

function writeDevKeyFile(token: string): string {
  const file = path.join(dir, 'dev-key');
  fs.writeFileSync(file, token, 'utf8');
  return file;
}

describe('parseCredentials', () => {
  it('parses [profile] sections into key/value maps', () => {
    const text = '[default]\nemail=a@b.com\napiKey=abc123\n\n[work]\nemail=c@d.com\napiKey=xyz789\n';
    expect(parseCredentials(text)).toEqual({
      default: { email: 'a@b.com', apiKey: 'abc123' },
      work: { email: 'c@d.com', apiKey: 'xyz789' },
    });
  });

  it('ignores garbage/malformed content without throwing', () => {
    expect(parseCredentials('not an ini file at all\n===\n')).toEqual({});
    expect(parseCredentials('')).toEqual({});
  });

  it('ignores key/value lines before any [profile] header', () => {
    expect(parseCredentials('email=orphan@b.com\n[default]\napiKey=k\n')).toEqual({
      default: { apiKey: 'k' },
    });
  });
});

describe('devKeyFromFile', () => {
  it('resolves a devKey= line from a credentials file', () => {
    const credFile = writeCredentials('[default]\ndevKey=tok-from-creds\n');
    expect(devKeyFromFile('default', [credFile], [])).toEqual({
      token: 'tok-from-creds',
      file: `${credFile} [default] devKey`,
    });
  });

  it('falls back to a standalone dev-key file when the credentials file has none', () => {
    const credFile = writeCredentials('[default]\nemail=a@b.com\napiKey=k\n');
    const keyFile = writeDevKeyFile('  standalone-tok  \n');
    expect(devKeyFromFile('default', [credFile], [keyFile])).toEqual({
      token: 'standalone-tok',
      file: keyFile,
    });
  });

  it('returns null when neither source exists', () => {
    expect(devKeyFromFile('default', [path.join(dir, 'missing')], [path.join(dir, 'also-missing')])).toBeNull();
  });
});

describe('apiKeyFromFile', () => {
  it('yields email+apiKey for the requested profile', () => {
    const credFile = writeCredentials('[default]\nemail=a@b.com\napiKey=abc123\n');
    expect(apiKeyFromFile('default', [credFile])).toEqual({ email: 'a@b.com', apiKey: 'abc123', file: credFile });
  });

  it('reads a non-default profile', () => {
    const credFile = writeCredentials('[default]\nemail=a@b.com\napiKey=abc123\n\n[work]\nemail=w@b.com\napiKey=work-key\n');
    expect(apiKeyFromFile('work', [credFile])).toEqual({ email: 'w@b.com', apiKey: 'work-key', file: credFile });
  });

  it('returns null when the profile is missing email or apiKey', () => {
    const credFile = writeCredentials('[default]\nemail=a@b.com\n');
    expect(apiKeyFromFile('default', [credFile])).toBeNull();
  });

  it('returns null for missing/malformed files without throwing', () => {
    expect(apiKeyFromFile('default', [path.join(dir, 'missing')])).toBeNull();
    const garbage = writeCredentials('not an ini file\n');
    expect(apiKeyFromFile('default', [garbage])).toBeNull();
  });
});

describe('resolveOwCredentials', () => {
  it('env OW_DEV_KEY wins over everything, including files on disk', () => {
    const credFile = writeCredentials('[default]\nemail=a@b.com\napiKey=file-key\ndevKey=file-dev-key\n');
    const result = resolveOwCredentials({
      env: { OW_DEV_KEY: 'env-dev-key' },
      credentialFiles: [credFile],
      devKeyFiles: [],
    });
    expect(result).toEqual({ devKey: 'env-dev-key', source: 'env: OW_DEV_KEY (dev key, bearer)' });
  });

  it('env email+apiKey wins over file contents when no OW_DEV_KEY is set', () => {
    const credFile = writeCredentials('[default]\ndevKey=file-dev-key\n');
    const result = resolveOwCredentials({
      env: { OW_CLI_EMAIL: 'env@b.com', OW_CLI_API_KEY: 'env-key' },
      credentialFiles: [credFile],
      devKeyFiles: [],
    });
    expect(result).toEqual({
      email: 'env@b.com',
      apiKey: 'env-key',
      source: 'env: OW_CLI_EMAIL + OW_CLI_API_KEY (api key)',
    });
  });

  it('resolves a dev key from a credentials file when no env is set', () => {
    const credFile = writeCredentials('[default]\ndevKey=file-dev-key\n');
    const result = resolveOwCredentials({ env: {}, credentialFiles: [credFile], devKeyFiles: [] });
    expect(result).toEqual({
      devKey: 'file-dev-key',
      source: `file: ${credFile} [default] devKey (dev key, bearer)`,
    });
  });

  it('resolves email+apiKey from the [default] credentials-file section', () => {
    const credFile = writeCredentials('[default]\nemail=a@b.com\napiKey=file-key\n');
    const result = resolveOwCredentials({ env: {}, credentialFiles: [credFile], devKeyFiles: [] });
    expect(result).toEqual({
      email: 'a@b.com',
      apiKey: 'file-key',
      source: `file: ${credFile} [default] (api key: a@b.com)`,
    });
  });

  it('reads a non-default profile selected via OW_PROFILE', () => {
    const credFile = writeCredentials('[default]\nemail=a@b.com\napiKey=default-key\n\n[work]\nemail=w@b.com\napiKey=work-key\n');
    const result = resolveOwCredentials({
      env: { OW_PROFILE: 'work' },
      credentialFiles: [credFile],
      devKeyFiles: [],
    });
    expect(result).toEqual({
      email: 'w@b.com',
      apiKey: 'work-key',
      source: `file: ${credFile} [work] (api key: w@b.com)`,
    });
  });

  it('resolves to null when no credential source exists anywhere, without throwing', () => {
    const result = resolveOwCredentials({
      env: {},
      credentialFiles: [path.join(dir, 'missing')],
      devKeyFiles: [path.join(dir, 'also-missing')],
    });
    expect(result).toBeNull();
  });

  it('resolves to null for malformed/garbage credentials-file content, without throwing', () => {
    const garbage = writeCredentials('this is not { valid ini === garbage\n');
    expect(() =>
      resolveOwCredentials({ env: {}, credentialFiles: [garbage], devKeyFiles: [] })
    ).not.toThrow();
    const result = resolveOwCredentials({ env: {}, credentialFiles: [garbage], devKeyFiles: [] });
    expect(result).toBeNull();
  });
});
