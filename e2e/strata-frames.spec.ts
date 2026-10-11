import { test, expect, type Page } from '@playwright/test';

/**
 * The landing field's moving frames make nothing new (3a §13: "don't allocate memory per frame inside the draw
 * loop"). Measured, not assumed: twenty thousand squares a frame, each a call passing a place's fractions and a packed
 * colour as numbers, boxed a heap number apiece — some 430 KB a frame — until the calls took arrays and indexes.
 * The heap is read every frame while everyone moves to the floors and back, with nothing else running (React is
 * idle between the move's start and end); between two frames with no collection, it should hardly grow.
 */
test.use({ launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] } });

/** The median growth of the heap between frames 20 and 120 from now, bytes, leaving out frames a collection fell in. */
const heapPerFrame = (page: Page) => page.evaluate(() => new Promise<number>((done) => {
  const w = window as unknown as { gc: () => void };
  const perf = performance as unknown as { memory: { usedJSHeapSize: number } };
  const h = new Float64Array(140);
  let k = 0;
  const frame = () => {
    h[k++] = perf.memory.usedJSHeapSize;
    if (k < 140) { requestAnimationFrame(frame); return; }
    const rises: number[] = [];
    for (let i = 21; i < 120; i++) if (h[i] >= h[i - 1]) rises.push(h[i] - h[i - 1]);
    rises.sort((a, b) => a - b);
    done(rises[rises.length >> 1]);
  };
  w.gc();
  requestAnimationFrame(frame);
}));

test('a moving frame makes next to nothing new: the heap hardly grows from one frame to the next', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const field = page.locator('.strata-field').first();
  await expect(field).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  // What reading the heap a frame costs by itself, at rest.
  const idle = await heapPerFrame(page);
  for (const view of ['Floors', 'Histogram']) {
    const moving = heapPerFrame(page);
    await page.getByRole('radiogroup', { name: 'View' }).getByText(view).click();
    const perFrame = await moving;
    expect(perFrame - idle, `the heap grew ${perFrame} bytes a frame moving to ${view} (${idle} at rest)`).toBeLessThan(1024);
    await expect(field).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  }
});
