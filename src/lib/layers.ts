/**
 * One stacking scale for every layer in the app.
 *
 * Before this there were eleven raw z-index literals spread across six files and one stylesheet,
 * ranging 0→1100, and two of them were wrong in ways nothing could catch: the back-to-top button
 * sat at 250 and the selection tray at 200, both at or above Mantine's modal layer, so the floating
 * page chrome painted over the command palette instead of under it. The tray only lost that fight
 * by accident of DOM order.
 *
 * The names below are chosen by *what the thing floats over*, not by how high it needs to be, so a
 * new call site picks one by asking a question it can answer without reading the other ten.
 *
 * Mirrored as `--z-*` in app.css because CSS cannot read this file; `layers.test.ts` parses that
 * stylesheet and fails if the two ever drift.
 */
export const Z = {
  /** A decorative layer painted behind the content of its own section (the hero dot grid). */
  behind: 0,
  /** Content that has to sit above such a backdrop in the same stacking context. */
  content: 1,
  /** A readout, crosshair, or sticky action row belonging to one card or figure. */
  local: 2,
  /** In-page chrome that stays put while its own section scrolls beneath it. */
  sticky: 6,
  /**
   * Chrome fixed over the whole page: the selection tray and the back-to-top button.
   *
   * Deliberately below `modal`. These float over the *page*, and a dialog is not the page — when
   * the command palette is open it owns the screen, and page furniture belongs behind it.
   */
  floating: 180,
  /**
   * A figure opened full page (the landing graph): over the page and its fixed chrome — the header, the
   * selection tray — because for as long as it is open it IS the page. Still under `modal`, so the
   * command palette opened over it takes the screen from it.
   */
  fullPage: 190,
  /**
   * Mantine's own modal/overlay/popover layer. Nothing here may claim it or exceed it; it is
   * recorded so that staying under it is a decision rather than a coincidence.
   */
  modal: 200,
  /**
   * One page turning into another (the landing search's reveal of a person): for the few seconds it
   * covers the screen it is over everything, a dialog included, and takes the first key or press to
   * finish at once. Only the loading bar, which reports the page loading beneath it, is above.
   */
  reveal: 1000,
  /**
   * The global loading bar — the one thing that outranks a dialog. It is a 3px non-interactive
   * strip reporting that the app is still fetching, which stays true while a dialog is open.
   */
  loadingBar: 1100,
} as const;
