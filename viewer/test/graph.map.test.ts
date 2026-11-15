// The map's data (needs G-1, G-2, G-7, G-10, G-12): every node type with how many
// things it holds, every edge type with its two types, how many links it holds and links per
// thing on average, and most linked things as places to start, all through the kit as it is.
// The kit names node counts but not link counts, so links are counted by walking things through
// bounded calls in the background:
// resumable, cancellable, cached for the session, ties by id, partial until complete.
import { describe, expect, it } from "vitest";
import { type ErrorAnswer, type GetAnswer, type SealedFile, type TableAnswer } from "@mosaic/kit";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { byBytes } from "../src/lib/graph/bytes.js";
import { mapData, mostLinkedByEdge, mostLinkedOfType } from "../src/lib/graph/map.js";
import { Tallies, TallyJob, type TallySource } from "../src/lib/graph/tally.js";
import { DEFAULT_VIEW, parseView, Shape } from "../src/lib/view.js";

/**
 * Hubs and spokes: 25 spokes (more than one page of 20), each pointing at one or two hubs;
 * two edges between Spoke:s00 and Hub:a differ only by qualifier, so they are two links.
 */
function spec(): MosaicSpec {
  const spokes = Array.from({ length: 25 }, (_, i) => `s${String(i).padStart(2, "0")}`);
  const edges: NonNullable<MosaicSpec["edges"]> = [];
  for (const [i, s] of spokes.entries()) {
    edges.push({ type: "points_at", from: `Spoke:${s}`, to: i % 3 === 0 ? "Hub:a" : "Hub:b" });
    if (i % 5 === 0) edges.push({ type: "also", from: `Spoke:${s}`, to: "Hub:c" });
  }
  edges.push({ type: "points_at", from: "Spoke:s00", to: "Hub:a", qualifier: "again" });
  edges.push({ type: "also", from: "Spoke:s01", to: "Hub:b" });
  edges.push({ type: "also", from: "Spoke:s02", to: "Hub:b" });
  return {
    typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}', Lonely: '{"name":"text"}' },
    edgeTypes: [
      ["points_at", "Spoke", "Hub"],
      ["also", "Spoke", "Hub"],
      ["unused", "Hub", "Lonely"],
    ],
    nodes: [
      ...["a", "b", "c"].map((k) => ({ type: "Hub", key: k, label: `Hub ${k}` })),
      ...spokes.map((s) => ({ type: "Spoke", key: s, label: `Spoke ${s}` })),
    ],
    types: ["Lonely"],
    edges,
  };
}

/** The links the spec holds, counted from the spec itself, never through the kit. */
function expected() {
  const { edges, nodes } = spec();
  const links = new Map<string, number>();
  const into = new Map<string, Map<string, number>>();
  const all = new Map<string, number>(nodes.map((n) => [`${n.type}:${n.key}`, 0]));
  for (const e of edges!) {
    links.set(e.type, (links.get(e.type) ?? 0) + 1);
    const m = into.get(e.type) ?? new Map<string, number>();
    m.set(e.to, (m.get(e.to) ?? 0) + 1);
    into.set(e.type, m);
    all.set(e.from, all.get(e.from)! + 1);
    all.set(e.to, all.get(e.to)! + 1);
  }
  return { links, into, all };
}

async function open(): Promise<SealedFile> {
  return openMosaic(buildMosaic(spec()), "hubs.mosaic");
}

/** A source that counts the kit calls made through it. */
function counting(file: SealedFile) {
  const calls = { table: 0, get: 0 };
  const source: TallySource = {
    table: (a) => (calls.table++, file.table(a)),
    get: (a) => (calls.get++, file.get(a)),
  };
  return { source, calls };
}

async function finish(job: TallyJob): Promise<void> {
  while (!job.tally.done) await job.advance();
}

