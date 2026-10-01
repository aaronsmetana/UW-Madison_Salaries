import { Button } from '@mantine/core';
import { IconPlus, IconCheck } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/**
 * The one "add to the compare set" button, used in every row-level table (Schools, Titles, Person peers).
 * Out of the set it reads as an action ("+ Compare"); in it, as a settled, disabled confirmation ("In set")
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
      leftSection={inTray ? <IconCheck size={ICON.compact} /> : <IconPlus size={ICON.compact} />}
      disabled={inTray}
      // The name, so a phone that shows only the icon (`.fold-table .tray-label`) still says what it does.
      aria-label={inTray ? 'In compare set' : addLabel}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onAdd();
      }}
    >
      <span className="tray-label">{inTray ? 'In set' : addLabel}</span>
    </Button>
  );
}
