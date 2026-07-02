import type { TrayItem } from '../state/tray';

const TYPE_CODE: Record<TrayItem['type'], string> = { person: 'p', title: 't', school: 's' };
const CODE_TYPE: Record<string, TrayItem['type']> = { p: 'person', t: 'title', s: 'school' };

// `,` and `|` are both percent-encoded by encodeURIComponent, so once id/label are individually
// encoded, neither delimiter can collide with content that happens to contain a literal `,` or `|`.
const FIELD_SEP = ',';
const ITEM_SEP = '|';
const MAX_LENGTH = 1600;

/** Serializes tray items into a compact, URL-safe value for a shareable Compare link. */
export function encodeSel(items: TrayItem[]): string {
  return items
    .map((i) => [TYPE_CODE[i.type], encodeURIComponent(i.id), encodeURIComponent(i.label)].join(FIELD_SEP))
    .join(ITEM_SEP);
}

/** Parses a `sel` query-param value back into tray items. Returns null if missing or malformed. */
export function decodeSel(param: string | null | undefined): TrayItem[] | null {
  if (!param || param.length > MAX_LENGTH) return null;
  const items: TrayItem[] = [];
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
