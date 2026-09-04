import { Fragment } from 'react';
import { Box, Paper, Text } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { Eyebrow } from '../Eyebrow';
import { CardTitle } from '../CardTitle';
import { ICON } from '../../lib/ui';

/**
 * What you give → what it checks → what you get, as three bordered columns.
 *
 * /reports is the one route in the app whose shape isn't visible from its controls. Every other page
 * shows you data and lets you filter it; this one takes a person and some peers and returns a written
 * document, and until it has both it shows an empty pane. The page header used to carry that in a
 * second sentence of prose — "What comes out is a one-page brief you can print, download, or paste
 * into an email" — which is exactly the third column here. Moving it into the strip is what pays for
 * the strip's height; the header is one sentence shorter than it was.
 *
 * The two report types check genuinely different things — the comparison brief argues a case against
 * the salary guidelines, while the person report is a profile — so the middle column is not shared
 * copy with a swapped noun. Writing one strip for both would have meant claiming the person report
 * tests parity and compression, which it does not.
 */

type Step = { eyebrow: string; body: string };

const FLOW: Record<'person' | 'comparison', [Step, Step, Step]> = {
  comparison: [
    {
      eyebrow: 'What you give',
      body: 'The person the case is about, and the peers you want them measured against. Anything they have taken on that their title does not say, if you want it counted.',
    },
    {
      eyebrow: 'What it checks',
      body: 'Parity, compression, and the market floor — the three adjustments the UW Salary Administration Guidelines name, tested against the comparators you chose.',
    },
    {
      eyebrow: 'What you get',
      body: 'A one-page brief that cites every figure it uses. Print it, save it as a .doc, or paste it straight into an email.',
    },
  ],
  person: [
    { eyebrow: 'What you give', body: 'One employee’s name.' },
    {
      eyebrow: 'What it shows',
      body: 'Their pay and title history across every snapshot, and where they sit among everyone else holding the same title.',
    },
    { eyebrow: 'What you get', body: 'A one-page profile you can print or save as a PDF.' },
  ],
};

export function ReportFlow({ type }: { type: 'person' | 'comparison' }) {
  return (
    // `mt` rather than a Stack gap: the strip shares the page header's `no-print` wrapper, so the
    // route's `Stack gap="lg"` spaces that whole wrapper and not the two things inside it.
    <Box className="no-print" mt="lg">
      <CardTitle mb="sm">How this works</CardTitle>
      <div className="report-flow">
        {FLOW[type].map((s, i) => (
          <Fragment key={s.eyebrow}>
            {i > 0 && (
              <IconChevronRight className="report-flow-arrow" size={ICON.control} aria-hidden stroke={2.5} />
            )}
            <Paper withBorder p="sm" radius="md">
              <Eyebrow mb={4}>{s.eyebrow}</Eyebrow>
              <Text size="sm">{s.body}</Text>
            </Paper>
          </Fragment>
        ))}
      </div>
    </Box>
  );
}