describe("the map's types and edge types (G-1)", () => {
  it("lists every node type with how many things it holds, as the kit counts them", async () => {
    const file = await open();
    const data = mapData(file, new Shape(DEFAULT_VIEW, file), new Tallies(file));
    expect(data.types.map((t) => [t.name, t.count])).toEqual([
      ["Hub", 3],
      ["Lonely", 0],
      ["Spoke", 25],
    ]);
  });

  it("lists every edge type with its two types, and no link count before any walk", async () => {
    const file = await open();
    const data = mapData(file, new Shape(DEFAULT_VIEW, file), new Tallies(file));
    expect(data.edges.map((e) => [e.name, e.from, e.to])).toEqual([
      ["also", "Spoke", "Hub"],
      ["points_at", "Spoke", "Hub"],
      ["unused", "Hub", "Lonely"],
    ]);
    for (const e of data.edges) expect(e.links).toMatchObject({ value: null, partial: true });
    expect(data.complete).toBe(false);
  });

  it("counts every link of every edge type exactly, two links between one pair included", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    for (const type of mapData(file, new Shape(DEFAULT_VIEW, file), tallies).needs) await finish(tallies.job(type));
    const data = mapData(file, new Shape(DEFAULT_VIEW, file), tallies);
    const { links } = expected();
    for (const e of data.edges) {
      expect(e.links, e.name).toEqual({ value: links.get(e.name) ?? 0, partial: false });
    }
    expect(data.complete).toBe(true);
  });

  it("gives links per thing on average: links over the things of the type they leave", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    await finish(tallies.job("Spoke"));
    await finish(tallies.job("Hub"));
    const data = mapData(file, new Shape(DEFAULT_VIEW, file), tallies);
    const { links } = expected();
    const pointsAt = data.edges.find((e) => e.name === "points_at")!;
    expect(pointsAt.perThing).toEqual({ value: links.get("points_at")! / 25, partial: false });
    const unused = data.edges.find((e) => e.name === "unused")!;
    expect(unused.perThing).toEqual({ value: 0, partial: false });
  });

  it("counts an edge type leaving a type the kit does not list as never whole", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    for (const type of ["Hub", "Spoke"]) await finish(tallies.job(type));
    // The kit lists at most 1000 node types; an edge type may leave one past them.
    const schema = { nodeTypes: file.nodeTypes, edgeTypes: [...file.edgeTypes, { name: "far", from: "Unlisted", to: "Hub" }] };
    const data = mapData(schema, new Shape(DEFAULT_VIEW, file), tallies);
    const far = data.edges.find((e) => e.name === "far")!;
    expect(far.links).toEqual({ value: null, partial: true });
    expect(far.perThing).toEqual({ value: null, partial: true });
    expect(data.complete).toBe(false);
    expect(data.needs).toEqual(["Hub", "Spoke"]);
  });

  it("averages links over the things counted so far while a walk runs", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    await tallies.job("Spoke").advance();
    const half = mapData(file, new Shape(DEFAULT_VIEW, file), tallies);
    const pointsAt = half.edges.find((e) => e.name === "points_at")!;
    expect(pointsAt.links.partial).toBe(true);
    expect(pointsAt.perThing).toEqual({ value: pointsAt.links.value! / 20, partial: true });
  });

  it("counts an edge type that may leave any type over every type, with no average", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    const schema = { nodeTypes: file.nodeTypes, edgeTypes: [{ name: "points_at", from: null, to: "Hub" }] };
    const before = mapData(schema, new Shape(DEFAULT_VIEW, file), tallies);
    expect(before.needs).toEqual(["Hub", "Lonely", "Spoke"]);
    for (const type of before.needs) await finish(tallies.job(type));
    const after = mapData(schema, new Shape(DEFAULT_VIEW, file), tallies);
    expect(after.edges[0]!.links).toEqual({ value: expected().links.get("points_at"), partial: false });
    expect(after.edges[0]!.perThing).toEqual({ value: null, partial: false });
  });

  it("needs walks of only the types edge types leave", async () => {
    const file = await open();
    expect(mapData(file, new Shape(DEFAULT_VIEW, file), new Tallies(file)).needs).toEqual(["Hub", "Spoke"]);
  });

  it("gives each type's and edge type's description from the view file, else none (G-2)", async () => {
    const file = await open();
    const view = parseView({
      search: "semantic",
      theme: "auto",
      types: [{ name: "Hub", label: "Centre", columns: null, page: null, names: {}, describe: "Where spokes point" }],
      edges: [{ name: "points_at", describe: "A spoke points at a hub" }],
      export: { types: null },
    });
    const data = mapData(file, new Shape(view, file), new Tallies(file));
    expect(data.types.map((t) => [t.name, t.label, t.describe])).toEqual([
      ["Hub", "Centre", "Where spokes point"],
      ["Lonely", "Lonely", null],
      ["Spoke", "Spoke", null],
    ]);
    expect(data.edges.map((e) => [e.name, e.describe])).toEqual([
      ["also", null],
      ["points_at", "A spoke points at a hub"],
      ["unused", null],
    ]);
  });
});

describe("most linked things (G-2)", () => {
  it("of a type: most links both ways first, ties by id (UTF-8 bytes)", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    await finish(tallies.job("Spoke"));
    const { all } = expected();
    const spokes = [...all].filter(([id]) => id.startsWith("Spoke:"));
    spokes.sort((a, b) => b[1] - a[1] || byBytes(a[0], b[0]));
    const top = mostLinkedOfType(tallies, "Spoke");
    expect(top.partial).toBe(false);
    expect(top.things.map((t) => [t.id, t.links])).toEqual(spokes.slice(0, 5));
    expect(top.things[0]!.label).toBe("Spoke s00");
  });

  it("of an edge type: the things it leads to that most of its links reach, ties by id", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    await finish(tallies.job("Hub"));
    const { into } = expected();
    for (const edge of ["points_at", "also"]) {
      const want = [...into.get(edge)!].sort((a, b) => b[1] - a[1] || byBytes(a[0], b[0]));
      const top = mostLinkedByEdge(file, tallies, edge);
      expect(top.partial).toBe(false);
      expect(top.things.map((t) => [t.id, t.links])).toEqual(want);
    }
    expect(mostLinkedByEdge(file, tallies, "unused").things).toEqual([]);
  });

  it("of an edge type that may reach any type: the things it leaves with most of its links", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    await finish(tallies.job("Spoke"));
    const schema = { nodeTypes: file.nodeTypes, edgeTypes: [{ name: "also", from: "Spoke", to: null }] };
    const counts = new Map<string, number>();
    for (const e of spec().edges!) if (e.type === "also") counts.set(e.from, (counts.get(e.from) ?? 0) + 1);
    const want = [...counts].sort((a, b) => b[1] - a[1] || byBytes(a[0], b[0])).slice(0, 5);
    const top = mostLinkedByEdge(schema, tallies, "also");
    expect(top.things.map((t) => [t.id, t.links])).toEqual(want);
    expect(mostLinkedByEdge({ nodeTypes: file.nodeTypes, edgeTypes: [{ name: "also", from: null, to: null }] }, tallies, "also").things).toEqual([]);
  });

  it("is partial, and says so, until the walk is done", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    expect(mostLinkedOfType(tallies, "Spoke")).toEqual({ things: [], partial: true, counted: 0, total: null });
    await tallies.job("Spoke").advance();
    const half = mostLinkedOfType(tallies, "Spoke");
    expect(half).toMatchObject({ partial: true, counted: 20, total: 25 });
    expect(half.things.length).toBe(5);
  });
});

