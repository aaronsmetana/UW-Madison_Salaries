// Word (.doc) + rich-text-clipboard export of the equity-review brief. A second, independent
// renderer over the same `BriefModel` that `ReportBrief` renders to screen — Word opens HTML saved
// with a .doc extension, so no document-format library is needed. Everything here is inline-styled
// plain HTML (no Mantine, no CSS vars): those only resolve in the live app's stylesheet, and Word
// ignores classes/external CSS anyway, so hand-rolled inline styles are the only way to keep the
// exported look under our control.
import { fmtYearsToParity, type BriefModel } from '../components/report/model';
import { usd, pct } from './format';
import { CITATIONS, POLICY, type CitationKey } from '../components/report/sources';

const esc = (s: string | number | null | undefined): string =>
  s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DIM = 'color:#666;';
const SMALL = 'font-size:9pt;';
const TABLE = 'border-collapse:collapse;width:100%;margin:0 0 12pt 0;';
const TH = 'border:1pt solid #ccc;padding:4pt 8pt;font-size:9pt;text-align:left;background:#f3f3f3;';
const TD = 'border:1pt solid #ccc;padding:4pt 8pt;font-size:10pt;text-align:left;';
const TD_R = `${TD}text-align:right;`;
const H2 = 'font-size:13pt;font-weight:700;margin:18pt 0 6pt 0;border-bottom:1pt solid #ccc;padding-bottom:2pt;';
const P = 'font-size:10.5pt;margin:0 0 8pt 0;line-height:1.4;';

