import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * An element's width, measured the moment it mounts and again whenever it resizes.
 *
 * Mantine's `useElementSize` attaches its observer in an effect keyed on `ref.current` and reports
 * through `requestAnimationFrame`, so an element that first appears in a later render (after a
 * loading state) is measured only once something else renders again. On production the person
 * page's trend chart drew no era titles until the reader clicked something. A callback ref runs
 * when the element exists, whatever the render order.
 */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
      observer.current.observe(el);
    }
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width];
}
