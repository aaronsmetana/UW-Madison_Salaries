import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, Title, Text, Divider, Paper, Group, Stack, SimpleGrid, Table, Badge, ThemeIcon, Progress } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { IconChartBar, IconScale, IconHistory } from '@tabler/icons-react';
import { usd, pct } from '../../lib/format';
import { CAND, PEER, type BriefModel, type ProofKind } from './model';

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
};

export function ReportBrief({ model, hovered, onHover }: {
  model: BriefModel;
  hovered: string | null;
  onHover: (id: string | null) => void;
}) {
  const {
    subjectName, subjectFirst, subjectPay, headerMeta, recommended, belowTarget, targetDelta, targetPct,
    basisLabel, receipt, proofs, rows, maxPay, showTenure, netSavings, divergence, format,
    sections, jobCode, activeFactors,
  } = model;

  const animated = useAnimatedNumber(recommended ?? 0);
  const has = (s: string) => sections.includes(s);
  const showReceipt = receipt.length > 1; // base + at least one add-on / negotiated line
  const aMax = divergence ? Math.max(divergence.avgAbs, divergence.subjAbs, 1) : 1;

  return (
    <Card withBorder padding="xl" className="print-area report-brief">
      <Title order={3}>Internal Equity &amp; Parity Review</Title>
      <Text c="dimmed" mt={2}>
        Prepared for <Text span fw={600} c="bright">{subjectName || '—'}</Text>
        {headerMeta ? ` · ${headerMeta}` : ''}
      </Text>
      <Divider my="md" />

      {subjectPay == null ? (
        <Text c="dimmed">Pick a subject and add comparators on the left to build the review.</Text>
      ) : (
        <>
          {/* Recommendation hero */}
          {belowTarget && recommended != null ? (
            <Paper radius="md" p="xl" bg="var(--mantine-color-indigo-light)" mb="lg">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.05em' }}>Recommendation</Text>
              <Text fw={800} c="green.8" lh={1} style={{ fontSize: 'clamp(2.5rem, 6vw, 3.5rem)', letterSpacing: '-0.02em' }}>
                {usd(Math.round(animated))}
              </Text>
              <Text mt={8}>
                Adjust <b>{subjectName}</b> from <b>{usd(subjectPay)}</b> to <b>{usd(recommended)}</b>{' '}
                (<Text span fw={700} c="green.7">+{usd(targetDelta)}, {pct(targetPct)}</Text>) — {basisLabel}.
              </Text>
            </Paper>
          ) : (
            <Paper withBorder radius="md" p="lg" mb="lg">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.05em' }}>Recommendation</Text>
              <Text fw={700} fz="lg" mt={4}>
                {subjectFirst} is at or above the parity target{recommended != null ? ` (${usd(recommended)})` : ''} — maintain current pay.
              </Text>
            </Paper>
          )}

          {/* Itemized receipt — transparent base + value-adds = total */}
          {showReceipt && (
            <Card withBorder radius="md" shadow="sm" padding="lg" mb="lg">
              <Text size="sm" fw={700} mb="sm">How this figure is built</Text>
              <Stack gap={4}>
                {receipt.map((line) => {
                  const lit = line.kind === 'addon' && hovered === `factor:${line.id}`;
                  return (
                    <Group
                      key={line.id}
                      justify="space-between"
                      wrap="nowrap"
                      px={6}
                      style={{ borderRadius: 6, background: lit ? 'var(--mantine-color-indigo-light)' : undefined, transition: 'background 150ms' }}
                    >
                      <Text size="sm" c={line.kind === 'base' ? undefined : 'dimmed'} fw={line.kind === 'base' ? 600 : 400}>
                        {line.kind === 'addon' ? '+ ' : ''}{line.label}
                      </Text>
                      <Text size="sm" fw={line.kind === 'base' ? 600 : 400} c={line.kind === 'negotiated' ? 'dimmed' : undefined}>
                        {line.kind !== 'base' && line.amount >= 0 ? '+' : ''}{usd(line.amount)}
                      </Text>
                    </Group>
                  );
                })}
                <Divider my={4} />
                <Group justify="space-between" wrap="nowrap" px={6}>
                  <Text size="sm" fw={800}>Total requested</Text>
                  <Text size="sm" fw={800} c="green.7">{usd(recommended ?? 0)}</Text>
                </Group>
              </Stack>
              {activeFactors.some((f) => f.amount == null && f.note) && (
                <Text size="xs" c="dimmed" mt="sm">
                  Also supporting (not costed): {activeFactors.filter((f) => f.amount == null && f.note).map((f) => f.label.toLowerCase()).join(', ')}.
                </Text>
              )}
            </Card>
          )}

          {!jobCode && (
            <Text size="sm" c="dimmed" mb="lg">No job code on record for {subjectName} in this snapshot, so title-market benchmarking is limited.</Text>
          )}

          {/* Why — the proofs */}
          {has('highlights') && proofs.length > 0 && (
            <>
              <Text size="sm" fw={600} mb="xs">Why this is an equity correction</Text>
              <SimpleGrid cols={{ base: 1, sm: Math.min(3, proofs.length) }} mb="lg">
                {proofs.map((p) => (
                  <Card key={p.kind} withBorder radius="md" shadow="sm" padding="lg">
                    <ThemeIcon variant="light" color="indigo" size={38} radius="md">{PROOF_ICON[p.kind]}</ThemeIcon>
                    <Text fw={800} fz={26} mt="sm" lh={1.1}>{p.value}</Text>
                    <Text size="sm" c="dimmed" mt={4}>{p.label}</Text>
                    {p.detail && <Text size="xs" c="dimmed" mt={6}>{p.detail}</Text>}
                  </Card>
                ))}
              </SimpleGrid>
            </>
          )}

          {/* Peer comparison matrix */}
          {has('peers') && rows.length > 1 && (
            <>
              <Text size="sm" fw={600} mb="xs">Peer comparison <Text span c="dimmed" size="xs">· your named comparators</Text></Text>
              <Card withBorder radius="md" shadow="sm" p={0} mb="lg" style={{ maxWidth: 900, overflow: 'hidden' }}>
                <Table striped highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Title</Table.Th>
                      {showTenure && <Table.Th ta="right">Tenure</Table.Th>}
                      <Table.Th>Salary</Table.Th>
                      <Table.Th ta="right">vs {subjectFirst}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((r) => {
                      const lit = hovered === `peer:${r.key}`;
                      const bg = r.isSubject
                        ? 'var(--mantine-color-indigo-light)'
                        : r.isAnomaly
                          ? 'var(--mantine-color-indigo-0)'
                          : lit ? 'var(--mantine-color-default-hover)' : undefined;
                      return (
                        <Table.Tr
                          key={r.key}
                          onMouseEnter={() => onHover(`peer:${r.key}`)}
                          onMouseLeave={() => onHover(null)}
                          style={{ background: bg, boxShadow: r.isAnomaly && !r.isSubject ? 'inset 4px 0 0 var(--mantine-color-indigo-6)' : undefined, transition: 'background 150ms' }}
                        >
                          <Table.Td>
                            {r.isSubject
                              ? <><b>{r.name}</b> <Badge size="xs" variant="light" color="indigo" tt="none" ml={4}>Review Subject</Badge></>
                              : <>{r.name}{r.isAnomaly
                                  ? <Badge size="xs" variant="filled" color="indigo" tt="none" ml={6}>Equity Anomaly</Badge>
                                  : r.lessTenure && <Badge size="xs" variant="light" color="indigo" tt="none" ml={6}>less tenure</Badge>}</>}
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
                              <Text span fw={r.gap > 0 ? 800 : 700} fz={r.gap > 0 ? 'md' : 'sm'} c={r.isAnomaly ? 'indigo.7' : 'dimmed'}>
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

          {/* Pay history — raise divergence (detailed format only) */}
          {format === 'detailed' && has('history') && divergence && (
            <Card withBorder radius="md" shadow="sm" padding="lg" mb="lg">
              <Text size="sm" fw={700}>Raise divergence (absolute dollars)</Text>
              <Text size="xs" c="dimmed" mb="md">
                Percentage growth flatters a low starting salary. In raw dollars, {subjectFirst}'s raises have lagged — and the gap compounds.
              </Text>
              <DivBar label="Peers (avg gained)" value={divergence.avgAbs} max={aMax} color="gray.5" />
              <DivBar label={`${subjectFirst} (gained)`} value={divergence.subjAbs} max={aMax} color="indigo.6" emphasize />
              <Text size="sm" mt="xs">
                {subjectFirst} has gained <Text span fw={800}>{usd(divergence.avgAbs - divergence.subjAbs)}</Text> less in raises than the typical peer over the same period.
              </Text>
            </Card>
          )}

          {/* Operational risk & replacement */}
          <Paper withBorder radius="md" shadow="sm" p="md" mb="lg">
            <Text size="sm" fw={700} mb={4}>Operational Risk &amp; Replacement Analysis</Text>
            {belowTarget && netSavings > 0 && (
              <Text size="sm" mb={6}>
                Granting this adjustment saves the department an estimated{' '}
                <Text span fw={800} c="green.7">{usd(netSavings)}</Text> versus the baseline cost of replacing this role on the open market.
              </Text>
            )}
            <Text size="sm">
              {belowTarget ? `The one-time ${usd(targetDelta)} adjustment` : `Retaining ${subjectFirst}`} is a fraction of turnover cost:
              replacing {subjectFirst} is widely estimated at <b>{usd(subjectPay * 0.5)}–{usd(subjectPay * 2)}</b> (roughly
              0.5×–2× annual salary in recruiting, lost productivity, and ramp-up). Keeping proven institutional knowledge is the
              lower-cost, lower-risk choice.
            </Text>
          </Paper>

          <Text size="xs" c="dimmed" mt="xl">
            Methodology: the title median is the median pay of everyone sharing the subject's job code at this snapshot; the
            tenure-adjusted target is the median for same-title peers with at least the subject's tenure. "Tenure" = years since the
            UW–Madison date of hire (not total career experience). Value-add adjustments are self-reported. Source: UW–Madison
            salary data (Wisconsin public record); zero/unreported salaries excluded; identity matched on name + date of hire.
          </Text>
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
        <Text size="sm" fw={700} c={emphasize ? 'indigo.7' : undefined}>+{usd(value)}</Text>
      </Group>
      <Progress value={filled} color={color} size="lg" radius="sm" />
    </div>
  );
}
