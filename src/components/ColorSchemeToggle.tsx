import { ActionIcon, Tooltip, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { IconSun, IconMoon, IconSunMoon } from '@tabler/icons-react';

const ORDER: MantineColorScheme[] = ['light', 'auto', 'dark'];
const ICON = { light: IconSun, auto: IconSunMoon, dark: IconMoon };
const LABEL: Record<MantineColorScheme, string> = { light: 'Light', auto: 'Auto (system)', dark: 'Dark' };

/** Light -> Auto -> Dark cycle. Mantine persists the choice, so dark mode stops being OS-only. */
export function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const next = ORDER[(ORDER.indexOf(colorScheme) + 1) % ORDER.length];
  const Icon = ICON[colorScheme];
  return (
    <Tooltip label={`Theme: ${LABEL[colorScheme]} (click for ${LABEL[next]})`} withArrow>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        radius="xl"
        aria-label={`Switch theme — currently ${LABEL[colorScheme]}`}
        onClick={() => setColorScheme(next)}
      >
        <Icon size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
