import { Anchor, Group } from '@mantine/core';
import { Link } from 'react-router-dom';

/** A tool a page's subject can be taken into, and how to get there. */
export interface ToolLink {
  label: string;
  to: string;
  /** Before going: a raise case, say, puts its person in the compare set it is built from. */
  onClick?: () => void;
}

/**
 * Where a page's subject goes next: the app's tools that take it — a person's one-page report and raise
 * case, a title's raises, a division's raises and screening. One line of links under the page's name, the
 * same on every page that is about one thing.
 */
export function ToolLinks({ links }: { links: ToolLink[] }) {
  if (!links.length) return null;
  return (
    <Group component="nav" aria-label="Take this further" gap="lg" className="tool-links">
      {links.map((l) => (
        <Anchor key={l.to} component={Link} to={l.to} onClick={l.onClick} size="sm" fw={600}>
          {l.label} →
        </Anchor>
      ))}
    </Group>
  );
}
