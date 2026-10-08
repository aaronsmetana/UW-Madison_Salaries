import { describe, it, expect } from 'vitest';
import { briefToWordHtml, htmlToPlainText } from './wordExport';
import type { BriefModel, MatchSide } from '../components/report/model';

function baseModel(overrides: Partial<BriefModel> = {}): BriefModel {
  return {
    subjectName: 'Jordan Rivers',
    subjectFirst: 'Jordan',
    subjectPay: 68_000,
    headerMeta: 'Senior Analyst · College of Letters & Science',
    generated: 'Jul 19, 2026',
    snapLabel: 'May 2026',
    recommended: 78_000,
    belowTarget: true,
    targetDelta: 10_000,
    targetPct: 0.147,
    basisLabel: 'to reach the median of all UW–Madison employees with this title',
    receipt: [
      { id: 'base', label: 'Base parity target', amount: 75_000, kind: 'base' },
      { id: 'credentials', label: 'Certifications & education', amount: 3_000, kind: 'addon' },
    ],
    activeFactors: [
      { key: 'credentials', label: 'Certifications & education', note: 'AWS Solutions Architect', amount: 3_000 },
    ],
    proofs: [
      { kind: 'market', value: '30th percentile', label: 'Current pay sits below the title median.', detail: 'n = 12' },
    ],
    yearsToParity: 4.2,
    yearsToParityRate: 0.02,
    yearsToParityObserved: false,
    realErosion: { firstYear: 2021, nominalPct: 0.08, realPct: -0.05 },
    rows: [
      { key: 'subj', name: 'Jordan Rivers', title: 'Senior Analyst', pay: 68_000, tenure: 6.2, isSubject: true, isAnomaly: false, lessTenure: false, gap: 0 },
      { key: 'p1', name: 'Alex Chen', title: 'Senior Analyst', pay: 79_000, tenure: 2.1, isSubject: false, isAnomaly: true, lessTenure: true, gap: 11_000 },
      { key: 'p2', name: 'Sam Lee', title: 'Senior Analyst', pay: 72_000, tenure: 8.4, isSubject: false, isAnomaly: false, lessTenure: false, gap: 4_000 },
    ],
    maxPay: 79_000,
    showTenure: true,
    anonymize: false,
    attrition: { leftN: 3, ofN: 20, fromLabel: 'May 2024', toLabel: 'May 2026' },
    divergence: { avgAbs: 9_000, subjAbs: 4_000 },
    history: [
      { date: '2024-05-01', pay: 64_000, med: 70_000 },
      { date: '2026-05-01', pay: 68_000, med: 74_000 },
    ],
    format: 'detailed',
    sections: ['highlights', 'guidelineBasis', 'standing', 'factors', 'peers', 'history', 'risk'],
    jobCode: 'J1234',
    supervisory: { reports: [{ key: 'r1', name: 'Riley Park', pay: 71_000, differential: 0.04, inverted: true, belowFloor: true }], invertedCount: 1, top: { key: 'r1', name: 'Riley Park', pay: 71_000, differential: 0.04, inverted: true, belowFloor: true }, target15: 81_650 },
    guidelineCompression: { threshold: 0.05, gapYears: 5, count: 2, invertedCount: 1, n: 3, maxPeerPay: 74_000, exempt: true },
    marketPosition: null,
    guidelineProvisions: [
      { key: 'parity', name: 'Parity adjustment', quote: 'Balanced salary relationships should be maintained…', supportedBy: 'the market-standing and peer-comparison evidence above' },
    ],
    cohortBasisScoped: true,
    standing: {
      min: 60_000, p25: 64_000, med: 70_000, p75: 76_000, max: 82_000,
      values: [60_000, 64_000, 68_000, 70_000, 76_000, 82_000],
      cohortLabel: 'all UW–Madison employees with this title',
      pools: [{ label: 'All UW–Madison', n: 40, med: 70_000, percentile: 30, gapToMed: 2_000 }],
    },
    tenureRegression: null,
    match: null,
    tenureScatterPoints: [],
    raiseCycle: { n: 10, medianPct: 0.03, subjectPct: 0.01, fromLabel: 'May 2024', toLabel: 'May 2026', annualRate: 0.015, dist: [{ bucket: 0, n: 2 }, { bucket: 3, n: 6 }], subjectBucket: 0 },
    ...overrides,
  };
}

