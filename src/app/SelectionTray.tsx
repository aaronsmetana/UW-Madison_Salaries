import { useEffect, useRef, useState } from 'react';
import { Group, Button, Text, Transition, Tooltip, ActionIcon, Anchor, VisuallyHidden, Menu } from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import {
  IconArrowsLeftRight, IconUser, IconBriefcase, IconBuildingBank, IconX, IconReportAnalytics,
  IconChevronDown, IconChevronUp, IconDots, IconTrash, IconList,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useTray, type TrayItem } from '../state/tray';
import { ICON } from '../lib/ui';
import { selQuery } from '../lib/share';
import { Z } from '../lib/layers';

const TYPE_META: Record<TrayItem['type'], { icon: typeof IconUser; one: string; many: string; href: (id: string) => string }> = {
  person: { icon: IconUser, one: 'person', many: 'people', href: (id) => `/person/${encodeURIComponent(id)}` },
  title: { icon: IconBriefcase, one: 'title', many: 'titles', href: (id) => `/titles?code=${encodeURIComponent(id)}` },
  school: { icon: IconBuildingBank, one: 'division', many: 'divisions', href: (id) => `/school/${encodeURIComponent(id)}` },
};
const TYPE_ORDER: TrayItem['type'][] = ['person', 'title', 'school'];
/** How many chips the set shows before "+N more" (C9): past it they scrolled out of a strip, one unseen. */
const CHIPS_SHOWN = 3;

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

/** One removable chip: the name, a link to its page, and its ×. A title or a division wears its kind's icon; a
 *  person, nothing else. (People carried a star that chose the raise case's subject; the Reports page chooses
 *  it now, in its own setup.) */
