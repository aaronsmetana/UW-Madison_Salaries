import { describe, expect, it } from 'vitest';
import { overlaps, packLabelRows, placeChips, placeEndLabels, placeNearLabels, placeSideLabel, placeSideLabels, segmentHitsBox, type Box } from './labelLayout';

const plot: Box = { left: 0, right: 400, top: 0, bottom: 200 };

describe('packLabelRows', () => {
  it('keeps labels that fit on one row', () => {
    expect(packLabelRows([{ left: 0, right: 50 }, { left: 60, right: 100 }], { left: 0, right: 200 })).toEqual([0, 0]);
  });

  it('lifts a label that would touch its neighbour onto the next row', () => {
    expect(packLabelRows([{ left: 0, right: 50 }, { left: 40, right: 90 }], { left: 0, right: 200 })).toEqual([0, 1]);
  });

  it('returns to the first row as soon as it has room', () => {
    expect(packLabelRows([{ left: 0, right: 50 }, { left: 40, right: 90 }, { left: 60, right: 80 }], { left: 0, right: 200 })).toEqual([0, 1, 0]);
  });

  it('gives up when three labels crowd two rows', () => {
    expect(packLabelRows([{ left: 0, right: 50 }, { left: 10, right: 60 }, { left: 20, right: 70 }], { left: 0, right: 200 })).toBeNull();
  });

  it('gives up when a label leaves the chart', () => {
    expect(packLabelRows([{ left: -10, right: 40 }], { left: 0, right: 200 })).toBeNull();
    expect(packLabelRows([{ left: 180, right: 230 }], { left: 0, right: 200 })).toBeNull();
  });
});

describe('placeChips', () => {
  it('puts a chip above its point, or below when that is preferred', () => {
    const [a] = placeChips([{ id: 0, x: 100, y: 100, width: 40, priority: 0 }], [], plot);
    expect(a.cy).toBe(78);
    const [b] = placeChips([{ id: 0, x: 100, y: 100, width: 40, priority: 0, preferBelow: true }], [], plot);
    expect(b.cy).toBe(122);
  });

  it('drops below the point when above would leave the plot', () => {
    const [a] = placeChips([{ id: 0, x: 100, y: 10, width: 40, priority: 0 }], [], plot);
    expect(a.cy).toBe(32);
  });

  it('nudges a chip inward at the edges', () => {
    const [a] = placeChips([{ id: 0, x: 395, y: 100, width: 40, priority: 0 }], [], plot);
    expect(a.box.right).toBe(400);
  });

  it('never covers an obstacle', () => {
    const marker: Box = { left: 89, right: 111, top: 67, bottom: 89 };
    const [a] = placeChips([{ id: 0, x: 100, y: 100, width: 40, priority: 0 }], [marker], plot);
    expect(overlaps(a.box, marker)).toBe(false);
    expect(a.cy).toBe(122);
  });

  it('never places two chips on each other, and drops the lower-priority one', () => {
    const chips = [
      { id: 0, x: 100, y: 100, width: 40, priority: 1 },
      { id: 1, x: 110, y: 100, width: 40, priority: 5 },
      { id: 2, x: 120, y: 100, width: 40, priority: 3 },
    ];
    const placed = placeChips(chips, [], plot);
    expect(placed.map((p) => p.id)).toEqual([1, 2]);
    expect(overlaps(placed[0].box, placed[1].box)).toBe(false);
  });
});

describe('placeSideLabel', () => {
  const w = (t: string) => t.length * 5;
  const plot = { left: 0, right: 200 };
  it('sits after the line when it fits', () => {
    expect(placeSideLabel(20, plot, ['abcdefghij'], w)).toEqual({ text: 'abcdefghij', anchor: 'start', x: 24 });
  });
  it('moves before the line near the right edge, keeping the full wording', () => {
    expect(placeSideLabel(180, plot, ['abcdefghij', 'ab'], w)).toEqual({ text: 'abcdefghij', anchor: 'end', x: 176 });
  });
  it('shortens only when the full wording fits on neither side', () => {
    expect(placeSideLabel(100, plot, ['a'.repeat(30), 'ab'], w)).toEqual({ text: 'ab', anchor: 'start', x: 104 });
  });
  it('draws nothing rather than overflow', () => {
    expect(placeSideLabel(100, plot, ['a'.repeat(30)], w)).toBeNull();
  });
});

