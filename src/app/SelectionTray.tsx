import { useEffect, useRef, useState } from 'react';
import { Group, Button, Text, Paper, Transition, Tooltip, ActionIcon, Anchor, VisuallyHidden } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import {
  IconArrowsLeftRight, IconUser, IconBriefcase, IconBuildingBank, IconX, IconReportAnalytics,
  IconChevronDown, IconChevronUp,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useTray, type TrayItem } from '../state/tray';

const TYPE_META: Record<TrayItem['type'], { icon: typeof IconUser; one: string; many: string; href: (id: string) => string }> = {
  person: { icon: IconUser, one: 'person', many: 'people', href: (id) => `/person/${encodeURIComponent(id)}` },
  title: { icon: IconBriefcase, one: 'title', many: 'titles', href: (id) => `/title/${encodeURIComponent(id)}` },
  school: { icon: IconBuildingBank, one: 'school', many: 'schools', href: (id) => `/school/${encodeURIComponent(id)}` },
};
const TYPE_ORDER: TrayItem['type'][] = ['person', 'title', 'school'];

/** Smart count: "1 person · 2 titles" (falls back to "N selected"). */
function summarize(items: TrayItem[]): string {
  const parts = TYPE_ORDER.flatMap((t) => {
    const n = items.filter((i) => i.type === t).length;
    if (!n) return [];
    const m = TYPE_META[t];
    return [`${n} ${n === 1 ? m.one : m.many}`];
  });
  return parts.length ? parts.join(' · ') : `${items.length} selected`;
}

/** One removable, clickable chip for a tray item. */
function Chip({ item, onRemove }: { item: TrayItem; onRemove: () => void }) {
  const { icon: Icon, href } = TYPE_META[item.type];
  return (
    <Group
      gap={6}
      wrap="nowrap"
      pl={8}
      pr={4}
      py={3}
      style={{ flexShrink: 0, borderRadius: 'var(--mantine-radius-xl)', background: 'var(--mantine-color-default-hover)', maxWidth: 220 }}
    >
      <Icon size={15} style={{ flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} />
      <Anchor component={Link} to={href(item.id)} c="inherit" underline="hover" fz="sm" lineClamp={1} title={item.label}>
        {item.label}
      </Anchor>
      <ActionIcon size={19} radius="xl" variant="subtle" color="gray" aria-label={`Remove ${item.label}`} onClick={onRemove} style={{ flexShrink: 0 }}>
        <IconX size={14} />
      </ActionIcon>
    </Group>
  );
}

/**
 * Floating "Compare set" — the selection you build across the app, with quick paths to Compare and Reports.
 * Appears only when something is selected; hidden in print.
 */
export function SelectionTray() {
  const { items, remove, clear, add } = useTray();
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [undoable, setUndoable] = useState<TrayItem[] | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Screen-reader-only announcement of set changes (no visible/audible cue).
  const [announce, setAnnounce] = useState('');
  const prevCount = useRef(items.length);
  useEffect(() => {
    if (items.length !== prevCount.current) {
      setAnnounce(`${items.length} in compare set`);
      prevCount.current = items.length;
    }
  }, [items.length]);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const onClear = () => {
    if (items.length === 0) return;
    setUndoable(items);
    clear();
    setExpanded(false);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoable(null), 5000);
  };
  const onUndo = () => {
    undoable?.forEach((i) => add(i));
    setUndoable(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  const mounted = items.length > 0 || undoable != null;
  const hasPerson = items.some((i) => i.type === 'person');
  const canCompare = items.length >= 2;
  const collapsed = items.length > 5 && !expanded;

  const body = (styles: React.CSSProperties) => {
    // Cleared → brief Undo affordance.
    if (items.length === 0) {
      return (
        <Paper className="no-print" shadow="lg" withBorder radius="xl" px="md" py={8} style={styles} role="region" aria-label="Compare set">
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" c="dimmed">Compare set cleared</Text>
            <Button size="xs" variant="subtle" onClick={onUndo}>Undo</Button>
          </Group>
        </Paper>
      );
    }
    return (
      <Paper className="no-print" shadow="lg" withBorder radius="xl" px="md" py={8} style={styles} role="region" aria-label="Compare set">
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
            Compare set <Text span c="dimmed" fw={500}>· {summarize(items)}</Text>
          </Text>

          {!collapsed && (
            <Group gap={6} wrap="nowrap" style={{ overflowX: 'auto', maxWidth: 'min(46vw, 520px)' }}>
              {TYPE_ORDER.flatMap((t) => items.filter((i) => i.type === t)).map((i) => (
                <Chip key={`${i.type}:${i.id}`} item={i} onRemove={() => remove(i.id)} />
              ))}
            </Group>
          )}
          {items.length > 5 && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={() => setExpanded((v) => !v)}
              rightSection={expanded ? <IconChevronDown size={15} /> : <IconChevronUp size={15} />}
              style={{ flexShrink: 0 }}
            >
              {expanded ? 'Hide' : 'Show all'}
            </Button>
          )}

          <Button size="xs" variant="outline" color="gray" onClick={onClear} style={{ flexShrink: 0 }}>Clear</Button>

          <Tooltip label="Add one more to compare" disabled={canCompare} withArrow>
            <Button
              size="xs"
              component={Link}
              to="/compare"
              data-disabled={!canCompare || undefined}
              onClick={(e) => { if (!canCompare) e.preventDefault(); }}
              leftSection={<IconArrowsLeftRight size={16} />}
              style={{ flexShrink: 0 }}
            >
              Compare
            </Button>
          </Tooltip>

          <Tooltip label={hasPerson ? 'Build a report' : 'Add at least one person to build a report'} withArrow>
            <ActionIcon
              size="lg"
              variant="default"
              component={Link}
              to="/reports?mode=compare"
              data-disabled={!hasPerson || undefined}
              onClick={(e) => { if (!hasPerson) e.preventDefault(); }}
              aria-label="Build a report"
              style={{ flexShrink: 0 }}
            >
              <IconReportAnalytics size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {items.length >= 8 && (
          <Text size="xs" c="dimmed" mt={4} ta="center">That's a lot selected — ready to compare?</Text>
        )}
      </Paper>
    );
  };

  return (
    <>
      <VisuallyHidden aria-live="polite">{announce}</VisuallyHidden>
      {/* Fixed, centered wrapper so the Transition's own transform (slide-up) doesn't fight the centering. */}
      <div
        className="no-print"
        style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 200, width: 'max-content', maxWidth: 'min(960px, calc(100vw - 32px))' }}
      >
        <Transition mounted={mounted} transition="slide-up" duration={reduce ? 0 : 200} timingFunction="ease">
          {(styles) => body(styles)}
        </Transition>
      </div>
    </>
  );
}
