/**
 * Choosing what a type's card shows (docs/design.md, "Viewer: chains and cards").
 *
 * - V-6: a card can show the node's summary and the type's properties, the things it links to by
 *   a link, and how many things it links to by a link. {@link pickOptions} lists them as the view
 *   file writes them: a property by its name; a link as its edge type, with `in` for an
 *   edge reaching the type, and with `out` or `in` where an edge type joins the type to itself.
 * - V-7: a choice is the type's card, set once per type ({@link chooseCard}): every card of the
 *   type shows it.
 * - V-15: the page cannot write the view file, so a choice is given as the view file's `cards`
 *   text ({@link cardsText}) to copy into it; read back, it gives the same cards.
 *
 * A choice starts from the type's card in the view file, or, with none set, from the default card
 * written out (V-9): the summary, the properties and a count per link, as the view file's
 * `page` selects and orders them. A fact picked comes last; one unpicked goes; the others keep
 * their order.
 */
import { offers, type ChainSchema } from "./chain.js";
import { inPageOrder, Shape, type CardSettings, type Schema, type ViewSettings } from "./view.js";

/** The parts of a card: what it shows, the links it lists things by, the links it counts. */
export type Part = "show" | "links" | "counts";

/** What a type's card can show: `show` names, and links (for `links` and `counts` alike). */
export interface PickOptions {
  readonly show: readonly string[];
  readonly links: readonly string[];
}

/** What the type's card can show, as the view file writes it; nothing for a type the mosaic lacks. */
export function pickOptions(schema: ChainSchema & Pick<Schema, "propsOf">, type: string): PickOptions {
  if (!schema.nodeTypes.some((t) => t.name === type)) return { show: [], links: [] };
  const ways = offers(schema, type);
  const both = (edge: string) => ways.filter((o) => o.edge === edge).length > 1;
  const links = ways.map((o) => (o.direction === "in" ? `${o.edge} in` : both(o.edge) ? `${o.edge} out` : o.edge));
  // `summary` names the node's summary in the view file, so a property of that name is
  // that one choice, offered once.
  return { show: ["summary", ...schema.propsOf(type).filter((p) => p !== "summary")], links };
}

/** The edge type a link names. */
const edgeOf = (link: string) => link.split(" ")[0]!;

/** The card a choice for `type` starts from: the view file's, else the default written out. */
export function startingCard(view: ViewSettings, schema: Schema, type: string): CardSettings {
  const set = view.cards?.find((c) => c.name === type);
  if (set !== undefined) return { ...set, links: spelled(schema, type, set.links), counts: spelled(schema, type, set.counts) };
  const page = new Shape(view, schema).page(type);
  const options = pickOptions(schema, type);
  return {
    name: type,
    show: ["summary", ...inPageOrder(schema.propsOf(type), page, (p) => p).filter((p) => p !== "summary")],
    links: [],
    counts: inPageOrder(options.links, page, edgeOf),
  };
}

/**
 * `links` as the picker spells them, each once: a link as the view file means it on `type`
 * (an edge type alone is each direction it has there, out first; with `in` or `out`, that one) is
 * the picker's option for each direction it names. A name the mosaic lacks is kept as written.
 */
function spelled(schema: ChainSchema & Pick<Schema, "propsOf">, type: string, links: readonly string[]): string[] {
  const ways = offers(schema, type);
  const options = pickOptions(schema, type).links;
  const out: string[] = [];
  for (const link of links) {
    const [edge, direction] = link.split(" ");
    const named = ways.flatMap((o, i) => (o.edge === edge && (direction === undefined || o.direction === direction) ? [options[i]!] : []));
    for (const n of named.length > 0 ? named : [link]) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** `card` with `name` picked in (`on`) or out of `part`; the card itself is never changed. */
export function toggle(card: CardSettings, part: Part, name: string, on: boolean): CardSettings {
  const has = card[part].includes(name);
  if (has === on) return card;
  return { ...card, [part]: on ? [...card[part], name] : card[part].filter((n) => n !== name) };
}

/** `view` with `card` as its type's card, in that card's place, or last; nothing else changes. */
export function chooseCard(view: ViewSettings, card: CardSettings): ViewSettings {
  const cards = view.cards ?? [];
  const at = cards.findIndex((c) => c.name === card.name);
  return { ...view, cards: at < 0 ? [...cards, card] : cards.map((c, i) => (i === at ? card : c)) };
}

/**
 * A name as YAML 1.2 (the view file's core schema) reads it back as that text: plain when it can
 * be, else double-quoted, with every character YAML cannot hold raw, or would read as a line
 * break, escaped (C0 and C1 controls, DEL, U+2028, U+2029, the byte order mark).
 */
export function scalar(name: string): string {
  const plain = /^[A-Za-z_][A-Za-z0-9_]*( (in|out))?$/.test(name) && !/^(true|false|null)$/i.test(name);
  if (plain) return name;
  // JSON's escapes are YAML's for quotes, backslash and C0 controls; the rest are escaped here.
  return JSON.stringify(name).replace(/[\u007f-\u009f\u2028\u2029\ufeff]/g, (c) => `\\u${c.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}

/** Longest key YAML reads in the short form (`key:`): 1024 characters, its implicit key limit. */
export const IMPLICIT_KEY = 1024;

/** The view file's `cards` section for `cards`, in their order, to copy into the view file. */
export function cardsText(cards: readonly CardSettings[]): string {
  if (cards.length === 0) return "cards: {}\n";
  const lines = ["cards:"];
  for (const card of cards) {
    const parts = (["show", "links", "counts"] as const).filter((p) => card[p].length > 0);
    const key = scalar(card.name);
    // A longer key takes YAML's explicit form: `? key`, then `:` and its value.
    if ([...key].length < IMPLICIT_KEY) lines.push(`  ${key}:${parts.length === 0 ? " {}" : ""}`);
    else lines.push(`  ? ${key}`, `  :${parts.length === 0 ? " {}" : ""}`);
    for (const p of parts) lines.push(`    ${p}: [${card[p].map(scalar).join(", ")}]`);
  }
  return `${lines.join("\n")}\n`;
}