describe('briefToWordHtml', () => {
  it('renders every section heading present in the model', () => {
    const html = briefToWordHtml(baseModel());
    expect(html).toContain('Pay Parity Review');
    expect(html).toContain('Recommendation');
    expect(html).toContain('Basis under the UW Salary Administration Guidelines');
    expect(html).toContain('Grounds for a parity / compression adjustment');
    expect(html).toContain('Market standing');
    expect(html).toContain('Documented qualifications');
    expect(html).toContain('Peer comparison');
    expect(html).toContain('Pay history');
    expect(html).toContain('Retention &amp; replacement cost');
    expect(html).toContain('Notes &amp; sources');
  });

  it('never emits undefined/NaN/[object Object] placeholders', () => {
    const html = briefToWordHtml(baseModel());
    expect(html).not.toMatch(/undefined/);
    expect(html).not.toMatch(/NaN/);
    expect(html).not.toMatch(/\[object Object\]/);
  });

  it('masks comparator names when anonymize is true, but never the subject', () => {
    const html = briefToWordHtml(baseModel({ anonymize: true }));
    expect(html).not.toContain('Alex Chen');
    expect(html).not.toContain('Sam Lee');
    expect(html).toContain('Peer A');
    expect(html).toContain('Jordan Rivers'); // subject name always shown
  });

  it('shows real comparator names when anonymize is false', () => {
    const html = briefToWordHtml(baseModel({ anonymize: false }));
    expect(html).toContain('Alex Chen');
    expect(html).toContain('Sam Lee');
  });

  it('reads a pool’s standing as the brief does, an ordinal, against the others it counts', () => {
    const m = baseModel();
    const pools = [53, 22, 11].map((percentile, i) => ({ label: `Pool ${i}`, n: 40, med: 70_000, percentile, gapToMed: 2_000 }));
    const html = briefToWordHtml({ ...m, standing: { ...m.standing!, pools } });
    for (const o of ['53rd', '22nd', '11th']) expect(html).toMatch(new RegExp(`>${o}<`));
    expect(html).toMatch(/>Others</);
  });

  it('every opened table tag is closed', () => {
    const html = briefToWordHtml(baseModel());
    const opens = (html.match(/<table/g) ?? []).length;
    const closes = (html.match(/<\/table>/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(0);
  });

  it('renders the pick-a-subject placeholder and stops when there is no subject', () => {
    const html = briefToWordHtml(baseModel({ subjectPay: null }));
    expect(html).toContain('Pick a subject');
    expect(html).not.toContain('Recommendation');
  });

  it('sets the person a case asks to match beside its subject, as the brief does, under their peer name when masked', () => {
    const match = {
      key: 'p1', name: 'Alex Chen', gap: 11_000, duties: '', shared: [] as string[], beyond: [] as { label: string; amount: number | null }[],
      sides: [
        { title: 'Senior Analyst', school: 'L&S', tenure: 6.2, pay: 68_000 },
        { title: 'Senior Analyst', school: 'L&S', tenure: 2.1, pay: 79_000 },
      ] as [MatchSide, MatchSide],
      tenure: { n: 12, perYear: 500, years: -4.1, explained: -2_050, rest: 13_050 },
      history: [{ label: 'May 2024', subject: 64_000, peer: 72_000, gap: 8_000 }, { label: 'May 2026', subject: 68_000, peer: 79_000, gap: 11_000 }],
    };
    const open = briefToWordHtml(baseModel({ match }));
    expect(open).toContain('Jordan and Alex Chen, side by side');
    expect(open).toContain('L&amp;S');
    expect(open).toContain('Alex Chen has 4.1 years less UW tenure than Jordan: on tenure alone, Alex Chen would be paid about $2,050 less, not $11,000 more.');
    expect(open).toContain('The gap at each snapshot');
    expect(open).toContain('+$8,000');
    const masked = briefToWordHtml(baseModel({ match, anonymize: true }));
    expect(masked).toContain('Jordan and Peer A, side by side');
    expect(masked).not.toContain('Alex Chen');
    expect(briefToWordHtml(baseModel()), 'no one to match, no block').not.toContain('side by side');
    const said = briefToWordHtml(baseModel({ match: { ...match, duties: 'Both run the <on-call> rota', shared: ['Certifications & education'], beyond: [{ label: 'Supervisory scope', amount: 2_500 }, { label: 'Bilingual', amount: null }] } }));
    expect(said).toContain('Duties they share, as attested in this request: Both run the &lt;on-call&gt; rota');
    expect(said).toContain('Alex Chen has these too, so they are not added to the ask: Certifications &amp; education.');
    expect(said).toContain('Beyond Alex Chen, Jordan brings: Supervisory scope (+$2,500), Bilingual.');
  });

  it('wraps output in a Word-flavored HTML document with the subject name in the title', () => {
    const html = briefToWordHtml(baseModel());
    expect(html).toMatch(/<html xmlns:o="urn:schemas-microsoft-com:office:office"/);
    expect(html).toContain('<title>Salary brief - Jordan Rivers</title>');
  });
});

describe('htmlToPlainText (the email copy without formatting)', () => {
  it('keeps paragraphs, breaks and numbered lists on their own lines, with every entity as its character', () => {
    expect(htmlToPlainText('<p>A &amp; B&nbsp;&mdash; C&#8217;s</p>\n<p>D<br/>E</p><ol style="x"><li>one</li><li>two</li></ol>'))
      .toBe('A & B — C’s\n\nD\nE\n\n1. one\n2. two');
  });

  it('reads a table a row to a line, its cells apart', () => {
    expect(htmlToPlainText('<table><thead><tr><th>Name</th><th>Pay</th></tr></thead><tbody><tr><td>Alex</td><td>$79,000</td></tr></tbody></table>'))
      .toBe('Name | Pay\nAlex | $79,000');
  });

  it('leaves out the document head, and keeps written angle brackets as text', () => {
    expect(htmlToPlainText('<html><head><title>T</title><style>p{}</style></head><body><p>&lt;b&gt; stays</p></body></html>')).toBe('<b> stays');
  });

  it('turns a whole brief into lines a reader can follow: its title alone, its headings, its notes numbered', () => {
    const text = htmlToPlainText(briefToWordHtml(baseModel()));
    const lines = text.split('\n');
    expect(lines[0]).toBe('Pay Parity Review');
    expect(lines.filter((l) => /^\d+\. Notes & sources$/.test(l))).toHaveLength(1);
    expect(lines.some((l) => /^1\. Source: /.test(l)), 'the first methodology note is numbered').toBe(true);
    expect(lines, 'a peer table row reads across, and a cell keeps its two lines in its row').toEqual(expect.arrayContaining([
      'Alex Chen [Pay inversion] | Senior Analyst | 2.1 yrs | $79,000 | +$11,000',
      'Certifications & education — AWS Solutions Architect | +$3,000',
    ]));
    expect(text).not.toMatch(/<[a-z/]|&[a-z#0-9]+;/i);
    expect(lines.length).toBeGreaterThan(40);
  });
});
