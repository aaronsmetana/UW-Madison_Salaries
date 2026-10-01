import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { ReleaseTag } from './ReleaseTag';

/** One step of the trail: a place to go back to, or (the last, `to` left out) the page itself. */
export interface Crumb {
  label: string;
  to?: string;
}

const CrumbsContext = createContext<{ crumbs: Crumb[]; set: (c: Crumb[]) => void }>({ crumbs: [], set: () => {} });

export function CrumbsProvider({ children }: { children: ReactNode }) {
  const [crumbs, set] = useState<Crumb[]>([]);
  const value = useMemo(() => ({ crumbs, set }), [crumbs]);
  return <CrumbsContext.Provider value={value}>{children}</CrumbsContext.Provider>;
}

/**
 * Where an entity page sits: "People / System Engineer IV / Aaron Smetana", "Divisions / Libraries". The
 * page names its trail and the shell draws it (PageTop), so every page's trail is in the same place, in the
 * same style, and a page that names none (a top-level one) has none. Cleared when the page goes.
 */
export function useCrumbs(crumbs: Crumb[]) {
  const { set } = useContext(CrumbsContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(JSON.parse(key) as Crumb[]);
  }, [key, set]);
  useEffect(() => () => set([]), [set]);
}

/**
 * The row over every page: its trail at left, which release the app holds at right. The release was beside
 * the app's name in the header; the redesign's top bar holds the name and the destinations, so it moved
 * here, where it says the same on every page and needs no second, narrower form for a phone.
 */
export function PageTop() {
  const { crumbs } = useContext(CrumbsContext);
  return (
    <div className="page-top no-print">
      {crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="crumbs">
          <ol>
            {crumbs.map((c, i) => (
              <li key={i}>
                {c.to && i < crumbs.length - 1 ? (
                  <Anchor component={Link} to={c.to} underline="hover" inherit>{c.label}</Anchor>
                ) : (
                  <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : <span />}
      <ReleaseTag />
    </div>
  );
}
