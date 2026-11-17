import { describe, expect, it } from 'vitest';
import {
  externalAppIframePolicy,
  PERMISSION_OPTIONS,
  readPermissionOptions,
  readSandboxOptions,
  SANDBOX_OPTIONS,
  togglePolicyOption,
} from '../src/state/externalAppPolicy';

const BASE = 'allow-scripts allow-same-origin allow-forms allow-downloads';

describe('externalAppIframePolicy', () => {
  it('an entry without the optional lists gets exactly the base policy', () => {
    expect(externalAppIframePolicy({})).toEqual({ sandbox: BASE, allow: undefined });
    expect(externalAppIframePolicy({ sandbox: [], allow: [] })).toEqual({ sandbox: BASE, allow: undefined });
  });

  it('sandbox opt-ins append their tokens in declared order; popups escape the sandbox', () => {
    const p = externalAppIframePolicy({ sandbox: ['storage-access', 'popups'] });
    expect(p.sandbox).toBe(
      `${BASE} allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation`,
    );
    expect(p.sandbox).not.toContain('top-navigation');
  });

  it('permissions join the way Permissions Policy expects', () => {
    expect(externalAppIframePolicy({ allow: ['fullscreen', 'camera'] }).allow).toBe('camera; fullscreen');
  });
});

describe('readSandboxOptions / readPermissionOptions', () => {
  it('keeps known options, dedupes, and reports the unknown ones', () => {
    expect(readSandboxOptions(['modals', 'modals', 'allow-top-navigation', 7])).toEqual({
      list: ['modals'],
      unknown: ['allow-top-navigation', '7'],
    });
    expect(readPermissionOptions(['payment', 'usb'])).toEqual({ list: ['payment'], unknown: ['usb'] });
  });

  it('treats a missing or non-array value as empty', () => {
    expect(readSandboxOptions(undefined)).toEqual({ list: [], unknown: [] });
    expect(readPermissionOptions('camera')).toEqual({ list: [], unknown: [] });
  });
});

describe('togglePolicyOption', () => {
  it('adds and removes while keeping declared order', () => {
    const on = togglePolicyOption(['modals'], SANDBOX_OPTIONS, 'popups', true);
    expect(on).toEqual(['popups', 'modals']);
    expect(togglePolicyOption(on, SANDBOX_OPTIONS, 'modals', false)).toEqual(['popups']);
    expect(togglePolicyOption(undefined, PERMISSION_OPTIONS, 'clipboard-write', true)).toEqual(['clipboard-write']);
  });
});
