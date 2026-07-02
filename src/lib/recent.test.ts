import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getRecent, pushRecent, removeRecent } from './recent';

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

describe('recent', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  it('starts empty', () => {
    expect(getRecent()).toEqual([]);
  });

  it('adds a person to the front', () => {
    pushRecent({ id: 'a', label: 'Aaron Field' });
    expect(getRecent()).toEqual([{ id: 'a', label: 'Aaron Field' }]);
  });

  it('moves an existing person to the front instead of duplicating', () => {
    pushRecent({ id: 'a', label: 'Aaron Field' });
    pushRecent({ id: 'b', label: 'Beth Green' });
    pushRecent({ id: 'a', label: 'Aaron Field' });
    expect(getRecent().map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('caps the list at 5, dropping the oldest', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) pushRecent({ id, label: id });
    const ids = getRecent().map((p) => p.id);
    expect(ids).toEqual(['f', 'e', 'd', 'c', 'b']);
  });

  it('removes a person by id', () => {
    pushRecent({ id: 'a', label: 'Aaron Field' });
    pushRecent({ id: 'b', label: 'Beth Green' });
    removeRecent('a');
    expect(getRecent().map((p) => p.id)).toEqual(['b']);
  });
});
