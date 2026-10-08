import { describe, it, expect } from 'vitest';
import { linkSplitPeople } from './lib/identity.mjs';

const SMPH = 'School of Medicine and Public Health';
const row = (snapshot_date, person_key, o = {}) => ({ snapshot_date, person_key, school: SMPH, title: 'IT Manager', department: 'Clinical Health Info Inst', salary: 120000, ...o });

describe('linkSplitPeople', () => {
  it('joins a person whose hire date changed between snapshots, under their latest key', () => {
    // Timothy Vertein, as the workbooks have him.
    const rows = [
      row('2024-09-01', 'timothyvertein|2013-09-23'),
      row('2025-04-01', 'timothyvertein|2017-05-08'),
      row('2025-09-01', 'timothyvertein|2017-05-08', { department: 'Administration', salary: 123600 }),
    ];
    const { canon, links } = linkSplitPeople(rows);
    expect([...canon]).toEqual([['timothyvertein|2013-09-23', 'timothyvertein|2017-05-08']]);
    expect(links).toEqual([{ from: 'timothyvertein|2013-09-23', to: 'timothyvertein|2017-05-08', date: '2025-04-01' }]);
  });

  it('joins a rehire in the same department under a new title, and follows a chain to its latest key', () => {
    const rows = [
      row('2023-10-01', 'janedoe|2019-01-01', { title: 'Research Specialist' }),
      row('2024-04-01', 'janedoe|2024-02-01', { title: 'Researcher' }),
      row('2024-09-01', 'janedoe|2024-07-01', { title: 'Researcher' }),
    ];
    expect(Object.fromEntries(linkSplitPeople(rows).canon)).toEqual({ 'janedoe|2019-01-01': 'janedoe|2024-07-01', 'janedoe|2024-02-01': 'janedoe|2024-07-01' });
  });

  it('leaves them apart without the same job: another division, or neither title nor department', () => {
    const elsewhere = [row('2024-09-01', 'a|2013-01-01'), row('2025-04-01', 'a|2017-01-01', { school: 'College of Engineering' })];
    const otherJob = [row('2024-09-01', 'a|2013-01-01'), row('2025-04-01', 'a|2017-01-01', { title: 'Nurse', department: 'Pediatrics' })];
    expect(linkSplitPeople(elsewhere).canon.size).toBe(0);
    expect(linkSplitPeople(otherJob).canon.size).toBe(0);
  });

  it('leaves them apart when someone else has the name in either snapshot, or a snapshot falls between', () => {
    const shared = [row('2024-09-01', 'weiwang|2013-01-01'), row('2024-09-01', 'weiwang|2020-01-01', { school: 'Law School' }), row('2025-04-01', 'weiwang|2017-01-01')];
    const gap = [row('2024-04-01', 'a|2013-01-01'), row('2024-09-01', 'b|2000-01-01'), row('2025-04-01', 'a|2017-01-01')];
    expect(linkSplitPeople(shared).canon.size).toBe(0);
    expect(linkSplitPeople(gap).canon.size).toBe(0);
  });

  it('reads a person by their highest-paid appointment, and counts two snapshots of one date as one', () => {
    // Pre- and post-TTC share a date; a second, smaller appointment elsewhere does not decide.
    const rows = [
      row('2021-11-01', 'a|2013-01-01'), row('2021-11-01', 'a|2013-01-01', { school: 'Law School', title: 'Lecturer', salary: 5000 }),
      row('2022-03-01', 'a|2017-01-01'),
    ];
    expect(linkSplitPeople(rows).canon.get('a|2013-01-01')).toBe('a|2017-01-01');
  });
});
