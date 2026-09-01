// Pure, unit-testable scoring logic for the org-level screening page (src/routes/Screening.tsx).
// Batch-runs the same guideline checks the per-person Reports brief uses — reusing, not
// reinventing, cohortStats/buildGuidelineCompression/caseStrength/POLICY from the report model.
import { cohortStats, buildGuidelineCompression, caseStrength, type CaseStrength } from '../components/report/model';
import { POLICY } from '../components/report/sources';
import { sameBasis } from './queries';

export interface ScreeningSubject {
  person_key: string;
  name: string;
  title: string | null;
  job_code: string | null;
  school: string | null;
  department: string | null;
  pay: number;
  tenure: number | null;
  grade_number: number | null;
  grade_basis: string | null;
  comp_basis: string | null;
  flsa_status: string | null;
}

export interface CohortMember {
  person_key: string;
  job_code: string;
  comp_basis: string | null;
  pay: number;
  tenure: number | null;
}

export interface PayPoint {
  person_key: string;
  year: number;
  pay: number;
}

export interface GradeBand {
  grade: number;
  basis: string;
  min: number;
  max: number;
}

export interface ScreeningResult {
  key: string;
  name: string;
  title: string | null;
  school: string | null;
  department: string | null;
  pay: number;
  tenure: number | null;
  tooFewPeers: boolean;
  cohortN: number;
  percentile: number | null;
  gapToMed: number | null; // dollars below (positive) the title-cohort median
  tenureInvCount: number; // less-tenured same-title peers paid more
  compressionCount: number; // distinctly-junior peers within the guideline's compression floor
  compressionInvertedCount: number;
  belowMarket: boolean;
  marketCompa: number | null;
  realErosion: boolean; // nominal pay grew, but real (CPI-adjusted) pay declined
  score: number;
  scoreLabel: CaseStrength['label'];
}

/**
 * Scores every `subjects` row against its university-wide same-title cohort (filtered to the same
 * pay basis — 9-month and 12-month appointments are never compared raw) and its official grade
 * band, ranking by the same case-strength signals the per-person brief surfaces. Subjects with a
 * too-small cohort skip parity/compression scoring (mirrors the brief's own n<4 gate) but still
 * show market/real-erosion flags.
 */
export function computeScreeningResults(opts: {
  subjects: ScreeningSubject[];
  cohortRows: CohortMember[];
  payHistory: PayPoint[];
  grades: GradeBand[];
  minCohortN: number;
  toReal: (amount: number, year: number) => number;
}): ScreeningResult[] {
  const { subjects, cohortRows, payHistory, grades, minCohortN, toReal } = opts;

  // Bucket the cohort by job code AND pay-basis class up front, rather than re-filtering the whole
  // job-code cohort for every subject. The old shape called `sameBasis` — which lowercases, trims and
  // searches an equivalence table — once per (subject x cohort-member) pair, so an unscoped run over a
  // title like Professor did roughly n^2 string comparisons for that title alone, on the main thread.
  // Bucketing is one pass; each subject then only walks its own (much smaller) bucket to drop itself.
  //
  // The null handling has to mirror `sameBasis` exactly or results would change: a blank basis on
  // EITHER side means "unknown, don't exclude". So members with no basis go in their own bucket and
  // are appended to every subject's cohort, and a subject with no basis gets the whole job code.
  const byJobAndBasis = new Map<string, CohortMember[]>();
  const byJob = new Map<string, CohortMember[]>();
  const push = (m: Map<string, CohortMember[]>, key: string, r: CohortMember) => {
    const list = m.get(key);
    if (list) list.push(r);
    else m.set(key, [r]);
  };
  const NO_BASIS = '\u0000none';
  const basisKey = (b: string | null | undefined) => (b && b.trim() ? b.trim().toLowerCase() : NO_BASIS);
  for (const r of cohortRows) {
    push(byJob, r.job_code, r);
    push(byJobAndBasis, `${r.job_code}|${basisKey(r.comp_basis)}`, r);
  }

  /** Everyone in `job_code` whose basis is comparable to `basis`, self included (callers drop self). */
  const cohortFor = (job_code: string, basis: string | null | undefined): CohortMember[] => {
    if (basisKey(basis) === NO_BASIS) return byJob.get(job_code) ?? []; // unknown subject basis matches all
    const sameClass = byJobAndBasis.get(`${job_code}|${basisKey(basis)}`) ?? [];
    // Other spellings of the same basis (the source relabeled the column mid-series).
    const aliases = (byJob.get(job_code) ?? []).filter(
      (r) => basisKey(r.comp_basis) !== basisKey(basis) && sameBasis(basis, r.comp_basis)
    );
    return aliases.length ? [...sameClass, ...aliases] : sameClass;
  };

  const historyByPerson = new Map<string, PayPoint[]>();
  for (const p of payHistory) {
    const list = historyByPerson.get(p.person_key);
    if (list) list.push(p);
    else historyByPerson.set(p.person_key, [p]);
  }

  return subjects.map((s) => {
    const cohort = (s.job_code ? cohortFor(s.job_code, s.comp_basis) : []).filter(
      (r) => r.person_key !== s.person_key
    );
    const tooFewPeers = cohort.length < minCohortN;
    const cohortForStats = cohort.map((r) => ({ pay: r.pay, tenure: r.tenure }));
    const stats = tooFewPeers ? null : cohortStats(cohortForStats, s.pay, s.tenure);
    const exempt = s.flsa_status === 'Exempt' ? true : s.flsa_status ? false : null;
    const gc = tooFewPeers ? null : buildGuidelineCompression(s.pay, s.tenure, cohortForStats, exempt);

    const band = grades.find((g) => g.grade === s.grade_number && g.basis === s.grade_basis);
    let belowMarket = false;
    let marketCompa: number | null = null;
    if (band && band.max > band.min) {
      const mid = (band.min + band.max) / 2;
      const compa = s.pay / mid;
      const pir = (s.pay - band.min) / (band.max - band.min);
      marketCompa = compa;
      belowMarket = compa < POLICY.marketCompetitive.compaLow || pir < POLICY.marketCompetitive.pirLow;
    }

    const hist = [...(historyByPerson.get(s.person_key) ?? [])].sort((a, b) => a.year - b.year);
    let realErosion = false;
    if (hist.length >= 2) {
      const first = hist[0];
      const last = hist[hist.length - 1];
      if (first.pay > 0) {
        const nominalPct = (last.pay - first.pay) / first.pay;
        const realFirst = toReal(first.pay, first.year);
        const realLast = toReal(last.pay, last.year);
        const realPct = realFirst > 0 ? (realLast - realFirst) / realFirst : 0;
        realErosion = nominalPct > 0 && realPct < 0;
      }
    }

    const strength = caseStrength({
      gapToMed: stats?.gapToMed ?? null,
      med: stats?.med ?? null,
      invCount: stats?.invCount ?? 0,
      streakYears: 0,
      activeFactors: 0,
      guidelineCompressionCount: gc?.count ?? 0,
    });

    return {
      key: s.person_key,
      name: s.name,
      title: s.title,
      school: s.school,
      department: s.department,
      pay: s.pay,
      tenure: s.tenure,
      tooFewPeers,
      cohortN: cohort.length,
      percentile: stats?.percentile ?? null,
      gapToMed: stats?.gapToMed ?? null,
      tenureInvCount: stats?.invCount ?? 0,
      compressionCount: gc?.count ?? 0,
      compressionInvertedCount: gc?.invertedCount ?? 0,
      belowMarket,
      marketCompa,
      realErosion,
      score: strength.score,
      scoreLabel: strength.label,
    };
  });
}
