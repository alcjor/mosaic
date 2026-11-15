/**
 * The view file, as the page applies it (docs/design.md, Implementation plan, "View file").
 * `mosaic view` and `mosaic export` read the YAML file and hand the page its
 * settings as JSON (`mosaic_build.view_file`, `ViewSettings.as_json`); `null` there is a
 * default the page applies. Every setting has a default, so no view file is M2's viewer.
 *
 * {@link Shape} applies the settings to one open mosaic: which node types the page lists, in the
 * order the file writes them; each type's label; its table's columns; what its node page shows,
 * in order; and the labels of its property and edge names. A table's columns are declared
 * properties, as the view file says ("the node's name, then these properties"). A type the
 * file leaves out is absent from the type list and tables only: search and links still reach
 * its nodes, and the kit is never shaped by the view file. A type,
 * property or edge type the mosaic does not have is dropped with a notice, and the page still
 * opens.
 *
 * Descriptions for the graph explorer's map (need G-2) come from the view file too, since the
 * kit as it is gives none (G-12):
 * `types.<Type>.describe` and `edges.<edge>.describe`. Without one, no description is shown.
 * `edges` describes edge types only; it never chooses which appear.
 *
 * The view file's `cards` (V-6, V-7, V-9, V-15, V-18) set, once per type, which facts
 * its card shows: properties (or the node's summary), the things it links to by some links,
 * and how many things it links to by others. A link is an edge type, alone or with `in` or
 * `out`; alone, it means each direction the edge type has at that type, out first. A card names
 * nothing the mosaic lacks once {@link Shape} has dropped it with a notice; a type with no card
 * reads as none set, and the page gives it its default.
 */
import type { EdgeType, NodeType, SealedFile } from "@mosaic/kit";

export type SearchMode = "semantic" | "text";
export type Theme = "auto" | "light" | "dark";

export const SEARCH_MODES: readonly SearchMode[] = ["semantic", "text"];
export const THEMES: readonly Theme[] = ["auto", "light", "dark"];

/** How each search mode is named on the search field's switch (brand book, section 6). */
export const MODE_NAMES: Readonly<Record<SearchMode, string>> = { semantic: "Semantic", text: "Text" };

/** One node type's settings; `null` is the default. */
export interface TypeSettings {
  readonly name: string;
  readonly label: string | null;
  readonly columns: readonly string[] | null;
  readonly page: readonly string[] | null;
  readonly names: ReadonlyMap<string, string>;
  /** Its description on the map (G-2), or null for none. */
  readonly describe: string | null;
}

/** One edge type's settings; `null` is the default. */
export interface EdgeSettings {
  readonly name: string;
  /** Its description on the map (G-2), or null for none. */
  readonly describe: string | null;
}

/** One type's card, as the view file sets it; empty parts show nothing. */
export interface CardSettings {
  readonly name: string;
  readonly show: readonly string[];
  readonly links: readonly string[];
  readonly counts: readonly string[];
}

/** One step of a chain saved in the view file: its link (an edge type and a direction) and pin. */
export interface ChainStepSettings {
  readonly link: string;
  readonly pin: string | null;
}

/**
 * A chain saved in the view file (V-15, V-16), by its label: a start type, the one
 * thing it starts from or null, and its steps, in order. A step's type is the other end of its
 * link's edge type, found on the open mosaic (lib/viewchains.ts).
 */
export interface ChainSettings {
  readonly name: string;
  readonly start: string;
  readonly pin: string | null;
  readonly steps: readonly ChainStepSettings[];
}

/** One link of a card: an edge type in one direction from the card's type. */
export interface CardLink {
  readonly edge: string;
  readonly direction: "out" | "in";
}

/** A type's card on the open mosaic: only what the mosaic has. */
export interface Card {
  readonly show: readonly string[];
  readonly links: readonly CardLink[];
  readonly counts: readonly CardLink[];
}

