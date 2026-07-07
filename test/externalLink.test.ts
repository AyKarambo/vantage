import { describe, it, expect, vi } from 'vitest';
import { isAllowedExternalUrl, openIfAllowed } from '../src/core/externalLink';

describe('isAllowedExternalUrl', () => {
  it('allows mailto and https', () => {
    expect(isAllowedExternalUrl('mailto:timo.seikel@gmail.com')).toBe(true);
    expect(isAllowedExternalUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('rejects unsafe, plaintext, or malformed URLs', () => {
    for (const u of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://insecure.example',
      'C:\\Windows\\System32',
      'not a url',
      '',
    ]) {
      expect(isAllowedExternalUrl(u)).toBe(false);
    }
  });
});

describe('openIfAllowed', () => {
  it('opens an allowed URL and reports success', async () => {
    const open = vi.fn();
    await expect(openIfAllowed('mailto:a@b.com', open)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('mailto:a@b.com');
  });

  it('never calls open for a disallowed URL', async () => {
    const open = vi.fn();
    await expect(openIfAllowed('file:///secret', open)).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
