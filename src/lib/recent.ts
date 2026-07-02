export interface RecentPerson {
  id: string;
  label: string;
}

const KEY = 'uwsal.recent.v1';
const MAX = 5;

function read(): RecentPerson[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Most-recently-viewed first, capped at 5 — repeat lookups are this audience's core loop. */
export function getRecent(): RecentPerson[] {
  return read();
}

/** Moves `person` to the front (de-duplicating by id) and trims to the cap. */
export function pushRecent(person: RecentPerson): void {
  const next = [person, ...read().filter((p) => p.id !== person.id)].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function removeRecent(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(read().filter((p) => p.id !== id)));
}
