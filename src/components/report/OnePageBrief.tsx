import { Card, Title, Text, Divider, Paper, SimpleGrid } from '@mantine/core';
import { PeerRangeBar } from '../PeerRangeBar';
import { Eyebrow } from '../Eyebrow';
import { usd, pct } from '../../lib/format';
import { matchTenureSentence, peerAlias, type BriefModel } from './model';

/**
 * The case on one printed page: the ask, its three strongest grounds, where the pay stands, and whom it asks to
 * match. The brief and the detailed review carry everything else, with their notes; this is the page that goes
 * in front of them.
 */
export function OnePageBrief({ model }: { model: BriefModel }) {
  const {
    subjectName, subjectFirst, subjectPay, headerMeta, generated, snapLabel, recommended, belowTarget, targetDelta, targetPct,
    basisLabel, proofs, standing, match, anonymize, rows,
  } = model;
  const them = match ? (anonymize ? peerAlias(rows, match.key) : match.name) : '';
  const sentence = match ? matchTenureSentence(match, subjectFirst, them) : null;
  return (
    <Card withBorder padding="xl" className="print-area report-brief one-page">
      <Title order={2} fz="h3">Pay Parity Review</Title>
      <Text c="dimmed" mt={2}>
        Prepared for <Text span fw={600} c="bright">{subjectName || '—'}</Text>
        {headerMeta ? ` · ${headerMeta}` : ''}
      </Text>
      <Divider my="md" />
      {subjectPay == null ? (
        <Text c="dimmed">Pick a subject and add comparators on the left to build the review.</Text>
      ) : (
        <>
          <Paper p="lg" mb="md" withBorder={!belowTarget} bg={belowTarget ? 'var(--mantine-color-accent-light)' : undefined}>
            <Eyebrow mb={4}>Recommendation</Eyebrow>
            {belowTarget && recommended != null ? (
              <>
                <Text fw={700} c="pos" fz="h2" lh={1.1}>{usd(recommended)}</Text>
                <Text mt={6}>
                  Adjust <b>{subjectName}</b> from <b>{usd(subjectPay)}</b> to <b>{usd(recommended)}</b>{' '}
                  (<Text span fw={700} c="pos">+{usd(targetDelta)}, {pct(targetPct)}</Text>){basisLabel ? ` — ${basisLabel}` : ''}.
                </Text>
              </>
            ) : (
              <Text fw={700}>{subjectFirst} is at or above the parity target{recommended != null ? ` (${usd(recommended)})` : ''} — maintain current pay.</Text>
            )}
          </Paper>

          {proofs.length > 0 && (
            <>
              <Eyebrow mb={6}>The strongest grounds</Eyebrow>
              <SimpleGrid cols={{ base: 1, xs: Math.min(3, proofs.length) }} mb="md" className="one-page-grounds">
                {proofs.slice(0, 3).map((p) => (
                  <Paper key={p.kind} withBorder p="sm">
                    <Text fw={700}>{p.value}</Text>
                    <Text size="xs">{p.label}</Text>
                  </Paper>
                ))}
              </SimpleGrid>
            </>
          )}

          {standing && standing.values.length >= 4 && standing.min != null && standing.p25 != null && standing.med != null && standing.p75 != null && standing.max != null && (
            <>
              <Eyebrow mb={4}>Where the pay stands</Eyebrow>
              <Text size="xs" c="dimmed" mb="xs">{subjectFirst}'s pay against {standing.cohortLabel} (n = {standing.values.length}).</Text>
              <PeerRangeBar min={standing.min} p25={standing.p25} median={standing.med} p75={standing.p75} max={standing.max} value={subjectPay} values={standing.values} />
            </>
          )}

          {match && (
            <Text size="sm" mt="md" className="one-page-match">
              <b>{subjectFirst} and {them}.</b> {them} is paid {usd(match.gap)} more.{sentence ? ` ${sentence}` : ''}
            </Text>
          )}

          <Text size="xs" c="dimmed" mt="md">
            Source: UW–Madison salary data through {snapLabel}, a Wisconsin public record · generated {generated}. The methods, the
            notes and the rest of the evidence are in the full brief.
          </Text>
        </>
      )}
    </Card>
  );
}