describe("walks (G-7, G-10)", () => {
  it("go a page of 20 things at a time, each a bounded call, partial until the last", async () => {
    const file = await open();
    const { source, calls } = counting(file);
    const job = new TallyJob(source, "Spoke");
    expect(job.tally).toMatchObject({ counted: 0, done: false });
    await job.advance();
    expect(job.tally).toMatchObject({ counted: 20, total: 25, done: false });
    expect(calls).toEqual({ table: 1, get: 20 });
    await job.advance();
    expect(job.tally).toMatchObject({ counted: 25, total: 25, done: true, unread: 0 });
    expect(calls).toEqual({ table: 2, get: 25 });
    await job.advance(); // done: nothing more is asked
    expect(calls).toEqual({ table: 2, get: 25 });
  });

  it("are cached for the session: the same type's walk is never done twice", async () => {
    const file = await open();
    const { source, calls } = counting(file);
    const tallies = new Tallies(source);
    expect(tallies.job("Spoke")).toBe(tallies.job("Spoke"));
    await finish(tallies.job("Spoke"));
    const asked = { ...calls };
    await finish(tallies.job("Spoke"));
    expect(calls).toEqual(asked);
  });

  it("resume where they stopped, and end as an uninterrupted walk ends", async () => {
    const file = await open();
    const whole = new TallyJob(file, "Spoke");
    await finish(whole);
    const stopped = new TallyJob(file, "Spoke");
    await stopped.advance();
    // The person left the view; later they come back and the walk goes on.
    await finish(stopped);
    expect(stopped.tally).toEqual(whole.tally);
  });

  it("never run one page twice when asked to advance twice at once", async () => {
    const file = await open();
    const { source, calls } = counting(file);
    const job = new TallyJob(source, "Spoke");
    await Promise.all([job.advance(), job.advance(), job.advance()]);
    expect(job.tally.done).toBe(true);
    expect(calls.get).toBe(25);
  });

  it("run in the background until done or stopped, yielding to the page between pages", async () => {
    const file = await open();
    const tallies = new Tallies(file);
    const seen: number[] = [];
    let pauses = 0;
    await tallies.run("Spoke", { onTally: (t) => seen.push(t.counted), pause: async () => void pauses++ });
    expect(seen).toEqual([20, 25]);
    expect(pauses).toBe(2);
    // Within a page it breathes every ten things, so no page holds the page's input for long;
    // the tally still changes a whole page at a time.
    const steps: string[] = [];
    await new Tallies(file).run("Spoke", {
      onTally: (t) => steps.push(`tally ${t.counted}`),
      pause: async () => void steps.push("pause"),
      breathe: async () => void steps.push("breathe"),
    });
    expect(steps).toEqual(["breathe", "tally 20", "pause", "tally 25", "pause"]);
    const stop = new AbortController();
    const other = new Tallies(file);
    await other.run("Spoke", { signal: stop.signal, onTally: () => stop.abort(), pause: async () => {} });
    expect(other.job("Spoke").tally).toMatchObject({ counted: 20, done: false });
  });

  it("give the same data every time for the same mosaic", async () => {
    const file = await open();
    const once = async () => {
      const tallies = new Tallies(file);
      for (const t of ["Hub", "Spoke"]) await finish(tallies.job(t));
      return {
        map: mapData(file, new Shape(DEFAULT_VIEW, file), tallies),
        top: mostLinkedOfType(tallies, "Spoke"),
        edge: mostLinkedByEdge(file, tallies, "points_at"),
      };
    };
    expect(await once()).toEqual(await once());
  });

  it("say what they could not read, and stay partial for it", async () => {
    const file = await open();
    // A kit that leaves one thing out of its rows (an id too long for an answer) but counts it
    // in `total`, paging what is left 20 at a time, as section 8.6 says `table` does.
    const rows: (readonly unknown[])[] = [];
    for (let page = 1; ; page++) {
      const answer = (await file.table({ type: "Spoke", columns: ["label"], page })) as TableAnswer;
      rows.push(...answer.data.rows);
      if (answer.data.rows.length < 20) break;
    }
    const kept = rows.filter((r) => r[0] !== "Spoke:s03");
    const source: TallySource = {
      async table(a) {
        const { type, page } = a as { type: string; page: number };
        if (type !== "Spoke") return file.table(a);
        const data = { type, columns: ["id", "label"], rows: kept.slice((page - 1) * 20, page * 20), page, total: rows.length };
        return { tool: "table", mosaic: "hubs.mosaic", data } as TableAnswer;
      },
      get: (a) => file.get(a) as Promise<GetAnswer | ErrorAnswer>,
    };
    const job = new TallyJob(source, "Spoke");
    while (!job.tally.done) await job.advance();
    expect(job.tally).toMatchObject({ counted: 24, total: 25, unread: 1, done: true });
    const tallies = new Tallies(source);
    for (const t of ["Hub", "Spoke"]) while (!tallies.job(t).tally.done) await tallies.job(t).advance();
    const data = mapData(file, new Shape(DEFAULT_VIEW, file), tallies);
    expect(data.edges.find((e) => e.name === "points_at")!.links.partial).toBe(true);
    expect(data.complete).toBe(false);
  });

  it("count a thing whose id is too long for an answer as unread, and stay partial", async () => {
    // Section 8.2: an id longer than 512 characters is left out of `table`'s rows and still
    // counted in its total; the walk cannot read its links.
    const long = "k".repeat(520);
    const file = await openMosaic(
      buildMosaic({
        typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}' },
        edgeTypes: [["points_at", "Spoke", "Hub"]],
        nodes: [
          { type: "Hub", key: "a", label: "Hub a" },
          ...Array.from({ length: 21 }, (_, i) => ({ type: "Spoke", key: `s${String(i).padStart(2, "0")}`, label: `Spoke ${i}` })),
          { type: "Spoke", key: long, label: "Long" },
        ],
        edges: [{ type: "points_at", from: `Spoke:${long}`, to: "Hub:a" }, { type: "points_at", from: "Spoke:s00", to: "Hub:a" }],
      }),
      "long.mosaic",
    );
    const tallies = new Tallies(file);
    await finish(tallies.job("Spoke"));
    expect(tallies.peek("Spoke")).toMatchObject({ total: 22, counted: 21, unread: 1, done: true });
    const data = mapData(file, new Shape(DEFAULT_VIEW, file), tallies);
    expect(data.edges[0]!.links).toEqual({ value: 1, partial: true });
    expect(mostLinkedOfType(tallies, "Spoke").partial).toBe(true);
  });

  it("report a tool's error rather than count past it", async () => {
    const file = await open();
    const source: TallySource = {
      table: (a) => file.table(a),
      get: async () => ({ tool: "get", mosaic: "m", error: { code: "unknown_id", message: "no such node", suggestions: [] } }) as ErrorAnswer,
    };
    const job = new TallyJob(source, "Spoke");
    await expect(job.advance()).rejects.toThrow(/Spoke: .*no such node/);
  });
});