export interface ViewSettings {
  readonly search: SearchMode;
  readonly theme: Theme;
  /** The node types listed, in order; null lists every node type, by name. */
  readonly types: readonly TypeSettings[] | null;
  /** Edge types described, in the order written; null describes none. */
  readonly edges: readonly EdgeSettings[] | null;
  /** Which types an export carries; null is its default. */
  readonly exportTypes: readonly string[] | null;
  /** Each type's card, in the order written; null sets none. */
  readonly cards: readonly CardSettings[] | null;
  /** The chains saved in the view file, in the order written; null saves none. */
  readonly chains: readonly ChainSettings[] | null;
}

/** M2's viewer. */
export const DEFAULT_VIEW: ViewSettings = { search: "semantic", theme: "auto", types: null, edges: null, exportTypes: null, cards: null, chains: null };

/**
 * A link, in a card or a chain step: an edge type name, alone or with one direction (edge type
 * names hold no spaces).
 * The name is anything but ASCII white space, as in `view_file.py` and the schema, so the reader,
 * the schema and the page accept the same links.
 */
export const LINK = /^([^ \t\n\v\f\r]+)(?: (in|out))?$/;


/** The query parameter that names the view file's settings, as JSON, for the page to fetch. */
export const VIEW_PARAM = "view";

function fail(where: string, what: string): never {
  throw new Error(`view file: ${where} must be ${what}`);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(where, "an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") fail(where, "non-empty text");
  return value;
}

function texts(value: unknown, where: string): readonly string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) fail(where, "a list of names or null");
  const seen = new Set<string>();
  return value.map((v, i) => {
    const name = text(v, `${where}[${i}]`);
    if (seen.has(name)) fail(`${where}[${i}]`, `a name not listed before, not ${name} again`);
    seen.add(name);
    return name;
  });
}

/** Optional non-empty text: null when absent or null. */
function maybeText(value: unknown, where: string): string | null {
  return value === null || value === undefined ? null : text(value, where);
}

function oneOf<T extends string>(value: unknown, where: string, values: readonly T[]): T {
  if (!values.includes(value as T)) fail(where, `one of ${values.join(", ")}`);
  return value as T;
}

