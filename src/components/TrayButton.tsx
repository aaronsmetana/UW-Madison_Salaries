import { Button } from '@mantine/core';
import { IconPlus, IconCheck } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/**
 * The one "add to compare tray" pill, used in every row-level table (Schools, Titles, Person peers).
 * Not-in-tray reads as an actionable outline button; in-tray reads as a settled, disabled confirmation
 * — never as a second flavor of "add". `stopPropagation` is for tables whose rows are themselves
 * clickable (e.g. row-navigates-to-detail-page), so clicking the button doesn't also fire the row nav.
 */
export function TrayButton({
  inTray,
  addLabel = 'Compare',
  onAdd,
  stopPropagation = false,
}: {
  inTray: boolean;
  addLabel?: string;
  onAdd: () => void;
  stopPropagation?: boolean;
}) {
  return (
    <Button
      className={inTray ? 'peer-add' : 'peer-add accent-adaptive-text'}
      size="compact-xs"
      variant={inTray ? 'light' : 'outline'}
      color={inTray ? 'pos' : 'accent'}
      radius="xl"
      leftSection={inTray ? <IconCheck size={ICON.inline} /> : <IconPlus size={ICON.inline} />}
      disabled={inTray}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onAdd();
      }}
    >
      {inTray ? 'In tray' : addLabel}
    </Button>
  );
}
