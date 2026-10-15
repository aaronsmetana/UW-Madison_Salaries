import type { CSSProperties } from 'react';
import { Anchor, Badge, Card, Group, ScrollArea, SimpleGrid, Skeleton, Stack, Text, Title, VisuallyHidden } from '@mantine/core';
import { CardTitle } from '../CardTitle';
import { Eyebrow } from '../Eyebrow';
import { useGrades, useRelease } from '../../lib/hooks';
import { isRange } from '../../lib/bands';
import { fmtChange, fmtDate, num, pct, usd } from '../../lib/format';

/** The longest run of consecutive grades: the series a structure is published in (15–35 today). */
function mainRun(grades: number[]): [number, number] | null {
  const gs = [...grades].sort((a, b) => a - b);
  let best: [number, number] | null = null;
  let start = 0;
  for (let i = 1; i <= gs.length; i++) {
    if (i === gs.length || gs[i] !== gs[i - 1] + 1) {
      if (!best || gs[i - 1] - gs[start] > best[1] - best[0]) best = [gs[start], gs[i - 1]];
      start = i;
    }
  }
  return best;
}

/**
 * The published salary structure every pay band here reads: which appointments it covers, every grade's range on
 * one axis, the grades with a minimum only, and how pay is held against a band. Read from grades.json and the
 * reference status, so the next structure rewrites all of it.
 */