describe('placeSideLabels', () => {
  // 5px a character, like a 10px label.
  const w = (t: string) => t.length * 5;
  const plot = { left: 100, right: 400 };
  const TTC = ['TTC reclassification', 'TTC'];
  const NINE = ['9-month pay reported differently', '9-month reporting'];
  const apart = (a: { x: number; anchor: string; text: string }, b: { x: number; anchor: string; text: string }) => {
    const span = (p: typeof a) => (p.anchor === 'start' ? [p.x, p.x + w(p.text)] : [p.x - w(p.text), p.x]);
    const [a0, a1] = span(a), [b0, b1] = span(b);
    return Math.max(b0 - a1, a0 - b1);
  };

  it('places far-apart markers each as it would alone', () => {
    const out = placeSideLabels([{ x: 110, texts: TTC }, { x: 390, texts: NINE }], plot, w);
    expect(out.map((p) => [p?.text, p?.row])).toEqual([['TTC reclassification', 0], ['9-month pay reported differently', 0]]);
  });

  it('gives two that would touch their short wording, and keeps them 6px apart', () => {
    // The phone case: the TTC line near the left, the 9-month label placed before its own line.
    const out = placeSideLabels([{ x: 150, texts: TTC }, { x: 290, texts: NINE }], { left: 100, right: 300 }, w);
    expect(out.map((p) => p?.text)).toEqual(['TTC', '9-month reporting']);
    expect(out.every((p) => p?.row === 0)).toBe(true);
    expect(apart(out[0]!, out[1]!)).toBeGreaterThanOrEqual(6);
  });

  it('moves the later of two that still touch to a second row', () => {
    const out = placeSideLabels([{ x: 200, texts: ['first marker', 'first'] }, { x: 205, texts: ['second marker', 'second'] }], plot, w);
    expect(out[0]?.row).toBe(0);
    expect(out[1]?.row).toBe(1);
  });
});

