import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, Title, Text, Divider, Paper, Group, Stack, SimpleGrid, Table, Badge, ThemeIcon, Progress, Box, Anchor } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { IconChartBar, IconScale, IconHistory, IconGauge, IconUserPlus, IconUsers, IconTrendingDown } from '@tabler/icons-react';
import { usd, pct, plural } from '../../lib/format';
import { AXIS_TICK, GRID, fmtUsd } from '../../lib/chartStyle';
import { PeerRangeBar } from '../PeerRangeBar';
import { TenurePayScatter } from '../TenurePayScatter';
import { ChartTooltip } from '../chart/ChartTooltip';
import { DeltaChip } from '../Delta';
import { GlossaryTerm } from '../GlossaryTerm';
import { Sup, NotesList, SourcesList, type CitationKey } from './sources';
import { CAND, PEER, ordinal, type BriefModel, type ProofKind } from './model';

/** "2024-03-15" → "Mar '24" for a compact x-axis on the pay-history chart. */
function fmtHistTick(d: string): string {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = Number(d.slice(5, 7));
  return `${MON[m - 1] ?? ''} '${d.slice(2, 4)}`;
}

/** Smoothly tween a number toward its target (respects reduced-motion). */
function useAnimatedNumber(target: number, duration = 500) {
  const [val, setVal] = useState(target);
  const from = useRef(target);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) { setVal(target); from.current = target; return; }
    const start = performance.now();
    const base = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(base + (target - base) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);
  return val;
}

const PROOF_ICON: Record<ProofKind, ReactNode> = {
  market: <IconChartBar size={22} />,
  inversion: <IconScale size={22} />,
  sustained: <IconHistory size={22} />,
  gradeband: <IconGauge size={22} />,
  compression: <IconUserPlus size={22} />,
  supervisory: <IconUsers size={22} />,
  tenureTrend: <IconTrendingDown size={22} />,
};