/** The view file's settings from their JSON form (`ViewSettings.as_json`); throws when malformed. */
export function parseView(data: unknown): ViewSettings {
  const given = record(data, "the settings");
  const seen = new Set<string>();
  const once = (name: string, where: string): string => {
    if (seen.has(name)) fail(where, `a type not listed before, not ${name} again`);
    seen.add(name);
    return name;
  };
  const seenEdges = new Set<string>();
  const onceEdge = (name: string, where: string): string => {
    if (seenEdges.has(name)) fail(where, `an edge type not listed before, not ${name} again`);
    seenEdges.add(name);
    return name;
  };
  const types =
    given.types === null || given.types === undefined
      ? null
      : (Array.isArray(given.types) ? given.types : fail("types", "a list or null")).map((t, i): TypeSettings => {
          const where = `types[${i}]`;
          const entry = record(t, where);
          const names = record(entry.names ?? {}, `${where}.names`);
          return {
            name: once(text(entry.name, `${where}.name`), `${where}.name`),
            label: entry.label === null || entry.label === undefined ? null : text(entry.label, `${where}.label`),
            columns: texts(entry.columns ?? null, `${where}.columns`),
            page: texts(entry.page ?? null, `${where}.page`),
            names: new Map(Object.keys(names).map((k) => [k, text(names[k], `${where}.names.${k}`)])),
            describe: maybeText(entry.describe, `${where}.describe`),
          };
        });
  const edges =
    given.edges === null || given.edges === undefined
      ? null
      : (Array.isArray(given.edges) ? given.edges : fail("edges", "a list or null")).map((e, i): EdgeSettings => {
          const where = `edges[${i}]`;
          const entry = record(e, where);
          return {
            name: onceEdge(text(entry.name, `${where}.name`), `${where}.name`),
            describe: maybeText(entry.describe, `${where}.describe`),
          };
        });
  const cardNames = new Set<string>();
  const cards =
    given.cards === null || given.cards === undefined
      ? null
      : (Array.isArray(given.cards) ? given.cards : fail("cards", "a list or null")).map((c, i): CardSettings => {
          const where = `cards[${i}]`;
          const entry = record(c, where);
          const name = text(entry.name, `${where}.name`);
          if (cardNames.has(name)) fail(`${where}.name`, `a type not given a card before, not ${name} again`);
          cardNames.add(name);
          const links = (key: string): readonly string[] =>
            (texts(entry[key] ?? [], `${where}.${key}`) ?? []).map((link, j) =>
              LINK.test(link) ? link : fail(`${where}.${key}[${j}]`, `an edge type name, alone or with in or out, not ${link}`),
            );
          return { name, show: texts(entry.show ?? [], `${where}.show`) ?? [], links: links("links"), counts: links("counts") };
        });
  const chainNames = new Set<string>();
  const pinOf = (value: unknown, where: string): string | null => (value === null || value === undefined ? null : text(value, where));
  const chains =
    given.chains === null || given.chains === undefined
      ? null
      : (Array.isArray(given.chains) ? given.chains : fail("chains", "a list or null")).map((c, i): ChainSettings => {
          const where = `chains[${i}]`;
          const entry = record(c, where);
          const name = text(entry.name, `${where}.name`);
          if (chainNames.has(name)) fail(`${where}.name`, `a chain label not given before, not ${name} again`);
          chainNames.add(name);
          const steps = (Array.isArray(entry.steps ?? []) ? ((entry.steps ?? []) as unknown[]) : fail(`${where}.steps`, "a list")).map((s, j) => {
            const at = `${where}.steps[${j}]`;
            const one = record(s, at);
            const link = text(one.link, `${at}.link`);
            if (!LINK.test(link)) fail(`${at}.link`, `an edge type name, alone or with in or out, not ${link}`);
            return { link, pin: pinOf(one.pin, `${at}.pin`) };
          });
          return { name, start: text(entry.start, `${where}.start`), pin: pinOf(entry.pin, `${where}.pin`), steps };
        });
  const exported = record(given.export ?? {}, "export");
  return {
    search: oneOf(given.search ?? "semantic", "search", SEARCH_MODES),
    theme: oneOf(given.theme ?? "auto", "theme", THEMES),
    types,
    edges,
    exportTypes: texts(exported.types ?? null, "export.types"),
    cards,
    chains,
  };
}

/** The address of the view file's settings that `?view=<url>` names, or null. */
function namedView(search: string, base: string): URL | null {
  const named = new URLSearchParams(search).get(VIEW_PARAM);
  return named === null || named === "" ? null : new URL(named, base);
}

/** The settings' JSON text at `url`; an answer `{"error": ...}` (`mosaic view`) throws that error. */
async function settingsText(url: URL, fetcher: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, { cache: "no-store" });
  } catch (e) {
    throw new Error(`could not fetch the view file's settings: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = await response.text();
  if (!response.ok) {
    let error: unknown;
    try {
      error = (JSON.parse(body) as { error?: unknown }).error;
    } catch {
      error = undefined;
    }
    if (typeof error === "string" && error !== "") throw new Error(error);
    throw new Error(`could not fetch the view file's settings: ${response.status} ${response.statusText}`.trim());
  }
  return body;
}

function parsedText(text: string): ViewSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("view file: the settings are not JSON");
  }
  return parseView(data);
}

/** The view file's settings the address's `?view=<url>` names, fetched as JSON, or null. */
export async function fetchNamedView(search: string, base: string, fetcher: typeof fetch = fetch): Promise<ViewSettings | null> {
  const url = namedView(search, base);
  return url === null ? null : parsedText(await settingsText(url, fetcher));
}

/** How often the page asks `mosaic view` for the view file's settings again, in milliseconds. */
export const WATCH_MS = 1000;

/**
 * Ask for the settings `?view=<url>` names every `everyMs`, and call `changed` with the new
 * settings each time their text changes, or `failed` with the error while they cannot be read
 * (a file saved with an error); `failed(null)` once they can be read again. Returns a function
 * that stops watching. Without `?view=`, nothing is watched.
 */
