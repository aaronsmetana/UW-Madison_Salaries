/**
 * A new build has been activated by the service worker but the page is still running the old one.
 *
 * `registerType: 'autoUpdate'` reloads the page the instant the incoming worker activates. That is
 * right at startup and wrong afterwards: `registerSW`'s `onRegisteredSW` hook polls hourly and on
 * every `visibilitychange`, so the reload can land while someone is halfway through reading a person's
 * history or a report they are about to print. Deferring it to the next route change keeps the update
 * automatic — nobody has to know what a hard refresh is — without yanking the page out from under a
 * reader. Any navigation is a moment they have already accepted losing the current view.
 *
 * A module flag rather than context or state: the producer is `main.tsx`, outside React entirely.
 */
let pending = false;

/** Called from the service-worker `onNeedReload` hook once a newer build is live. */
export function markUpdateReady(): void {
  pending = true;
}

/** True once, then false — so two listeners can't both fire a reload. */
export function consumeUpdate(): boolean {
  const was = pending;
  pending = false;
  return was;
}