export function RangesTab() {
  const { data: grades } = useGrades();
  const release = useRelease();
  const ref = release?.ref;
  if (!grades || !release) return <Skeleton height={600} radius="lg" />;
  // The figures are the same on every schedule (lib/bands); the 12-month rows list each grade once.
  const rows = grades.filter((g) => g.basis === 'annual_12mo').sort((a, b) => a.grade - b.grade);
  const ranges = rows.filter((g): g is typeof g & { max: number } => isRange(g));
  const floors = rows.filter((g) => !isRange(g));
  const run = mainRun(ranges.map((g) => g.grade));
  const inRun = (g: number) => !!run && g >= run[0] && g <= run[1];
  const series = ranges.filter((g) => inRun(g.grade));
  const outside = ranges.filter((g) => !inRun(g.grade));
  const steps = Math.max(1, Math.ceil(Math.max(0, ...ranges.map((g) => g.max)) / 100_000));
  const top = steps * 100_000;
  const at = (v: number) => `${((v / top) * 100).toFixed(2)}%`;
  const none = ref && ref.coverage != null && ref.floor_coverage != null ? Math.max(0, 1 - ref.coverage - ref.floor_coverage) : null;
  const runLabel = run ? `${run[0]}–${run[1]}` : '';
  const retrieved = ref?.retrieved_at ? fmtDate(ref.retrieved_at) : null;
  const updated = ref?.retrieved_at ? new Date(ref.retrieved_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;

  const row = (g: (typeof ranges)[number]) => {
    const mid = (g.min + g.max) / 2;
    return (
      <tr key={g.grade} data-grade={g.grade}>
        <th scope="row">{g.grade}</th>
        <td className="range-track-cell">
          <div className="range-track" aria-hidden>
            <div className="range-bar" style={{ left: at(g.min), width: at(g.max - g.min) }}>
              <span className="range-mid" style={{ left: `${(((mid - g.min) / (g.max - g.min)) * 100).toFixed(1)}%` }} />
            </div>
          </div>
        </td>
        <td>{usd(g.min)}</td>
        <td className="range-mid-value">{usd(mid)}</td>
        <td>{usd(g.max)}</td>
      </tr>
    );
  };

  return (
    <Stack gap="lg">
      <Card id="salary-ranges" className="salary-ranges">
        <CardTitle
          anchorId="salary-ranges"
          right={release.rangesUpdated && updated ? <Badge variant="light" color="accent" radius="sm" tt="none">Updated {updated}</Badge> : undefined}
          sub={<>
            UW–Madison&apos;s{' '}
            <Anchor href={ref?.source_url ?? 'https://hr.wisc.edu/pay/salary-structure/'} target="_blank" rel="noopener noreferrer" inherit>published salary structure</Anchor>
            {retrieved ? `, retrieved ${retrieved}` : ''}. HR states no effective date.
            {ref?.structure_change != null ? <> Figures are <b data-structure-change>{fmtChange(ref.structure_change)}</b> on the ranges this site carried before.</> : null}
          </>}
        >
          Which appointments a range can be read for
        </CardTitle>
        {ref && ref.coverage != null && (
          <>
            <div className="coverage-bar" role="img"
              aria-label={`Of ${num(ref.graded_rows)} graded appointments: ${pct(ref.coverage, 0)} have a published range, ${pct(ref.floor_coverage ?? null, 0)} a minimum only${none != null ? `, ${pct(none, 0)} none` : ''}.`}>
              <span className="coverage-full" style={{ width: pct(ref.coverage, 2) }} />
              <span className="coverage-floor" style={{ width: pct(ref.floor_coverage ?? 0, 2) }} />
              <span className="coverage-none" style={{ flex: 1 }} />
            </div>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg" mt="md" className="salary-ranges-coverage">
              <div className="coverage-key" data-figure="range-coverage">
                <span className="coverage-swatch coverage-full" aria-hidden />
                <div>
                  <Text className="coverage-big">{pct(ref.coverage, 0)}</Text>
                  <Text size="sm" fw={650}>Full range</Text>
                  <Text size="xs" c="dimmed">{num(ref.matched_rows)} of {num(ref.graded_rows)} graded appointments.{runLabel ? ` Grades ${runLabel}.` : ''}</Text>
                </div>
              </div>
              <div className="coverage-key" data-figure="floor-coverage">
                <span className="coverage-swatch coverage-floor" aria-hidden />
                <div>
                  <Text className="coverage-big">{pct(ref.floor_coverage ?? null, 0)}</Text>
                  <Text size="sm" fw={650}>Minimum only</Text>
                  <Text size="xs" c="dimmed">{ref.floor_rows != null ? `${num(ref.floor_rows)} more. ` : ''}Most of grades 51–99: says whether pay is below the floor, nothing about a top.</Text>
                </div>
              </div>
              <div className="coverage-key" data-figure="no-range">
                <span className="coverage-swatch coverage-none" aria-hidden />
                <div>
                  <Text className="coverage-big">{none == null ? '—' : pct(none, 0)}</Text>
                  <Text size="sm" fw={650}>None published</Text>
                  <Text size="xs" c="dimmed">HR lists these as “Contact your division”, “Varies by job title” or “Not applicable”.</Text>
                </div>
              </div>
            </SimpleGrid>
          </>
        )}
      </Card>

      <Card id="range-chart">
        <CardTitle
          anchorId="range-chart"
          sub="12-month full-time salary, the same on each schedule the data uses. Each bar runs from minimum to maximum; the notch is the midpoint."
          right={
            <Group gap="md" className="range-key" aria-hidden>
              <span><span className="range-key-bar" /> Min to max</span>
              <span><span className="range-key-mid" /> Midpoint</span>
            </Group>
          }
        >
          {num(ranges.length)} grades with a full range
        </CardTitle>
        <ScrollArea.Autosize type="auto" offsetScrollbars="present" viewportProps={{ role: 'region', tabIndex: 0, 'aria-label': 'Grades with a full range' }}>
          <table className="range-table" style={{ '--range-steps': steps } as CSSProperties}>
            <VisuallyHidden component="caption">Each grade&apos;s minimum, midpoint and maximum, 12-month full-time salary</VisuallyHidden>
            <thead>
              <tr>
                <th scope="col">Grade</th>
                <th scope="col" className="range-axis-head">
                  <VisuallyHidden>Range</VisuallyHidden>
                  <div className="range-axis" aria-hidden>
                    {Array.from({ length: steps + 1 }, (_, i) => (
                      <span key={i} style={{ left: `${(i / steps) * 100}%`, transform: `translateX(${i === 0 ? '0' : i === steps ? '-100%' : '-50%'})` }}>
                        {i === 0 ? '$0' : `$${i * 100}k`}
                      </span>
                    ))}
                  </div>
                </th>
                <th scope="col">Min</th>
                <th scope="col">Mid</th>
                <th scope="col">Max</th>
              </tr>
            </thead>
            <tbody>
              {series.map(row)}
              {outside.length > 0 && (
                <tr className="range-outside">
                  <th scope="rowgroup" colSpan={5}>Outside the {runLabel} series</th>
                </tr>
              )}
              {outside.map(row)}
            </tbody>
          </table>
        </ScrollArea.Autosize>
      </Card>

      <Card id="minimum-only">
        <CardTitle anchorId="minimum-only" sub="Used for “below grade minimum” and nothing else.">
          {num(floors.length)} grades with a minimum only
        </CardTitle>
        <div className="floor-tiles">
          {floors.map((g) => (
            <div key={g.grade} className="floor-tile" data-grade={g.grade}>
              <Eyebrow>Grade {g.grade}</Eyebrow>
              <Text fw={650} className="tabular">{usd(g.min)}</Text>
            </div>
          ))}
        </div>
      </Card>

      <Card id="band-rules">
        <CardTitle anchorId="band-rules">How pay is held against a band</CardTitle>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {[
            ['Full-time rate, never part-time pay', 'A band is compared with the full-time rate of the appointment that carries the grade.'],
            ['Hourly pay at 2,080 hours', 'Hourly rates are annualized the way the source reports them.'],
            ['9-month appointments at 12 months', 'Compared at their 12-month equivalent, as reported since Sep 2025. Before that, the band is scaled by HR’s own 9/11.'],
          ].map(([t, d]) => (
            <div key={t} className="muted-panel">
              <Title order={3} fz="sm" fw={650}>{t}</Title>
              <Text size="sm" c="dimmed" mt={4}>{d}</Text>
            </div>
          ))}
        </SimpleGrid>
        <Text size="sm" c="dimmed" mt="md">
          Read by: a person&apos;s place in their range, the compa-ratio, Screening&apos;s “below market floor” (85% of the midpoint)
          and “below grade minimum”.
        </Text>
      </Card>
    </Stack>
  );
}
