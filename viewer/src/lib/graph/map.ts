/**
 * The data of the map of how a mosaic fits together (needs G-1, G-2): every node
 * type with how many things it holds, every edge type with its two types, how many links it
 * holds and links per thing on average, descriptions, and most linked things as places to start.
 *
 * Node counts come from the kit (`SealedFile.nodeTypes`). Link counts come from tallies
 * ({@link Tallies}): an edge type's links are those leaving the things of the type it leaves,
 * so the map needs walks of those types only ({@link MapData.needs}); an edge type that may
 * leave any type needs every type walked. Until those walks are done and read every thing, each
 * count is partial and says so (G-10). Descriptions are the view file's, else none (G-2).
 * Everything is in the kit's order, names by
 * UTF-8 bytes, so the same mosaic always gives the same data (G-7).
 */
import type { EdgeType, NodeType } from "@mosaic/kit";
import { byBytes } from "./bytes.js";
import { byKey, type Linked, type Tallies, type Tally } from "./tally.js";

/** A number counted by walking, and whether it is still partial. */
export interface Counted {
  /** Null before anything was counted. */
  readonly value: number | null;
  readonly partial: boolean;
}

export interface MapType {
  readonly name: string;
  /** What the page calls it (the view file's label, else its name). */
  readonly label: string;
  /** Things it holds, as the kit counts them. */
  readonly count: number;
  readonly describe: string | null;
}

export interface MapEdge {
  readonly name: string;
  /** The node type it leaves and the one it reaches; null when it may be any. */
  readonly from: string | null;
  readonly to: string | null;
  readonly describe: string | null;
  /** How many links it holds. */
  readonly links: Counted;
  /**
   * Links per thing of the type it leaves, on average: over the things counted so far while
   * partial; null when that type is not one type, or nothing of it was counted.
   */
  readonly perThing: Counted;
}

export interface MapData {
  readonly types: readonly MapType[];
  readonly edges: readonly MapEdge[];
  /** The types whose walks give every edge type's links, by name. */
  readonly needs: readonly string[];
  /** True once every count is whole. */
  readonly complete: boolean;
}

/** What the map needs of an open mosaic. */
export interface MapSchema {
  readonly nodeTypes: readonly NodeType[];
  readonly edgeTypes: readonly EdgeType[];
}

/** What the map needs of the view file's settings. */
export interface MapNames {
  typeLabel(type: string): string;
  typeDescription(type: string): string | null;
  edgeDescription(edge: string): string | null;
}

/** The types whose things an edge type's links leave: one type, or every type when any may. */
function leaving(edge: EdgeType, schema: MapSchema): readonly string[] {
  return edge.from !== null ? [edge.from] : schema.nodeTypes.map((t) => t.name);
}

function whole(tally: Tally | null): boolean {
  return tally !== null && tally.done && tally.unread === 0;
}

/** The map's data, from the kit's types, the view file's names and the walks so far. */
export function mapData(schema: MapSchema, names: MapNames, tallies: Tallies): MapData {
  const counts = new Map(schema.nodeTypes.map((t) => [t.name, t.count]));
  const types = schema.nodeTypes.map(
    (t): MapType => ({ name: t.name, label: names.typeLabel(t.name), count: t.count, describe: names.typeDescription(t.name) }),
  );
  const needs = new Set<string>();
  const edges = schema.edgeTypes.map((e): MapEdge => {
    const named = leaving(e, schema);
    const from = named.filter((t) => counts.has(t));
    for (const t of from) needs.add(t);
    const seen = from.map((t) => tallies.peek(t));
    const started = seen.some((t) => t !== null && (t.counted > 0 || t.done));
    // A type the kit does not list (past its 1000 node types) cannot be walked: never whole.
    const partial = from.length < named.length || named.length === 0 || !seen.every(whole);
    const value = started ? seen.reduce((sum, t) => sum + (t?.out.get(e.name) ?? 0), 0) : null;
    // Per thing of the type it leaves: over every thing once the walk is done, over the things
    // counted so far while it runs, so a partial average is not understated.
    const walk = e.from === null ? null : tallies.peek(e.from);
    const things = e.from === null ? 0 : walk?.done ? (counts.get(e.from) ?? 0) : (walk?.counted ?? 0);
    const perThing = e.from === null || things === 0 || value === null ? null : value / things;
    return {
      name: e.name,
      from: e.from,
      to: e.to,
      describe: names.edgeDescription(e.name),
      links: { value, partial },
      perThing: { value: perThing, partial },
    };
  });
  return {
    types,
    edges,
    needs: [...needs].sort(byBytes),
    complete: edges.every((e) => !e.links.partial),
  };
}

/** Most linked things, as far as the walk got. */
export interface MostLinked {
  readonly things: readonly Linked[];
  readonly partial: boolean;
  /** Things the walk counted, of the type's total (null before its first page). */
  readonly counted: number;
  readonly total: number | null;
}

function most(tally: Tally | null, things: (t: Tally) => readonly Linked[]): MostLinked {
  if (tally === null) return { things: [], partial: true, counted: 0, total: null };
  return { things: things(tally).filter((t) => t.links > 0), partial: !whole(tally), counted: tally.counted, total: tally.total };
}

/** A type's most linked things, by all their links both ways: places to start (G-2). */
export function mostLinkedOfType(tallies: Tallies, type: string): MostLinked {
  return most(tallies.peek(type), (t) => t.top);
}

/**
 * An edge type's most linked things: the things it leads to that most of its links reach, from
 * the walk of the type it reaches; for an edge type that may reach any type, the things it
 * leaves with most of its links, from the walk of the type it leaves. Null types give none.
 */
export function mostLinkedByEdge(schema: MapSchema, tallies: Tallies, edge: string): MostLinked {
  const found = schema.edgeTypes.find((e) => e.name === edge);
  if (found === undefined) return { things: [], partial: false, counted: 0, total: 0 };
  if (found.to !== null) return most(tallies.peek(found.to), (t) => t.topBy.get(byKey(edge, "in")) ?? []);
  if (found.from !== null) return most(tallies.peek(found.from), (t) => t.topBy.get(byKey(edge, "out")) ?? []);
  return { things: [], partial: false, counted: 0, total: 0 };
}

/** The type whose walk gives an edge type's most linked things, or null. */
export function mostLinkedWalk(schema: MapSchema, edge: string): string | null {
  const found = schema.edgeTypes.find((e) => e.name === edge);
  return found?.to ?? found?.from ?? null;
}
