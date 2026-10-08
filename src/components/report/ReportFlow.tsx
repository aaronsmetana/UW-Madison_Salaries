import { Fragment, useId } from 'react';
import { Box, Paper, Text, UnstyledButton, Group } from '@mantine/core';
import { IconChevronRight, IconChevronDown } from '@tabler/icons-react';
import { Eyebrow } from '../Eyebrow';
import { CardTitle } from '../CardTitle';
import { ICON } from '../../lib/ui';
import { usePref } from '../../lib/prefs';

/**
 * What you give → what it checks → what you get, as three bordered columns.
 *
 * /reports is the one route in the app whose shape isn't visible from its controls. Every other page
 * shows you data and lets you filter it; this one takes a person and some peers and returns a written
 * document, and until it has both it shows an empty pane. The page header used to carry that in a
 * second sentence of prose — "What comes out is a one-page brief you can print, download, or paste
 * into an email" — which is exactly the third column here. Moving it into the strip is what pays for
 * the strip's height; the header is one sentence shorter than it was.
 */

type Step = { eyebrow: string; body: string };

const FLOW: [Step, Step, Step] = [
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
    body: 'A brief that cites every figure it uses. Print it, save it as a .doc, or paste it straight into an email.',
  },
];

/**
 * In full until a subject is picked — the moment the page is an empty pane and the strip is what
 * explains it — then one line, "How this report works", that opens it again in place. Whether it is
 * open is remembered per viewer: someone who wants the strip keeps it; everyone else gets the brief
 * a screen higher.
 */
export function ReportFlow({ hasSubject }: { hasSubject: boolean }) {
  const [open, setOpen] = usePref<boolean>('reportFlowOpen', false);
  const id = useId();
  const expanded = !hasSubject || open;
  return (
    // `mt` rather than a Stack gap: the strip shares the page header's `no-print` wrapper, so the
    // route's `Stack gap="lg"` spaces that whole wrapper and not the two things inside it.
    <Box className="no-print report-flow-wrap" mt="lg" data-expanded={expanded ? 'yes' : 'no'}>
      {hasSubject ? (
        <UnstyledButton className="report-flow-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} mb={open ? 'sm' : 0}>
          <Group gap={6} wrap="nowrap">
            {open ? <IconChevronDown size={ICON.compact} aria-hidden /> : <IconChevronRight size={ICON.compact} aria-hidden />}
            <Text size="sm" fw={600}>How this report works</Text>
          </Group>
        </UnstyledButton>
      ) : (
        <CardTitle mb="sm">How this works</CardTitle>
      )}
      {expanded && (
      <div className="report-flow" id={id}>
        {FLOW.map((s, i) => (
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
      )}
    </Box>
  );
}
