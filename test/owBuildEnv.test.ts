import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveBuildKey, resolveBuildEnv } from '../scripts/ow-build-env.mjs';

// All fixtures live under a temp dir — never the real ~/.ow-cli — and are passed
// in via the buildKeyFiles/credentialFiles/devKeyFiles override params, which is
// the whole point of resolveBuildEnv() staying pure. This machine genuinely has
// no ~/.ow-cli directory, but these tests must not depend on that either way.
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owbuildenv-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeBuildKeyFile(contents: string): string {
  const file = path.join(dir, 'build-key');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

function writeCredentials(contents: string): string {
  const file = path.join(dir, 'credentials');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

describe('resolveBuildKey', () => {
  it('resolves from env.OW_BUILD_KEY', () => {
    expect(resolveBuildKey({ env: { OW_BUILD_KEY: 'env-build-key' }, buildKeyFiles: [] })).toBe('env-build-key');
  });

  it('falls back to a standalone build-key file when the env var is absent', () => {
    const keyFile = writeBuildKeyFile('  file-build-key  \n');
    expect(resolveBuildKey({ env: {}, buildKeyFiles: [keyFile] })).toBe('file-build-key');
  });

  it('env build key wins over the file', () => {
    const keyFile = writeBuildKeyFile('file-build-key');
    expect(
      resolveBuildKey({ env: { OW_BUILD_KEY: 'env-build-key' }, buildKeyFiles: [keyFile] })
    ).toBe('env-build-key');
  });

  it('treats a missing file as absent, without throwing', () => {
    expect(() => resolveBuildKey({ env: {}, buildKeyFiles: [path.join(dir, 'missing')] })).not.toThrow();
    expect(resolveBuildKey({ env: {}, buildKeyFiles: [path.join(dir, 'missing')] })).toBeUndefined();
  });

  it('treats an empty file as absent, without throwing', () => {
    const keyFile = writeBuildKeyFile('');
    expect(resolveBuildKey({ env: {}, buildKeyFiles: [keyFile] })).toBeUndefined();
  });

  it('treats a whitespace-only file as absent, without throwing', () => {
    const keyFile = writeBuildKeyFile('   \n\t  ');
    expect(resolveBuildKey({ env: {}, buildKeyFiles: [keyFile] })).toBeUndefined();
  });

  it('falls through an empty first file to a non-empty second file', () => {
    const empty = writeBuildKeyFile('');
    const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owbuildenv-second-'));
    const secondFile = path.join(secondDir, 'build-key');
    fs.writeFileSync(secondFile, 'second-build-key', 'utf8');
    try {
      expect(resolveBuildKey({ env: {}, buildKeyFiles: [empty, secondFile] })).toBe('second-build-key');
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true });
    }
  });
});

