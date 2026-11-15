/**
 * Where the viewer is, kept in the page's address after `#`, so the browser's back button,
 * links and bookmarks work without a server: `#q=<query>&node=<id>`, both optional. A link to
 * a node keeps the search beside it. An empty `node` is no node.
 *
 * A table view adds `t=<node type>`, and optionally `p=<page>`, `o=<column>` with `d=1` for
 * descending order, and `w=<JSON list of {column, op, value}>`: everything `table` is asked
 * (section 8.6), so a table view can be linked to and reloaded.
 *
 * A view of the whole mosaic from the shell's switcher adds `v=<view>` (lib/views.ts); a name
 * that is no view is ignored, as anything else the address does not name.
 *
 * The neighbourhood view (`v=neighbourhood`) adds the choices made in it (G-8): each
 * thing expanded as `x=<id>`, in the order opened; each thing hidden as `h=<id>`; the edge types
 * shown as `e=<name>` when not every one is, one empty `e=` when none is; and the limit as
 * `l=<n>` when it is not the default. They are read as written; lib/graph/hood-address.ts applies
 * them to a mosaic.
 *
 * The chain view (`v=chain`, need V-17) adds the chain shown: its start type as
 * `c=<type>`, each step's link as `k=<link>` spelled as in the view file (an edge type alone is
 * followed out; `<edge> in` is followed in), and the thing each place is pinned to as
 * `p<place>=<id>`, the start being place 0. Then, beside the defaults, the view as `show=table`,
 * the place in the results as `at=<n>` from 1, the table's sort as `co=<place> <column>` with
 * `cd=1` for descending, and its filters as `cf=<JSON list of [place, column, text]>`, places from
 * 1 as the table numbers them. lib/chainlink.ts applies them to a mosaic.
 *
 * Mind the two numberings: a pin's place counts from 0 (`p0` is the start), a sort's or a
 * filter's from 1 (`1` is the start), as the table's group headers show it.
 */
import { viewNamed, type ViewId } from "./views.js";

/** One `where` condition of `table` (section 8.6). */
export interface Condition {
  readonly column: string;
  readonly op: "=" | "!=" | "<" | "<=" | ">" | ">=" | "contains";
  readonly value: string | number | boolean;
}

export const OPERATORS: readonly Condition["op"][] = ["=", "!=", "<", "<=", ">", ">=", "contains"];

/** What a table view asks `table`. */
export interface TableRoute {
  readonly type: string;
  /** From 1. */
  readonly page: number;
  readonly order: { readonly column: string; readonly desc: boolean } | null;
  readonly where: readonly Condition[];
}

/** The choices made in a neighbourhood, as its address writes them. */
export interface HoodChoices {
  /** In the order opened. */
  readonly expanded: readonly string[];
  readonly hidden: readonly string[];
  /** The edge types shown; null when every one is. */
  readonly edges: readonly string[] | null;
  /** The limit as written, or null for the default. */
  readonly limit: string | null;
}

/** The chain the chain view shows, and where in its results, as its address writes it (V-17). */
export interface ChainLinkRoute {
  readonly start: string;
  readonly pin: string | null;
  /** Each step: its link as the view file spells it, and the thing it is pinned to. */
  readonly steps: readonly { readonly link: string; readonly pin: string | null }[];
  readonly show: "cards" | "table";
  /** The place in the results, from 1. */
  readonly at: number;
  /** The table's sort: a column by its place (from 1) and its key. */
  readonly sort: { readonly place: number; readonly column: string; readonly desc: boolean } | null;
  /** The table's filters, each on a column by its place (from 1) and its key. */
  readonly filters: readonly { readonly place: number; readonly column: string; readonly text: string }[];
}

export interface Route {
  /** The search box's query; empty when there is none. */
  readonly query: string;
  /** The id of the node whose page is open, or null. */
  readonly node: string | null;
  /** The table view open, or null. */
  readonly table?: TableRoute | null;
  /** The view of the whole mosaic open from the switcher, or null. */
  readonly view?: ViewId | null;
  /** In the neighbourhood view, the choices made in it, or null for none. */
  readonly hood?: HoodChoices | null;
  /** In the chain view, the chain shown and where in its results, or null for none. */
  readonly chain?: ChainLinkRoute | null;
}

const COUNT = /^[1-9][0-9]{0,8}$/;

function chainFilters(text: string | null): ChainLinkRoute["filters"] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((f: unknown) =>
      Array.isArray(f) && f.length === 3 && Number.isInteger(f[0]) && f[0] >= 1 && typeof f[1] === "string" && typeof f[2] === "string"
        ? [{ place: f[0] as number, column: f[1], text: f[2] }]
        : [],
    );
  } catch {
    return [];
  }
}

