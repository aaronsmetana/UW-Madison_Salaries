import type { ReactNode } from 'react';
import { Tooltip, Text } from '@mantine/core';
import { GLOSSARY, type GlossaryKey } from '../lib/glossary';

/** Wraps a label in a dotted-underline hover/focus tooltip explaining an HR/payroll term in plain
 *  language — this audience is union members, not HR analysts. */
export function GlossaryTerm({ term, children }: { term: GlossaryKey; children: ReactNode }) {
  return (
    <Tooltip label={GLOSSARY[term]} withArrow multiline w={260} events={{ hover: true, focus: true, touch: true }}>
      <Text span tabIndex={0} style={{ borderBottom: '1px dotted currentColor', cursor: 'help' }}>
        {children}
      </Text>
    </Tooltip>
  );
}
