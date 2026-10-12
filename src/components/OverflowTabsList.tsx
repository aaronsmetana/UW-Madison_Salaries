import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { ICON } from '../lib/ui';
import { prefersReducedMotion } from '../lib/motion';

/**
 * A tab list that says when it runs past its edge (G25). On a 375px phone the person's tabs stopped at
 * "Hist" and Divisions' at "Chang", and the tabs past them were reachable only by a sideways swipe nothing
 * hinted at. The list keeps its one row and its swipe; a side with more tabs beyond it fades out under a
 * chevron, and the chevron scrolls the list a screenful that way. Keyboard users move through the tabs with
 * the arrow keys, which scroll the chosen tab into view, so the chevrons are for a pointer and hidden from
 * a screen reader.
 */
export function OverflowTabsList({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });
  const list = () => wrap.current?.querySelector<HTMLElement>('.mantine-Tabs-list') ?? null;

  const measure = useCallback(() => {
    const el = list();
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
  }, []);

  useEffect(() => {
    const el = list();
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
  }, [measure]);

  const page = (dir: -1 | 1) => {
    const el = list();
    el?.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div ref={wrap} className="tabs-overflow" data-more-start={more.start || undefined} data-more-end={more.end || undefined}>
      <Tabs.List>{children}</Tabs.List>
      {more.start && (
        <span className="tabs-more tabs-more-start" aria-hidden onClick={() => page(-1)}>
          <IconChevronLeft size={ICON.control} />
        </span>
      )}
      {more.end && (
        <span className="tabs-more tabs-more-end" aria-hidden onClick={() => page(1)}>
          <IconChevronRight size={ICON.control} />
        </span>
      )}
    </div>
  );
}
