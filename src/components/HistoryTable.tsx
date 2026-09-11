import { useMemo, type ReactNode } from 'react';
import { Card, Table, Badge, Text, Group, Tooltip as MantineTooltip } from '@mantine/core';
import { CardTitle } from './CardTitle';
import { GlossaryTerm } from './GlossaryTerm';
import { LaneGutter, LaneStationSample } from './LaneGutter';
import { matchAppointments, acrossLabel, byAppointment, combinedReason, laneGutter, type Raise } from '../lib/payHistory';
import { actualPay, sameBasis, reportingChange } from '../lib/queries';
import { usd, pct, fmtBasis, fmtChange } from '../lib/format';
import { ttcRank } from '../lib/snapshotOrder';

/**
 * The person page's title & salary history table.
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
    : <Text size="sm" fw={600} c={delta > 0 ? 'pos' : 'orange'}>{fmtChange(delta)}</Text>;
}

/**
 * The history table's "Change" cell. Its states follow the matcher (see payHistory.ts): a paired
 * change, one measured across appointments the source cannot tell apart, a lone appointment that
 * moved title, and nothing to compare. `children` is the last of those. `reporting` names a reporting
 * change between the two snapshots — no figure is drawn across one, because it is not a change in pay.
 */
function RaiseCell({ raise, note, reporting, children }: { raise: Raise; note?: string | null; reporting?: string | null; children: ReactNode }) {
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
          c={raise.move === 'promotion' ? 'accent.7' : 'dimmed'}
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

  if (reporting) {
    return (<><Text size="sm" c="dimmed">—</Text><span className="appt-reporting-note">{reporting}</span></>);
  }

  const figure = <ChangeFigure delta={raise.delta} />;
  if (raise.kind === 'paired') {
    // The figure is the change in ACTUAL pay, so an appointment-percentage or comp-basis move lands
    // in it looking like a pay change. Where that has happened the note says what the RATE did —
    // the number the reader came for, and the only one they cannot get elsewhere on the page.
    return note ? (<>{figure}<span className="appt-rate-note">{note}</span></>) : figure;
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

export function HistoryTable({ rows }: { rows: readonly HistoryRow[] }) {
  // Appointment count per snapshot, for the station's tooltip ("A of 2", or "the only one").
  const apptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.snapshot_id, (m.get(r.snapshot_id) ?? 0) + 1);
    return m;
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

  // Where each snapshot's first row sits — the one row of the group that carries the snapshot's
  // label, now that the label is printed once per snapshot rather than once per line.
  const apptFirstRow = useMemo(() => {
    const m = new Map<string, number>();
    historyRows.forEach((r, i) => { if (!m.has(r.snapshot_id)) m.set(r.snapshot_id, i); });
    return m;
  }, [historyRows]);

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

  return (
    <Card withBorder padding="lg">
      <CardTitle>Title & salary history</CardTitle>
      {/* The gutter is a fixed 22px per slot plus the cell padding (app.css), so the floor grows with it. */}
      <Table.ScrollContainer minWidth={gutter.slots ? 900 + gutter.slots * 22 : 880}>
      {/* Striping is off because it is done per snapshot group in app.css instead — see .appt-history. */}
      <Table
        className="appt-history"
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
            <Table.Th className="appt-snapshot">Snapshot</Table.Th>
            <Table.Th>Title</Table.Th>
            <Table.Th>Job code</Table.Th>
            <Table.Th>School / Dept</Table.Th>
            <Table.Th ta="right"><GlossaryTerm term="rate">Rate</GlossaryTerm></Table.Th>
            <Table.Th ta="right"><GlossaryTerm term="actualPay">Actual pay</GlossaryTerm></Table.Th>
            <Table.Th ta="right"><GlossaryTerm term="payChange">Change</GlossaryTerm></Table.Th>
            <Table.Th ta="right">FTE</Table.Th>
            <Table.Th>Basis</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {historyRows.map((r, i) => {
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
            const lastOfGroup = i === historyRows.length - 1 || historyRows[i + 1].snapshot_id !== r.snapshot_id;
            // Org move = this appointment's OWN department a snapshot ago. It used to compare
            // against the previous displayed row, which on a split page is a different appointment
            // entirely: 4,787 rows across the data were guaranteed a dot that meant nothing.
            const orgMoved = !!from && ((r.school ?? '') !== (from.school ?? '') || (r.department ?? '') !== (from.department ?? ''));
                const orgMovedLabel = orgMoved
                  ? `Division/Department changed since this appointment's previous snapshot — was: ${[from!.school, from!.department].filter(Boolean).join(' · ') || 'not recorded'}`
                  : '';
                // Why the Change column may not mean what it looks like. It reports the change in ACTUAL pay
                // (rate x FTE), so an appointment-percentage or comp-basis move shows up as if it were a pay
                // change: 4,159 figures across the data coincide with an FTE change, and 2,519 carry a sign
                // that contradicts what the rate did.
                const rateNote = ((): string | null => {
                  if (!from || raise.kind !== 'paired') return null;
                  // `sameBasis`, never `!==`. The source renamed its own vocabulary — Annual to 12 Month,
                  // Academic to 9 Month — and left the column null before it existed, so a literal comparison
                  // calls 35,313 pairs a basis change when 2,720 of them are.
                  const basisMoved = !sameBasis(r.comp_basis, from.comp_basis);
                  // Matches FTE_MULT: a zero or missing FTE counts as full-time.
                  const fteMoved = (r.fte || 1) !== (from.fte || 1);
                  if (!basisMoved && !fteMoved) return null;
                  // A 9-month rate and a 12-month rate are not the same quantity, so no percentage is drawn
                  // across that boundary — the Basis column already says what it is now.
                  if (basisMoved) return 'basis changed';
                  // Drawn when one side is `fte = 0` too (no percentage on file). Actual pay there is the full
                  // rate, so the Change column swings by the other side's FTE and the rate is the figure to read.
                  if (!r.salary || !from.salary || from.salary <= 0) return null;
                  const d = r.salary / from.salary - 1;
                  return `rate ${d >= 0 ? '+' : ''}${pct(d)}`;
                })();
                // A reporting change between this row and the one it is measured against: the
                // appointment's own prior row where the matcher found one, else any prior row under
                // the same title (a combined figure spans those).
                const reporting = ((): string | null => {
                  const priors = from ? [from] : historyRows.filter((x) => x.snapshot_id === priorId && x.job_code === r.job_code);
                  const hit = priors.map((x) => reportingChange(x.comp_basis, r.comp_basis)).find(Boolean);
                  return hit ? hit.note : null;
                })();
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
                <Table.Td className="appt-snapshot">
                  {apptFirstRow.get(r.snapshot_id) === i && (
                    <Badge variant="light" size="sm">{r.snapshot_label}</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  {r.title ?? '—'}
                  {isNew && (
                    <Badge ml="xs" size="xs" variant="light" color={ttcReclass ? 'gray' : 'accent'}>
                      {ttcReclass ? 'Reclassified (TTC)' : 'New title'}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{r.job_code ?? '—'}</Table.Td>
                <Table.Td>
                  <Text size="sm">{r.school ?? '—'}</Text>
                  <Group gap={6} wrap="nowrap">
                    {orgMoved && (
                      /* The dot was colour plus a hover tooltip and nothing else: invisible to a screen
                         reader, unreachable by keyboard, and it left the reader to scroll up and
                         diff two rows themselves. Both the label and the tooltip now name what it
                         was. */
                      <MantineTooltip label={orgMovedLabel} withArrow multiline w={280}>
                        <span
                          role="img"
                          aria-label={orgMovedLabel}
                          style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mantine-color-orange-6)', flexShrink: 0, display: 'inline-block' }}
                        />
                      </MantineTooltip>
                    )}
                    <Text size="xs" c="dimmed">{r.department ?? ''}</Text>
                  </Group>
                </Table.Td>
                <Table.Td ta="right">{usd(r.salary)}</Table.Td>
                <Table.Td ta="right">{usd(actual)}</Table.Td>
                <Table.Td ta="right">
                  <RaiseCell raise={raise} note={rateNote} reporting={reporting}>
                    {/* A new title the matcher could not pair — the person held more than one
                        appointment on a side. It is new; whether it was a promotion is unknowable. */}
                    {isNew && !ttcReclass && pos > 0 ? (
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>new title</Text>
                    ) : (
                      <Text size="sm" c="dimmed">—</Text>
                    )}
                  </RaiseCell>
                </Table.Td>
                {/* `||`, not `??`: a recorded 0 means no appointment percentage on file (hourly), which is what the em dash says. */}
                <Table.Td ta="right">{r.fte || '—'}</Table.Td>
                <Table.Td><Text size="xs">{fmtBasis(r.comp_basis)}</Text></Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      </Table.ScrollContainer>
      <Group gap={6} mt="sm" wrap="wrap">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mantine-color-orange-6)', flexShrink: 0, display: 'inline-block' }} />
        <Text size="xs" c="dimmed">
          = department changed since this appointment’s previous snapshot. “Change” is the change in
          actual pay, so a change in appointment percentage or comp basis moves it on its own — where
          that has happened, what the full-time rate did is printed underneath. “Across both” means the
          change could only be measured across the lines together.
        </Text>
      </Group>
      {gutter.slots > 0 && (
        /* Only where there is a gutter to explain. The samples are the gutter's own class, so the key
           cannot drift from what it describes. */
        <Text size="xs" c="dimmed" mt={6}>
          Where a person holds several appointments at once, each runs as its own line down the left of
          the table, and each row is a letter on its line.{' '}
          <LaneStationSample /> continues the same appointment from the snapshot above;{' '}
          <LaneStationSample start /> means the source does not connect it to the previous snapshot, so
          its line starts there; a line that stops with a bar is an appointment that ended.
        </Text>
      )}
    </Card>
  );
}