describe('placeNearLabels', () => {
  const field: Box = { left: 0, right: 600, top: 0, bottom: 300 };
  // One marked dot, `n` of them, spread or stacked as each test needs.
  const dot = (id: number, x: number, y: number, width = 90, priority = 0) => ({ id, x, y, r: 10, width, priority });

  it('sits a label just above its own dot, clear of the dot itself', () => {
    const [out] = placeNearLabels([dot(0, 300, 200)], field, { height: 19 });
    expect(out.cx).toBe(300);
    // Above the dot, and its bottom edge above the dot's top.
    expect(out.cy).toBeLessThan(200);
    expect(out.box.bottom).toBeLessThan(190);
    // …and near it: this is an annotation on the dot, not a legend at the top of the plot.
    expect(200 - out.box.bottom).toBeLessThan(40);
  });

  it('puts the second of two labels where its leader does not run through the first', () => {
    // Level with each other, so one of them has to give way — above, below or out to the side, as
    // there is room. Stacking one straight above the other is the tempting wrong answer: the boxes
    // clear each other, and the upper one's leader then runs right through the lower name.
    const dots = [dot(0, 300, 200), dot(1, 315, 200)];
    const out = placeNearLabels(dots, field, { height: 19 });
    expect(out.length).toBe(2);
    expect(overlaps(out[0].box, out[1].box)).toBe(false);
    for (const p of out) {
      const d = dots[p.id];
      const anchor = { x: p.cx, y: p.cy < d.y ? p.box.bottom : p.box.top };
      for (const q of out) {
        if (q.id === p.id) continue;
        expect(segmentHitsBox({ x: d.x, y: d.y }, anchor, q.box), `${p.id}'s leader runs through ${q.id}`).toBe(false);
      }
    }
  });

  it('leads to a label either straight up or at exactly 45 degrees, never in between', () => {
    // Four dots in a heap: every one of them has to move, and each has to stay followable.
    const dots = [dot(0, 300, 220), dot(1, 310, 225), dot(2, 320, 215), dot(3, 330, 230)];
    const out = placeNearLabels(dots, field, { height: 19 });
    expect(out.length).toBeGreaterThan(1);
    for (const p of out) {
      const d = dots[p.id];
      const across = Math.abs(p.anchor.x - d.x);
      const along = Math.abs(p.anchor.y - d.y);
      if (across < 1) expect(along, 'a vertical leader that goes nowhere').toBeGreaterThan(d.r);
      else expect(Math.abs(along - across), `${across} across, ${along} along`).toBeLessThan(1.5);
      // The leader ends on the label it belongs to, not somewhere near it.
      expect(p.anchor.x).toBeGreaterThanOrEqual(p.box.left - 0.5);
      expect(p.anchor.x).toBeLessThanOrEqual(p.box.right + 0.5);
      expect(Math.min(Math.abs(p.anchor.y - p.box.top), Math.abs(p.anchor.y - p.box.bottom))).toBeLessThan(0.5);
    }
  });

  it('moves a label that would lie across another, even where no leader crosses anything', () => {
    // Two dots far enough apart that each leader rises well clear of the other's name, but with labels
    // wide enough to overlap where they stand. Only the label-against-label check can catch this one:
    // the leaders are vertical, 150px apart, and neither goes near the other's box.
    const dots = [dot(0, 300, 200, 200), dot(1, 450, 200, 200)];
    const out = placeNearLabels(dots, field, { height: 19 });
    expect(out.length).toBe(2);
    expect(overlaps(out[0].box, out[1].box), 'two names were drawn across each other').toBe(false);
  });

  it('leaves a name out rather than sending it across the plot to find room', () => {
    // Ten people within a few hundred dollars of each other, with names too wide to fan out: some of
    // them have nowhere near their dot to go. The answer is to drop those, not to place them far away
    // with a long line trailing after them — that is the legend-at-the-top failure, one label at a time.
    // A tall plot, so what stops a name wandering is the rule about staying near its dot rather than
    // the plot running out of room above it.
    const tall: Box = { left: 0, right: 600, top: 2, bottom: 800 };
    const dots = Array.from({ length: 10 }, (_, i) => dot(i, 290 + i * 4, 610 + (i % 3) * 5, 170));
    const out = placeNearLabels(dots, tall, { height: 19 });
    expect(out.length, 'nothing was placed at all').toBeGreaterThan(2);
    expect(out.length, 'a field this crowded cannot name everyone near their dot').toBeLessThan(dots.length);
    for (const p of out) {
      const d = dots[p.id];
      const away = Math.hypot(p.anchor.x - d.x, p.anchor.y - d.y);
      expect(away, `${p.id}'s name is ${away.toFixed(0)}px from its dot`).toBeLessThan(150);
    }
  });

  it('goes round a name rather than running its leader through it', () => {
    // Two dots one above the other at the foot of the plot: there is no room below, and the place
    // straight above the lower one is walled off by the upper one's name. The way out is sideways —
    // never straight up through the name, which would read as pointing at that person instead.
    const floor: Box = { left: 0, right: 600, top: 2, bottom: 320 };
    const dots = [dot(0, 300, 285, 120), dot(1, 300, 300, 120)];
    const out = placeNearLabels(dots, floor, { height: 19 });
    expect(out.length).toBe(2);
    for (const p of out) {
      const d = dots[p.id];
      for (const q of out) {
        if (q.id === p.id) continue;
        expect(segmentHitsBox({ x: d.x, y: d.y }, p.anchor, q.box), `${p.id}'s leader runs through ${q.id}`).toBe(false);
      }
    }
  });

  it('never covers another marked dot with a name', () => {
    // Three dots in a row, close enough that a centred label would lie across its neighbours.
    const dots = [dot(0, 280, 150), dot(1, 300, 150), dot(2, 320, 150)];
    const out = placeNearLabels(dots, field, { height: 19 });
    for (const p of out) {
      for (const d of dots) {
        expect(overlaps(p.box, { left: d.x - d.r, right: d.x + d.r, top: d.y - d.r, bottom: d.y + d.r })).toBe(false);
      }
    }
  });

  it('goes below a dot that has no room above it', () => {
    const [out] = placeNearLabels([dot(0, 300, 12)], field, { height: 19 });
    expect(out.cy).toBeGreaterThan(12);
    expect(out.box.top).toBeGreaterThan(22);
  });

  it('keeps a label inside the plot at either edge', () => {
    const out = placeNearLabels([dot(0, 4, 200), dot(1, 596, 200)], field, { height: 19 });
    expect(out[0].box.left).toBeGreaterThanOrEqual(field.left);
    expect(out[1].box.right).toBeLessThanOrEqual(field.right);
  });

  it('gives the closest place to the label the reader is following', () => {
    // Two dots on the same spot: the active one (priority 1) is placed first, so it gets the nearest
    // place there is — straight above — and the other takes a further one.
    const out = placeNearLabels([dot(0, 300, 200), dot(1, 300, 200, 90, 1)], field, { height: 19 });
    const away = (p: { cx: number; cy: number }) => Math.hypot(p.cx - 300, p.cy - 200);
    const active = out.find((p) => p.id === 1)!;
    const other = out.find((p) => p.id === 0)!;
    expect(active.cy, 'the name the reader is following went below the dot').toBeLessThan(200);
    expect(away(active), 'the name the reader is following was not the one placed closest').toBeLessThanOrEqual(away(other));
    expect(overlaps(active.box, other.box)).toBe(false);
  });

  it('leaves a name out rather than printing it over another', () => {
    // Six dots on one spot, in a plot with room for far fewer: some are dropped, none overlap.
    const crowd = Array.from({ length: 6 }, (_, i) => dot(i, 300, 150, 200));
    const out = placeNearLabels(crowd, { left: 0, right: 400, top: 120, bottom: 180 }, { height: 19 });
    expect(out.length).toBeLessThan(6);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) expect(overlaps(out[i].box, out[j].box)).toBe(false);
    }
  });
});

