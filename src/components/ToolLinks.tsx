import { Anchor, Button, Group } from '@mantine/core';
import { Link } from 'react-router-dom';

/** A tool a page's subject can be taken into, and how to get there. */
export interface ToolLink {
  label: string;
  to: string;
  /** Before going: a raise case, say, puts its person in the compare set it is built from. */
  onClick?: () => void;
}

/**
 * Where a page's subject goes next: the app's tools that take it — a person's raise case, a title's raises, a
 * division's raises and screening. Buttons in the header's action group where the page has one (a person, a
 * division); otherwise one line of links under the page's name.
 */
export function ToolLinks({ links, asButtons = false }: { links: ToolLink[]; asButtons?: boolean }) {
  if (!links.length) return null;
  // In a page header's action group (a person, a division), as buttons beside its others (P3): a lone underlined
  // link under the title line, away from the actions, read as an afterthought.
  if (asButtons) {
    return (
      <Group component="nav" aria-label="Take this further" gap="sm" wrap="wrap" className="tool-links tool-links-buttons">
        {links.map((l) => (
          <Button key={l.to} component={Link} to={l.to} onClick={l.onClick} variant="default">{l.label}</Button>
        ))}
      </Group>
    );
  }
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
