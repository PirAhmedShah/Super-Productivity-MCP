import { describe, it, expect } from 'vitest';
import { isAtLeast, MIN_SUP_VERSION } from '../../../plugin/plugin.js';

// Regression: plugin 1.8.0 dropped all legacy support paths (marker-only timer fallback,
// legacy plannedAt reads, getAppState workarounds) and hard-gates on SP 18.16.0+ so old
// builds get a clear error instead of silently degraded behavior.

describe('version gate', () => {
  it('accepts the minimum supported version exactly', () => {
    expect(isAtLeast('18.16.0', MIN_SUP_VERSION)).toBe(true);
  });

  it('accepts newer versions', () => {
    expect(isAtLeast('18.16.1', MIN_SUP_VERSION)).toBe(true);
    expect(isAtLeast('19.0.0', MIN_SUP_VERSION)).toBe(true);
    expect(isAtLeast('18.100.0', MIN_SUP_VERSION)).toBe(true);
  });

  it('rejects older versions', () => {
    expect(isAtLeast('18.15.9', MIN_SUP_VERSION)).toBe(false);
    expect(isAtLeast('17.16.0', MIN_SUP_VERSION)).toBe(false);
    expect(isAtLeast('14.0.0', MIN_SUP_VERSION)).toBe(false);
  });

  it('handles partial version strings', () => {
    expect(isAtLeast('18.16', MIN_SUP_VERSION)).toBe(true);
    expect(isAtLeast('18', MIN_SUP_VERSION)).toBe(false);
  });

  it('handles unknown/missing versions as below the floor', () => {
    expect(isAtLeast(null, MIN_SUP_VERSION)).toBe(false);
    expect(isAtLeast(undefined, MIN_SUP_VERSION)).toBe(false);
    expect(isAtLeast('', MIN_SUP_VERSION)).toBe(false);
  });
});
