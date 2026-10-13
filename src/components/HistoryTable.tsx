import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Table, Badge, Text, Group, Anchor, Tooltip as MantineTooltip } from '@mantine/core';
import { CardTitle } from './CardTitle';
import { GlossaryTerm } from './GlossaryTerm';
import { LaneGutter, LaneStationSample } from './LaneGutter';
import { matchAppointments, acrossLabel, byAppointment, combinedReason, laneGutter, type Raise } from '../lib/payHistory';
import { actualPay, countedAppts, sameBasisAcross, reportingChange, likeForLike, likeForLikeNote, type ReportingChange } from '../lib/queries';
import { usd, fmtBasis, fmtChange } from '../lib/format';
import { ttcRank } from '../lib/snapshotOrder';
import { useSummary } from '../lib/hooks';
import { NewBadge } from './NewBadge';
import { MethodNote } from './MethodNote';
import { CsvButton } from './CsvButton';
import { downloadCSV } from '../lib/csv';

/**
 * A person's title & salary history: the person page's History tab and the one-person report draw this one
 * table, so the printed report cannot tell a reader something the page does not. On paper the job code, the
 * school and department, the rate and the basis fold under the cells beside them (print.css), so it fits a
 * Letter page.
 *
 * Any interactive state for this table belongs here, not in the page: the page keeps every tab panel
 * mounted (Mantine's `keepMounted` default), and while the History tab is showing the hidden panels
 * hold 504 peer-table rows, so state kept up there would have React reconcile all of them.
 */

/** The fields this table reads. Declared here rather than imported from the route, so a component
 *  does not depend on a page; the page's own row type satisfies it structurally. */
export interface HistoryRow {
  snapshot_id: string;
  snapshot_label: string;
  snapshot_date: string;
  school: string | null;
  department: string | null;
  title: string | null;
  job_code: string | null;
  salary: number | null;
  salary_fte_adjusted: number | null;
  fte: number | null;
  comp_basis: string | null;
  /** Grade and pay schedule: whether a title change was a promotion (see `titleChange`). */
  grade_number?: number | null;
  grade_basis?: string | null;
}

/** A change as a figure: signed and coloured, or a dimmed "0%" for no change. */
function ChangeFigure({ delta }: { delta: number }) {
  return delta === 0
    ? <Text size="sm" c="dimmed">0%</Text>
    // The light-mode shades Mantine resolves for `pos` and `orange` measured 4.15–4.37:1 and 2.88:1 on
    // these rows; the shared light-text classes (app.css) carry the darker ones.
    : <Text size="sm" fw={600} c={delta > 0 ? 'up' : 'down'}>{fmtChange(delta)}</Text>;
}

/**
 * The history table's "Change" cell. Its states follow the matcher (see payHistory.ts): a paired
 * change, one measured across appointments the source cannot tell apart, a lone appointment that
 * moved title, and nothing to compare. `children` is the last of those. `reporting` is a reporting change
 * between the two snapshots: the figure as reported is mostly how pay was reported, so a paired step draws the
 * change like for like with the factor named, and anything else no figure.
 */
/** What the full-time rate did, where an appointment-percentage move put a change into actual pay that is not a
 *  change in pay: the rate's change, and the FTE on each side (null where none is on file, as on an hourly job). */
interface RateMove { rate: number; fte: [number | null, number | null] }
const ftePct = (f: number | null) => (f ? `${Math.round(f * 100)}%` : 'hourly');

