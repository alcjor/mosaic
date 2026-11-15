/**
 * A link to a neighbourhood (need G-8): the address holds the centre and the choices
 * made in it (G-5), so a colleague lands on exactly the same picture. Beside `node` and
 * `v=explore` (lib/route.ts), it adds each thing unfolded as `x`, in the order unfolded (a thing
 * unfolded again, for more of its links, is named again), and the edge types shown as `e` when
 * not every one is (one empty `e` when none is).
 *
 * Opening such a link applies what the mosaic allows and says what it could not: a thing the
 * mosaic lacks is not unfolded, and an edge type it lacks is not shown (when the link names no
 * edge type it has, every one is). Whether a thing exists is asked of the kit's `get`, once per
 * thing. A link is read with the bound a person meets when making a picture (`MOST_EXPANDED`):
 * a longer link, written by hand, unfolds the first of its list and says so. A link naming every
 * edge type shows every one, as a person's own choice does.
 */
import type { SealedFile } from "@mosaic/kit";
import type { HoodChoices, Route } from "../route.js";
import { byBytes } from "./bytes.js";
import { expand, hoodOf, MOST_EXPANDED, type HoodState } from "./hood.js";

/** The most edge types the mosaic lacks that a link's notes name one by one. */
const NAMED = 20;

/** The route of a neighbourhood with the choices made in it. */
export function hoodRoute(state: HoodState): Route {
  const route: Route = { query: "", node: state.centre, view: "explore" };
  return state.expanded.length === 0 && state.edges === null ? route : { ...route, hood: { expanded: state.expanded, edges: state.edges } };
}

/** The neighbourhood a link names, as far as the mosaic allows, and what it could not apply. */
export async function applyAddress(
  file: Pick<SealedFile, "get" | "edgeTypes">,
  centre: string,
  choices: HoodChoices | null,
): Promise<{ state: HoodState; unapplied: string[] }> {
  const unapplied: string[] = [];
  let state = hoodOf(centre);
  if (choices === null) return { state, unapplied };

  const known = new Map<string, Promise<boolean>>();
  const exists = (id: string) => {
    let found = known.get(id);
    if (found === undefined) {
      found = file.get({ id }).then((a) => !("error" in a));
      known.set(id, found);
    }
    return found;
  };
  const said = new Set<string>();
  for (const id of choices.expanded.slice(0, MOST_EXPANDED)) {
    // A thing named more often than it can be unfolded is unfolded as far as it goes.
    if (await exists(id)) state = expand(state, id);
    else if (!said.has(id)) unapplied.push(`Could not unfold ${id}: the mosaic has no such thing.`);
    said.add(id);
  }
  if (choices.expanded.length > MOST_EXPANDED) unapplied.push(`This link unfolds things ${choices.expanded.length} times; the first ${MOST_EXPANDED} are shown.`);

  if (choices.edges !== null) {
    const names = new Set(file.edgeTypes.map((e) => e.name));
    const asked = [...new Set(choices.edges)];
    const shown = asked.filter((e) => names.has(e));
    const lacking = asked.filter((e) => !names.has(e));
    for (const e of lacking.slice(0, NAMED)) unapplied.push(`Could not show the edge type ${e}: the mosaic has no such edge type.`);
    if (lacking.length > NAMED) unapplied.push(`Could not show ${lacking.length - NAMED} more edge types: the mosaic has none of them.`);
    // A link that names only edge types the mosaic lacks shows every one, not none.
    const none = choices.edges.length === 0;
    // A link that names every edge type shows every one: the state a person's own choice gives.
    const every = names.size > 0 && [...names].every((n) => shown.includes(n));
    state = { ...state, edges: (shown.length === 0 && !none) || every ? null : [...shown].sort(byBytes) };
  }
  return { state, unapplied };
}
