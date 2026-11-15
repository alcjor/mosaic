/**
 * What the shell (App.svelte) hands every place: the open mosaic's viewer, the view file's
 * settings applied to it, whether the page is below 960px, and the addresses things open at.
 * A place renders `<Place id=…>` (components/Place.svelte) and, where it has one, a `<Pane>`.
 */
import type { PlaceId } from "../lib/places.js";
import type { ChainLinkRoute, TableRoute } from "../lib/route.js";
import type { Shape } from "../lib/view.js";
import type { Viewer } from "../lib/viewer.svelte.js";

/** The addresses the places link to; each keeps the query and what the other places hold. */
export interface PlaceLinks {
  /** A thing opens in Explore. */
  readonly thing: (id: string) => string;
  /** A table opens in Tables. */
  readonly table: (table: TableRoute) => string;
  /** A type's table, from its first page. */
  readonly type: (type: string) => string;
  /** A chain opens in Trails (null: Trails with no chain). */
  readonly trail: (chain: ChainLinkRoute | null) => string;
  /** A place, as it was left. */
  readonly place: (place: PlaceId) => string;
}

export interface PlaceProps {
  viewer: Viewer;
  shape: Shape;
  links: PlaceLinks;
}