function chainLink(params: URLSearchParams): ChainLinkRoute | null {
  const start = params.get("c");
  if (start === null || start === "") return null;
  const pinOf = (place: number) => {
    const pin = params.get(`p${place}`);
    return pin === null || pin === "" ? null : pin;
  };
  const steps = params
    .getAll("k")
    .filter((k) => k !== "")
    .map((link, i) => ({ link, pin: pinOf(i + 1) }));
  const at = params.get("at");
  const order = /^([1-9][0-9]{0,3}) (.+)$/.exec(params.get("co") ?? "");
  return {
    start,
    pin: pinOf(0),
    steps,
    show: params.get("show") === "table" ? "table" : "cards",
    at: at !== null && COUNT.test(at) ? Number(at) : 1,
    sort: order === null ? null : { place: Number(order[1]), column: order[2]!, desc: params.get("cd") === "1" },
    filters: chainFilters(params.get("cf")),
  };
}

function isCondition(value: unknown): value is Condition {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.column === "string" &&
    OPERATORS.includes(c.op as Condition["op"]) &&
    (typeof c.value === "string" || typeof c.value === "number" || typeof c.value === "boolean")
  );
}

function conditions(text: string | null): Condition[] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isCondition) : [];
  } catch {
    return [];
  }
}

/** The route a location hash names; anything it does not name is empty. */
export function parseRoute(hash: string): Route {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const node = params.get("node");
  const type = params.get("t");
  const pageText = params.get("p");
  const page = pageText !== null && /^[1-9][0-9]{0,8}$/.test(pageText) ? Number(pageText) : 1;
  const column = params.get("o");
  const table =
    type === null || type === ""
      ? null
      : {
          type,
          page,
          order: column === null || column === "" ? null : { column, desc: params.get("d") === "1" },
          where: conditions(params.get("w")),
        };
  const named = viewNamed(params.get("v") ?? "");
  let route: Route = { query: params.get("q") ?? "", node: node === null || node === "" ? null : node };
  if (table !== null) route = { ...route, table };
  if (named !== undefined) route = { ...route, view: named.id };
  if (named?.id === "neighbourhood") {
    const edges = params.getAll("e");
    const hood: HoodChoices = {
      expanded: params.getAll("x").filter((x) => x !== ""),
      hidden: params.getAll("h").filter((h) => h !== ""),
      edges: edges.length === 0 ? null : edges.filter((e) => e !== ""),
      limit: params.get("l"),
    };
    if (hood.expanded.length > 0 || hood.hidden.length > 0 || hood.edges !== null || hood.limit !== null) route = { ...route, hood };
  }
  if (named?.id === "chain") {
    const chain = chainLink(params);
    if (chain !== null) route = { ...route, chain };
  }
  return route;
}

/** The location hash of `route`, as {@link parseRoute} reads it. */
export function routeHash(route: Route): string {
  const params = new URLSearchParams();
  if (route.query !== "") params.set("q", route.query);
  if (route.node !== null) params.set("node", route.node);
  if (route.view) params.set("v", route.view);
  const hood = route.view === "neighbourhood" ? route.hood : null;
  if (hood) {
    for (const x of hood.expanded) params.append("x", x);
    for (const h of hood.hidden) params.append("h", h);
    if (hood.edges !== null) {
      if (hood.edges.length === 0) params.append("e", "");
      for (const e of hood.edges) params.append("e", e);
    }
    if (hood.limit !== null) params.set("l", hood.limit);
  }
  const chain = route.view === "chain" ? route.chain : null;
  if (chain) {
    params.set("c", chain.start);
    if (chain.pin !== null) params.set("p0", chain.pin);
    for (const s of chain.steps) params.append("k", s.link);
    chain.steps.forEach((s, i) => s.pin !== null && params.set(`p${i + 1}`, s.pin));
    if (chain.show === "table") params.set("show", "table");
    if (chain.at !== 1) params.set("at", String(chain.at));
    if (chain.sort) {
      params.set("co", `${chain.sort.place} ${chain.sort.column}`);
      if (chain.sort.desc) params.set("cd", "1");
    }
    if (chain.filters.length > 0) params.set("cf", JSON.stringify(chain.filters.map((f) => [f.place, f.column, f.text])));
  }
  const table = route.table;
  if (table) {
    params.set("t", table.type);
    if (table.page !== 1) params.set("p", String(table.page));
    if (table.order) {
      params.set("o", table.order.column);
      if (table.order.desc) params.set("d", "1");
    }
    if (table.where.length > 0) params.set("w", JSON.stringify(table.where));
  }
  const text = params.toString();
  return text === "" ? "#" : `#${text}`;
}
