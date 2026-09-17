import type { Page } from '@playwright/test';

/**
 * On a developer's machine, run at about a CI runner's pace: CPU slowed three times. A frame budget met
 * only on a fast laptop is not met — a click's guard passed here at 3.8ms and failed in CI at 14ms,
 * when every moving frame stamped two thousand bead sprites. CI itself is not slowed further.
 */
export async function atCiPace(page: Page) {
  if (process.env.CI) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 3 });
}

/**
 * The budget for one moving frame. Two numbers, because the two machines are not the same machine:
 * here the pace is pinned (one laptop, slowed exactly three times), while a shared runner is whatever
 * hardware the job landed on, unslowed.
 *
 * Measured on the landing field: 6.4ms at the pinned three times, 11.4 at five, 17.4 at seven — and CI
 * reads about 9.6, so a runner is roughly half again slower than the pinned pace. The 8ms bar was set
 * from the pinned pace and applied to both, which left CI a coin flip: a deploy failed on 9.6 and on a
 * median of exactly 8.0, and the identical code on the previous commit measures 6.5 and 11.5 here, so
 * nothing had got slower — the bar was simply never the runner's.
 *
 * 12, not 16, for the runner. These guards exist because stamping every dot as a bead held the re-stack
 * at 16ms; a budget of 16 would wave that exact regression through. Drawing beads every frame reads
 * 38ms at the pinned pace and 51ms at a runner's, so 12 still catches it by a wide margin.
 *
 * Both live here, in one module, rather than beside the tests that use them. They were copied per spec
 * before, and the copies drifted: the budget was raised where it had failed and stayed at 8 in
 * tail.spec, which then failed the next deploy on 8.7 — the same fault, found one push later.
 */
export const FRAME_MS = process.env.CI ? 12 : 8;