export function ReportBrief({ model, hovered, onHover }: {
  model: BriefModel;
  hovered: string | null;
  onHover: (id: string | null) => void;
}) {
  const {
    subjectName, subjectFirst, subjectPay, headerMeta, recommended, belowTarget, targetDelta, targetPct,
    basisLabel, receipt, proofs, yearsToParity, yearsToParityRate, yearsToParityObserved, realErosion, rows, maxPay, showTenure, anonymize,
    attrition, divergence, history, format, sections, jobCode, activeFactors, supervisory, generated, snapLabel,
    standing, tenureScatterPoints, raiseCycle,
  } = model;
  const otherRows = rows.filter((r) => !r.isSubject);
  const anonName = (key: string) => {
    const idx = otherRows.findIndex((r) => r.key === key);
    return idx >= 0 && idx < 26 ? `Peer ${String.fromCharCode(65 + idx)}` : 'Peer';
  };

  const animated = useAnimatedNumber(recommended ?? 0);
  const has = (s: string) => sections.includes(s);
  const showReceipt = receipt.length > 1; // base + at least one add-on / negotiated line
  const aMax = divergence ? Math.max(divergence.avgAbs, divergence.subjAbs, 1) : 1;
  // The detailed-format tenure scatter reuses the shared TenurePayScatter component as-is (same
  // self-inclusive fit line as the Person page) — its callout may read a hair different from the
  // proof card above, which fits peers only for a stricter, self-independent evidence claim.
  const selfScatterPt = tenureScatterPoints.find((p) => p.isSelf);
  const raiseDistMax = raiseCycle ? Math.max(1, ...raiseCycle.dist.map((d) => d.n)) : 1;

  // ── Section numbering — sequential, based on what actually renders (a toggled-off section leaves
  //    no gap in the numbering). Keep each `show` condition identical to that section's own JSX gate. ──
  const sectionShow = {
    highlights: has('highlights') && proofs.length > 0,
    standing: has('standing') && !!standing && standing.min != null && standing.p25 != null && standing.med != null && standing.p75 != null && standing.max != null,
    factors: has('factors') && activeFactors.length > 0,
    peers: has('peers') && rows.length > 1,
    history: has('history') && history.length >= 2,
    risk: has('risk'),
  };
  const sectionOrder: (keyof typeof sectionShow)[] = ['highlights', 'standing', 'factors', 'peers', 'history', 'risk'];
  const sectionNum: Partial<Record<keyof typeof sectionShow, number>> = {};
  {
    let n = 1; // "1." is always the Recommendation, which renders whenever subjectPay != null
    for (const key of sectionOrder) if (sectionShow[key]) sectionNum[key] = ++n;
  }
  const notesSectionNum = Object.keys(sectionShow).filter((k) => sectionShow[k as keyof typeof sectionShow]).length + 2;

  // ── Footnotes — one numbered list, built from exactly the claims rendered THIS printing. `fn(id)`
  //    resolves an id to its footnote number (0 → render nothing, via <Sup>). ──
  const hasPercentileClaim = proofs.some((p) => p.kind === 'market') || (standing?.pools.length ?? 0) > 0;
  const noteDefs: { id: string; when: boolean; text: ReactNode }[] = [
    { id: 'identity', when: true, text: 'Source: UW–Madison salary data (Wisconsin public record); zero/unreported salaries excluded; identity matched on name + date of hire.' },
    { id: 'basis', when: belowTarget, text: "The title median is the median pay of everyone sharing the subject's job code at this snapshot. The tenure-adjusted target (used once at least 5 same-title peers meet or exceed the subject's tenure) is the median for that narrower, more comparable group instead." },
    { id: 'parity', when: yearsToParity != null && yearsToParity >= 0.5, text: 'Time-to-parity assumes compounding raises at the stated annual rate with no other adjustment — a projection, not a commitment.' },
    { id: 'tenure', when: showTenure, text: '"Tenure" = years since the UW–Madison date of hire (not total career experience), computed as of this snapshot.' },
    { id: 'percentile', when: hasPercentileClaim, text: 'Percentile = the share of the comparison pool paid less than the subject; the subject is never counted against themself.' },
    { id: 'supervisory', when: supervisory.reports.length > 0, text: <>Per the UW–Madison Salary Administration Guidelines&rsquo; &ldquo;Supervisors or Managers and Subordinates&rdquo; provision: at least a 15% pay differential between a supervisor/manager and a non-managing subordinate (pay differential = (higher salary &minus; lower salary) &divide; lower salary). See Sources.</> },
    { id: 'gradeband', when: proofs.some((p) => p.kind === 'gradeband'), text: "Compa-ratio = pay ÷ the grade's official band midpoint (a standard compensation metric; 1.00 = exactly at midpoint)." },
    { id: 'tenureTrend', when: proofs.some((p) => p.kind === 'tenureTrend'), text: "The tenure-vs-pay trend is an ordinary least-squares fit of same-title peers' pay on tenure (the subject excluded from the fit), evaluated at the subject's own tenure." },
    { id: 'raiseCycle', when: !!raiseCycle, text: 'The raise-cycle comparison covers continuing appointments only (present in both snapshots) in the same job code; the annualized rate compounds the median cycle raise over the actual elapsed months between the two snapshots.' },
    { id: 'selfReported', when: has('factors') && activeFactors.length > 0, text: 'Value-add adjustments under "Documented qualifications & responsibilities" are self-reported by the subject, not independently verified against a position description or performance record.' },
    { id: 'cpi', when: !!realErosion, text: 'Real-dollar (inflation-adjusted) figures use BLS Consumer Price Index (CPI-U) annual averages; recent years use the latest available approximation. See Sources.' },
    { id: 'retention', when: has('risk'), text: 'Replacement-cost estimates are industry-wide benchmarks, not specific to this employee, role, or institution; the attrition figure, where shown, is drawn directly from the public salary record. See Sources.' },
  ];
  const activeNotes = noteDefs.filter((n) => n.when);
  const fn = (id: string) => {
    const i = activeNotes.findIndex((n) => n.id === id);
    return i >= 0 ? i + 1 : 0;
  };
  const sourceIds: CitationKey[] = [
    'wisStat', 'ufas',
    ...(supervisory.reports.length > 0 ? (['uwSalaryGuidelines'] as CitationKey[]) : []),
    ...(proofs.some((p) => p.kind === 'gradeband') ? (['uwHrGrades'] as CitationKey[]) : []),
    ...(realErosion ? (['bls'] as CitationKey[]) : []),
    ...(has('risk') ? (['workInstitute', 'gallup'] as CitationKey[]) : []),
  ];
  const PROOF_NOTE: Partial<Record<ProofKind, string>> = {
    market: 'percentile', supervisory: 'supervisory', gradeband: 'gradeband', tenureTrend: 'tenureTrend',
  };

  return (
    <Card withBorder padding="xl" className="print-area report-brief">
      <Title order={3}>Internal Equity &amp; Parity Review</Title>
      <Text c="dimmed" mt={2}>
        Prepared for <Text span fw={600} c="bright">{subjectName || '—'}</Text>
        {headerMeta ? ` · ${headerMeta}` : ''}
      </Text>
      {subjectPay != null && (
        <Text size="xs" c="dimmed" mt={2}>
          Data through {snapLabel} · generated {generated} · UW–Madison salary data released under Wisconsin's public-records law<Sup n={fn('identity')} />.
        </Text>
      )}
      <Divider my="md" />

      {subjectPay == null ? (
        <Text c="dimmed">Pick a subject and add comparators on the left to build the review.</Text>
      ) : (
        <>
          {/* Recommendation hero — with the itemized "receipt" docked directly under the number */}
          {belowTarget && recommended != null ? (
            <Paper radius="md" p="xl" bg="var(--mantine-color-accent-light)" mb="lg">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.05em' }}>1. Recommendation</Text>
              <Text fw={800} c="green.8" lh={1} style={{ fontSize: 'clamp(2.5rem, 6vw, 3.5rem)', letterSpacing: '-0.02em' }}>
                {usd(Math.round(animated))}
              </Text>
              <Text mt={8}>
                Adjust <b>{subjectName}</b> from <b>{usd(subjectPay)}</b> to <b>{usd(recommended)}</b>{' '}
                (<Text span fw={700} c="green.7">+{usd(targetDelta)}, {pct(targetPct)}</Text>){showReceipt ? '.' : ` — ${basisLabel}.`}<Sup n={fn('basis')} />
              </Text>
              {yearsToParity != null && yearsToParity >= 0.5 && (
                <Text size="xs" c="dimmed" mt={4}>
                  Absent this adjustment, a raise at {pct(yearsToParityRate)}/yr ({yearsToParityObserved ? "this title's own observed raise rate" : 'a standard assumption'}) alone
                  would take ~{Math.ceil(yearsToParity)} more {Math.ceil(yearsToParity) === 1 ? 'year' : 'years'} to reach today's median.<Sup n={fn('parity')} />
                </Text>
              )}

              {showReceipt && (
                <Box mt="lg" pt="md" style={{ borderTop: '1px solid var(--mantine-color-accent-2)' }}>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb={6} style={{ letterSpacing: '0.05em' }}>How this figure is built</Text>
                  <Stack gap={4}>
                    {receipt.map((line) => {
                      const lit = line.kind === 'addon' && hovered === `factor:${line.id}`;
                      // Each value-add also shown as a % of current pay (ties back to the +1% / +2.5% pills).
                      const linePct = line.kind !== 'base' && subjectPay ? line.amount / subjectPay : null;
                      return (
                        <Group
                          key={line.id}
                          justify="space-between"
                          wrap="nowrap"
                          px={6}
                          style={{ borderRadius: 6, background: lit ? 'var(--mantine-color-default-hover)' : undefined, transition: 'background 150ms' }}
                        >
                          <Text size="sm" c={line.kind === 'base' ? undefined : 'dimmed'} fw={line.kind === 'base' ? 600 : 400}>
                            {line.kind === 'addon' ? '+ ' : ''}{line.label}
                          </Text>
                          <Text size="sm" fw={line.kind === 'base' ? 600 : 400} c={line.kind === 'negotiated' ? 'dimmed' : undefined}>
                            {line.kind !== 'base' && line.amount >= 0 ? '+' : ''}{usd(line.amount)}
                            {linePct != null && <Text span c="dimmed" fw={400}> ({linePct >= 0 ? '+' : ''}{pct(linePct)})</Text>}
                          </Text>
                        </Group>
                      );
                    })}
                    <Divider my={4} />
                    <Group justify="space-between" wrap="nowrap" px={6}>
                      <Text size="sm" fw={800}>Total parity recommendation</Text>
                      <Text size="sm" fw={800} c="green.7">{usd(recommended)}<Text span fw={600}> (+{pct(targetPct)})</Text></Text>
                    </Group>
                  </Stack>
                </Box>
              )}
            </Paper>
          ) : (
            <Paper withBorder radius="md" p="lg" mb="lg">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.05em' }}>1. Recommendation</Text>
              <Text fw={700} fz="lg" mt={4}>
                {subjectFirst} is at or above the parity target{recommended != null ? ` (${usd(recommended)})` : ''} — maintain current pay.
              </Text>
            </Paper>
          )}

          {!jobCode && (
            <Text size="sm" c="dimmed" mb="lg">No job code on record for {subjectName} in this snapshot, so title-market benchmarking is limited.</Text>
          )}

          {/* Why — the proofs. This is objective, salary+tenure-derived evidence, distinct from (and
              ordered before) the self-reported value-adds in "Documented qualifications" below. */}
          {sectionShow.highlights && (
            <>
              <Text size="sm" fw={600} mb="xs">{sectionNum.highlights}. Why this is an equity correction <Text span c="dimmed" size="xs" fw={400}>· objective evidence</Text></Text>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: Math.min(3, proofs.length) }} mb="lg">
                {proofs.map((p) => (
                  <Card key={p.kind} withBorder radius="md" shadow="sm" padding="lg">
                    <ThemeIcon variant="light" color="accent" size={38} radius="md">{PROOF_ICON[p.kind]}</ThemeIcon>
                    <Text fw={800} fz={26} mt="sm" lh={1.1}>{p.value}</Text>
                    <Text size="sm" c="dimmed" mt={4}>{p.label}</Text>
                    {p.detail && <Text size="xs" c="dimmed" mt={6}>{p.detail}{PROOF_NOTE[p.kind] && <Sup n={fn(PROOF_NOTE[p.kind]!)} />}</Text>}
                  </Card>
                ))}
              </SimpleGrid>
            </>
          )}

          {has('highlights') && realErosion && (
            <Text size="sm" c="dimmed" mb="lg">
              Since {realErosion.firstYear}, {subjectFirst}'s pay rose {pct(realErosion.nominalPct)} nominally — a{' '}
              <Text span fw={600}>{pct(Math.abs(realErosion.realPct))} decline</Text> in real (CPI-adjusted) purchasing power.<Sup n={fn('cpi')} />
            </Text>
          )}

          {/* Market standing — a distribution view of the active benchmark cohort + how the subject
              stands across every other available comparison pool (title/grade/division/tenure-band). */}
          {sectionShow.standing && standing && (
            <>
              <Text size="sm" fw={600} mb="xs">{sectionNum.standing}. Market standing</Text>
              <Card withBorder radius="md" shadow="sm" padding="lg" mb="lg">
                <Text size="xs" c="dimmed" mb="md">
                  {subjectFirst}'s pay against {standing.cohortLabel} (n = {standing.values.length}).
                </Text>
                <PeerRangeBar min={standing.min!} p25={standing.p25!} median={standing.med!} p75={standing.p75!} max={standing.max!} value={subjectPay} values={standing.values} />

                {standing.pools.length > 0 && (
                  <Table mt="lg" style={{ maxWidth: 640 }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Comparison pool</Table.Th>
                        <Table.Th ta="right">n</Table.Th>
                        <Table.Th ta="right">Median</Table.Th>
                        <Table.Th ta="right"><GlossaryTerm term="percentile">Percentile</GlossaryTerm><Sup n={fn('percentile')} /></Table.Th>
                        <Table.Th ta="right">vs. median</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {standing.pools.map((p) => (
                        <Table.Tr key={p.label}>
                          <Table.Td>{p.label}</Table.Td>
                          <Table.Td ta="right">{p.n}</Table.Td>
                          <Table.Td ta="right">{usd(p.med)}</Table.Td>
                          <Table.Td ta="right">{p.percentile != null ? ordinal(p.percentile) : '—'}</Table.Td>
                          <Table.Td ta="right">
                            <DeltaChip frac={p.med != null && p.med > 0 ? (subjectPay - p.med) / p.med : null} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}

                {format === 'detailed' && tenureScatterPoints.length >= 2 && (
                  <Box mt="lg" pt="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                    <Text size="sm" fw={700} mb={4}>Pay vs. tenure — same-title peers</Text>
                    <TenurePayScatter
                      points={tenureScatterPoints}
                      self={selfScatterPt ? { tenure: selfScatterPt.tenure, pay: selfScatterPt.pay } : null}
                      titleLabel="this title"
                    />
                  </Box>
                )}
              </Card>
            </>
          )}

          {/* Documented qualifications & responsibilities — self-reported value-adds, distinct from and
              ordered after the objective evidence above. */}
          {sectionShow.factors && (
            <>
              <Text size="sm" fw={600} mb="xs">
                {sectionNum.factors}. Documented qualifications &amp; responsibilities <Text span c="dimmed" size="xs" fw={400}>· self-reported</Text><Sup n={fn('selfReported')} />
              </Text>
              <Card withBorder radius="md" shadow="sm" padding="lg" mb="lg">
                <Stack gap={10}>
                  {activeFactors.map((f) => (
                    <Group key={f.key} justify="space-between" wrap="nowrap" align="flex-start">
                      <Box style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600}>{f.label}</Text>
                        {f.note && <Text size="xs" c="dimmed">{f.note}</Text>}
                      </Box>
                      {f.amount != null && (
                        <Text size="sm" fw={700} c="green.7" style={{ flexShrink: 0 }}>+{usd(f.amount)}</Text>
                      )}
                    </Group>
                  ))}
                </Stack>
              </Card>
            </>
          )}

          {/* Peer comparison matrix */}
          {sectionShow.peers && (
            <>
              <Text size="sm" fw={600} mb="xs">{sectionNum.peers}. Peer comparison <Text span c="dimmed" size="xs">· your named comparators (n = {rows.length - 1})</Text></Text>
              <Card withBorder radius="md" shadow="sm" p={0} mb="lg" style={{ maxWidth: 900, overflow: 'hidden' }}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Title</Table.Th>
                      {showTenure && <Table.Th ta="right"><GlossaryTerm term="tenure">Tenure</GlossaryTerm><Sup n={fn('tenure')} /></Table.Th>}
                      <Table.Th>Salary</Table.Th>
                      <Table.Th ta="right">vs {subjectFirst}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((r) => {
                      const lit = hovered === `peer:${r.key}`;
                      const bg = r.isSubject
                        ? 'var(--mantine-color-accent-light)'
                        : r.isAnomaly
                          ? 'var(--mantine-color-accent-0)'
                          : lit ? 'var(--mantine-color-default-hover)' : undefined;
                      return (
                        <Table.Tr
                          key={r.key}
                          onMouseEnter={() => onHover(`peer:${r.key}`)}
                          onMouseLeave={() => onHover(null)}
                          style={{ background: bg, boxShadow: r.isAnomaly && !r.isSubject ? 'inset 4px 0 0 var(--mantine-color-accent-6)' : undefined, transition: 'background 150ms' }}
                        >
                          <Table.Td>
                            {r.isSubject ? (
                              <><b>{r.name}</b> <Badge size="xs" variant="light" color="accent" tt="none" ml={4}>Review Subject</Badge></>
                            ) : (
                              <>
                                {anonymize ? (
                                  <Text span>{anonName(r.key)}</Text>
                                ) : (
                                  <Anchor component={Link} to={`/person/${encodeURIComponent(r.key)}`} c="inherit" underline="hover">
                                    {r.name}
                                  </Anchor>
                                )}
                                {r.isAnomaly
                                  ? <Badge size="xs" variant="filled" color="accent" tt="none" ml={6}>Pay inversion</Badge>
                                  : r.lessTenure && <Badge size="xs" variant="light" color="accent" tt="none" ml={6}>less tenure</Badge>}
                              </>
                            )}
                          </Table.Td>
                          <Table.Td>{r.title ?? '—'}</Table.Td>
                          {showTenure && <Table.Td ta="right">{r.tenure != null ? `${r.tenure.toFixed(1)} yr` : '—'}</Table.Td>}
                          <Table.Td style={{ minWidth: 200 }}>
                            <Text size="sm" fw={r.isSubject ? 700 : 500}>{usd(r.pay)}</Text>
                            <div style={{ position: 'relative', marginTop: 3, height: 6, borderRadius: 3, background: 'var(--mantine-color-gray-2)' }}>
                              <div style={{ width: `${(r.pay / maxPay) * 100}%`, height: '100%', borderRadius: 3, background: r.isSubject ? CAND : PEER, transition: 'width 300ms ease' }} />
                              {!r.isSubject && subjectPay != null && (
                                <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${(subjectPay / maxPay) * 100}%`, width: 2, background: CAND }} />
                              )}
                            </div>
                          </Table.Td>
                          <Table.Td ta="right">
                            {r.isSubject ? (
                              <Text span size="xs" c="dimmed">baseline</Text>
                            ) : (
                              <Text span fw={r.gap > 0 ? 800 : 700} fz={r.gap > 0 ? 'md' : 'sm'} c={r.isAnomaly ? 'accent.7' : 'dimmed'}>
                                {r.gap > 0 ? '+' : r.gap < 0 ? '−' : ''}{usd(Math.abs(r.gap))}
                              </Text>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Card>
            </>
          )}

          {/* Pay history — subject vs. title median over time, plus (detailed format only) raise divergence */}
          {sectionShow.history && (
            <Card withBorder radius="md" shadow="sm" padding="lg" mb="lg">
              <Text size="sm" fw={700}>{sectionNum.history}. Pay vs. title median over time</Text>
              <Text size="xs" c="dimmed" mb="md">{subjectFirst}'s pay against the median for this title at each snapshot.</Text>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={history} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="date" tickFormatter={fmtHistTick} tick={AXIS_TICK} tickMargin={8} />
                  <YAxis tickFormatter={fmtUsd} width={72} tick={AXIS_TICK} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const tRows = payload
                      .filter((it) => it.value != null)
                      .map((it) => ({ color: it.stroke as string, name: it.name, value: usd(it.value as number) }));
                    return <ChartTooltip label={fmtHistTick(String(label))} rows={tRows} />;
                  }} />
                  <Line type="monotone" dataKey="med" name="Title median" stroke="var(--mantine-color-gray-5)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="pay" name={subjectFirst} stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <Group gap="lg" mt="xs">
                <Group gap={6} wrap="nowrap" align="center">
                  <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-accent-6)" strokeWidth={2} /></svg>
                  <Text size="xs" c="dimmed">{subjectFirst}</Text>
                </Group>
                <Group gap={6} wrap="nowrap" align="center">
                  <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-gray-5)" strokeWidth={2} strokeDasharray="6 4" /></svg>
                  <Text size="xs" c="dimmed">Title median</Text>
                </Group>
              </Group>

              {raiseCycle && (
                <Text size="sm" mt="md">
                  Same-title peers received a median <b>{pct(raiseCycle.medianPct)}</b> raise from {raiseCycle.fromLabel} to {raiseCycle.toLabel}
                  {raiseCycle.subjectPct != null && <>; {subjectFirst} received <b>{pct(raiseCycle.subjectPct)}</b></>}
                  {' '}(n = {raiseCycle.n}).<Sup n={fn('raiseCycle')} />
                </Text>
              )}

              {format === 'detailed' && raiseCycle && raiseCycle.dist.length > 0 && (
                <Box mt="lg" pt="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                  <Text size="sm" fw={700}>Raise distribution ({raiseCycle.fromLabel} → {raiseCycle.toLabel})</Text>
                  <Text size="xs" c="dimmed" mb="md">% change in pay among {plural(raiseCycle.n, 'continuing same-title peer')}.</Text>
                  <Group align="flex-end" gap={4} style={{ height: 90 }}>
                    {raiseCycle.dist.map((d) => (
                      <div key={d.bucket} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            width: '100%', maxWidth: 22,
                            height: `${Math.max(3, (d.n / raiseDistMax) * 70)}px`,
                            background: d.bucket === raiseCycle.subjectBucket ? 'var(--mantine-color-accent-6)' : 'var(--mantine-color-gray-4)',
                            borderRadius: '3px 3px 0 0',
                          }}
                        />
                        <Text fz={9} c="dimmed" mt={2}>{d.bucket > 0 ? '+' : ''}{d.bucket}%</Text>
                      </div>
                    ))}
                  </Group>
                  {raiseCycle.subjectBucket != null && (
                    <Text size="xs" c="dimmed" mt={4}>Accent bar = {subjectFirst}'s own bucket.</Text>
                  )}
                </Box>
              )}

              {format === 'detailed' && divergence && (
                <Box mt="lg" pt="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                  <Text size="sm" fw={700}>Raise divergence (absolute dollars)</Text>
                  <Text size="xs" c="dimmed" mb="md">
                    Percentage growth flatters a low starting salary. In raw dollars, {subjectFirst}'s raises have lagged — and the gap compounds.
                  </Text>
                  <DivBar label="Peers (avg gained)" value={divergence.avgAbs} max={aMax} color="gray.5" />
                  <DivBar label={`${subjectFirst} (gained)`} value={divergence.subjAbs} max={aMax} color="accent.6" emphasize />
                  <Text size="sm" mt="xs">
                    {subjectFirst} has gained <Text span fw={800}>{usd(divergence.avgAbs - divergence.subjAbs)}</Text> less in raises than the typical peer over the same period.
                  </Text>
                </Box>
              )}
            </Card>
          )}

          {/* Retention & replacement cost — off by default (see Report sections); when shown, every
              figure is either an independent, cited estimate or the public salary record itself. */}
          {sectionShow.risk && (
            <Paper withBorder radius="md" shadow="sm" p="md" mb="lg">
              <Text size="sm" fw={700} mb={4}>{sectionNum.risk}. Retention &amp; Replacement Cost<Sup n={fn('retention')} /></Text>
              <Text size="sm" mb={6}>
                Independent research estimates the cost of replacing an employee at roughly one-third of
                annual salary at the median (Work Institute, 2020 Retention Report), rising to one-half to
                two times salary for specialized or hard-to-fill roles (Gallup, 2019) — about{' '}
                <b>{usd(subjectPay * 0.33)}–{usd(subjectPay * 2)}</b> for this position.
              </Text>
              {attrition && (
                <Text size="sm" mb={6}>
                  In the public salary record, <b>{attrition.leftN} of {attrition.ofN}</b> employees holding
                  this title as of {attrition.fromLabel} no longer hold it as of {attrition.toLabel}.
                </Text>
              )}
              {belowTarget && (
                <Text size="sm" c="dimmed">
                  For comparison, the proposed {usd(targetDelta)} adjustment is {pct(targetDelta / (subjectPay * 0.33))} of
                  even the conservative (one-third-of-salary) replacement estimate.
                </Text>
              )}
            </Paper>
          )}

          {/* Notes & Sources — the document's scholarly apparatus. Every note fires only when the claim
              it explains actually rendered above, so the numbering never drifts or leaves an orphan. */}
          <Text size="sm" fw={600} mb="xs">{notesSectionNum}. Notes &amp; Sources</Text>
          <Box mb="md">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: '0.04em' }}>Methodology notes</Text>
            <NotesList notes={activeNotes.map((n) => n.text)} />
            {anonymize && <Text size="xs" c="dimmed" mt={6}>Peer identities anonymized in this printing; names available on request.</Text>}
          </Box>
          <Box>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: '0.04em' }}>Sources</Text>
            <SourcesList ids={sourceIds} />
          </Box>
        </>
      )}
    </Card>
  );
}

function DivBar({ label, value, max, color, emphasize }: { label: string; value: number; max: number; color: string; emphasize?: boolean }) {
  const filled = max > 0 ? Math.max(3, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <Group justify="space-between" gap="xs" mb={3}>
        <Text size="sm" fw={emphasize ? 700 : 500}>{label}</Text>
        <Text size="sm" fw={700} c={emphasize ? 'accent.7' : undefined}>+{usd(value)}</Text>
      </Group>
      <Progress value={filled} color={color} size="lg" radius="sm" />
    </div>
  );
}