describe("graph map: further cases", () => {
  async function open(spec: MosaicSpec): Promise<SealedFile> {
    return openMosaic(buildMosaic(spec), "edges.mosaic");
  }

  function counting(file: SealedFile) {
    const calls = { table: 0, get: 0 };
    const source: TallySource = {
      table: (a) => (calls.table++, file.table(a)),
      get: (a) => (calls.get++, file.get(a)),
    };
    return { source, calls };
  }

  async function finish(job: TallyJob): Promise<void> {
    while (!job.tally.done) await job.advance();
  }

  async function walkAll(file: SealedFile, tallies: Tallies): Promise<void> {
    for (const t of mapData(file, new Shape(DEFAULT_VIEW, file), tallies).needs) await finish(tallies.job(t));
  }

  const shape = (file: SealedFile) => new Shape(DEFAULT_VIEW, file);

  /** `count` spokes s000.., each with one link to Hub:h. */
  function star(count: number): MosaicSpec {
    const keys = Array.from({ length: count }, (_, i) => `s${String(i).padStart(3, "0")}`);
    return {
      typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}' },
      edgeTypes: [["to_hub", "Spoke", "Hub"]],
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, ...keys.map((k) => ({ type: "Spoke", key: k, label: `Spoke ${k}` }))],
      edges: keys.map((k) => ({ type: "to_hub", from: `Spoke:${k}`, to: "Hub:h" })),
    };
  }

  describe("empty and single inputs (G-1)", () => {
    it("a mosaic with a type that holds nothing and no edge type: one type, count 0, no edges, whole", async () => {
      const file = await open({ nodes: [], types: ["Only"], typeProps: { Only: '{"name":"text"}' } });
      const data = mapData(file, shape(file), new Tallies(file));
      expect(data.types.map((t) => [t.name, t.count])).toEqual([["Only", 0]]);
      expect(data.edges).toEqual([]);
      expect(data.needs).toEqual([]);
      expect(data.complete).toBe(true);
    });

    it("walking a type that holds nothing finishes at once, with nothing counted and no top", async () => {
      const file = await open({ nodes: [], types: ["Only"], typeProps: { Only: '{"name":"text"}' } });
      const { source, calls } = counting(file);
      const job = new TallyJob(source, "Only");
      await finish(job);
      expect(job.tally).toMatchObject({ total: 0, counted: 0, unread: 0, done: true });
      expect(job.tally.top).toEqual([]);
      expect(calls.get).toBe(0);
    });

    it("a single thing with no link: counted, whole, and not among the most linked", async () => {
      const file = await open({ nodes: [{ type: "Solo", key: "x", label: "X" }], typeProps: { Solo: '{"name":"text"}' } });
      const tallies = new Tallies(file);
      await finish(tallies.job("Solo"));
      expect(tallies.peek("Solo")).toMatchObject({ total: 1, counted: 1, done: true, unread: 0 });
      expect(mostLinkedOfType(tallies, "Solo")).toMatchObject({ things: [], partial: false });
    });

    it("an edge type that holds no link has 0 links, whole, and 0 per thing when its type holds things", async () => {
      const file = await open({
        nodes: [{ type: "A", key: "a" }, { type: "B", key: "b" }],
        typeProps: { A: '{"name":"text"}', B: '{"name":"text"}' },
        edgeTypes: [["none", "A", "B"]],
      });
      const tallies = new Tallies(file);
      await walkAll(file, tallies);
      const e = mapData(file, shape(file), tallies).edges[0]!;
      expect(e.links).toEqual({ value: 0, partial: false });
      expect(e.perThing).toEqual({ value: 0, partial: false });
      expect(mostLinkedByEdge(file, tallies, "none").things).toEqual([]);
    });

    it("an edge type leaving a type that holds nothing has no average, not a division by zero", async () => {
      const file = await open({
        nodes: [{ type: "B", key: "b" }],
        types: ["A"],
        typeProps: { A: '{"name":"text"}', B: '{"name":"text"}' },
        edgeTypes: [["from_empty", "A", "B"]],
      });
      const tallies = new Tallies(file);
      await walkAll(file, tallies);
      const e = mapData(file, shape(file), tallies).edges[0]!;
      expect(e.links).toEqual({ value: 0, partial: false });
      expect(e.perThing.value).toBeNull();
      expect(Number.isNaN(e.perThing.value)).toBe(false);
    });
  });

  describe("page boundaries (G-10)", () => {
    it.each([1, 19, 20, 21, 40, 41])("%i things are counted once each, links added up exactly", async (n) => {
      const file = await open(star(n));
      const { source, calls } = counting(file);
      const tallies = new Tallies(source);
      await finish(tallies.job("Spoke"));
      await finish(tallies.job("Hub"));
      expect(tallies.peek("Spoke")).toMatchObject({ total: n, counted: n, unread: 0, done: true });
      expect(tallies.peek("Spoke")!.out.get("to_hub")).toBe(n);
      expect(tallies.peek("Hub")!.in.get("to_hub")).toBe(n);
      expect(calls.get).toBe(n + 1);
      const e = mapData(file, shape(file), tallies).edges[0]!;
      expect(e.links).toEqual({ value: n, partial: false });
      expect(e.perThing).toEqual({ value: 1, partial: false });
    });

    it("each page is one bounded table call of a fixed size; counted never passes the total", async () => {
      const file = await open(star(45));
      const job = new TallyJob(file, "Spoke");
      const seen: number[] = [];
      while (!job.tally.done) {
        await job.advance();
        seen.push(job.tally.counted);
        expect(job.tally.counted).toBeLessThanOrEqual(job.tally.total ?? 0);
      }
      expect(seen).toEqual([20, 40, 45]);
    });
  });

  describe("partial until whole (G-10)", () => {
    it("a walk that was created but not advanced has counted nothing: no link count, partial", async () => {
      const file = await open(star(25));
      const tallies = new Tallies(file);
      tallies.job("Spoke");
      const data = mapData(file, shape(file), tallies);
      expect(data.edges[0]!.links).toEqual({ value: null, partial: true });
      expect(data.complete).toBe(false);
    });

    it("an edge type is whole as soon as the type it leaves is walked, and not before", async () => {
      const file = await open(star(25));
      const tallies = new Tallies(file);
      const job = tallies.job("Spoke");
      await job.advance();
      const half = mapData(file, shape(file), tallies).edges[0]!;
      expect(half.links.partial).toBe(true);
      expect(half.perThing.partial).toBe(true);
      expect(half.links.value).toBeLessThanOrEqual(25);
      await finish(job);
      const whole = mapData(file, shape(file), tallies).edges[0]!;
      expect(whole.links).toEqual({ value: 25, partial: false });
    });

    it("link counts never fall as the walk goes on", async () => {
      const file = await open(star(45));
      const tallies = new Tallies(file);
      const job = tallies.job("Spoke");
      let last = 0;
      while (!job.tally.done) {
        await job.advance();
        const v = mapData(file, shape(file), tallies).edges[0]!.links.value!;
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
      expect(last).toBe(45);
    });

    it("a thing with more edge types than the kit lists in `get` is reported unread, and the counts stay partial", async () => {
      // 21 edge types out of one thing: the kit lists at most 20 link counts per thing.
      const names = Array.from({ length: 21 }, (_, i) => `e${String(i).padStart(2, "0")}`);
      const file = await open({
        typeProps: { A: '{"name":"text"}', B: '{"name":"text"}' },
        nodes: [{ type: "A", key: "a" }, { type: "B", key: "b" }],
        edgeTypes: names.map((n) => [n, "A", "B"] as [string, string, string]),
        edges: names.map((n) => ({ type: n, from: "A:a", to: "B:b" })),
      });
      const tallies = new Tallies(file);
      await walkAll(file, tallies);
      expect(tallies.peek("A")).toMatchObject({ done: true, counted: 1 });
      expect(tallies.peek("A")!.unread).toBeGreaterThan(0);
      const data = mapData(file, shape(file), tallies);
      expect(data.complete).toBe(false);
      expect(data.edges.some((e) => e.links.partial)).toBe(true);
    });
  });

  describe("most linked things in a fixed order (G-2, G-7)", () => {
    /** Spokes with the keys given, one link each to Hub:h. */
    function keyed(keys: string[]): MosaicSpec {
      return {
        typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}' },
        edgeTypes: [["to_hub", "Spoke", "Hub"]],
        nodes: [{ type: "Hub", key: "h" }, ...keys.map((k) => ({ type: "Spoke", key: k, label: `L ${k}` }))],
        edges: keys.map((k) => ({ type: "to_hub", from: `Spoke:${k}`, to: "Hub:h" })),
      };
    }

    it("ties go by id in UTF-8 byte order, not UTF-16 order, not locale, not case-folded", async () => {
      // UTF-8: "B" < "a" < "é" (C3 A9) < U+FF5E (EF BD 9E) < U+1F600 (F0 9F 98 80).
      // UTF-16 would put U+1F600 (D83D DE00) before U+FF5E.
      const keys = ["\u{1F600}", "～", "é", "a", "B"];
      const file = await open(keyed(keys));
      const tallies = new Tallies(file);
      await finish(tallies.job("Spoke"));
      const ids = mostLinkedOfType(tallies, "Spoke").things.map((t) => t.id);
      expect(ids).toEqual(["Spoke:B", "Spoke:a", "Spoke:é", "Spoke:～", "Spoke:\u{1F600}"]);
    });

    it("a prefix comes before its longer id", async () => {
      const file = await open(keyed(["ab", "a", "abc"]));
      const tallies = new Tallies(file);
      await finish(tallies.job("Spoke"));
      expect(mostLinkedOfType(tallies, "Spoke").things.map((t) => t.id)).toEqual(["Spoke:a", "Spoke:ab", "Spoke:abc"]);
    });

    it("keeps five, the first five by id when more tie, whatever order the walk met them in", async () => {
      const keys = ["g", "f", "e", "d", "c", "b", "a"];
      const file = await open(keyed(keys));
      const tallies = new Tallies(file);
      await finish(tallies.job("Spoke"));
      expect(mostLinkedOfType(tallies, "Spoke").things.map((t) => t.id)).toEqual(
        ["a", "b", "c", "d", "e"].map((k) => `Spoke:${k}`),
      );
    });

    it("keeps the number a walk was asked to keep", async () => {
      const file = await open(keyed(["a", "b", "c", "d"]));
      for (const keep of [1, 2, 3]) {
        const job = new TallyJob(file, "Spoke", keep);
        await finish(job);
        expect(job.tally.top.map((t) => t.id)).toEqual(["Spoke:a", "Spoke:b", "Spoke:c"].slice(0, keep));
      }
    });

    it("a hub with many links comes before spokes with few, whatever the ids", async () => {
      const file = await open(keyed(["a", "b", "c"]));
      const tallies = new Tallies(file);
      await finish(tallies.job("Hub"));
      const top = mostLinkedOfType(tallies, "Hub");
      expect(top.things.map((t) => [t.id, t.links])).toEqual([["Hub:h", 3]]);
    });

    it("a thing's label is the node's label, and a thing with none is still listed", async () => {
      const file = await open({
        typeProps: { A: '{"name":"text"}', B: '{"name":"text"}' },
        nodes: [{ type: "A", key: "named", label: "A name" }, { type: "A", key: "bare" }, { type: "B", key: "b" }],
        edgeTypes: [["r", "A", "B"]],
        edges: [{ type: "r", from: "A:named", to: "B:b" }, { type: "r", from: "A:bare", to: "B:b" }],
      });
      const tallies = new Tallies(file);
      await finish(tallies.job("A"));
      const things = mostLinkedOfType(tallies, "A").things;
      expect(things.map((t) => t.id)).toEqual(["A:bare", "A:named"]);
      expect(things.find((t) => t.id === "A:named")!.label).toBe("A name");
    });

    it("an edge type's most linked things count only that edge type, not the thing's other links", async () => {
      const file = await open({
        typeProps: { A: '{"name":"text"}', B: '{"name":"text"}' },
        nodes: [{ type: "A", key: "a1" }, { type: "A", key: "a2" }, { type: "B", key: "x" }, { type: "B", key: "y" }],
        edgeTypes: [["r", "A", "B"], ["s", "A", "B"]],
        edges: [
          { type: "r", from: "A:a1", to: "B:x" },
          { type: "r", from: "A:a2", to: "B:y" },
          { type: "s", from: "A:a1", to: "B:x" },
          { type: "s", from: "A:a2", to: "B:x" },
        ],
      });
      const tallies = new Tallies(file);
      await finish(tallies.job("B"));
      expect(mostLinkedByEdge(file, tallies, "r").things.map((t) => [t.id, t.links])).toEqual([["B:x", 1], ["B:y", 1]]);
      expect(mostLinkedByEdge(file, tallies, "s").things.map((t) => [t.id, t.links])).toEqual([["B:x", 2]]);
      expect(mostLinkedOfType(tallies, "B").things.map((t) => [t.id, t.links])).toEqual([["B:x", 3], ["B:y", 1]]);
    });

    it("an edge type the mosaic lacks has no most linked things", async () => {
      const file = await open(star(3));
      const tallies = new Tallies(file);
      await finish(tallies.job("Hub"));
      expect(mostLinkedByEdge(file, tallies, "nope").things).toEqual([]);
    });

    it("a type never walked has none yet, and says it is partial", async () => {
      expect(mostLinkedOfType(new Tallies(await open(star(3))), "Nope")).toMatchObject({ things: [], partial: true });
    });
  });

  describe("a link from a thing to itself (G-1)", () => {
    async function loops(): Promise<SealedFile> {
      return open({
        typeProps: { N: '{"name":"text"}' },
        nodes: ["a", "b", "c"].map((k) => ({ type: "N", key: k })),
        edgeTypes: [["next", "N", "N"]],
        edges: [
          { type: "next", from: "N:a", to: "N:a" },
          { type: "next", from: "N:a", to: "N:b" },
          { type: "next", from: "N:b", to: "N:c" },
        ],
      });
    }

    it("is one link of its edge type, however many times it is met", async () => {
      const file = await loops();
      const tallies = new Tallies(file);
      await finish(tallies.job("N"));
      const e = mapData(file, shape(file), tallies).edges[0]!;
      expect(e.from).toBe("N");
      expect(e.to).toBe("N");
      expect(e.links).toEqual({ value: 3, partial: false });
      expect(e.perThing).toEqual({ value: 1, partial: false });
    });

    it("makes its thing the one most reached by the edge type when it is reached twice", async () => {
      const file = await loops();
      const tallies = new Tallies(file);
      await finish(tallies.job("N"));
      expect(mostLinkedByEdge(file, tallies, "next").things.map((t) => [t.id, t.links])).toEqual([
        ["N:a", 1], ["N:b", 1], ["N:c", 1],
      ]);
    });
  });

  describe("names in the kit's order (G-7)", () => {
    it("types and edge types come in UTF-8 byte order of their names", async () => {
      // Capitals before lower case, digits before letters, "_" between: not a locale's order.
      const types = ["Zed", "Alpha2", "B", "A9", "A10"];
      const file = await open({
        typeProps: Object.fromEntries(types.map((t) => [t, '{"name":"text"}'])),
        nodes: [],
        types,
        edgeTypes: ["zeta", "alpha", "beta", "a_b", "a9", "a10"].map((n) => [n, "B", "Zed"] as [string, string, string]),
      });
      const data = mapData(file, shape(file), new Tallies(file));
      expect(data.types.map((t) => t.name)).toEqual(["A10", "A9", "Alpha2", "B", "Zed"]);
      expect(data.edges.map((e) => e.name)).toEqual(["a10", "a9", "a_b", "alpha", "beta", "zeta"]);
      expect(data.needs).toEqual(["B"]);
    });
  });

  describe("the same data every time (G-7)", () => {
    it("whatever order the types are walked in, and however the pages are interleaved", async () => {
      const file = await open(star(45));
      const a = new Tallies(file);
      await finish(a.job("Hub"));
      await finish(a.job("Spoke"));
      const b = new Tallies(file);
      const [hub, spoke] = [b.job("Hub"), b.job("Spoke")];
      while (!hub.tally.done || !spoke.tally.done) {
        await spoke.advance();
        await hub.advance();
      }
      const data = (t: Tallies) => ({
        map: mapData(file, shape(file), t),
        spokes: mostLinkedOfType(t, "Spoke"),
        hub: mostLinkedOfType(t, "Hub"),
        edge: mostLinkedByEdge(file, t, "to_hub"),
      });
      expect(data(b)).toEqual(data(a));
    });

    it("from two builds of the same mosaic", async () => {
      const run = async () => {
        const file = await open(star(30));
        const tallies = new Tallies(file);
        await walkAll(file, tallies);
        return JSON.stringify([mapData(file, shape(file), tallies), mostLinkedOfType(tallies, "Spoke")]);
      };
      expect(await run()).toBe(await run());
    });

    it("asking twice without a change in between gives equal answers and starts no walk", async () => {
      const file = await open(star(30));
      const { source, calls } = counting(file);
      const tallies = new Tallies(source);
      await finish(tallies.job("Spoke"));
      const asked = { ...calls };
      const first = mapData(file, shape(file), tallies);
      const second = mapData(file, shape(file), tallies);
      expect(second).toEqual(first);
      mostLinkedOfType(tallies, "Spoke");
      mostLinkedByEdge(file, tallies, "to_hub");
      expect(calls).toEqual(asked);
    });
  });

  describe("stopping and starting again (G-10)", () => {
    it("a walk stopped before it starts asks the kit for at most one page", async () => {
      const file = await open(star(45));
      const { source, calls } = counting(file);
      const tallies = new Tallies(source);
      const stop = new AbortController();
      stop.abort();
      await tallies.run("Spoke", { signal: stop.signal, pause: async () => {} });
      expect(calls.table).toBeLessThanOrEqual(1);
      expect(tallies.job("Spoke").tally.done).toBe(false);
    });

    it("a walk stopped and run again ends as an uninterrupted one, and nothing is counted twice", async () => {
      const file = await open(star(45));
      const whole = new Tallies(file);
      await whole.run("Spoke", { pause: async () => {} });
      const { source, calls } = counting(file);
      const tallies = new Tallies(source);
      for (let i = 0; i < 3; i++) {
        const stop = new AbortController();
        await tallies.run("Spoke", { signal: stop.signal, onTally: () => stop.abort(), pause: async () => {} });
      }
      expect(tallies.job("Spoke").tally.done).toBe(true);
      expect(tallies.peek("Spoke")).toEqual(whole.peek("Spoke"));
      expect(calls.get).toBe(45);
    });

    it("running a finished walk asks the kit for nothing", async () => {
      const file = await open(star(25));
      const { source, calls } = counting(file);
      const tallies = new Tallies(source);
      await tallies.run("Spoke", { pause: async () => {} });
      const asked = { ...calls };
      await tallies.run("Spoke", { pause: async () => {} });
      expect(calls).toEqual(asked);
    });

    it("two runs of one type at once never count a thing twice", async () => {
      const file = await open(star(45));
      const { source, calls } = counting(file);
      const tallies = new Tallies(source);
      await Promise.all([tallies.run("Spoke", { pause: async () => {} }), tallies.run("Spoke", { pause: async () => {} })]);
      expect(calls.get).toBe(45);
      expect(tallies.peek("Spoke")!.out.get("to_hub")).toBe(45);
    });

    it("each page is followed by one pause that lets the page breathe, none after the last report", async () => {
      const file = await open(star(45));
      const tallies = new Tallies(file);
      const order: string[] = [];
      await tallies.run("Spoke", { onTally: () => order.push("tally"), pause: async () => void order.push("pause") });
      expect(order).toEqual(["tally", "pause", "tally", "pause", "tally", "pause"]);
    });
  });

  describe("what the kit cannot answer (G-12)", () => {
    it("a type the mosaic lacks fails naming the type", async () => {
      const file = await open(star(3));
      await expect(new TallyJob(file, "Nope").advance()).rejects.toThrow(/Nope/);
    });

    it("a failure on a later page keeps what was counted and does not mark the walk done", async () => {
      const file = await open(star(45));
      let tables = 0;
      const source: TallySource = {
        table: (a) => {
          tables++;
          if (tables === 2) return Promise.resolve({ tool: "table", mosaic: "m", error: { code: "bad", message: "boom", suggestions: [] } } as never);
          return file.table(a);
        },
        get: (a) => file.get(a),
      };
      const job = new TallyJob(source, "Spoke");
      await job.advance();
      await expect(job.advance()).rejects.toThrow(/boom/);
      expect(job.tally).toMatchObject({ counted: 20, done: false });
    });
  });

  describe("the 20 link counts `get` lists per thing (G-10)", () => {
    function fan(outs: number, ins: number): MosaicSpec {
      const out = Array.from({ length: outs }, (_, i) => `o${String(i).padStart(2, "0")}`);
      const into = Array.from({ length: ins }, (_, i) => `i${String(i).padStart(2, "0")}`);
      return {
        typeProps: { A: '{"name":"text"}', B: '{"name":"text"}' },
        nodes: [{ type: "A", key: "hub" }, { type: "B", key: "b" }],
        edgeTypes: [...out, ...into].map((n) => [n, n.startsWith("o") ? "A" : "B", n.startsWith("o") ? "B" : "A"] as [string, string, string]),
        edges: [
          ...out.map((n) => ({ type: n, from: "A:hub", to: "B:b" })),
          ...into.map((n) => ({ type: n, from: "B:b", to: "A:hub" })),
        ],
      };
    }

    it("exactly 20 edge types and directions on one thing are all read: nothing unread", async () => {
      const file = await open(fan(10, 10));
      const tallies = new Tallies(file);
      await finish(tallies.job("A"));
      expect(tallies.peek("A")).toMatchObject({ unread: 0, done: true });
      expect([...tallies.peek("A")!.out.values()].reduce((a, b) => a + b, 0)).toBe(10);
      expect([...tallies.peek("A")!.in.values()].reduce((a, b) => a + b, 0)).toBe(10);
      expect(tallies.peek("A")!.top[0]).toMatchObject({ id: "A:hub", links: 20 });
    });

    it("21 counted across both directions is one too many: unread, and said so", async () => {
      const file = await open(fan(11, 10));
      const tallies = new Tallies(file);
      await finish(tallies.job("A"));
      expect(tallies.peek("A")!.unread).toBe(1);
    });
  });

  describe("odd text in labels (G-2)", () => {
    it("a long label, a NUL and non-ASCII text come through whole or cut, never break the walk", async () => {
      const file = await open({
        typeProps: { A: '{"name":"text"}', B: '{"name":"text"}' },
        nodes: [
          { type: "A", key: "long", label: "x".repeat(500) },
          { type: "A", key: "nul", label: "a\u0000b" },
          { type: "A", key: "wide", label: "日本語 😀" },
          { type: "B", key: "b" },
        ],
        edgeTypes: [["r", "A", "B"]],
        edges: ["long", "nul", "wide"].map((k) => ({ type: "r", from: `A:${k}`, to: "B:b" })),
      });
      const tallies = new Tallies(file);
      await finish(tallies.job("A"));
      const things = mostLinkedOfType(tallies, "A").things;
      expect(things.map((t) => t.id)).toEqual(["A:long", "A:nul", "A:wide"]);
      expect(things.find((t) => t.id === "A:wide")!.label).toBe("日本語 😀");
      expect(things.find((t) => t.id === "A:long")!.label!.length).toBeLessThanOrEqual(121);
      expect(tallies.peek("A")).toMatchObject({ unread: 0, counted: 3, done: true });
    });
  });
});