export function watchView(
  search: string,
  base: string,
  changed: (view: ViewSettings) => void,
  failed: (error: string | null) => void,
  { fetcher = fetch, everyMs = WATCH_MS, initial = null }: { fetcher?: typeof fetch; everyMs?: number; initial?: string | null } = {},
): () => void {
  const url = namedView(search, base);
  if (url === null) return () => {};
  let last = initial;
  let failing = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async (): Promise<void> => {
    try {
      const text = await settingsText(url, fetcher);
      const view = parsedText(text);
      if (stopped) return;
      if (failing) {
        failing = false;
        failed(null);
      }
      if (text !== last) {
        last = text;
        changed(view);
      }
    } catch (e) {
      if (stopped) return;
      failing = true;
      failed(e instanceof Error ? e.message : String(e));
    }
    if (!stopped) timer = setTimeout(() => void tick(), everyMs);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** What {@link Shape} needs of an open mosaic. */
export type Schema = Pick<SealedFile, "nodeTypes" | "edgeTypes" | "propsOf">;

/** The most columns a table shows after the node's name (section 8.6: 20 columns in all). */
const MORE_COLUMNS = 19;

/** The view file's settings applied to one open mosaic. */
export class Shape {
  /** The node types the page lists, in the view file's order. */
  readonly types: readonly NodeType[];
  /** What the view file names that the mosaic does not have; each was left out. */
  readonly notices: readonly string[];
  readonly #settings = new Map<string, TypeSettings>();
  readonly #columns = new Map<string, readonly string[]>();
  readonly #page = new Map<string, readonly string[]>();
  readonly #names = new Map<string, ReadonlyMap<string, string>>();
  readonly #cards = new Map<string, Card>();
  readonly #edgeFrom: ReadonlyMap<string, string | null>;
  readonly #edgeDescriptions = new Map<string, string>();

  constructor(view: ViewSettings, schema: Schema) {
    const notices: string[] = [];
    this.#edgeFrom = new Map(schema.edgeTypes.map((e) => [e.name, e.from]));
    const known = new Map(schema.nodeTypes.map((t) => [t.name, t]));
    const listed: NodeType[] = [];
    for (const settings of view.types ?? schema.nodeTypes.map((t) => typeSettings(t.name))) {
      const type = known.get(settings.name);
      if (type === undefined) {
        notices.push(`view file: types.${settings.name}: the mosaic has no node type ${settings.name}`);
        continue;
      }
      listed.push(type);
      this.#settings.set(type.name, settings);
      const props = schema.propsOf(type.name);
      const touching = edgesOf(schema.edgeTypes, type.name);
      const keep = (names: readonly string[], allowed: (n: string) => boolean, where: string, what: string) =>
        names.filter((n) => {
          if (allowed(n)) return true;
          notices.push(`view file: types.${type.name}.${where}: ${type.name} has no ${what} ${n}`);
          return false;
        });
      if (settings.columns !== null) {
        const columns = keep(settings.columns, (n) => props.includes(n), "columns", "property");
        if (columns.length > MORE_COLUMNS) {
          notices.push(
            `view file: types.${type.name}.columns: a table shows at most ${MORE_COLUMNS} columns after the name; left out: ${columns.slice(MORE_COLUMNS).join(", ")}`,
          );
        }
        this.#columns.set(type.name, columns.slice(0, MORE_COLUMNS));
      }
      if (settings.page !== null) {
        this.#page.set(type.name, keep(settings.page, (n) => props.includes(n) || touching.has(n), "page", "property or edge type"));
      }
      const named = keep([...settings.names.keys()], (n) => props.includes(n) || touching.has(n), "names", "property or edge type");
      this.#names.set(type.name, new Map(named.map((n) => [n, settings.names.get(n)!])));
    }
    for (const edge of view.edges ?? []) {
      if (!this.#edgeFrom.has(edge.name)) {
        notices.push(`view file: edges.${edge.name}: the mosaic has no edge type ${edge.name}`);
      } else if (edge.describe !== null) {
        this.#edgeDescriptions.set(edge.name, edge.describe);
      }
    }
    for (const card of view.cards ?? []) {
      if (!known.has(card.name)) {
        notices.push(`view file: cards.${card.name}: the mosaic has no node type ${card.name}`);
        continue;
      }
      const props = schema.propsOf(card.name);
      const show = card.show.filter((n) => {
        if (n === "summary" || props.includes(n)) return true;
        notices.push(`view file: cards.${card.name}.show: ${card.name} has no property ${n}`);
        return false;
      });
      const resolve = (items: readonly string[], key: string): CardLink[] =>
        items.flatMap((item) => {
          const [, edge, way] = LINK.exec(item)!;
          const type = schema.edgeTypes.find((e) => e.name === edge);
          const ways: ("out" | "in")[] = [];
          if (type && (type.from === null || type.from === card.name) && way !== "in") ways.push("out");
          if (type && (type.to === null || type.to === card.name) && way !== "out") ways.push("in");
          if (ways.length === 0) notices.push(`view file: cards.${card.name}.${key}: ${card.name} has no edge type ${item}`);
          return ways.map((direction) => ({ edge: edge!, direction }));
        });
      this.#cards.set(card.name, { show, links: resolve(card.links, "links"), counts: resolve(card.counts, "counts") });
    }
    this.types = listed;
    this.notices = notices;
  }

  /** `type`'s card as the view file sets it, keeping only what the mosaic has; null when none is set. */
  card(type: string): Card | null {
    return this.#cards.get(type) ?? null;
  }

  /** True when the page lists `type` and shows its table. */
  lists(type: string): boolean {
    return this.#settings.has(type);
  }

  /** What the page calls node type `type`. */
  typeLabel(type: string): string {
    return this.#settings.get(type)?.label ?? type;
  }

  /** The label the view file gives `name`, a property or edge type, on `type`'s pages, or null. */
  label(type: string, name: string): string | null {
    return this.#names.get(type)?.get(name) ?? null;
  }

  /**
   * The label the view file gives edge type `edge` on `type`'s node pages: `type`'s own, else
   * that of the type the edge leaves, so an incoming edge keeps its source type's label; or null.
   */
  edgeLabel(type: string, edge: string): string | null {
    const from = this.#edgeFrom.get(edge);
    return this.label(type, edge) ?? (from ? this.label(from, edge) : null);
  }

  /** The description the view file gives node type `type` (G-2), or null for none. */
  typeDescription(type: string): string | null {
    return this.#settings.get(type)?.describe ?? null;
  }

  /** The description the view file gives edge type `edge` (G-2), or null for none. */
  edgeDescription(edge: string): string | null {
    return this.#edgeDescriptions.get(edge) ?? null;
  }

  /** The columns `type`'s table shows after the node's name, or null for `table`'s default. */
  columns(type: string): readonly string[] | null {
    return this.#columns.get(type) ?? null;
  }

  /** The properties and edge types `type`'s node page shows, in order, or null for all of them. */
  page(type: string): readonly string[] | null {
    return this.#page.get(type) ?? null;
  }
}

function typeSettings(name: string): TypeSettings {
  return { name, label: null, columns: null, page: null, names: new Map(), describe: null };
}

/** The edge types that leave or enter `type`. */
function edgesOf(edges: readonly EdgeType[], type: string): Set<string> {
  return new Set(edges.filter((e) => e.from === null || e.from === type || e.to === null || e.to === type).map((e) => e.name));
}

/** Set the page's theme: `auto` follows the system, `light` and `dark` fix it (tokens.css). */
export function applyTheme(root: { dataset: Record<string, string | undefined> }, theme: Theme): void {
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/** Items of `items` that `page` names, by `nameOf`, in `page`'s order; all of them when `page` is null. */
export function inPageOrder<T>(items: readonly T[], page: readonly string[] | null, nameOf: (item: T) => string): T[] {
  if (page === null) return [...items];
  const rank = new Map(page.map((n, i) => [n, i]));
  return items
    .map((item, i) => ({ item, i, r: rank.get(nameOf(item)) }))
    .filter((x): x is { item: T; i: number; r: number } => x.r !== undefined)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}
