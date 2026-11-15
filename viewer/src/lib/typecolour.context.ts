/**
 * The open mosaic's type colours, handed from the shell to every component under it
 * (lib/typecolour.ts says how types take them).
 */
import { getContext, setContext } from "svelte";

/** The number of a type's colour token, or null for a type the page does not know. */
export type ColourOf = (type: string) => number | null;

const KEY = Symbol("type colours");

/** The shell provides the open mosaic's type colours to every component under it. */
export function provideTypeColours(colourOf: ColourOf): void {
  setContext(KEY, colourOf);
}

/** The type colours the shell provided; outside a shell, every type is neutral. */
export function typeColours(): ColourOf {
  return getContext<ColourOf | undefined>(KEY) ?? (() => null);
}
