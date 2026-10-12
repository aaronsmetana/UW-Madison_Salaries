import { useState } from 'react';
import { Anchor, CloseButton, Group } from '@mantine/core';
import { Link, useLocation } from 'react-router-dom';
import { useRelease } from '../lib/hooks';
import { NewBadge } from '../components/NewBadge';

/**
 * Which release the app holds, at the top right of every page (PageTop): "Salary data as of September 2026".
 *
 * It replaced a "New · September 2026 data" pill in the landing page's top-right corner, which said
 * the month only on that one page and said "New" until the next release, six months on. Here it is on
 * every page, and it states the LATEST release, which stays true on a page showing an older snapshot
 * through its picker (the picker says which one that is). For 30 days from the day the release went up
 * (`useRelease().isNew`) it leads with the same "New" badge as the picker's and links to what came with
 * it; after that it reads plainly and links to the Data page.
 *
 * It sat beside the app's name until the person-page redesign gave the header to the destinations; there,
 * below 992px, it had to become a second, smaller line over the name. In the page's own top row it has the
 * width of the page, and on a phone it simply wraps under the trail.
 *
 * It repeated over every page's heading for good, and read as a caption rather than a link (G20). It is
 * underlined as a link, a reader can put it away (for this release: the next one brings it back), and it
 * is not shown on the Data page, whose "What's new" it pointed to and sat directly over (AD4).
 */
const seenKey = (month: string) => `release-tag-dismissed:${month}`;

export function ReleaseTag() {
  const release = useRelease();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return localStorage.getItem('release-tag-dismissed'); } catch { return null; }
  });
  if (!release?.month || pathname.endsWith('/data')) return null;
  const { month, isNew, rangesUpdated } = release;
  if (dismissed === seenKey(month)) return null;
  const dismiss = () => {
    try { localStorage.setItem('release-tag-dismissed', seenKey(month)); } catch { /* private mode: for this page only */ }
    setDismissed(seenKey(month));
  };
  const withRanges = isNew && rangesUpdated;
  const label = `Salary data as of ${month}${isNew ? `, new${withRanges ? ', with updated salary ranges' : ''}. What's new` : '. About the data'}`;
  return (
    <Group gap={2} wrap="nowrap" className="release-tag-wrap">
      <Anchor
        component={Link}
        to={isNew ? '/data#whats-new' : '/data'}
        underline="never"
        className="release-tag"
        data-new={isNew || undefined}
        aria-label={label}
      >
        <NewBadge />
        <span className="release-tag-long" aria-hidden>
          Salary data as of {month}
          {withRanges && <span className="release-tag-ranges"><span className="release-tag-sep"> · </span>salary ranges updated</span>}
        </span>
      </Anchor>
      <CloseButton size="sm" variant="subtle" onClick={dismiss} aria-label={`Hide the note about the ${month} data`} className="release-tag-close" />
    </Group>
  );
}

