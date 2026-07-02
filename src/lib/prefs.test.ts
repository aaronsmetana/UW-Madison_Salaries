import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readPref } from './prefs';

// vitest runs in a plain Node environment here (no jsdom), so localStorage doesn't exist — stub a
// minimal in-memory implementation for this test file only.
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  } as Storage;
}

describe('readPref', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  it('returns the fallback when nothing is stored', () => {
    expect(readPref('dollarMode', 'nominal')).toBe('nominal');
  });

  it('returns a previously-written value under the app-prefixed key', () => {
    localStorage.setItem('uwsal.pref.dollarMode', JSON.stringify('real'));
    expect(readPref('dollarMode', 'nominal')).toBe('real');
  });

  it('reads a value written for one key independently of another key', () => {
    localStorage.setItem('uwsal.pref.dollarMode', JSON.stringify('real'));
    expect(readPref('scaleMode', 'linear')).toBe('linear');
  });

  it('falls back to the given default when the stored value is corrupt JSON', () => {
    localStorage.setItem('uwsal.pref.dollarMode', 'not-json{');
    expect(readPref('dollarMode', 'nominal')).toBe('nominal');
  });
});
