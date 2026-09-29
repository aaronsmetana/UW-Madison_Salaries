/** How long a release is "new", in days. */
export const NEW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Whether a release is still new: for NEW_DAYS from the day it went up on the site (`published`, from
 * data/releases.json), or, with no day recorded, from its snapshot date — which is the 1st of its month,
 * so a forgotten entry ends NEW early rather than never.
 *
 * Every "New" in the app reads this: the header's release tag and the badge on the newest snapshot in the
 * picker, a person's history and the Data page. They used to say "New" until the next release landed,
 * which for a twice-yearly source meant six months of NEW on data a returning reader had long since seen.
 * Dates are read as local midnight, as a reader's calendar has them.
 */
export function isNewRelease(published: string | null | undefined, snapshotDate: string, now: number = Date.now()): boolean {
  const start = Date.parse(`${(published || snapshotDate).slice(0, 10)}T00:00:00`);
  return Number.isFinite(start) && now < start + NEW_DAYS * DAY_MS;
}
