/**
 * The four places the shell offers (brand book, section 6, Shell): Home, the map of types and
 * the saved trails; Explore, the graph beside the selected thing's card; Trails, a chain as
 * columns or as one table; Tables, a type's table. The address names the place as `v=<id>`;
 * without one, the page is at Home.
 */

export type PlaceId = "home" | "explore" | "trails" | "tables";

export interface Place {
  readonly id: PlaceId;
  /** Its name in the shell. */
  readonly label: string;
}

/** The places, in the shell's order. */
export const PLACES: readonly Place[] = [
  { id: "home", label: "Home" },
  { id: "explore", label: "Explore" },
  { id: "trails", label: "Trails" },
  { id: "tables", label: "Tables" },
];

/** The place `id` names, or undefined when it names none. */
export function placeNamed(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id);
}