function RaiseCell({ raise, note, reporting, compare, children }: {
  raise: Raise; note?: string | RateMove | null; reporting?: ReportingChange | null;
  /** How a continuing raise compares with that step's raises campus-wide, or why this one is not compared;
   *  `href`, the Raises page for that step and title. */
  compare?: { text: string; compared: boolean; href?: string } | null;
  children: ReactNode;
}) {
  // A new appointment under a title the person already held. Deliberately not an em dash: that
  // already means "no prior snapshot", and the two must not read alike.
  if (raise.kind === 'newAppointment') return <Badge size="xs" variant="light" color="gray">new</Badge>;
  if (raise.kind === 'none') return <>{children}</>;

  if (raise.kind === 'titleChange') {
    // Plain text, not a Badge: a badge truncates to its cell, and the 78px Change column cut
    // "promotion" to "promoti…".
    return (
      <>
        {raise.delta == null ? <Text size="sm" c="dimmed">—</Text> : <ChangeFigure delta={raise.delta} />}
        <Text
          size="xs"
          fw={600}
          c={raise.move === 'promotion' ? 'var(--text-accent)' : 'dimmed'}
          className={raise.move === 'promotion' ? 'accent7-text' : undefined}
          data-change-tag={raise.move}
          style={{ whiteSpace: 'nowrap' }}
        >
          {raise.move}
        </Text>
        {raise.note && <span className="appt-reporting-note">{raise.note}</span>}
      </>
    );
  }

  // A compared raise opens the Raises page for its step and title: who else in it got more than the usual.
  const context = raise.kind === 'paired' && compare && (
    // Wraps at a sentence's width (P31): on one line, "Bigger than 98% of UW raises (typical +2.0%)" widened the column.
    <Text size="xs" c="dimmed" data-raise-compare={compare.compared ? 'yes' : 'no'} maw={190} ml="auto">
      {compare.href ? (
        <Anchor component={Link} to={compare.href} inherit c="dimmed" underline="always" className="raise-compare-link"
          aria-label={`${compare.text}: who in this title got more than the usual raise`}>{compare.text}</Anchor>
      ) : compare.text}
    </Text>
  );

  if (reporting) {
    return raise.kind === 'paired'
      ? (<><ChangeFigure delta={likeForLike(raise.delta, reporting)} /><span className="appt-reporting-note">{likeForLikeNote(reporting)}</span>{context}</>)
      : (<><Text size="sm" c="dimmed">—</Text><span className="appt-reporting-note">{reporting.note}</span></>);
  }

  const figure = <ChangeFigure delta={raise.delta} />;
  if (raise.kind === 'paired') {
    // Where the FTE moved, actual pay moved with it: the figure is what the full-time RATE did, the number
    // the reader came for, and the note gives the change in actual pay and the FTE on each side. It led with
    // actual pay, "−68.6%" for an FTE going 0.65 → 0.2. A basis change has no rate to compare: its note says so.
    if (note && typeof note === 'object') {
      return (<><ChangeFigure delta={note.rate} /><span className="appt-rate-note">actual {fmtChange(raise.delta)} · FTE {ftePct(note.fte[0])} → {ftePct(note.fte[1])}</span>{context}</>);
    }
    return note ? (<>{figure}<span className="appt-rate-note">{note}</span>{context}</>) : (<>{figure}{context}</>);
  }

  // Two lines of a split carry the same figure, so the label has to say it covers both — otherwise
  // the repetition reads as each appointment having moved by that much on its own.
  return (
    <MantineTooltip label={combinedReason(raise.curCount, raise.priorCount)} withArrow multiline w={300}>
      <div>
        {figure}
        <Text size="xs" c="dimmed">{acrossLabel(raise.curCount, raise.priorCount)}</Text>
      </div>
    </MantineTooltip>
  );
}

/** No snapshot holds two lines: the history is one continuous line, and the lanes (laneGutter) are not drawn. */
const gutterFree = (rows: readonly HistoryRow[]) => new Set(rows.map((r) => r.snapshot_id)).size === rows.length;

