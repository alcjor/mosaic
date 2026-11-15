/**
 * A link to a neighbourhood (need G-8): the address holds the centre and the choices
 * made in it (G-5), so a colleague lands on exactly the same picture. Beside `node` and
 * `v=neighbourhood` (lib/route.ts), it adds each thing expanded as `x`, in the order opened; each
 * thing hidden as `h`; the edge types shown as `e` when not every one is (one empty `e` when none
 * is); and the limit as `l` when it is not the default.
 *
 * Opening such a link applies what the mosaic allows and says what it could not: a thing the
 * mosaic lacks is neither expanded nor hidden, an edge type it lacks is not shown (when the link
 * names no edge type it has, every one is), and a limit that is not 3, 5, 10 or 20 is the default.
 * Whether a thing exists is asked of the kit's `get`, once per thing. A link is read with the bound
 * a person meets when making a picture (`MOST_EXPANDED`, `MOST_HIDDEN`): a longer
 * link, written by hand, opens the first of each list in its order and says so. A link naming every
 * edge type shows every one, as a person's own choice does.
 */
import type { SealedFile } from "@mosaic/kit";
import type { HoodChoices, Route } from "../route.js";
import { byBytes } from "./bytes.js";
import { DEFAULT_LIMIT, expand, hide, hoodOf, LIMITS, MOST_EXPANDED, MOST_HIDDEN, type HoodState, type Limit } from "./hood.js";

/** The most edge types the mosaic lacks that a link's notes name one by one. */
const NAMED = 20;

/** The route of a neighbourhood with the choices made in it. */
export function hoodRoute(state: HoodState): Route {
  const plain = state.expanded.length === 0 && state.hidden.length === 0 && state.edges === null && state.limit === DEFAULT_LIMIT;
  const route: Route = { query: "", node: state.centre, view: "explore" };
  return plain
    ? route
    : {
        ...route,
        hood: { expanded: state.expanded, hidden: state.hidden, edges: state.edges, limit: state.limit === DEFAULT_LIMIT ? null : String(state.limit) },
      };
}

/** The neighbourhood a link names, as far as the mosaic allows, and what it could not apply. */
export async function applyAddress(
  file: Pick<SealedFile, "get" | "edgeTypes">,
  centre: string,
  choices: HoodChoices | null,
): Promise<{ state: HoodState; unapplied: string[] }> {
  const unapplied: string[] = [];
  if (choices === null) return { state: hoodOf(centre), unapplied };
  let limit: Limit = DEFAULT_LIMIT;
  if (choices.limit !== null) {
    const n = /^[0-9]+$/.test(choices.limit) ? Number(choices.limit) : NaN;
    if ((LIMITS as readonly number[]).includes(n)) limit = n as Limit;
    else unapplied.push(`Could not show ${JSON.stringify(choices.limit)} per group: a group shows ${LIMITS.slice(0, -1).join(", ")} or ${LIMITS.at(-1)}; it shows ${DEFAULT_LIMIT}.`);
  }
  let state = hoodOf(centre, limit);

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
  const cannot = (what: string, id: string) => {
    const text = `Could not ${what} ${id}: the mosaic has no such thing.`;
    if (!said.has(text)) unapplied.push(text);
    said.add(text);
  };
  // Each thing once, at its first place: the 50 are things, not repeats of one.
  const expanded = [...new Set(choices.expanded)];
  const hidden = [...new Set(choices.hidden)];
  for (const id of expanded.slice(0, MOST_EXPANDED)) {
    if (id === centre) continue;
    if (await exists(id)) state = expand(state, id);
    else cannot("expand", id);
  }
  if (expanded.length > MOST_EXPANDED) unapplied.push(`This link names ${expanded.length} expanded things; the first ${MOST_EXPANDED} are shown.`);
  for (const id of hidden.slice(0, MOST_HIDDEN)) {
    if (id === centre) continue;
    if (await exists(id)) state = hide(state, id);
    else cannot("hide", id);
  }
  if (hidden.length > MOST_HIDDEN) unapplied.push(`This link names ${hidden.length} hidden things; the first ${MOST_HIDDEN} are hidden.`);

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
