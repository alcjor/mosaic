/**
 * A place's side pane, as a person left it: its width and whether it is collapsed to a rail.
 * Kept per place in the browser's storage, so it survives a reload; a page that may not use
 * storage (a private window, a file opened from disk in some browsers) keeps the defaults.
 */

export interface PaneState {
  /** The pane's width in CSS pixels. */
  readonly width: number;
  readonly collapsed: boolean;
}

export const PANE_MIN = 260;
export const PANE_MAX = 720;
export const PANE_DEFAULT: PaneState = { width: 340, collapsed: false };

/** `width` kept within the pane's limits and within `room`, the width the place has in all. */
export function clampWidth(width: number, room: number = Infinity): number {
  const most = Math.max(PANE_MIN, Math.min(PANE_MAX, room - PANE_MIN));
  return Math.round(Math.max(PANE_MIN, Math.min(most, width)));
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const key = (place: string): string => `mosaic.pane.${place}`;

/** The pane of `place` as last left, or the default. */
export function readPane(place: string, store: Storage | null = storage()): PaneState {
  try {
    const got: unknown = JSON.parse(store?.getItem(key(place)) ?? "null");
    if (typeof got !== "object" || got === null) return PANE_DEFAULT;
    const { width, collapsed } = got as { width?: unknown; collapsed?: unknown };
    return {
      width: typeof width === "number" && Number.isFinite(width) ? clampWidth(width) : PANE_DEFAULT.width,
      collapsed: collapsed === true,
    };
  } catch {
    return PANE_DEFAULT;
  }
}

/** Keep the pane of `place` as it is now; nothing happens where storage is refused. */
export function writePane(place: string, state: PaneState, store: Storage | null = storage()): void {
  try {
    store?.setItem(key(place), JSON.stringify({ width: state.width, collapsed: state.collapsed }));
  } catch {
    // Storage is full or refused: the pane still works for this visit.
  }
}
