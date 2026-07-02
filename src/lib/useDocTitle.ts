import { useEffect } from 'react';

const SITE_NAME = 'UW–Madison Salaries';

/** Sets document.title to "{title} · SITE_NAME" for as long as the calling route is mounted, restoring
 *  the previous title on unmount — so browser history/tabs/bookmarks read as more than one generic name. */
export function useDocTitle(title: string | null | undefined): void {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
