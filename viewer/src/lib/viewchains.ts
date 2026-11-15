/**
 * Chains saved in the view file (docs/design.md V-15, V-16, V-18), on the open mosaic
 * and back to view-file text.
 *
 * The view file saves each chain by its label: a start type, the one thing it starts from (or
 * none), and its steps, each a link and the one thing it reaches (or none). A link is spelled as
 * in `cards`: an edge type, alone or with `in` or `out`; alone, the step follows it out. A step's type
 * is the other end of its edge type, so it is found here, on the open mosaic. A chain that names a type, an edge type or a link the mosaic lacks, a link that does
 * not follow from the type before it, or a pin of another type is reported by name, with its
 * first fault, and left out (applying the rest of it would give other results than the ones
 * saved); so is one that pins a thing the mosaic lacks, once the kit has said so. The notices
 * come in the order the view file writes the chains. The rest of the view file still applies.
 *
 * The page cannot write the view file, so a chain built in the page is given as the view file's
 * `chains` text to copy into it: the file's chains as written, in their order, with the one built
 * under its label, in place of one of the same label or after them.
 */
import { IMPLICIT_KEY, scalar } from "./cardpick.js";
import { checkChain, type Chain, type ChainSchema, type Step } from "./chain.js";
import { LINK, type ChainSettings } from "./view.js";

/** A chain the view file saves, by its label, as the open mosaic reads it. */
export interface SavedChain {
  readonly name: string;
  readonly chain: Chain;
}

/** The view file's chains the open mosaic can apply, in order, and why each other one cannot. */
export function resolveChains(settings: readonly ChainSettings[] | null, schema: ChainSchema): { chains: SavedChain[]; notices: string[] } {
  const chains: SavedChain[] = [];
  const notices: string[] = [];
  for (const saved of settings ?? []) {
    const chain = resolve(saved, schema);
    if (typeof chain === "string") notices.push(`view file: chains.${saved.name}: ${chain}`);
    else chains.push({ name: saved.name, chain });
  }
  return { chains, notices };
}

/**
 * `saved` as a chain on the mosaic `schema` describes, or its first fault in the chain's order
 * (the start, then each step: its link, then its pin).
 */
function resolve(saved: ChainSettings, schema: ChainSchema): Chain | string {
  if (!schema.nodeTypes.some((t) => t.name === saved.start)) return `the mosaic has no node type ${saved.start}`;
  const steps: Step[] = [];
  // The first fault of the places before step `i`, which come before any fault of step `i`.
  const before = (): string | undefined => checkChain(schema, { start: saved.start, pin: saved.pin, steps }).problems[0];
  for (const [i, s] of saved.steps.entries()) {
    const [, edge, way] = LINK.exec(s.link) ?? [];
    const type = schema.edgeTypes.find((e) => e.name === edge);
    if (type === undefined || edge === undefined) return before() ?? `step ${i + 1}: the mosaic has no edge type ${edge ?? s.link}`;
    // Alone, a step's link is followed out; `in` must be written.
    const direction = way === "in" ? "in" : "out";
    const reaches = direction === "out" ? type.to : type.from;
    if (reaches === null) return before() ?? `step ${i + 1}: ${s.link} leads to no one node type`;
    steps.push({ edge, direction, type: reaches, pin: s.pin });
  }
  return before() ?? { start: saved.start, pin: saved.pin, steps };
}

/** The ids `chain` pins, in place order: the start's, then each step's. */
export function pinsOf(chain: Chain): string[] {
  return [chain.pin, ...chain.steps.map((s) => s.pin)].filter((p): p is string => p !== null);
}

/**
 * The saved chains whose pinned things the mosaic has (`has`), in order, and a notice naming
 * each thing it lacks. A thing the kit cannot look up is not a thing it lacks: that chain stays.
 */
