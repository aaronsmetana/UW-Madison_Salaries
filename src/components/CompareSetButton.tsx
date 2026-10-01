import { Button } from '@mantine/core';
import { IconCheck, IconPlus } from '@tabler/icons-react';
import { useTray, type TrayItemInput } from '../state/tray';
import { ICON } from '../lib/ui';

/**
 * A page's own "put this in the compare set" control, beside its name (a person, a division): one button
 * that says the state and changes it. Out of the set it is the page's action, filled; in the set it says
 * so on the accent's tint, and a second press takes it out again.
 *
 * It was "+ Add to tray", then a disabled "In tray": a dead control that could not undo itself, named for
 * a "tray" the rest of the app calls the compare set.
 */
export function CompareSetButton({ item }: { item: TrayItemInput }) {
  const { add, remove, has } = useTray();
  const inSet = has(item.id);
  return (
    <Button
      variant={inSet ? 'light' : 'filled'}
      className={inSet ? 'in-set-button' : undefined}
      leftSection={inSet ? <IconCheck size={ICON.control} /> : <IconPlus size={ICON.control} />}
      aria-pressed={inSet}
      style={{ flexShrink: 0 }}
      onClick={() => (inSet ? remove(item.id) : add(item))}
    >
      {inSet ? 'In compare set' : 'Add to compare'}
    </Button>
  );
}