function p(html: string, style = P): string {
  return `<p style="${style}">${html}</p>`;
}
function h2(text: string): string {
  return `<h2 style="${H2}">${esc(text)}</h2>`;
}
function table(headers: string[], rows: string[][], align?: ('l' | 'r')[]): string {
  const thead = headers.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('');
  const tbody = rows
    .map((r) => `<tr>${r.map((c, i) => `<td style="${align?.[i] === 'r' ? TD_R : TD}">${c}</td>`).join('')}</tr>`)
    .join('');
  return `<table style="${TABLE}"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

/** Renders a `BriefModel` as a self-contained Word-flavored HTML document (mirrors `ReportBrief`'s
 *  section order/headings; see model.ts for field docs). */
export function briefToWordHtml(model: BriefModel): string {
  const {
    subjectName, subjectFirst, subjectPay, headerMeta, generated, snapLabel,
    recommended, belowTarget, targetDelta, targetPct, basisLabel,
    receipt, activeFactors, proofs, yearsToParity, yearsToParityRate, yearsToParityObserved,
    realErosion, rows, showTenure, anonymize, attrition, divergence, history, format, sections,
    supervisory, guidelineCompression, guidelineProvisions, standing, raiseCycle, cohortBasisScoped,
  } = model;

  const body: string[] = [];
  body.push(`<h1 style="font-size:20pt;font-weight:700;margin:0 0 4pt 0;">Internal Equity &amp; Parity Review</h1>`);
  body.push(p(`Prepared for <b>${esc(subjectName || '—')}</b>${headerMeta ? ` &middot; ${esc(headerMeta)}` : ''}`, `${P}${DIM}`));
  if (subjectPay != null) {
    body.push(p(
      `Data through ${esc(snapLabel)} &middot; generated ${esc(generated)} &middot; UW&ndash;Madison salary data released under Wisconsin's public-records law.`,
      `${SMALL}${DIM}`,
    ));
  }
  body.push('<hr style="border:none;border-top:1pt solid #ccc;margin:10pt 0;"/>');

  if (subjectPay == null) {
    body.push(p('Pick a subject and add comparators to build the review.', `${P}${DIM}`));
    return wrap(subjectName, body.join(''));
  }

  const otherRows = rows.filter((r) => !r.isSubject);
  const anonName = (key: string) => {
    const idx = otherRows.findIndex((r) => r.key === key);
    return idx >= 0 && idx < 26 ? `Peer ${String.fromCharCode(65 + idx)}` : 'Peer';
  };

  // ── Section presence + numbering — identical conditions/order to ReportBrief's sectionShow. ──
  const sectionShow = {
    guidelineBasis: sections.includes('guidelineBasis') && guidelineProvisions.length > 0,
    highlights: sections.includes('highlights') && proofs.length > 0,
    standing: sections.includes('standing') && !!standing && standing.min != null && standing.p25 != null && standing.med != null && standing.p75 != null && standing.max != null,
    factors: sections.includes('factors') && activeFactors.length > 0,
    peers: sections.includes('peers') && rows.length > 1,
    history: sections.includes('history') && history.length >= 2,
    risk: sections.includes('risk'),
  };
  const order: (keyof typeof sectionShow)[] = ['guidelineBasis', 'highlights', 'standing', 'factors', 'peers', 'history', 'risk'];
  const num: Partial<Record<keyof typeof sectionShow, number>> = {};
  { let n = 1; for (const k of order) if (sectionShow[k]) num[k] = ++n; }
  const notesNum = order.filter((k) => sectionShow[k]).length + 2;

  // ── 1. Recommendation ──
  const showReceipt = receipt.length > 1;
  body.push(h2('1. Recommendation'));
  if (belowTarget && recommended != null) {
    body.push(p(usd(Math.round(recommended)), 'font-size:26pt;font-weight:800;color:#1a7a4c;margin:0 0 6pt 0;'));
    body.push(p(
      `Adjust <b>${esc(subjectName)}</b> from <b>${usd(subjectPay)}</b> to <b>${usd(recommended)}</b> ` +
      `(<b style="color:#1a7a4c;">+${usd(targetDelta)}, ${pct(targetPct)}</b>)${showReceipt ? '.' : ` &mdash; ${esc(basisLabel)}.`}`,
    ));
    if (yearsToParity != null && yearsToParity >= 0.5) {
      body.push(p(
        `Absent this adjustment, a raise at ${pct(yearsToParityRate)}/yr ` +
        `(${yearsToParityObserved ? "this title's own observed raise rate" : 'a standard assumption'}) alone would take ` +
        `${fmtYearsToParity(yearsToParity)} to reach today's median, if that rate continues.`,
        `${SMALL}${DIM}`,
      ));
    }
    if (standing != null && standing.values.length < 4) {
      body.push(p(`Based on a small same-title comparison group (n = ${standing.values.length}) &mdash; see Market standing below.`, `${SMALL}${DIM}font-weight:600;`));
    }
    if (showReceipt) {
      const rows2 = receipt.map((line) => {
        const linePct = line.kind !== 'base' && subjectPay ? line.amount / subjectPay : null;
        const label = `${line.kind === 'addon' ? '+ ' : ''}${esc(line.label)}`;
        const amt = `${line.kind !== 'base' && line.amount >= 0 ? '+' : ''}${usd(line.amount)}${linePct != null ? ` (${linePct >= 0 ? '+' : ''}${pct(linePct)})` : ''}`;
        return [label, amt];
      });
      rows2.push([`<b>Total parity recommendation</b>`, `<b>${usd(recommended)} (+${pct(targetPct)})</b>`]);
      body.push(table(['Component', 'Amount'], rows2, ['l', 'r']));
    }
  } else {
    body.push(p(
      `<b>${esc(subjectFirst)}</b> is at or above the parity target${recommended != null ? ` (${usd(recommended)})` : ''} &mdash; maintain current pay.`,
    ));
  }

  // ── Basis under the UW Salary Administration Guidelines ──
  if (sectionShow.guidelineBasis) {
    body.push(h2(`${num.guidelineBasis}. Basis under the UW Salary Administration Guidelines`));
    for (const g of guidelineProvisions) {
      body.push(p(`<b>${esc(g.name)}</b>${g.selfReported ? ' <i style="color:#888;">(self-reported)</i>' : ''}`, `${P}margin-bottom:2pt;`));
      body.push(p(`&ldquo;${esc(g.quote)}&rdquo;`, `${SMALL}${DIM}font-style:italic;margin:0 0 2pt 0;`));
      body.push(p(`Supported here by: ${esc(g.supportedBy)}.`, `${SMALL}margin:0 0 10pt 0;`));
    }
    body.push(p(
      `Terms follow the guideline: this is a request for a <b>parity / compression adjustment</b>, not an ` +
      `&ldquo;equity adjustment&rdquo; (a term the guideline reserves for protected-category inequities).`,
      `${SMALL}${DIM}`,
    ));
  }

  // ── Grounds for a parity / compression adjustment (proofs) ──
  if (sectionShow.highlights) {
    body.push(h2(`${num.highlights}. Grounds for a parity / compression adjustment`));
    for (const pr of proofs) {
      body.push(p(
        `<b style="font-size:13pt;">${esc(pr.value)}</b> &mdash; ${esc(String(pr.label))}` +
        (pr.detail ? `<br/><span style="${SMALL}${DIM}">${esc(String(pr.detail))}</span>` : ''),
        `${P}margin-bottom:10pt;`,
      ));
    }
    if (realErosion) {
      body.push(p(
        `Since ${realErosion.firstYear}, ${esc(subjectFirst)}'s pay rose ${pct(realErosion.nominalPct)} nominally &mdash; ` +
        `a <b>${pct(Math.abs(realErosion.realPct))} decline</b> in real (CPI-adjusted) purchasing power.`,
        `${P}${DIM}`,
      ));
    }
  }

  // ── Market standing ──
  if (sectionShow.standing && standing) {
    body.push(h2(`${num.standing}. Market standing`));
    body.push(p(`${esc(subjectFirst)}'s pay against ${esc(standing.cohortLabel)} (n = ${standing.values.length}).`, `${SMALL}${DIM}`));
    if (standing.values.length >= 4) {
      body.push(table(
        ['Min', 'P25', 'Median', 'P75', 'Max', `${subjectFirst}'s pay`],
        [[usd(standing.min), usd(standing.p25), usd(standing.med), usd(standing.p75), usd(standing.max), `<b>${usd(subjectPay)}</b>`]],
        ['r', 'r', 'r', 'r', 'r', 'r'],
      ));
    } else {
      body.push(p('Too few peers in this cohort for a distribution; see the comparison pools below and the peer table.'));
    }
    if (standing.pools.length > 0) {
      body.push(table(
        ['Comparison pool', 'n', 'Median', 'Percentile', 'vs. median'],
        standing.pools.map((pl) => [
          esc(pl.label), String(pl.n), usd(pl.med),
          pl.percentile != null ? `${pl.percentile}th` : '—',
          pl.med != null && pl.med > 0 ? `${subjectPay - pl.med >= 0 ? '+' : ''}${pct((subjectPay - pl.med) / pl.med)}` : '—',
        ]),
        ['l', 'r', 'r', 'r', 'r'],
      ));
    }
  }

  // ── Documented qualifications & responsibilities ──
  if (sectionShow.factors) {
    body.push(h2(`${num.factors}. Documented qualifications & responsibilities`));
    body.push(table(
      ['Qualification', 'Amount'],
      activeFactors.map((f) => [
        `<b>${esc(f.label)}</b>${f.note ? `<br/><span style="${SMALL}${DIM}">${esc(f.note)}</span>` : ''}`,
        f.amount != null ? `+${usd(f.amount)}` : '—',
      ]),
      ['l', 'r'],
    ));
  }

  // ── Peer comparison ──
  if (sectionShow.peers) {
    body.push(h2(`${num.peers}. Peer comparison`));
    const headers = ['Name', 'Title', ...(showTenure ? ['Tenure'] : []), 'Salary', `vs ${subjectFirst}`];
    const tRows = rows.map((r) => {
      const name = r.isSubject ? `<b>${esc(r.name)}</b> (Review Subject)` : anonymize ? anonName(r.key) : esc(r.name);
      const flag = !r.isSubject ? (r.isAnomaly ? ' [Pay inversion]' : r.lessTenure ? ' [less tenure]' : '') : '';
      const tenureCell = r.tenure != null ? `${r.tenure.toFixed(1)} yr` : '—';
      const gapCell = r.isSubject ? 'baseline' : `${r.gap > 0 ? '+' : r.gap < 0 ? '&minus;' : ''}${usd(Math.abs(r.gap))}`;
      return [name + flag, esc(r.title ?? '—'), ...(showTenure ? [tenureCell] : []), usd(r.pay), gapCell];
    });
    body.push(table(headers, tRows, headers.map((_, i) => (i >= 2 ? 'r' : 'l'))));
  }

  // ── Pay history ──
  if (sectionShow.history) {
    body.push(h2(`${num.history}. Pay history`));
    body.push(p(`${esc(subjectFirst)}'s pay against the median for this title at each snapshot.`, `${SMALL}${DIM}`));
    body.push(table(
      ['Date', subjectFirst, 'Title median'],
      history.map((pt) => [esc(pt.date), usd(pt.pay), usd(pt.med)]),
      ['l', 'r', 'r'],
    ));
    if (raiseCycle) {
      body.push(p(
        `Same-title peers received a median <b>${pct(raiseCycle.medianPct)}</b> raise from ${esc(raiseCycle.fromLabel)} to ${esc(raiseCycle.toLabel)}` +
        (raiseCycle.subjectPct != null ? `; ${esc(subjectFirst)} received <b>${pct(raiseCycle.subjectPct)}</b>` : '') +
        ` (n = ${raiseCycle.n}). These cycles include the Legislature's JCOER-approved pay plan adjustments, which apply across the board and so maintain &mdash; rather than close &mdash; an existing pay gap.`,
      ));
    }
    if (format === 'detailed' && raiseCycle && raiseCycle.dist.length > 0) {
      body.push(p(`Raise distribution (${esc(raiseCycle.fromLabel)} &rarr; ${esc(raiseCycle.toLabel)})`, 'font-weight:700;font-size:10.5pt;margin:0 0 4pt 0;'));
      body.push(table(
        ['Bucket', 'n'],
        raiseCycle.dist.map((d) => [`${d.bucket > 0 ? '+' : ''}${d.bucket}%${d.bucket === raiseCycle.subjectBucket ? ` (${subjectFirst})` : ''}`, String(d.n)]),
        ['l', 'r'],
      ));
    }
    if (format === 'detailed' && divergence) {
      body.push(p(
        `Percentage growth flatters a low starting salary. In raw dollars, ${esc(subjectFirst)}'s raises have lagged: peers gained ` +
        `${usd(divergence.avgAbs)} on average vs. ${esc(subjectFirst)}'s ${usd(divergence.subjAbs)} &mdash; ` +
        `<b>${usd(divergence.avgAbs - divergence.subjAbs)} less</b> over the same period.`,
      ));
    }
  }

  // ── Retention & replacement cost ──
  if (sectionShow.risk) {
    body.push(h2(`${num.risk}. Retention & replacement cost`));
    body.push(p(
      `Independent research estimates the cost of replacing an employee at roughly one-third of annual salary at the ` +
      `median (Work Institute, 2020 Retention Report), rising to one-half to two times salary for specialized or ` +
      `hard-to-fill roles (Gallup, 2019) &mdash; about <b>${usd(subjectPay * 0.33)}&ndash;${usd(subjectPay * 2)}</b> for this position.`,
    ));
    if (attrition) {
      body.push(p(`In the public salary record, <b>${attrition.leftN} of ${attrition.ofN}</b> employees holding this title as of ${esc(attrition.fromLabel)} no longer hold it as of ${esc(attrition.toLabel)}.`));
    }
    if (belowTarget) {
      body.push(p(
        `For comparison, the proposed ${usd(targetDelta)} adjustment is ${pct(targetDelta / (subjectPay * 0.33))} of ` +
        `even the conservative (one-third-of-salary) replacement estimate.`,
        `${P}${DIM}`,
      ));
    }
    body.push(p(
      `The guidelines also provide for a <b>retention bonus</b> &mdash; an alternative instrument to retain a valuable ` +
      `employee where a base-salary increase is not advised due to parity or range considerations.`,
      `${SMALL}${DIM}`,
    ));
  }

  // ── Notes & sources — same underlying conditions as ReportBrief's noteDefs/sourceIds (endnote
  //    numbers are omitted from the body text here; the doc stands alone without inline anchors). ──
  const hasPercentileClaim = proofs.some((pr) => pr.kind === 'market') || (standing?.pools.length ?? 0) > 0;
  const gc = guidelineCompression;
  const exemptLabel = gc?.exempt === false ? 'non-exempt' : gc?.exempt === true ? 'exempt/professional' : 'FLSA status unavailable — conservative non-exempt floor applied';
  const notes: { when: boolean; text: string }[] = [
    { when: true, text: `Source: UW&ndash;Madison salary data (Wisconsin public record); zero/unreported salaries excluded; identity matched on name + date of hire.` },
    { when: belowTarget, text: `The title median is the median pay of everyone sharing the subject's job code at this snapshot. The tenure-adjusted target (used once at least 5 same-title peers meet or exceed the subject's tenure) is the median for that narrower, more comparable group instead.` },
    { when: sectionShow.guidelineBasis, text: esc(POLICY.equityAdjustmentScope) },
    { when: yearsToParity != null && yearsToParity >= 0.5, text: `Time-to-parity assumes compounding raises at the stated annual rate with no other adjustment &mdash; a projection, not a commitment.` },
    { when: showTenure, text: `&ldquo;Tenure&rdquo; = years since the UW&ndash;Madison date of hire (not total career experience), computed as of this snapshot.` },
    { when: hasPercentileClaim, text: `Percentile = the share of the comparison pool paid less than the subject; the subject is never counted against themself.` },
    { when: cohortBasisScoped && (sectionShow.highlights || sectionShow.peers || sectionShow.standing || sectionShow.history), text: `Same-title comparisons are scoped to the subject's own pay basis &mdash; 9-month (academic-year) and 12-month appointments are never compared raw.` },
    { when: supervisory.reports.length > 0, text: `Per the UW&ndash;Madison Salary Administration Guidelines&rsquo; &ldquo;Supervisors or Managers and Subordinates&rdquo; provision: at least a 15% pay differential between a supervisor/manager and a non-managing subordinate (pay differential = (higher salary &minus; lower salary) &divide; lower salary).` },
    { when: !!gc && gc.count > 0, text: `The UW&ndash;Madison Salary Administration Guidelines&rsquo; &ldquo;Compression&rdquo; provision suggests at least a ${gc ? pct(gc.threshold) : '5%'} pay differential (${exemptLabel}) where same-title employees have distinct differences in experience. &ldquo;Distinct differences&rdquo; is operationalized here as a peer with at least ${gc?.gapYears ?? 5} fewer years of UW tenure, mirroring the guideline&rsquo;s own 3-vs-8-year example.` },
    { when: proofs.some((pr) => pr.kind === 'compression'), text: `Recent hires may additionally receive a hiring bonus of up to 15% of the proposed starting salary, which the public salary record does not capture &mdash; so the recorded salary understates new-hire total compensation.` },
    { when: proofs.some((pr) => pr.kind === 'gradeband'), text: `Compa-ratio = pay &divide; the grade's official band midpoint (1.00 = exactly at midpoint). Position in range (PIR) = (pay &minus; band minimum) &divide; (band maximum &minus; band minimum), where 0% is the band floor and 100% the ceiling.` },
    { when: proofs.some((pr) => pr.kind === 'marketFloor'), text: `The UW&ndash;Madison Salary Administration Guidelines define the market-competitive range as +/-15% of the grade or market midpoint (85%&ndash;115% compa-ratio, or 25%&ndash;75% PIR); below it, &ldquo;a market competitive pay request can be made for OHR to review and approve.&rdquo;` },
    { when: proofs.some((pr) => pr.kind === 'tenureTrend'), text: `The tenure-vs-pay trend is an ordinary least-squares fit of same-title peers' pay on tenure (the subject excluded from the fit), evaluated at the subject's own tenure.` },
    { when: !!raiseCycle, text: `The raise-cycle comparison covers continuing appointments only (present in both snapshots) in the same job code; the annualized rate compounds the median cycle raise over the actual elapsed months between the two snapshots. Observed cycle raises include the Legislature's Joint Committee on Employment Relations (JCOER)-approved pay plan adjustments, which are applied broadly and so maintain rather than close relative pay gaps.` },
    { when: sectionShow.factors, text: `Value-add adjustments under &ldquo;Documented qualifications &amp; responsibilities&rdquo; are self-reported by the subject, not independently verified against a position description or performance record.` },
    { when: !!realErosion, text: `Real-dollar (inflation-adjusted) figures use BLS Consumer Price Index (CPI-U) annual averages; recent years use the latest available approximation.` },
    { when: sectionShow.risk, text: `Replacement-cost estimates are industry-wide benchmarks, not specific to this employee, role, or institution; the attrition figure, where shown, is drawn directly from the public salary record. The retention-bonus alternative is drawn from the UW&ndash;Madison Salary Administration Guidelines.` },
  ];
  const activeNotes = notes.filter((n) => n.when);

  const citesGuidelines = supervisory.reports.length > 0
    || (!!gc && gc.count > 0)
    || proofs.some((pr) => pr.kind === 'marketFloor' || pr.kind === 'compression')
    || sectionShow.guidelineBasis
    || sectionShow.risk;
  const sourceIds: CitationKey[] = [
    'wisStat', 'ufas',
    ...(citesGuidelines ? (['uwSalaryGuidelines'] as CitationKey[]) : []),
    ...(proofs.some((pr) => pr.kind === 'gradeband') ? (['uwHrGrades'] as CitationKey[]) : []),
    ...(realErosion ? (['bls'] as CitationKey[]) : []),
    ...(sectionShow.risk ? (['workInstitute', 'gallup'] as CitationKey[]) : []),
  ];

  body.push(h2(`${notesNum}. Notes & sources`));
  body.push(p('Methodology notes', 'font-weight:700;font-size:10.5pt;margin:0 0 4pt 0;'));
  body.push(`<ol style="${SMALL}${DIM}padding-left:18pt;margin:0 0 10pt 0;">${activeNotes.map((n) => `<li style="margin-bottom:4pt;">${n.text}</li>`).join('')}</ol>`);
  if (anonymize) body.push(p('Peer identities anonymized in this printing; names available on request.', `${SMALL}${DIM}`));
  body.push(p('Sources', 'font-weight:700;font-size:10.5pt;margin:0 0 4pt 0;'));
  body.push(`<ol style="${SMALL}${DIM}padding-left:18pt;margin:0;">${sourceIds.map((id) => {
    const c = CITATIONS[id];
    return `<li style="margin-bottom:4pt;"><b>${esc(c.label)}.</b> ${esc(c.detail)}${c.url ? ` ${esc(c.url)}` : ''}</li>`;
  }).join('')}</ol>`);

  return wrap(subjectName, body.join(''));
}

function wrap(subjectName: string, bodyHtml: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${esc(`Salary brief - ${subjectName}`)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page { size: 8.5in 11in; margin: 1in; } body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; }</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

/** Triggers a browser download of `html` as a `.doc` file (Word opens Word-flavored HTML directly —
 *  no document-format library needed). Mirrors `downloadCSV`'s blob/anchor idiom (see `./csv.ts`). */
export function downloadDoc(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Copies `html` to the clipboard as rich text (pastes formatted into an email/Word) via the native
 *  `ClipboardItem` API, falling back to plain text if the browser can't write HTML. Returns whether
 *  the rich-text write succeeded (the caller can tell the user "copied as plain text" otherwise). */
export async function copyBriefRichText(html: string): Promise<boolean> {
  try {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([stripHtml(html)], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(stripHtml(html));
    } catch {
      // clipboard unavailable (permissions/private context) — caller surfaces the failure
    }
    return false;
  }
}