describe('placeEndLabels', () => {
  const flat = (y: number, x0 = 0, x1 = 400) => [{ x: x0, y }, { x: x1, y }];
  const crossesAny = (box: Box, lines: { x: number; y: number }[][]) =>
    lines.some((l) => l.some((p, i) => i > 0 && segmentHitsBox(l[i - 1], p, box, 1)));

  it('writes a name just above its line, back from the end', () => {
    const [a] = placeEndLabels([{ id: 'a', x: 400, y: 100, width: 60 }], [flat(100)], plot, 0);
    expect(a).toMatchObject({ x: 396, y: 93, anchor: 'end' });
  });

  it('goes below a line that runs along the top of the chart', () => {
    const [a] = placeEndLabels([{ id: 'a', x: 400, y: 4, width: 60 }], [flat(4)], plot, 0);
    expect(a.y).toBe(19);
  });

  it('gives two lines that end close together one side each', () => {
    const lines = [flat(100), flat(106)];
    const [a, b] = placeEndLabels([{ id: 'b', x: 400, y: 106, width: 60 }, { id: 'a', x: 400, y: 100, width: 60 }], lines, plot, 0);
    expect(a).toMatchObject({ id: 'a', y: 93 });
    expect(b.id).toBe('b');
    expect(b.y).toBeGreaterThan(106);
    expect(overlaps(a.box, b.box)).toBe(false);
    for (const p of [a, b]) expect(crossesAny(p.box, lines), `${p.id} covers a line`).toBe(false);
  });

  it('keeps a name off another line that climbs through the corner above its own end', () => {
    // A wide name above a flat line's end would lie across the steep one rising past it.
    const steep = [{ x: 250, y: 120 }, { x: 400, y: 40 }];
    const lines = [flat(110, 0, 400), steep];
    const [a] = placeEndLabels([{ id: 'a', x: 400, y: 110, width: 160 }], lines, plot, 0);
    expect(crossesAny(a.box, lines)).toBe(false);
    expect(a.y).toBeGreaterThan(110);
  });

  it('stays near its line rather than wandering off to find a clear place', () => {
    // A thicket of lines everywhere near the end: the name takes the nearest place clear of other names.
    const thicket = Array.from({ length: 40 }, (_, i) => flat(i * 5));
    const [a] = placeEndLabels([{ id: 'a', x: 400, y: 100, width: 60 }], thicket, plot, 0);
    expect(a.y).toBe(93);
  });

  it("crosses a band's faint edge beside its own line rather than leave the line far behind", () => {
    // The median runs inside a middle-50% band whose edges sit 12px above and below it: no place beside
    // the end clears both, and the nearest place clear of them is over the band's edge, away from it.
    const edges = [flat(88), flat(112)];
    const [a] = placeEndLabels([{ id: 'a', x: 400, y: 100, width: 60 }], [flat(100)], plot, 0, { edges });
    expect(a.y).toBe(93);
    // With room between the edges, the edge is kept clear.
    const [b] = placeEndLabels([{ id: 'b', x: 400, y: 100, width: 60 }], [flat(100)], plot, 0, { edges: [flat(80), flat(130)] });
    expect(crossesAny(b.box, [flat(80), flat(130)])).toBe(false);
    expect(b.y).toBe(93);
    // And an equally near place clear of the edge beats one across it: here, below.
    const [c] = placeEndLabels([{ id: 'c', x: 400, y: 100, width: 60 }], [flat(100)], plot, 0, { edges: [flat(92)] });
    expect(c.y).toBe(115);
  });

  it("keeps clear of a marker's words already on the chart", () => {
    const words: Box = { left: 300, right: 420, top: 84, bottom: 96 };
    const [a] = placeEndLabels([{ id: 'a', x: 400, y: 100, width: 60 }], [flat(100)], plot, 0, { avoid: [words] });
    expect(overlaps(a.box, words)).toBe(false);
    expect(a.y).toBe(115);
  });

  it('never has another line, or words, between a name and its own line', () => {
    // The end's room above is taken by a marker's words and a second line runs just below it, so
    // neither side of the end will do, and nor will above the words: the name slides back along its
    // line, past them.
    const own = flat(100, 0, 400);
    const other = flat(110, 300, 400);
    const words: Box = { left: 330, right: 420, top: 80, bottom: 96 };
    const [a] = placeEndLabels([{ id: 'a', x: 400, y: 100, width: 60, line: own }], [own, other], plot, 0, { avoid: [words] });
    expect(overlaps(a.box, words)).toBe(false);
    expect(a.box.bottom).toBeLessThan(100);
    expect(a.box.right).toBeLessThanOrEqual(330);
  });

  it('follows a sloping line as it slides back along it', () => {
    const own = [{ x: 0, y: 190 }, { x: 400, y: 30 }];
    const words: Box = { left: 330, right: 420, top: 0, bottom: 40 };
    const others = [flat(45, 330, 400)];
    const [a] = placeEndLabels([{ id: 'a', x: 400, y: 30, width: 60, line: own }], [own, ...others], plot, 0, { avoid: [words] });
    const lineAtRight = 190 + (a.box.right / 400) * (30 - 190);
    // Beside the line where the name now ends, not at the height of the line's end.
    expect(a.box.right).toBeLessThan(330);
    expect(Math.abs(a.y - lineAtRight)).toBeLessThan(20);
  });

  it('writes forward from a line that stops near the left edge', () => {
    const [a] = placeEndLabels([{ id: 'a', x: 30, y: 100, width: 60 }], [flat(100, 0, 30)], plot, 0);
    expect(a).toMatchObject({ x: 34, anchor: 'start' });
    expect(a.box.left).toBe(34);
  });

  it('never leaves the chart, and never sets one name on another', () => {
    const ends = [0, 3, 6, 9].map((y, i) => ({ id: String(i), x: 400, y: 190 + y, width: 60 }));
    const placed = placeEndLabels(ends, [], plot, 0);
    for (const p of placed) {
      expect(p.box.top).toBeGreaterThanOrEqual(0);
      expect(p.box.bottom).toBeLessThanOrEqual(plot.bottom);
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i].box, placed[j].box)).toBe(false);
    }
  });
});
