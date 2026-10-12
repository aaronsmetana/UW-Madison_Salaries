import { Button, Tooltip } from '@mantine/core';
import { IconPlus, IconCheck } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/**
 * The one "add to the compare set" control, used in every row-level table (Schools, Titles, Top earners,
 * a title's people, a person's peers). An icon with a tooltip, as a phone always drew it (G19): the word
 * "Compare" on every row made a column of identical words. Out of the set it is a plus; in it, a check in
 * the accent, pressed, and a second press takes the row out again (when the table can), so the column also
 * shows which rows are already in the set. Its accessible name says which row it acts on.
 *
 * At rest it is grey and the row a pointer or focus is on lights it (app.css `.peer-row .peer-add`) — kept
 * visible, not hidden until hover: a control a keyboard or a first-time reader cannot see is not there for
 * them, and it clears 3:1 at rest (e2e/readability). `stopPropagation` is for tables whose rows are
 * themselves clickable (row-navigates-to-detail-page), so the button doesn't also fire the row's link.
 */
export function TrayButton({
  inTray,
  name,
  onAdd,
  onRemove,
  stopPropagation = false,
}: {
  inTray: boolean;
  /** What the row is ("Ananth Seshadri", "Professor"), for the button's accessible name. */
  name: string;
  onAdd: () => void;
  /** Takes the row out of the set; without it, a row in the set is a settled, disabled check. */
  onRemove?: () => void;
  stopPropagation?: boolean;
}) {
  const tip = inTray ? (onRemove ? 'In the compare set · select to take out' : 'In the compare set') : 'Add to compare';
  return (
    <Tooltip label={tip} withArrow openDelay={300}>
      <Button
        className={inTray ? 'peer-add peer-add-in' : 'peer-add accent-adaptive-text'}
        size="compact-xs"
        variant={inTray ? 'light' : 'outline'}
        color="accent"
        radius="xl"
        aria-label={inTray ? `${name} is in the compare set` : `Add ${name} to compare`}
        aria-pressed={inTray}
        disabled={inTray && !onRemove}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          if (inTray) onRemove?.();
          else onAdd();
        }}
      >
        {inTray ? <IconCheck size={ICON.compact} aria-hidden /> : <IconPlus size={ICON.compact} aria-hidden />}
      </Button>
    </Tooltip>
  );
}