export function HistoryTable({ rows, comparisons, csvName }: {
  rows: readonly HistoryRow[];
  /** Each continuing raise's comparison with that step's raises campus-wide (lib/raiseContext),
   *  keyed by the snapshot it ends at. Absent until loaded. */
  comparisons?: ReadonlyMap<string, { text: string }>;
  /** The person's name, for the CSV's file name. */
  csvName: string;
}) {
  // The newest release's rows carry "New" (NewBadge) for its first 30 days.
  const newestId = useSummary().data?.latest?.id ?? null;
  // Appointment count per snapshot, for the station's tooltip ("A of 2", or "the only one").
  const apptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.snapshot_id, (m.get(r.snapshot_id) ?? 0) + 1);
    return m;
  }, [rows]);

  // The rows a snapshot's actual pay counts (queries `personPay`): a salaried person's hourly jobs, and an
  // hourly-only person's lesser-paid ones, are listed at their own rate but left out of it.
  const counted = useMemo(() => {
    const by = new Map<string, HistoryRow[]>();
    for (const r of rows) by.set(r.snapshot_id, [...(by.get(r.snapshot_id) ?? []), r]);
    return new Set([...by.values()].flatMap((g) => countedAppts(g)));
  }, [rows]);

  // History rows ordered chronologically, with pre-TTC above post-TTC for the shared-date pair, and
  // concurrent appointments in a STABLE order within each snapshot. Date alone left the order to
  // whatever the query returned, which flipped a person's two appointments between snapshots — see
  // byAppointment. Sorting only moves rows; matchAppointments does not depend on their order.
  const historyRows = useMemo(() => {
    const withinSnapshot = byAppointment<HistoryRow>((r) => ({
      snapshotId: r.snapshot_id, jobCode: r.job_code, school: r.school,
      department: r.department, fte: r.fte, pay: actualPay(r),
    }));
    return [...rows].sort(
      (a, b) =>
        String(a.snapshot_date).localeCompare(String(b.snapshot_date)) ||
        ttcRank(a.snapshot_id) - ttcRank(b.snapshot_id) ||
        withinSnapshot(a, b)
    );
  }, [rows]);

  // Which job codes each snapshot holds, so the badges can tell a genuinely new title from a
  // concurrent appointment (the adjacent row interleaves those and yields bogus "New title"/−100%).
  // This deliberately carries no pay: an earlier version summed the rows per job code here, and the
  // Δ below then divided ONE appointment's pay by that sum — see payHistory.ts.
  const snapHistory = useMemo(() => {
    const order: string[] = [];
    const index = new Map<string, number>();
    const bySnap = new Map<string, { date: string; jobs: Set<string> }>();
    for (const r of historyRows) {
      let s = bySnap.get(r.snapshot_id);
      if (!s) { s = { date: String(r.snapshot_date), jobs: new Set() }; bySnap.set(r.snapshot_id, s); index.set(r.snapshot_id, order.length); order.push(r.snapshot_id); }
      if (r.job_code != null) s.jobs.add(r.job_code);
    }
    return { order, index, bySnap };
  }, [historyRows]);

  // Newest first (P35): today's row was at the foot of the table. Every figure is still worked out in time order
  // (`historyRows`, which the matcher and the lanes read); only the drawing runs the other way. The whole list
  // turns over, a snapshot's own lines too, so the lanes are the same picture upside down: each row's tracks are
  // flipped in place (app.css, `data-order`), and a line that began at a station now runs up from it.
  const displayRows = useMemo(() => [...historyRows].reverse(), [historyRows]);

  // Where each snapshot's first row sits — the one row of the group that carries the snapshot's
  // label, now that the label is printed once per snapshot rather than once per line.
  const apptFirstRow = useMemo(() => {
    const m = new Map<string, number>();
    displayRows.forEach((r, i) => { if (!m.has(r.snapshot_id)) m.set(r.snapshot_id, i); });
    return m;
  }, [displayRows]);

  // One school across the whole history, for a one-line-per-snapshot person: named once over the table (P30),
  // the group's header, rather than on its first row alone. Where it changes, each run names it on its top row.
  const oneSchool = useMemo(
    () => (gutterFree(historyRows) && historyRows.length > 0 && historyRows.every((r) => (r.school ?? '') === (historyRows[0].school ?? ''))
      ? historyRows[0].school
      : null),
    [historyRows]
  );

  // Per-appointment change for every history row, plus the lane that lets a reader follow ONE
  // appointment down the page and the prior row each line continues. `historyRows` is already in
  // display order, which is the sequence the matcher compares against.
  const matching = useMemo(
    () =>
      matchAppointments(historyRows, (r) => ({
        snapshotId: r.snapshot_id,
        jobCode: r.job_code,
        school: r.school,
        department: r.department,
        fte: r.fte,
        pay: actualPay(r),
        date: r.snapshot_date,
        grade: r.grade_number ?? null,
        gradeBasis: r.grade_basis ?? null,
        basis: r.comp_basis,
      })),
    [historyRows]
  );

  /**
   * The appointment tracks. Empty for anyone who never holds two appointments at once, which is most
   * people — and that is the gate for the whole column, so their table renders as it always has.
   */
  const gutter = useMemo(
    () => laneGutter(historyRows, (r) => r.snapshot_id, matching),
    [historyRows, matching]
  );

  // Each row's change as its Change cell states it, and the reporting change it was measured across: like for
  // like across one (queries `likeForLike`), none where nothing pairs. The CSV writes the same figures.
  const stated = useMemo(() => {
    const m = new Map<HistoryRow, { reporting: ReportingChange | null; change: number | null; note: string | null }>();
    historyRows.forEach((r) => {
      const pos = snapHistory.index.get(r.snapshot_id) ?? 0;
      const priorId = pos > 0 ? snapHistory.order[pos - 1] : null;
      const from = matching.priorOf.get(r);
      // The appointment's own prior row where the matcher found one, else any prior row under the same title
      // (a combined figure spans those).
      const priors = from ? [from] : historyRows.filter((x) => x.snapshot_id === priorId && x.job_code === r.job_code);
      const reporting = priors.map((x) => reportingChange(x.comp_basis, r.comp_basis)).find(Boolean) ?? null;
      const raise: Raise = matching.raises.get(r) ?? { kind: 'none' };
      const [change, note] = raise.kind === 'titleChange' ? [raise.delta, [raise.move, raise.note].filter(Boolean).join(' · ')]
        : reporting ? (raise.kind === 'paired' ? [likeForLike(raise.delta, reporting), likeForLikeNote(reporting)] : [null, reporting.note])
        : raise.kind === 'paired' ? [raise.delta, null]
        : raise.kind === 'combined' ? [raise.delta, acrossLabel(raise.curCount, raise.priorCount)]
        : raise.kind === 'newAppointment' ? [null, 'new appointment'] : [null, null];
      m.set(r, { reporting, change, note: note || null });
    });
    return m;
  }, [historyRows, snapHistory, matching]);

  // One pay column when the rate IS the pay on every row (full-time, or no FTE on file): two columns
  // repeating the same figure made the reader compare them for a difference that is never there.
  const onePay = useMemo(
    () => historyRows.every((r) => Math.round(r.salary ?? 0) === Math.round(actualPay(r))),
    [historyRows]
  );

  return (
    <Card withBorder padding="lg" className="appt-history-card">
      <CardTitle
        sub={oneSchool ? <span className="history-school">All in {oneSchool}</span> : undefined}
        right={(
          <CsvButton
            label="CSV of the title and salary history"
            disabled={!historyRows.length}
            onClick={() => downloadCSV(`${csvName}-history.csv`, historyRows.map((r) => {
              const st = stated.get(r);
              return {
                snapshot: r.snapshot_label, title: r.title, job_code: r.job_code, school: r.school, department: r.department,
                rate: r.salary != null ? Math.round(r.salary) : null, actual_pay: Math.round(actualPay(r)),
                change: st?.change != null ? fmtChange(st.change) : null, change_note: st?.note ?? null,
                fte: r.fte || null, basis: fmtBasis(r.comp_basis),
              };
            }))}
          />
        )}
      >
        Title &amp; salary history
      </CardTitle>
      {/* The gutter is a fixed 22px per slot plus the cell padding (app.css), so the floor grows with it. */}
      <Table.ScrollContainer className="fold-scroll" minWidth={(gutter.slots ? 900 + gutter.slots * 22 : 880) - (onePay ? 90 : 0)}>
      {/* Striping is off because it is done per snapshot group in app.css instead — see .appt-history. */}
      <Table
        className="appt-history fold-table"
        data-order="newest"
        striped={false}
        style={gutter.slots ? ({ ['--lane-slots' as string]: gutter.slots }) : undefined}
      >
        <Table.Thead>
          <Table.Tr>
            {gutter.slots > 0 && (
              /* Visible, not hidden: an unlabelled column reads as a rendering accident. The
                 column is 71px and "APPOINTMENT" runs ~90px at the header's 11px uppercase, so the
                 visible text is the abbreviation and the full word is the accessible name. */
              <Table.Th className="appt-gutter-th" aria-label="Appointment">Appt</Table.Th>
            )}
            <Table.Th className="appt-snapshot" data-fold>Snapshot</Table.Th>
            <Table.Th>Title</Table.Th>
            <Table.Th data-fold data-print-fold>Job code</Table.Th>
            <Table.Th data-fold data-print-fold>{oneSchool ? 'Department' : 'School / Dept'}</Table.Th>
            {onePay ? (
              <Table.Th ta="right"><GlossaryTerm term="actualPay">Actual pay</GlossaryTerm></Table.Th>
            ) : (
              <>
                <Table.Th ta="right" data-fold data-print-fold><GlossaryTerm term="rate">Full-time rate</GlossaryTerm></Table.Th>
                <Table.Th ta="right"><GlossaryTerm term="actualPay">Actual pay</GlossaryTerm></Table.Th>
              </>
            )}
            <Table.Th ta="right"><GlossaryTerm term="payChange">Change</GlossaryTerm></Table.Th>
            <Table.Th ta="right" data-fold>FTE</Table.Th>
            <Table.Th data-fold data-print-fold>Basis</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {displayRows.map((r, i) => {
            // Compare to the SAME job code in the prior snapshot (not the adjacent interleaved row).
            const pos = snapHistory.index.get(r.snapshot_id) ?? 0;
            const priorId = pos > 0 ? snapHistory.order[pos - 1] : null;
            const priorSnap = priorId ? snapHistory.bySnap.get(priorId) : null;
            const inPrior = !!r.job_code && !!priorSnap && priorSnap.jobs.has(r.job_code);
            const isNew = !!priorSnap && !!r.job_code && !inPrior;
            const ttcReclass = isNew && String(priorSnap!.date) === String(r.snapshot_date);
            const actual = actualPay(r);
            const raise: Raise = matching.raises.get(r) ?? { kind: 'none' };
            const apptTotal = apptCounts.get(r.snapshot_id) ?? 0;
            const cell = gutter.byRow.get(r);
            // The row this line continues. Everything below that claims continuity — the lane's
            // solid rail, the department-change dot — is answered by this and nothing else.
            const from = matching.priorOf.get(r);
            const lastOfGroup = i === displayRows.length - 1 || displayRows[i + 1].snapshot_id !== r.snapshot_id;
            // Org move = this appointment's OWN department a snapshot ago. It used to compare
            // against the previous displayed row, which on a split page is a different appointment
            // entirely: 4,787 rows across the data were guaranteed a dot that meant nothing.
            const orgMoved = !!from && ((r.school ?? '') !== (from.school ?? '') || (r.department ?? '') !== (from.department ?? ''));
            // With one appointment per snapshot the rows are one continuous line, so the school is
            // printed at the top of each run of it; the rows between repeated it to no end. One school
            // throughout is the table's header instead (P30). A split history keeps it on every row — the
            // line above may be another appointment.
            const showSchool = !oneSchool && (gutter.slots > 0 || i === 0 || (r.school ?? '') !== (displayRows[i - 1].school ?? ''));
                const orgMovedLabel = orgMoved
                  ? `Division/Department changed since this appointment's previous snapshot — was: ${[from!.school, from!.department].filter(Boolean).join(' · ') || 'not recorded'}`
                  : '';
                // Why the Change column may not mean what it looks like. It reports the change in ACTUAL pay
                // (rate x FTE), so an appointment-percentage or comp-basis move shows up as if it were a pay
                // change: 4,159 figures across the data coincide with an FTE change, and 2,519 carry a sign
                // that contradicts what the rate did.
                const rateNote = ((): string | RateMove | null => {
                  if (!from || raise.kind !== 'paired') return null;
                  // `sameBasisAcross`, never `!==`. The source renamed its own vocabulary — Annual to 12 Month,
                  // Academic to 9 Month, Hourly to 12 Month — and left the column null before it existed, so a
                  // literal comparison calls 35,313 pairs a basis change when 2,720 of them are.
                  const basisMoved = !sameBasisAcross(from.comp_basis, r.comp_basis);
                  // Matches FTE_MULT: a zero or missing FTE counts as full-time.
                  const fteMoved = (r.fte || 1) !== (from.fte || 1);
                  if (!basisMoved && !fteMoved) return null;
                  // A 9-month rate and a 12-month rate are not the same quantity, so no percentage is drawn
                  // across that boundary — the Basis column already says what it is now.
                  if (basisMoved) return 'basis changed';
                  // Drawn when one side is `fte = 0` too (no percentage on file). Actual pay there is the full
                  // rate, so the Change column swings by the other side's FTE and the rate is the figure to read.
                  if (!r.salary || !from.salary || from.salary <= 0) return null;
                  return { rate: r.salary / from.salary - 1, fte: [from.fte || null, r.fte || null] };
                })();
                // A reporting change between this row and the one it is measured against: the
                // appointment's own prior row where the matcher found one, else any prior row under
                // the same title (a combined figure spans those).
                // A paired change that is not a continuing raise says why it is not compared — the rule
                // itself is continuingRaisesSql, which is what `comparisons` came from.
                const compare = ((): { text: string; compared: boolean; href?: string } | null => {
                  if (!comparisons || raise.kind !== 'paired') return null;
                  const c = comparisons.get(r.snapshot_id);
                  if (c) {
                    const href = from && r.job_code
                      ? `/raises?${new URLSearchParams({ from: from.snapshot_id, to: r.snapshot_id, title: r.job_code })}`
                      : undefined;
                    return { text: c.text, compared: true, href };
                  }
                  if (!from) return null;
                  const why = (apptCounts.get(r.snapshot_id) ?? 1) > 1 || (apptCounts.get(from.snapshot_id) ?? 1) > 1
                    ? 'several appointments'
                    : (r.fte || 1) !== (from.fte || 1)
                      ? 'FTE changed'
                      : !sameBasisAcross(from.comp_basis, r.comp_basis)
                        ? 'pay basis changed'
                        : 'a snapshot is missing between';
                  return { text: `not compared: ${why}`, compared: false };
                })();
                const reporting = stated.get(r)?.reporting ?? null;
            return (
              <Table.Tr
                key={`${r.snapshot_id}-${i}`}
                // Banding is by snapshot, not by row: Mantine's own striping put the two lines of
                // one snapshot on opposite stripes, pulling apart what belongs together. Parity
                // follows nth-of-type(odd) so a person with one line per snapshot is unchanged.
                data-band={pos % 2 === 0 ? '1' : '0'}
                // Only for a person who actually holds concurrent appointments. Otherwise every
                // row is the last of its own group and the strengthened boundary rule would land
                // on the 93.2% of tables this is not about.
                data-group-last={gutter.slots > 0 ? (lastOfGroup ? 'yes' : 'no') : undefined}
              >
                {gutter.slots > 0 && (
                  <Table.Td className="appt-gutter-td">
                    {cell && <LaneGutter cell={cell} count={apptTotal} />}
                  </Table.Td>
                )}
                <Table.Td className="appt-snapshot" data-fold>
                  {apptFirstRow.get(r.snapshot_id) === i && (
                    <>
                      <Badge variant="light" size="sm">{r.snapshot_label}</Badge>
                      {r.snapshot_id === newestId && <NewBadge ml={4} />}
                    </>
                  )}
                </Table.Td>
                <Table.Td>
                  {/* On a phone the snapshot, the title and the department are one cell. */}
                  {apptFirstRow.get(r.snapshot_id) === i && (
                    <div className="fold-under"><Badge variant="light" size="sm" mb={4}>{r.snapshot_label}</Badge>{r.snapshot_id === newestId && <NewBadge ml={4} />}</div>
                  )}
                  {r.title ?? '—'}
                  {isNew && (
                    // The change column's own word (P28): "Promotion" only where the grade rose, else "Title change";
                    // a new appointment with nothing before it is a "New title". The tag said "New title" beside a
                    // change the column called a promotion.
                    <Badge ml="xs" size="xs" variant="light" color={ttcReclass ? 'gray' : 'accent'} data-title-tag>
                      {ttcReclass ? 'Reclassified (TTC)' : raise.kind === 'titleChange' ? (raise.move === 'promotion' ? 'Promotion' : 'Title change') : 'New title'}
                    </Badge>
                  )}
                  <Text className="fold-under" size="xs" c="dimmed">
                    {[r.department, showSchool ? r.school : null].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  {/* On paper the job code and the department are under the title too. */}
                  <Text className="print-under" size="xs" c="dimmed">
                    {[r.job_code, r.department, showSchool ? r.school : null].filter(Boolean).join(' · ') || '—'}
                  </Text>
                </Table.Td>
                <Table.Td data-fold data-print-fold>{r.job_code ?? '—'}</Table.Td>
                <Table.Td data-fold data-print-fold>
                  {showSchool && <Text size="sm" className="appt-school">{r.school ?? '—'}</Text>}
                  <Group gap={6} wrap="nowrap">
                    {orgMoved && (
                      /* A tag that says what it marks (P34): it was an orange dot keyed in a footnote under the
                         table, in the colour that now means a fall. The tooltip names where they were. */
                      <MantineTooltip label={orgMovedLabel} withArrow multiline w={280}>
                        <Badge size="xs" variant="light" color="gray" radius="sm" className="dept-change-tag" aria-label={orgMovedLabel} style={{ flexShrink: 0 }}>
                          Dept change
                        </Badge>
                      </MantineTooltip>
                    )}
                    <Text size="xs" c="dimmed">{r.department ?? ''}</Text>
                  </Group>
                </Table.Td>
                {!onePay && <Table.Td ta="right" data-fold data-print-fold>{usd(r.salary)}</Table.Td>}
                <Table.Td ta="right">
                  {usd(actual)}
                  {!onePay && Math.round(r.salary ?? 0) !== Math.round(actual) && <Text className="print-under" size="xs" c="dimmed">rate {usd(r.salary)}</Text>}
                  {(r.salary ?? 0) > 0 && !counted.has(r) && <Text className="print-under not-in-pay" size="xs" c="dimmed">not in actual pay</Text>}
                </Table.Td>
                <Table.Td ta="right">
                  <RaiseCell raise={raise} note={rateNote} reporting={reporting} compare={compare}>
                    {/* A new title the matcher could not pair — the person held more than one
                        appointment on a side. It is new; whether it was a promotion is unknowable. */}
                    {isNew && !ttcReclass && pos > 0 ? (
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>new title</Text>
                    ) : (
                      <Text size="sm" c="dimmed">—</Text>
                    )}
                  </RaiseCell>
                </Table.Td>
                {/* `||`, not `??`: a recorded 0 means no appointment percentage on file (hourly), which is what the em dash says.
                    A percentage, as the trend's card gives it (P32): it printed "1". */}
                <Table.Td ta="right" data-fold>
                  {r.fte ? `${Math.round(r.fte * 100)}%` : '—'}
                  {r.comp_basis && <Text className="print-under" size="xs" c="dimmed">{fmtBasis(r.comp_basis)}</Text>}
                </Table.Td>
                <Table.Td data-fold data-print-fold>
                  {r.comp_basis ? <Text size="xs">{fmtBasis(r.comp_basis)}</Text> : (
                    // Said, not a dash (P33): from Nov 2021 to Apr 2024 the column was a run of "—".
                    <MantineTooltip label="The source did not report a pay basis for this snapshot." withArrow>
                      <Text size="xs" c="dimmed" className="basis-not-reported">Not reported</Text>
                    </MantineTooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      </Table.ScrollContainer>
      {/* The table's method, folded (G22): it closed on a 60-word footnote. */}
      <MethodNote className="history-method">
        <Text inherit>
          Rows run newest first, and each “Change” is measured from the snapshot below it. “Change” is the change in
          actual pay, so a change in appointment percentage or comp basis moves it on its
          own — where that has happened, what the full-time rate did is printed underneath. “Across both” means the
          change could only be measured across the lines together. “Dept change” marks an appointment whose
          division or department differs from its previous snapshot; point to it for where it was. “Not reported” in
          Basis: the source gave no pay basis for that snapshot.
        </Text>
      </MethodNote>
      {gutter.slots > 0 && (
        /* Only where there is a gutter to explain. The samples are the gutter's own class, so the key
           cannot drift from what it describes. */
        <Text size="xs" c="dimmed" mt={6}>
          Where a person holds several appointments at once, each runs as its own line down the left of
          the table, and each row is a letter on its line.{' '}
          <LaneStationSample /> continues the same appointment from the snapshot below;{' '}
          <LaneStationSample start /> means the source does not connect it to the previous snapshot, so
          its line starts there; a line that stops with a bar is an appointment that ended.
        </Text>
      )}
    </Card>
  );
}
