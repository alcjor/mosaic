/**
 * Chains (docs/design.md, "Viewer: chains and cards"): a fixed walk across the links,
 * from a start type along one kind of link, then another.
 *
 * - V-1: a chain is a start type and an ordered list of steps; each step follows one edge type
 *   in one direction to the next type.
 * - V-2: the start and any step may be pinned to one thing (a node id of that type), or left
 *   open to any thing of that type.
 * - V-3: the steps offered after a type ({@link offers}) are exactly the edge types the mosaic
 *   declares from it (out) or to it (in), so a chain built from offers can always be followed;
 *   {@link checkChain} reports any other step and keeps only the part before it.
 * - V-5: {@link extend}, {@link shorten}, {@link change}, {@link pin} and {@link restart} return a
 *   new chain that keeps every step before the change and its pin, and drops what no longer
 *   follows. They never change the chain they are given.
 *
 * Every edge type declares both its ends (Specification 0.1, section 3; `format.sql`: an edge
 * type has a `from_type` and a `to_type`), so each step leads to one type. The kit reports an
 * end it cannot name as a node type (`SealedFile.edgeTypes`) as null, and lists at most
 * `NODE_TYPE_LIMIT` node types: a step whose other end is null, or is not a node type the kit
 * lists, is not offered, so every step offered can itself be followed further. Offers come in
 * a fixed order: by edge type name in UTF-8 byte order, out before in, the order in which the
 * kit's `neighbors` lists edges (kit/src/neighbors.ts). Nothing here asks the kit: what a chain
 * finds is lib/results.ts's.
 */
import type { SealedFile } from "@mosaic/kit";

export type Direction = "out" | "in";

/** A step the mosaic allows after a type: an edge type, its direction, and the type it leads to. */
export interface Offer {
  readonly edge: string;
  readonly direction: Direction;
  readonly type: string;
}

/** One step of a chain: an offer, pinned to one thing (its node id) or open (null). */
export interface Step extends Offer {
  readonly pin: string | null;
}

export interface Chain {
  /** The node type the chain starts from. */
  readonly start: string;
  /** The one thing it starts from, or null for any thing of the start type. */
  readonly pin: string | null;
  readonly steps: readonly Step[];
}

/** What a chain needs of an open mosaic. */
export type ChainSchema = Pick<SealedFile, "nodeTypes" | "edgeTypes">;