export async function withThings(chains: readonly SavedChain[], has: (id: string) => Promise<boolean>): Promise<{ chains: SavedChain[]; notices: string[] }> {
  const kept: SavedChain[] = [];
  const notices: string[] = [];
  for (const saved of chains) {
    const lacking = await lackedPins(saved.chain, has);
    if (lacking.length === 0) kept.push(saved);
    else notices.push(...lacking.map((id) => `view file: chains.${saved.name}: the mosaic has no thing ${id}`));
  }
  return { chains: kept, notices };
}

/** The ids `chain` pins that the mosaic lacks (`has`), in place order. */
async function lackedPins(chain: Chain, has: (id: string) => Promise<boolean>): Promise<string[]> {
  const lacking: string[] = [];
  for (const id of pinsOf(chain)) {
    if (!(await has(id).catch(() => true))) lacking.push(id);
  }
  return lacking;
}

/**
 * One chain written as the view file writes it (`saved`), on the open mosaic: the chain, or
 * null with its first fault, or with each pinned thing the mosaic lacks (a link to a chain,
 * V-17, reads its chain this way and reports the same faults).
 */
export async function checkOne(saved: ChainSettings, schema: ChainSchema, has: (id: string) => Promise<boolean>): Promise<{ chain: Chain | null; faults: string[] }> {
  const chain = resolve(saved, schema);
  if (typeof chain === "string") return { chain: null, faults: [chain] };
  const lacking = await lackedPins(chain, has);
  return lacking.length === 0 ? { chain, faults: [] } : { chain: null, faults: lacking.map((id) => `the mosaic has no thing ${id}`) };
}

/**
 * The view file's chains the open mosaic can apply, in order, and one notice for each other
 * one, in the order the view file writes them: its first fault, or each pinned thing the
 * mosaic lacks (`has`, through the kit).
 */
export async function checkChains(
  settings: readonly ChainSettings[] | null,
  schema: ChainSchema,
  has: (id: string) => Promise<boolean>,
): Promise<{ chains: SavedChain[]; notices: string[] }> {
  const chains: SavedChain[] = [];
  const notices: string[] = [];
  for (const saved of settings ?? []) {
    const one = resolveChains([saved], schema);
    const checked = await withThings(one.chains, has);
    chains.push(...checked.chains);
    notices.push(...one.notices, ...checked.notices);
  }
  return { chains, notices };
}

/** `chain` as the view file saves it, under `name`: a link followed out is written alone. */
export function chainSettings(name: string, chain: Chain): ChainSettings {
  return { name, start: chain.start, pin: chain.pin, steps: chain.steps.map((s) => ({ link: s.direction === "out" ? s.edge : `${s.edge} in`, pin: s.pin })) };
}

/** A label for `chain` before the person gives one: its types in order, as the page names them. */
export function chainName(chain: Chain, typeLabel: (type: string) => string): string {
  return [chain.start, ...chain.steps.map((s) => s.type)].map(typeLabel).join(" → ");
}

/**
 * The view file's `chains` section: `saved`, in order, with `add` in place of the one of its
 * label, or after them; null adds none.
 */
export function chainsText(saved: readonly ChainSettings[], add: ChainSettings | null): string {
  const all = add === null ? [...saved] : saved.some((c) => c.name === add.name) ? saved.map((c) => (c.name === add.name ? add : c)) : [...saved, add];
  if (all.length === 0) return "chains: {}\n";
  const lines = ["chains:"];
  for (const chain of all) {
    const key = scalar(chain.name);
    // A longer key takes YAML's explicit form: `? key`, then `:` and its value.
    if ([...key].length < IMPLICIT_KEY) lines.push(`  ${key}:`);
    else lines.push(`  ? ${key}`, "  :");
    lines.push(`    start: ${scalar(chain.start)}`);
    if (chain.pin !== null) lines.push(`    pin: ${scalar(chain.pin)}`);
    if (chain.steps.length > 0) lines.push("    steps:");
    for (const s of chain.steps) {
      if (s.pin === null) lines.push(`      - ${scalar(s.link)}`);
      else lines.push(`      - link: ${scalar(s.link)}`, `        pin: ${scalar(s.pin)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
