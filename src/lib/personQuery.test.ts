import { describe, it, expect } from 'vitest';
import { latestRows, latestMain, otherAppts, apptTerms } from './personQuery';

type R = { snapshot_id: string; snapshot_date: string; job_code: string; title: string; salary: number; salary_fte_adjusted: number | null; fte: number | null };
const r = (snapshot_id: string, snapshot_date: string, job_code: string, salary: number, fte: number | null): R =>
  ({ snapshot_id, snapshot_date, job_code, title: `Title ${job_code}`, salary, salary_fte_adjusted: null, fte });

// Brett Van Ess in Sep 2026: a salaried directorship, and hourly crowd control on a higher annualized figure
// than half of it. Fetched oldest first, the hourly row last — the row the page used to name him by.
const BRETT = [
  r('2026-03', '2026-03-01', 'CP052', 110313, 1),
  r('2026-09', '2026-09-01', 'CP052', 135023.52, 1),
  r('2026-09', '2026-09-01', 'TE007', 89440, 0),
];

describe('latestMain', () => {
  it('names a person by the main appointment of their latest snapshot, not the last row fetched', () => {
    expect(latestMain(BRETT)?.job_code).toBe('CP052');
    expect(latestMain(BRETT)?.snapshot_id).toBe('2026-09');
    expect(latestMain([...BRETT].reverse())?.job_code).toBe('CP052');
  });
  it('takes the post-TTC twin over the pre-TTC one of the same date, in either order', () => {
    const twins = [r('2021-11-post', '2021-11-01', 'NEW', 50000, 1), r('2021-11-pre', '2021-11-01', 'OLD', 50000, 1)];
    expect(latestRows(twins).map((x) => x.job_code)).toEqual(['NEW']);
    expect(latestRows([...twins].reverse()).map((x) => x.job_code)).toEqual(['NEW']);
  });
  it('is nothing for nobody', () => {
    expect(latestMain([])).toBeUndefined();
  });
});

describe('otherAppts', () => {
  it('lists the rest, the next most main first', () => {
    const rows = [r('s', '2026-09-01', 'H1', 40000, 0), r('s', '2026-09-01', 'J1', 60000, 0.5), r('s', '2026-09-01', 'J2', 90000, 1), r('s', '2026-09-01', 'J3', 50000, 0.25)];
    expect(otherAppts(rows).map((x) => x.job_code)).toEqual(['J1', 'J3', 'H1']);
    expect(otherAppts(latestRows(BRETT)).map((x) => x.job_code)).toEqual(['TE007']);
    expect(otherAppts([BRETT[0]])).toEqual([]);
  });
});

describe('apptTerms', () => {
  it('says an hourly job by its rate, a salaried one by its FTE, and an unpaid one as such', () => {
    expect(apptTerms({ salary: 89440, fte: 0 })).toBe('hourly, $43.00/hr');
    expect(apptTerms({ salary: 60000, fte: 0.5 })).toBe('50% FTE');
    expect(apptTerms({ salary: 0, fte: 1 })).toBe('unpaid');
  });
  it('says of an hourly job actual pay leaves out that it does', () => {
    expect(apptTerms({ salary: 89440, fte: 0 }, false)).toBe('hourly, $43.00/hr; hours not reported, not in actual pay');
    expect(apptTerms({ salary: 60000, fte: 0.5 }, false)).toBe('50% FTE');
  });
});
