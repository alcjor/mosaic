/**
 * A small wrapper round d3-force: nodes and links in, positions out (needs G-7).
 *
 * The simulation runs a fixed number of ticks at once, never on a timer, and draws its "random"
 * numbers from a generator seeded by a constant, so the same input always gives the same
 * positions. A pinned node stays exactly where it is; a node with a `home` is pulled back
 * towards it, so a new layout does not throw known things to new places.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { round, seeded } from "./seed.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ForceNode {
  readonly id: string;
  /** Where it starts. */
  readonly x: number;
  readonly y: number;
  /** How far other nodes keep from its middle. */
  readonly radius: number;
  /** Held here: it does not move at all. */
  readonly pinned?: Point;
  /** Where it was before: it is pulled back towards there. */
  readonly home?: Point;
}

export interface ForceLink {
  readonly source: string;
  readonly target: string;
  /** How long the link would like to be. */
  readonly length: number;
}

export interface ForceOptions {
  /** How many ticks to run; 300 by default, enough to settle from rest. */
  readonly ticks?: number;
  /** How lively the start is, 0 to 1; 1 by default. Lower moves known things less. */
  readonly heat?: number;
}

/** How hard a node with a home is pulled back to it, against 0.1 for d3's own pulls. */
const HOME_PULL = 0.4;

interface Body extends SimulationNodeDatum {
  id: string;
  radius: number;
}

interface Join extends SimulationLinkDatum<Body> {
  length: number;
}

/** Settle `nodes` joined by `links`; every node's place, rounded to hundredths. */
export function settle(nodes: readonly ForceNode[], links: readonly ForceLink[], options: ForceOptions = {}): Map<string, Point> {
  const bodies: Body[] = nodes.map((n) => ({
    id: n.id,
    radius: n.radius,
    x: n.pinned?.x ?? n.x,
    y: n.pinned?.y ?? n.y,
    fx: n.pinned?.x ?? null,
    fy: n.pinned?.y ?? null,
  }));
  const ids = new Set(bodies.map((b) => b.id));
  const joins: Join[] = links.filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target).map((l) => ({ ...l }));
  const homes = new Map(nodes.filter((n) => n.home !== undefined).map((n) => [n.id, n.home!]));
  const at = (b: Body) => homes.get(b.id);

  const sim = forceSimulation<Body>(bodies)
    .stop()
    .randomSource(seeded("force-layout"))
    .alpha(options.heat ?? 1)
    .force("link", forceLink<Body, Join>(joins).id((b) => b.id).distance((j) => j.length))
    .force("charge", forceManyBody<Body>().strength(-260).distanceMax(900))
    .force("collide", forceCollide<Body>((b) => b.radius))
    .force("homeX", forceX<Body>((b) => at(b)?.x ?? 0).strength((b) => (at(b) ? HOME_PULL : 0)))
    .force("homeY", forceY<Body>((b) => at(b)?.y ?? 0).strength((b) => (at(b) ? HOME_PULL : 0)));
  sim.tick(options.ticks ?? 300);
  return new Map(bodies.map((b) => [b.id, { x: round(b.x!), y: round(b.y!) }]));
}
