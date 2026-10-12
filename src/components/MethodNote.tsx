import type { ReactNode } from 'react';
import { Stack } from '@mantine/core';

/**
 * A card's method, one click away (G22): how a figure was counted, what it leaves out, where the data can't
 * tell. Cards opened with these paragraphs — Changes with about 120 words and two callouts before its first
 * figure — so a reader met the caveats before the number they qualify. Now a card leads with one sentence
 * and its figure, and the method closes it, folded.
 *
 * A native `<details>`: the browser gives it its keyboard and its announced state, and a page printed or
 * searched with it closed still holds every word.
 */
export function MethodNote({ children, title = 'How this is calculated', className }: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <details className={['method-note', className].filter(Boolean).join(' ')}>
      <summary>{title}</summary>
      <Stack gap={6} className="method-note-body">{children}</Stack>
    </details>
  );
}