function Chip({ item, onRemove }: { item: TrayItem; onRemove: () => void }) {
  const { icon: Icon, href } = TYPE_META[item.type];
  return (
    <Group className="tray-chip compare-chip" gap={6} wrap="nowrap" pl={item.type === 'person' ? 10 : 8} pr={4} py={3} style={{ flex: '0 1 auto', minWidth: 0, maxWidth: 240 }}>
      {item.type !== 'person' && <Icon size={ICON.compact} style={{ flexShrink: 0 }} className="compare-chip-icon" />}
      <Anchor component={Link} to={href(item.id)} c="inherit" underline="hover" fz="sm" lineClamp={1} title={item.label} style={{ minWidth: 0 }}>
        {item.label}
      </Anchor>
      <ActionIcon size={20} radius="xs" variant="subtle" color="gray" className="compare-chip-x" aria-label={`Remove ${item.label}`} onClick={onRemove} style={{ flexShrink: 0 }}>
        <IconX size={ICON.compact} />
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
  // On a phone the one-line bar ran off the screen: "Compare" was cut in half and the report's button out
  // of reach. There it takes two rows — the count and Clear, then the two actions — with the chips
  // behind "Show all".
  const phone = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false }) ?? false;
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
  // While the set floats over the bottom of the window, the page's footer runs on under it by the set's own
  // height (app.css `html[data-tray] .app-footer`), so the last line of every page can be scrolled clear.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = wrapRef.current;
    if (!mounted || !el) {
      root.removeAttribute('data-tray');
      return;
    }
    root.setAttribute('data-tray', '');
    const measure = () => root.style.setProperty('--tray-room', `${Math.ceil(el.offsetHeight) + (phone ? 12 : 20) + 8}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeAttribute('data-tray');
    };
  }, [mounted, phone]);
  const hasPerson = items.some((i) => i.type === 'person');
  const canCompare = items.length >= 2;
  const ordered = TYPE_ORDER.flatMap((t) => items.filter((i) => i.type === t));
  const hidden = expanded ? 0 : Math.max(0, ordered.length - CHIPS_SHOWN);
  const caseTo = `/raise-case?type=comparison&${selQuery(items.filter((i) => i.type === 'person'))}`;

  const body = (styles: React.CSSProperties) => {
    // Cleared → brief Undo affordance.
    if (items.length === 0) {
      return (
        <div className="no-print compare-bar" style={styles} role="region" aria-label="Compare set">
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" className="compare-count">Compare set cleared</Text>
            <Button size="compact-sm" variant="subtle" className="compare-text-button" onClick={onUndo}>Undo</Button>
          </Group>
        </div>
      );
    }
    // On a narrow screen one pill (C9): the count, Compare, and the rest under "⋯"; the items a row of their own
    // when asked for. It took two rows and covered what was under it.
    if (phone) {
      return (
        <div className="no-print compare-bar" data-phone style={styles} role="region" aria-label="Compare set">
          <Group gap="xs" wrap="nowrap" className="tray-row">
            <Text size="sm" fw={600} truncate="end" style={{ flex: '1 1 0', minWidth: 0 }}>{summarize(items)}</Text>
            <Button size="compact-sm" component={Link} to="/compare" className="compare-bar-compare"
              data-disabled={!canCompare || undefined} aria-disabled={!canCompare || undefined}
              onClick={(e) => { if (!canCompare) e.preventDefault(); }} leftSection={<IconArrowsLeftRight size={ICON.compact} />} style={{ flexShrink: 0 }}>
              Compare
            </Button>
            <Menu position="top-end" withinPortal shadow="md">
              <Menu.Target>
                <ActionIcon size={28} variant="subtle" color="gray" className="compare-text-button tray-more" aria-label="More for the compare set"><IconDots size={ICON.control} /></ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconList size={ICON.control} />} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Hide the items' : 'Show the items'}</Menu.Item>
                <Menu.Item leftSection={<IconReportAnalytics size={ICON.control} />} component={Link} to={caseTo} disabled={!hasPerson}>Raise case</Menu.Item>
                <Menu.Item leftSection={<IconTrash size={ICON.control} />} onClick={onClear}>Clear</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
          {expanded && (
            <Group gap={6} wrap="wrap" mt={6} className="tray-chips">
              {ordered.map((i) => <Chip key={`${i.type}:${i.id}`} item={i} onRemove={() => remove(i.id)} />)}
            </Group>
          )}
        </div>
      );
    }
    return (
      <div className="no-print compare-bar" style={styles} role="region" aria-label="Compare set">
        <Group gap="sm" wrap="nowrap" className="tray-row">
          <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap', flex: '0 0 auto', minWidth: 0 }}>
            Compare set <Text span fw={500} className="compare-count">{summarize(items)}</Text>
          </Text>
          <span className="compare-divider" aria-hidden />

          {/* The first few, then how many more (C9), every one of them one press away. The chips give way to the count:
              three full names ran past the row's width, and "+2 more" went under Clear. */}
          <Group gap={6} wrap={expanded ? 'wrap' : 'nowrap'} className="tray-chips" style={{ maxWidth: 'min(52vw, 640px)', minWidth: 0, flex: '0 1 auto' }}>
            {ordered.slice(0, ordered.length - hidden).map((i) => (
              <Chip key={`${i.type}:${i.id}`} item={i} onRemove={() => remove(i.id)} />
            ))}
            {hidden > 0 && (
              <Button size="compact-sm" variant="subtle" color="gray" className="compare-text-button tray-more-chips" onClick={() => setExpanded(true)}
                rightSection={<IconChevronUp size={ICON.compact} />} style={{ flexShrink: 0 }}>
                +{hidden} more
              </Button>
            )}
            {expanded && ordered.length > CHIPS_SHOWN && (
              <Button size="compact-sm" variant="subtle" color="gray" className="compare-text-button" onClick={() => setExpanded(false)}
                rightSection={<IconChevronDown size={ICON.compact} />} style={{ flexShrink: 0 }}>
                Fewer
              </Button>
            )}
          </Group>

          <Button size="compact-sm" variant="subtle" color="gray" className="compare-text-button" onClick={onClear} style={{ flexShrink: 0 }}>Clear</Button>

          <Group gap="xs" wrap="nowrap" className="tray-actions">
          <Tooltip label="Add one more to compare" disabled={canCompare} withArrow>
            <Button
              size="xs"
              component={Link}
              to="/compare"
              className="compare-bar-compare"
              data-disabled={!canCompare || undefined}
              aria-disabled={!canCompare || undefined}
              onClick={(e) => { if (!canCompare) e.preventDefault(); }}
              leftSection={<IconArrowsLeftRight size={ICON.control} />}
              style={{ flexShrink: 0 }}
            >
              Compare
            </Button>
          </Tooltip>

          <Tooltip label={hasPerson ? 'Build the raise case for these people' : 'Add at least one person to build a raise case'} withArrow>
            <Button
              size="xs"
              component={Link}
              to={caseTo}
              className="compare-bar-case"
              data-disabled={!hasPerson || undefined}
              aria-disabled={!hasPerson || undefined}
              onClick={(e) => { if (!hasPerson) e.preventDefault(); }}
              leftSection={<IconReportAnalytics size={ICON.control} />}
              style={{ flexShrink: 0 }}
            >
              Raise case
            </Button>
          </Tooltip>
          </Group>
        </Group>
        {items.length >= 8 && (
          <Text size="xs" mt={4} ta="center" className="compare-count">That's a lot selected — ready to compare?</Text>
        )}
      </div>
    );
  };

  return (
    <>
      <VisuallyHidden aria-live="polite">{announce}</VisuallyHidden>
      {/* Fixed, centered wrapper so the Transition's own transform (slide-up) doesn't fight the centering. */}
      <div
        ref={wrapRef}
        className="no-print"
        style={{ position: 'fixed', bottom: phone ? 12 : 20, left: '50%', transform: 'translateX(-50%)', zIndex: Z.floating, width: phone ? 'calc(100vw - 24px)' : 'max-content', maxWidth: phone ? 'calc(100vw - 24px)' : 'min(1100px, calc(100vw - 32px))' }}
      >
        <Transition mounted={mounted} transition="slide-up" duration={reduce ? 0 : 200} timingFunction="ease">
          {(styles) => body(styles)}
        </Transition>
      </div>
    </>
  );
}
