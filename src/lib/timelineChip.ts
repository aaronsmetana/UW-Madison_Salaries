/**
 * The timeline's status chip (mockup 3a §11): what the graph is doing, in words — moving people, holding for the
 * countdown, re-sorting, resting before the next snapshot, playing Fast — with the seconds left where it counts
 * down, how long until the timeline ends while it plays, and how far round its ring is drawn. Pure: the chip asks
 * again as the clock runs.
 */

export interface ChipInput {
  /** performance.now(), ms. */
  now: number;
  playing: boolean;
  paused: boolean;
  /** Fast: one flow, a snapshot every `fastMs`. */
  fast: boolean;
  fastMs: number;
  /** The step's phase, from the field, and the step it belongs to: its snapshots' names, and whether it is a
   *  quick catch-up step. */
  phase: { phase: 'move' | 'hold' | 'sort'; start: number; end: number } | null;
  step: { from: string; to: string; quick: boolean } | null;
  /** Back to an earlier snapshot: the cross-fade, and where to. */
  fade: { to: string; start: number; end: number } | null;
  /** Everyone on the way to another view. */
  switching: boolean;
  /** The intro's title, and its way out to everyone (3a §12). */
  intro: boolean;
  /** Play's rest before the next snapshot. */
  rest: { start: number; end: number; next: string } | null;
  /** 'salary', or 'type, then salary'. */
  sortBy: string;
  /** The pace's phases, ms, for the time left. */
  plan: { mv: number; cd: number; so: number; re: number };
  /** Snapshots still to come after the one the step goes to (or rests at), and the last one's name. */
  stepsLeft: number;
  last: string;
  /** Overall progress through the snapshots, 0–1, before and after the step in flight: Fast's ring. */
  progress: { from: number; to: number };
}

/** The ring: from `from` to `to` (0–1 of a turn) between `start` and `end`, or simply at `from`. */
export interface Ring { from: number; to: number; start: number; end: number; linear: boolean }

export interface ChipState {
  label: string;
  /** Whole seconds left, where it counts down; else empty. */
  count: string;
  /** "Timeline ends (Sep 2026) in 0:42", while it plays. */
  eta: string;
  ring: Ring;
}

const still = (v: number): Ring => ({ from: v, to: v, start: 0, end: 0, linear: true });
const secondsLeft = (end: number, now: number) => String(Math.max(1, Math.ceil((end - now) / 1000)));
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function chipState(c: ChipInput): ChipState {
  const { now, phase, step, rest, fade } = c;
  let label: string, count = '', ring: Ring = still(0);
  if (c.intro) label = 'Each square is one person';
  else if (fade && now < fade.end) {
    label = `Rewinding to ${fade.to}`;
    ring = { from: 0, to: 1, start: fade.start, end: fade.end, linear: false };
  } else if (c.switching) label = 'Switching view';
  else if (c.fast && c.playing) {
    label = `Playing · ${Math.max(1, Math.round(1000 / c.fastMs))} snapshots a second`;
    ring = phase?.phase === 'move'
      ? { from: c.progress.from, to: c.progress.to, start: phase.start, end: phase.end, linear: true }
      : still(c.progress.to);
  } else if (phase?.phase === 'move' && step) {
    label = `${step.quick ? 'Skipping ahead' : 'Moving people'} · ${step.from} → ${step.to}`;
    ring = { from: 0, to: 1, start: phase.start, end: phase.end, linear: false };
  } else if (phase?.phase === 'hold') {
    label = `Sorting by ${c.sortBy} in`;
    count = secondsLeft(phase.end, now);
    ring = { from: 1, to: 0, start: phase.start, end: phase.end, linear: true };
  } else if (phase?.phase === 'sort') {
    label = `Sorting by ${c.sortBy}…`;
    ring = { from: 0, to: 1, start: phase.start, end: phase.end, linear: false };
  } else if (c.playing && rest && now < rest.end) {
    label = `Next: ${rest.next} in`;
    count = secondsLeft(rest.end, now);
    ring = { from: 1, to: 0, start: rest.start, end: rest.end, linear: true };
  } else label = c.paused ? `Paused · sorted by ${c.sortBy}` : `Sorted by ${c.sortBy}`;

  // While it plays: what is left of this phase, the step's phases after it, and every step still to come.
  let eta = '';
  if (c.playing && !fade) {
    const { mv, cd, so, re } = c.plan;
    let left = 0;
    if (phase) {
      left = Math.max(0, phase.end - now) + (phase.phase === 'move' ? cd + so + re : phase.phase === 'hold' ? so + re : re);
    } else if (rest) left = Math.max(0, rest.end - now);
    left += c.stepsLeft * (mv + cd + so + re);
    if (phase || rest || c.stepsLeft > 0) eta = `Timeline ends (${c.last}) in ${clock(left)}`;
  }
  return { label, count, eta, ring };
}