/** Compare by Unicode code points, which is UTF-8 byte order. */
function byBytes(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** The steps the mosaic allows after `type`, in a fixed order; none for a type it lacks. */
export function offers(schema: ChainSchema, type: string): Offer[] {
  if (!schema.nodeTypes.some((t) => t.name === type)) return [];
  const edges = [...schema.edgeTypes].sort((a, b) => byBytes(a.name, b.name));
  const found: Offer[] = [];
  const listed = new Set(schema.nodeTypes.map((t) => t.name));
  for (const e of edges) {
    if (e.from === null || e.to === null) continue;
    if (e.from === type && listed.has(e.to)) found.push({ edge: e.name, direction: "out", type: e.to });
    if (e.to === type && listed.has(e.from)) found.push({ edge: e.name, direction: "in", type: e.from });
  }
  return found;
}

/** The type at `index`: -1 is the start, 0 the first step's. */
export function typeAt(chain: Chain, index: number): string {
  if (index === -1) return chain.start;
  const step = chain.steps[index];
  if (step === undefined) throw new RangeError(`the chain has no step ${index + 1}`);
  return step.type;
}

function same(a: Offer, b: Offer): boolean {
  return a.edge === b.edge && a.direction === b.direction && a.type === b.type;
}

/** Why `step` cannot follow `type`, or null when it can. */
function refusal(schema: ChainSchema, type: string, step: Offer): string | null {
  const allowed = offers(schema, type);
  if (allowed.some((o) => same(o, step))) return null;
  const way = allowed.find((o) => o.edge === step.edge && o.direction === step.direction);
  if (way) return `${step.edge} ${step.direction} from ${type} leads to ${way.type}, not ${step.type}`;
  return `${type} has no edge type ${step.edge} ${step.direction}`;
}

/** True when `id` names a thing of `type`: node ids are `Type:key` (section 3.4). */
function ofType(id: string, type: string): boolean {
  return id.startsWith(`${type}:`) && id.length > type.length + 1;
}

function checkedPin(id: string | null, type: string): string | null {
  if (id !== null && !ofType(id, type)) throw new TypeError(`${id} is not a ${type}`);
  return id;
}

function noType(schema: ChainSchema, type: string): boolean {
  return !schema.nodeTypes.some((t) => t.name === type);
}

/**
 * The longest part of `chain` the mosaic allows, and what was wrong with the rest, in order:
 * a start type it lacks keeps nothing; a step it does not allow ends the chain before it; a pin
 * of another type is dropped and its step kept, open.
 */
export function checkChain(schema: ChainSchema, chain: Chain): { chain: Chain | null; problems: string[] } {
  if (noType(schema, chain.start)) return { chain: null, problems: [`start: the mosaic has no node type ${chain.start}`] };
  const problems: string[] = [];
  const keepPin = (id: string | null, type: string, where: string): string | null => {
    if (id === null || ofType(id, type)) return id;
    problems.push(`${where}: ${id} is not a ${type}`);
    return null;
  };
  const startPin = keepPin(chain.pin, chain.start, "start");
  const steps: Step[] = [];
  let type = chain.start;
  for (const [i, step] of chain.steps.entries()) {
    const why = refusal(schema, type, step);
    if (why !== null) {
      problems.push(`step ${i + 1}: ${why}`);
      break;
    }
    steps.push({ edge: step.edge, direction: step.direction, type: step.type, pin: keepPin(step.pin, step.type, `step ${i + 1}`) });
    type = step.type;
  }
  return { chain: { start: chain.start, pin: startPin, steps }, problems };
}

/** `chain` with `offer` added as its last step, open; refused when the last type does not offer it. */
export function extend(schema: ChainSchema, chain: Chain, offer: Offer): Chain {
  const type = chain.steps.length === 0 ? chain.start : chain.steps.at(-1)!.type;
  const why = noType(schema, type) ? `the mosaic has no node type ${type}` : refusal(schema, type, offer);
  if (why !== null) throw new RangeError(why);
  return { ...chain, steps: [...chain.steps, { edge: offer.edge, direction: offer.direction, type: offer.type, pin: null }] };
}

/** `chain` with only its first `length` steps. */
export function shorten(chain: Chain, length: number): Chain {
  return { ...chain, steps: chain.steps.slice(0, Math.max(0, length)) };
}

/**
 * `chain` with step `index` following `offer` instead. The steps before it keep their pins; if
 * the step still leads to the same type it keeps its pin and the steps after it, else they are
 * dropped with its pin, since they no longer follow.
 */
export function change(schema: ChainSchema, chain: Chain, index: number, offer: Offer): Chain {
  const old = chain.steps[index];
  if (old === undefined) throw new RangeError(`the chain has no step ${index + 1}`);
  const why = refusal(schema, typeAt(chain, index - 1), offer);
  if (why !== null) throw new RangeError(why);
  const kept = offer.type === old.type;
  const step: Step = { edge: offer.edge, direction: offer.direction, type: offer.type, pin: kept ? old.pin : null };
  return { ...chain, steps: [...chain.steps.slice(0, index), step, ...(kept ? chain.steps.slice(index + 1) : [])] };
}

/** `chain` with the start (`"start"`) or step `index` pinned to the thing `id`, or left open (null). */
export function pin(chain: Chain, index: number | "start", id: string | null): Chain {
  if (index === "start") return { ...chain, pin: checkedPin(id, chain.start) };
  const step = chain.steps[index];
  if (step === undefined) throw new RangeError(`the chain has no step ${index + 1}`);
  const steps = [...chain.steps];
  steps[index] = { ...step, pin: checkedPin(id, step.type) };
  return { ...chain, steps };
}

/** `chain` starting from `type`: the same chain for its own start type, else a new, empty one. */
export function restart(schema: ChainSchema, chain: Chain, type: string): Chain {
  if (noType(schema, type)) throw new RangeError(`the mosaic has no node type ${type}`);
  return type === chain.start ? chain : { start: type, pin: null, steps: [] };
}

/**
 * `chain` without step `index` (V-5). The steps before it keep their pins; the steps after it
 * stay as long as they still follow from the step before (a step from a type to itself can go
 * and leave the rest), and from the first that does not, they go.
 */
export function remove(schema: ChainSchema, chain: Chain, index: number): Chain {
  if (chain.steps[index] === undefined) throw new RangeError(`the chain has no step ${index + 1}`);
  const steps = [...chain.steps.slice(0, index), ...chain.steps.slice(index + 1)];
  const kept = checkChain(schema, { ...chain, steps }).chain;
  if (kept === null) throw new RangeError(`the mosaic has no node type ${chain.start}`);
  return { ...chain, steps: kept.steps };
}