describe('resolveBuildEnv', () => {
  it('resolves all three from env, leaving missing empty', () => {
    const result = resolveBuildEnv({
      env: { OW_CLI_EMAIL: 'a@b.com', OW_CLI_API_KEY: 'api-key', OW_BUILD_KEY: 'build-key' },
      credentialFiles: [],
      devKeyFiles: [],
      buildKeyFiles: [],
    });
    expect(result).toEqual({
      email: 'a@b.com',
      apiKey: 'api-key',
      buildKey: 'build-key',
      missing: [],
    });
  });

  it('resolves OW_BUILD_KEY from the build-key file when the env var is absent', () => {
    const keyFile = writeBuildKeyFile('file-build-key');
    const result = resolveBuildEnv({
      env: { OW_CLI_EMAIL: 'a@b.com', OW_CLI_API_KEY: 'api-key' },
      credentialFiles: [],
      devKeyFiles: [],
      buildKeyFiles: [keyFile],
    });
    expect(result).toEqual({
      email: 'a@b.com',
      apiKey: 'api-key',
      buildKey: 'file-build-key',
      missing: [],
    });
  });

  it('prefers the env build key over the file', () => {
    const keyFile = writeBuildKeyFile('file-build-key');
    const result = resolveBuildEnv({
      env: { OW_CLI_EMAIL: 'a@b.com', OW_CLI_API_KEY: 'api-key', OW_BUILD_KEY: 'env-build-key' },
      credentialFiles: [],
      devKeyFiles: [],
      buildKeyFiles: [keyFile],
    });
    expect(result.buildKey).toBe('env-build-key');
    expect(result.missing).toEqual([]);
  });

  it('reports exactly OW_BUILD_KEY missing when only the build key is unresolved', () => {
    const result = resolveBuildEnv({
      env: { OW_CLI_EMAIL: 'a@b.com', OW_CLI_API_KEY: 'api-key' },
      credentialFiles: [],
      devKeyFiles: [],
      buildKeyFiles: [path.join(dir, 'missing')],
    });
    expect(result.missing).toEqual(['OW_BUILD_KEY']);
    expect(result.email).toBe('a@b.com');
    expect(result.apiKey).toBe('api-key');
    expect(result.buildKey).toBeUndefined();
  });

  it('lists all three names in missing when nothing resolves anywhere, without throwing', () => {
    expect(() =>
      resolveBuildEnv({
        env: {},
        credentialFiles: [path.join(dir, 'missing-creds')],
        devKeyFiles: [path.join(dir, 'missing-devkey')],
        buildKeyFiles: [path.join(dir, 'missing-buildkey')],
      })
    ).not.toThrow();
    const result = resolveBuildEnv({
      env: {},
      credentialFiles: [path.join(dir, 'missing-creds')],
      devKeyFiles: [path.join(dir, 'missing-devkey')],
      buildKeyFiles: [path.join(dir, 'missing-buildkey')],
    });
    expect(result).toEqual({ missing: ['OW_CLI_EMAIL', 'OW_CLI_API_KEY', 'OW_BUILD_KEY'] });
  });

  it('does not let a dev-key-only resolution satisfy email/apiKey', () => {
    const credFile = writeCredentials('[default]\ndevKey=file-dev-key\n');
    const keyFile = writeBuildKeyFile('file-build-key');
    const result = resolveBuildEnv({
      env: {},
      credentialFiles: [credFile],
      devKeyFiles: [],
      buildKeyFiles: [keyFile],
    });
    expect(result.email).toBeUndefined();
    expect(result.apiKey).toBeUndefined();
    expect(result.buildKey).toBe('file-build-key');
    expect(result.missing).toEqual(['OW_CLI_EMAIL', 'OW_CLI_API_KEY']);
  });

  it('treats a missing/empty/whitespace-only build-key file as absent, without throwing', () => {
    const missing = path.join(dir, 'missing-buildkey');
    const empty = writeBuildKeyFile('');
    const whitespaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owbuildenv-ws-'));
    const whitespaceFile = path.join(whitespaceDir, 'build-key');
    fs.writeFileSync(whitespaceFile, '   \n\t  ', 'utf8');
    try {
      for (const buildKeyFiles of [[missing], [empty], [whitespaceFile]]) {
        expect(() =>
          resolveBuildEnv({
            env: { OW_CLI_EMAIL: 'a@b.com', OW_CLI_API_KEY: 'api-key' },
            credentialFiles: [],
            devKeyFiles: [],
            buildKeyFiles,
          })
        ).not.toThrow();
        const result = resolveBuildEnv({
          env: { OW_CLI_EMAIL: 'a@b.com', OW_CLI_API_KEY: 'api-key' },
          credentialFiles: [],
          devKeyFiles: [],
          buildKeyFiles,
        });
        expect(result.buildKey).toBeUndefined();
        expect(result.missing).toEqual(['OW_BUILD_KEY']);
      }
    } finally {
      fs.rmSync(whitespaceDir, { recursive: true, force: true });
    }
  });
});
