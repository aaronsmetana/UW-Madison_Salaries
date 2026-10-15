import type { TrayItemInput } from '../state/tray';

const TYPE_CODE: Record<TrayItemInput['type'], string> = { person: 'p', title: 't', school: 's' };
const CODE_TYPE: Record<string, TrayItemInput['type']> = { p: 'person', t: 'title', s: 'school' };

// `,` and `|` are both percent-encoded by encodeURIComponent, so once id/label are individually
// encoded, neither delimiter can collide with content that happens to contain a literal `,` or `|`.
const FIELD_SEP = ',';
const ITEM_SEP = '|';
const MAX_LENGTH = 1600;

/**
 * The tray in the address (C7): one `sel` a selection, its kind and its id — `sel=p:aaronsmetana|2014-10-15` —
 * encoded once, by the address. It was one value of every item with its name, each part encoded and then the whole
 * encoded again (`%257C`, `%2520`), names and all. A name is looked up on load; until it is, the id stands in.
 */
export function writeSel(p: URLSearchParams, items: readonly TrayItemInput[]) {
  p.delete('sel');
  for (const i of items) p.append('sel', `${TYPE_CODE[i.type]}:${i.id}`);
}

/** The selections a link holds: one `sel` each, or an older link's one value of them all (`decodeSel`). */
export function readSel(p: URLSearchParams): TrayItemInput[] | null {
  const all = p.getAll('sel');
  if (!all.length) return null;
  if (all.length === 1 && /^[pts],/.test(all[0])) return decodeSel(all[0]);
  const items: TrayItemInput[] = [];
  for (const v of all) {
    const m = v.match(/^([pts]):(.+)$/);
    if (!m) continue;
    items.push({ type: CODE_TYPE[m[1]], id: m[2], label: m[2] });
  }
  return items.length ? items : null;
}

/** A link's `sel` part for `items` (the tray's way to the raise case). */
export function selQuery(items: readonly TrayItemInput[]): string {
  const p = new URLSearchParams();
  writeSel(p, items);
  return p.toString();
}

/** An older link's one-value form (kept to read old links, `decodeSel`). */
export function encodeSel(items: TrayItemInput[]): string {
  return items
    .map((i) => [TYPE_CODE[i.type], encodeURIComponent(i.id), encodeURIComponent(i.label)].join(FIELD_SEP))
    .join(ITEM_SEP);
}

/** Parses a `sel` query-param value back into tray items (colorIdx is assigned by useTray's `add`,
 *  not carried over the link). Returns null if missing or malformed. */
export function decodeSel(param: string | null | undefined): TrayItemInput[] | null {
  if (!param || param.length > MAX_LENGTH) return null;
  const items: TrayItemInput[] = [];
  try {
    for (const part of param.split(ITEM_SEP)) {
      if (!part) continue;
      const [code, rawId, rawLabel] = part.split(FIELD_SEP);
      const type = CODE_TYPE[code];
      if (!type || !rawId) return null;
      const id = decodeURIComponent(rawId);
      items.push({ type, id, label: rawLabel != null ? decodeURIComponent(rawLabel) : id });
    }
  } catch {
    return null; // malformed percent-encoding
  }
  return items.length ? items : null;
}
