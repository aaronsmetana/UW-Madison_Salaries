import type { ReactNode } from 'react';
import { Tooltip, Text } from '@mantine/core';
import { GLOSSARY, type GlossaryKey } from '../lib/glossary';

/** Wraps a label in a dotted-underline hover/focus tooltip explaining an HR/payroll term in plain
 *  language — this audience is union members, not HR analysts.
 *
 *  `fz="inherit"` because this is a wrapper, not a type choice. Mantine's `<Text>` defaults to `md`
 *  (16px), so wrapping a term inflated whatever contained it: in the person header's 11px meta
 *  chips it made the three glossary chips 29px tall against their neighbours' 21px, on a baseline
 *  4px off — a visibly ragged row. The two table headers using it had the same problem, quieter.
 *  A term should read at the size of the text around it, whatever that is. */
export function GlossaryTerm({ term, children }: { term: GlossaryKey; children: ReactNode }) {
  return (
    <Tooltip label={GLOSSARY[term]} withArrow multiline w={260} events={{ hover: true, focus: true, touch: true }}>
      <Text span fz="inherit" className="glossary-term" tabIndex={0} style={{ borderBottom: '1px dotted currentColor', cursor: 'help' }}>
        {children}
      </Text>
    </Tooltip>
  );
}
