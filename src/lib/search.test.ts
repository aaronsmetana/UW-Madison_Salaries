import { describe, expect, it } from 'vitest';
import { matchRank, matchTitles, matchDivisions, enterPick } from './search';
import type { SearchIndex } from './manifest';

const INDEX: SearchIndex = {
  snapshot: '2026-03',
  label: 'Mar 2026',
  titles: [
    ['FA020', 'Professor', 1251, 216964],
    ['IT037', 'System Engineer I', 3, 65649],
    ['IT038', 'System Engineer II', 24, 80688],
    ['IT039', 'System Engineer III', 42, 102385],
    ['IT040', 'System Engineer IV', 48, 116991],
    ['IT050', 'Systems Analyst', 60, 90000],
    ['FA040', 'Assistant Professor', 654, 139321],
  ],
  divisions: [
    ['School of Medicine and Public Health', 5840, 72107],
    ['School of Veterinary Medicine', 700, 62000],
    ['College of Letters & Science', 2715, 97790],
  ],
};

describe('matchRank', () => {
  it('ranks the whole text, then its start, then word starts, then anywhere', () => {
    expect(matchRank('Professor', 'professor')).toBe(0);
    expect(matchRank('Professor', 'prof')).toBe(1);
    expect(matchRank('Assistant Professor', 'prof')).toBe(2);
    expect(matchRank('Assistant Professor', 'fess')).toBe(3);
  });
  it('needs every word, in any order', () => {
    expect(matchRank('System Engineer IV', 'engineer system')).toBe(2);
    expect(matchRank('Systems Analyst', 'system engineer')).toBeNull();
  });
});

describe('matchTitles', () => {
  it('gives the largest of equally close titles first', () => {
    expect(matchTitles(INDEX, 'system engineer').map((t) => t.code)).toEqual(['IT040', 'IT039', 'IT038', 'IT037']);
  });
  it('finds a title by its job code', () => {
    expect(matchTitles(INDEX, 'it040')[0]).toEqual({ code: 'IT040', title: 'System Engineer IV', n: 48, med: 116991 });
  });
  it('puts a title that starts with the query before a larger one that only contains it', () => {
    expect(matchTitles(INDEX, 'prof').map((t) => t.code)).toEqual(['FA020', 'FA040']);
  });
  it('waits for two characters', () => {
    expect(matchTitles(INDEX, 's')).toEqual([]);
  });
});

describe('matchDivisions', () => {
  it('finds a division by a word in its name, the largest first', () => {
    expect(matchDivisions(INDEX, 'medicine').map((d) => d.school)).toEqual(['School of Medicine and Public Health', 'School of Veterinary Medicine']);
  });
  it('offers nothing before the index loads', () => {
    expect(matchDivisions(undefined, 'medicine')).toEqual([]);
  });
});

describe('enterPick', () => {
  it('opens the active row once people have answered', () => {
    expect(enterPick(0, 3, false, false)).toBe(0);
  });
  it('waits while people are still being searched, unless the reader chose a row', () => {
    expect(enterPick(0, 3, true, false)).toBe('wait');
    // Even with nothing to show yet: the person may be about to arrive.
    expect(enterPick(0, 0, true, false)).toBe('wait');
    expect(enterPick(1, 3, true, true)).toBe(1);
  });
  it('opens nothing when there is no row', () => {
    expect(enterPick(0, 0, false, false)).toBeNull();
  });
});
