import { Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useRelease } from '../lib/hooks';
import { NewBadge } from '../components/NewBadge';

/**
 * Which release the app holds, beside its name on every page: "Salary data as of September 2026".
 *
 * It replaced a "New · September 2026 data" pill in the landing page's top-right corner, which said
 * the month only on that one page and said "New" until the next release, six months on. Here it is on
 * every page, beside the name it qualifies, and it states the LATEST release, which stays true on a
 * page showing an older snapshot through its picker (the picker says which one that is). For 30 days
 * from the day the release went up (`useRelease().isNew`) it leads with the same "New" badge as the
 * picker's and links to what came with it; after that it reads plainly and links to the Data page.
 *
 * Its own link, beside the wordmark's rather than inside it: the wordmark goes home, and links do not
 * nest. Below 1200px "· salary ranges updated" gives way first; below `md` there is no room beside
 * the name and the credit at all — at 768px the tag ran into the colour switch — and the release is
 * the line over the name instead (ReleaseEyebrow).
 */
export function ReleaseTag() {
  const release = useRelease();
  if (!release?.month) return null;
  const { month, isNew, rangesUpdated } = release;
  const withRanges = isNew && rangesUpdated;
  const label = `Salary data as of ${month}${isNew ? `, new${withRanges ? ', with updated salary ranges' : ''}. What's new` : '. About the data'}`;
  return (
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
  );
}

/**
 * The same, below `md`: the line over the app's name, where a wider header says "Open record salary
 * data". Beside the name there is no room there — on a phone the tag ran off the screen, and at 768px
 * it ran into the colour switch. Not a link of its own: it sits inside the name's link home, and links
 * do not nest.
 */
export function ReleaseEyebrow() {
  const release = useRelease();
  if (!release?.month) return null;
  return (
    <span className="release-eyebrow" data-new={release.isNew || undefined}>
      <NewBadge />
      <span>Data as of {release.latest.label}</span>
    </span>
  );
}
