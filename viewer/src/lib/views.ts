/**
 * The views the shell's switcher offers (brand book, section 6, Shell): the views of
 * the whole mosaic, then a Card / Graph / Table switch for the current thing. A view that
 * is not built yet is listed as not available, with a note saying when it comes, so the page
 * never presents as available what is not built. A change that builds a view sets its
 * `available` here and adds its screen to the shell.
 */

/** A view of the whole mosaic, named in the address as `v=<id>`. */
export type ViewId = "schema" | "neighbourhood" | "path" | "chain" | "overview";

/** How the current thing is shown. */
export type ThingViewId = "card" | "graph" | "table";

export interface ViewEntry<Id extends string> {
  readonly id: Id;
  /** Its name in the switcher. */
  readonly label: string;
  /** Whether its screen is built. */
  readonly available: boolean;
  /** For a view not available: a sentence saying when it comes, wherever it is offered. */
  readonly note: string;
}

const notYet = (label: string): string => `${label} is not available yet: it comes later in this milestone.`;

/** The views of the whole mosaic, in the switcher's order. */
export const VIEWS: readonly ViewEntry<ViewId>[] = [
  { id: "schema", label: "Schema", available: true, note: "" },
  { id: "neighbourhood", label: "Neighbourhood", available: true, note: "" },
  { id: "path", label: "Path", available: false, note: "Path comes with M9: it needs the kit's path." },
  { id: "chain", label: "Chain", available: true, note: "" },
  { id: "overview", label: "Overview", available: true, note: "" },
];

/** The ways to show the current thing, in the switch's order. */
export const THING_VIEWS: readonly ViewEntry<ThingViewId>[] = [
  { id: "card", label: "Card", available: true, note: "" },
  { id: "graph", label: "Graph", available: true, note: "" },
  { id: "table", label: "Table", available: true, note: "" },
];

/** The view `id` names, or undefined when it names none. */
export function viewNamed(id: string): ViewEntry<ViewId> | undefined {
  return VIEWS.find((v) => v.id === id);
}
