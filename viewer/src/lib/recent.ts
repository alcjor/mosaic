/**
 * "Jump back in": the last few things a person opened in a mosaic, newest first. Kept per
 * mosaic, by its knowledge hash, in the browser's storage, so another mosaic never shows them;
 * a page that may not use storage (a private window, a file opened from disk in some browsers)
 * simply has none.
 */

/** A thing opened: enough to name it and to open it again. */
export interface Recent {
  readonly id: string;
  readonly label: string | null;
  readonly type: string;
}

/** How many things are kept. */
export const RECENT_MOST = 5;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const key = (mosaic: string): string => `mosaic.recent.${mosaic}`;

/** The things last opened in the mosaic with knowledge hash `mosaic`, newest first. */
export function readRecent(mosaic: string, store: Storage | null = storage()): Recent[] {
  try {
    const got: unknown = JSON.parse(store?.getItem(key(mosaic)) ?? "null");
    if (!Array.isArray(got)) return [];
    const out: Recent[] = [];
    for (const item of got as unknown[]) {
      if (typeof item !== "object" || item === null) continue;
      const { id, label, type } = item as Record<string, unknown>;
      if (typeof id !== "string" || typeof type !== "string" || out.some((r) => r.id === id)) continue;
      out.push({ id, label: typeof label === "string" ? label : null, type });
    }
    return out.slice(0, RECENT_MOST);
  } catch {
    return [];
  }
}

/** Put `thing` first among the things opened in `mosaic`; nothing happens where storage is refused. */
export function remember(mosaic: string, thing: Recent, store: Storage | null = storage()): void {
  try {
    const next = [thing, ...readRecent(mosaic, store).filter((r) => r.id !== thing.id)].slice(0, RECENT_MOST);
    store?.setItem(key(mosaic), JSON.stringify(next.map(({ id, label, type }) => ({ id, label, type }))));
  } catch {
    // Storage is full or refused: the page works without the list.
  }
}
