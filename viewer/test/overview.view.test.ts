// The Overview (needs G-9, G-7, G-11): marked Experimental, it draws one shard per
// thing in bands by type, coloured by type; selecting a shard names the thing and opens its
// neighbourhood; a mosaic too big to draw whole draws a stated sample and says so; below 960px the
// same contents come as a list. Rendered on the server from things read through the kit, as the
// page draws them once read; the browser test drives it. Data is invented.
import { type SealedFile } from "@mosaic/kit";
import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import OverviewView from "../src/components/OverviewView.svelte";
import { readOverview, samplePlan, type OverviewData, OverviewStopped, sampleNote, SAMPLE_BUDGET, type Plan } from "../src/lib/graph/overview.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { routeHash, type TableRoute, parseRoute } from "../src/lib/route.js";
import { DEFAULT_VIEW, parseView, Shape, type ViewSettings } from "../src/lib/view.js";
import { VIEWS } from "../src/lib/views.js";
import { keepOverview, keptOverview } from "../src/lib/graph/session.js";

const hrefFor = (id: string) => routeHash({ query: "", node: id });
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });
const now = () => Promise.resolve();

/** 30 items, 6 tags and one hub. */
async function open(): Promise<SealedFile> {
  return openMosaic(
    buildMosaic({
      typeProps: { Hub: '{"name":"text"}', Item: '{"name":"text"}', Tag: '{"name":"text"}' },
      edgeTypes: [],
      nodes: [
        { type: "Hub", key: "h", label: "The hub" },
        ...Array.from({ length: 30 }, (_, i) => ({ type: "Item", key: `i${String(i).padStart(2, "0")}`, label: `Item ${i}` })),
        ...Array.from({ length: 6 }, (_, i) => ({ type: "Tag", key: `t${i}`, label: `Tag ${i}` })),
      ],
      edges: [],
    }),
    "o.mosaic",
  );
}

async function drawn(opts: { view?: ViewSettings; selected?: string; data?: (d: OverviewData) => OverviewData } = {}) {
  const file = await open();
  const read = await readOverview(file, samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count }))), { pause: now });
  const initial = opts.data ? opts.data(read) : read;
  const { body } = render(OverviewView, {
    props: { file, shape: new Shape(opts.view ?? DEFAULT_VIEW, file), hrefFor, tableHref, hoodHref, initial, selected: opts.selected },
  });
  return body;
}

const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("the Overview (G-9)", () => {
  it("is available in the shell's switcher", () => {
    expect(VIEWS.find((v) => v.id === "overview")).toMatchObject({ available: true });
  });

  it("is marked Experimental", async () => {
    expect(text(await drawn())).toContain("Experimental");
  });

  it("draws one shard per thing, each once", async () => {
    const shards = attr(await drawn(), "data-shard");
    expect(shards).toHaveLength(37);
    expect(new Set(shards).size).toBe(37);
    expect(shards).toContain("Hub:h");
  });

  it("is one stop for the keyboard: only one shard is reached by Tab", async () => {
    const tabs = attr(await drawn(), "tabindex").filter((t) => t === "0");
    expect(tabs).toHaveLength(1);
  });

  it("selecting a shard opens its neighbourhood: each shard is a link there, Enter included", async () => {
    const html = await drawn();
    expect(html).toMatch(/<polygon[^>]*role="link"[^>]*data-shard="Tag:t3"/);
    expect(html).not.toContain("aria-pressed");
    expect(attr(html, "aria-label").join(" ")).toContain("Enter opens a thing's neighbourhood");
  });

  it("a shard pointed at is named, with links to its neighbourhood and its page", async () => {
    const html = await drawn({ selected: "Tag:t3" });
    const panel = html.slice(html.indexOf('aria-label="Selection"'));
    expect(text(panel)).toContain("Tag 3");
    expect(text(panel)).toContain("Tag · Tag:t3");
    expect(panel).toContain(`href="${hoodHref("Tag:t3").replaceAll("&", "&amp;")}"`);
    expect(panel).toContain(`href="${hrefFor("Tag:t3")}"`);
    expect(text(panel)).toContain("Open its neighbourhood");
  });

  it("uses the view file's type labels", async () => {
    const view = parseView({
      search: "semantic",
      theme: "auto",
      types: [{ name: "Item", label: "Thing kept", columns: null, page: null, names: {}, describe: null }],
      edges: null,
      export: { types: null },
    });
    const html = await drawn({ view });
    expect(text(html)).toContain("Thing kept · 30");
    expect(attr(html, "aria-label")).toContain("Item 0 (Thing kept)");
  });
});

describe("as a list, for narrow screens (G-11)", () => {
  it("gives each band with its count and its first things, and where to find the rest", async () => {
    const html = await drawn();
    const list = html.slice(html.indexOf('class="list'));
    expect(attr(list, "data-list-band")).toEqual(["Item", "Tag", "Hub"]);
    expect(text(list)).toContain("Item 0");
    expect(text(list)).not.toContain("Item 25");
    // The picture is hidden at that width: the list says what it leaves out, not where to look.
    expect(text(list)).toContain("10 more of the 30 drawn are not listed here.");
    expect(text(list)).not.toContain("picture");
    // Each thing in the list opens its neighbourhood, as a shard does.
    expect(attr(list, "href")).toContain(hoodHref("Item:i00").replaceAll("&", "&amp;"));
    expect(list).toContain(tableHref({ type: "Item", page: 1, order: null, where: [] }));
  });
});

describe("the same picture every time (G-7)", () => {
  it("draws the same markup for the same mosaic", async () => {
    expect(await drawn()).toBe(await drawn());
  });
});

describe("overview: further cases", () => {
  const now = () => Promise.resolve();
  const hrefFor = (id: string) => routeHash({ query: "", node: id });
  const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
  const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });
  const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
  const pad = (i: number, n = 4) => String(i).padStart(n, "0");

  /** Things on the pages a plan reads (the last page of a type may be short). */
  function thingsRead(plan: Plan): number {
    let n = 0;
    for (const t of plan.types) for (const p of t.pages) n += Math.min(20, t.count - 20 * (p - 1));
    return n;
  }

  function many(type: string, n: number, label = (i: number) => `${type} ${i}`): MosaicSpec["nodes"] {
    return Array.from({ length: n }, (_, i) => ({ type, key: `k${pad(i)}`, label: label(i) }));
  }

  async function open(nodes: MosaicSpec["nodes"], types: string[]): Promise<SealedFile> {
    return openMosaic(
      buildMosaic({ typeProps: Object.fromEntries(types.map((t) => [t, '{"name":"text"}'])), edgeTypes: [], nodes, edges: [] }),
      "edges.mosaic",
    );
  }

  async function plan(file: SealedFile, budget?: number): Promise<Plan> {
    return samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count })), budget);
  }

  async function draw(file: SealedFile, data: OverviewData | undefined, extra: { selected?: string; view?: ViewSettings } = {}): Promise<string> {
    return render(OverviewView, {
      props: { file, shape: new Shape(extra.view ?? DEFAULT_VIEW, file), hrefFor, tableHref, hoodHref, initial: data, selected: extra.selected },
    }).body;
  }

  describe("the sample's plan at the budget's edges (G-9)", () => {
    it("plans nothing, and draws whole, for a mosaic with no things", () => {
      expect(samplePlan([])).toEqual({ whole: true, types: [] });
      expect(samplePlan([{ name: "A", count: 0 }])).toEqual({ whole: true, types: [] });
    });

    it("draws whole at exactly the budget and samples one thing past it", () => {
      expect(samplePlan([{ name: "A", count: SAMPLE_BUDGET }]).whole).toBe(true);
      expect(samplePlan([{ name: "A", count: SAMPLE_BUDGET + 1 }]).whole).toBe(false);
      expect(samplePlan([{ name: "A", count: 100 }], 100).whole).toBe(true);
      expect(samplePlan([{ name: "A", count: 101 }], 100).whole).toBe(false);
    });

    it("keeps the budget it is given: a sample reads no more things than that", () => {
      const p = samplePlan([{ name: "A", count: 5000 }, { name: "B", count: 5000 }], 200);
      expect(p.whole).toBe(false);
      expect(thingsRead(p)).toBeLessThanOrEqual(200);
      expect(thingsRead(p)).toBeGreaterThan(0);
    });

    it("splits a type into pages of 20: 20 things are one page, 21 are two", () => {
      const p = samplePlan([{ name: "A", count: 20 }, { name: "B", count: 21 }, { name: "C", count: 1 }]);
      expect(p.types.map((t) => [t.type, t.totalPages, t.pages])).toEqual([["A", 1, [1]], ["B", 2, [1, 2]], ["C", 1, [1]]]);
    });

    it("only reads pages a type has, each once, in increasing order, whatever the counts", () => {
      for (const total of [1501, 1700, 3999, 12_345, 1_000_000]) {
        for (const split of [[1], [3, 1], [1, 1, 1], [7, 3], [97, 2, 1]]) {
          const sum = split.reduce((a, b) => a + b, 0);
          const types = split.map((s, i) => ({ name: `T${i}`, count: Math.max(1, Math.floor((total * s) / sum)) }));
          for (const t of samplePlan(types).types) {
            expect(t.pages.length).toBeGreaterThan(0);
            expect(t.pages[0]).toBe(1);
            expect(new Set(t.pages).size).toBe(t.pages.length);
            for (let i = 0; i < t.pages.length; i++) {
              expect(t.pages[i]).toBeGreaterThanOrEqual(1);
              expect(t.pages[i]).toBeLessThanOrEqual(t.totalPages);
              if (i > 0) expect(t.pages[i]!).toBeGreaterThan(t.pages[i - 1]!);
            }
          }
        }
      }
    });

    it("never reads more than the budget when each type fits a page in it", () => {
      for (const types of [
        [{ name: "A", count: 1_000_000 }],
        [{ name: "P", count: 40_948 }, { name: "T", count: 8_807 }, { name: "C", count: 122 }],
        Array.from({ length: 30 }, (_, i) => ({ name: `T${pad(i)}`, count: 100 + i * 211 })),
      ]) {
        expect(thingsRead(samplePlan(types))).toBeLessThanOrEqual(SAMPLE_BUDGET);
      }
    });

    it("a bigger type gets at least as many pages as a smaller one", () => {
      const p = samplePlan([{ name: "Big", count: 30_000 }, { name: "Mid", count: 6_000 }, { name: "Small", count: 900 }]);
      const pages = (n: string) => p.types.find((t) => t.type === n)!.pages.length;
      expect(pages("Big")).toBeGreaterThanOrEqual(pages("Mid"));
      expect(pages("Mid")).toBeGreaterThanOrEqual(pages("Small"));
    });

    it("does not change what it is given", () => {
      const types = Object.freeze([Object.freeze({ name: "B", count: 5000 }), Object.freeze({ name: "A", count: 9000 })]);
      expect(() => samplePlan(types)).not.toThrow();
    });

    it("orders types by UTF-8 bytes, not by UTF-16 units", () => {
      // U+FF5A sorts below U+1F600 by bytes, above it by UTF-16 units.
      const p = samplePlan([{ name: "\u{1F600}", count: 1 }, { name: "\uFF5A", count: 1 }]);
      expect(p.types.map((t) => t.type)).toEqual(["\uFF5A", "\u{1F600}"]);
    });

    it("stays a sample that is smaller than the mosaic, within the budget, with very many small types", () => {
      // 200 types of 20 things: 4,000 things, too many to draw whole. One page each is all of each
      // type, so a "sample" would be the whole mosaic, over the budget (G-9, G-10).
      const types = Array.from({ length: 200 }, (_, i) => ({ name: `T${pad(i)}`, count: 20 }));
      const p = samplePlan(types);
      expect(p.whole).toBe(false);
      expect(thingsRead(p)).toBeLessThanOrEqual(SAMPLE_BUDGET);
    });
  });

  describe("what the overview says of its sample (G-9)", () => {
    const band = (type: string, count: number, shown: number) => ({ type, count, things: Array.from({ length: shown }, (_, i) => ({ id: `${type}:${i}`, label: null })) });

    it("says it with thousands separators, however big the mosaic", () => {
      const note = sampleNote({ whole: false, bands: [band("A", 12_345_678, 1500)] });
      expect(note).toContain("1,500 of 12,345,678 things");
    });

    it("says nothing of a sample when every thing was read, whatever the counts", () => {
      expect(sampleNote({ whole: true, bands: [] })).toBeNull();
      expect(sampleNote({ whole: true, bands: [band("A", 5, 5), band("B", 2000, 2000)] })).toBeNull();
    });

    it("states a sample of an empty read without failing", () => {
      expect(sampleNote({ whole: false, bands: [] })).toContain("0 of 0");
    });
  });

  describe("reading the things through the kit (G-9, G-10)", () => {
    it("reads nothing, and tells nothing, from a mosaic with no things", async () => {
      const file = await open([], ["Item"]);
      const told: number[] = [];
      const data = await readOverview(file, await plan(file), { onPage: (n) => told.push(n), pause: now });
      expect(data).toEqual({ whole: true, bands: [] });
      expect(told).toEqual([]);
    });

    it("tells how many pages of how many it has read", async () => {
      const file = await open([...many("A", 45), ...many("B", 1)], ["A", "B"]);
      const told: [number, number][] = [];
      await readOverview(file, await plan(file), { onPage: (n, total) => told.push([n, total]), pause: now });
      expect(told).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    });

    it("gives way to the page between pages", async () => {
      const file = await open(many("A", 45), ["A"]);
      const pause = vi.fn(now);
      await readOverview(file, await plan(file), { pause });
      expect(pause.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it("reads exactly the pages of a sample, in id order, and keeps the type's whole count", async () => {
      const file = await open(many("A", 1700), ["A"]);
      const p = await plan(file);
      expect(p.whole).toBe(false);
      const data = await readOverview(file, p, { pause: now });
      expect(data.whole).toBe(false);
      const band = data.bands[0]!;
      expect(band.count).toBe(1700);
      const expected = p.types[0]!.pages.flatMap((page) =>
        Array.from({ length: Math.min(20, 1700 - 20 * (page - 1)) }, (_, i) => `A:k${pad(20 * (page - 1) + i)}`),
      );
      expect(band.things.map((t) => t.id)).toEqual(expected);
      expect(band.things.length).toBeLessThan(1700);
      expect(band.things.length).toBeLessThanOrEqual(SAMPLE_BUDGET);
      expect(sampleNote(data)).toContain(`${band.things.length.toLocaleString("en-US")} of 1,700 things`);
    });

    it("reads the same sample every time (G-7)", async () => {
      const file = await open([...many("A", 1700), ...many("B", 333)], ["A", "B"]);
      const first = await readOverview(file, await plan(file), { pause: now });
      const second = await readOverview(file, await plan(file), { pause: now });
      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it("lists a band's things by id in UTF-8 byte order, not UTF-16", async () => {
      const file = await open(
        [{ type: "A", key: "\u{1F600}", label: "astral" }, { type: "A", key: "\uFF5A", label: "wide" }, { type: "A", key: "a", label: "ascii" }],
        ["A"],
      );
      const data = await readOverview(file, await plan(file), { pause: now });
      expect(data.bands[0]!.things.map((t) => t.id)).toEqual(["A:a", "A:\uFF5A", "A:\u{1F600}"]);
    });

    it("keeps a thing without a name as null, a name of 120 characters whole, and a far longer one cut", async () => {
      // Text from the file is length-limited by the kit, labels to 120 characters, cut with a marker (section 8.2).
      const long = "x".repeat(120);
      const file = await open(
        [{ type: "A", key: "a", label: null }, { type: "A", key: "b", label: long }, { type: "A", key: "c", label: "tab\there" }],
        ["A"],
      );
      const data = await readOverview(file, await plan(file), { pause: now });
      const things = data.bands[0]!.things;
      expect(things[0]).toEqual({ id: "A:a", label: null });
      expect(things[1]!.label).toBe(long);
      const longer = await readOverview(await open([{ type: "A", key: "a", label: "y".repeat(100_000) }], ["A"]), { whole: true, types: [{ type: "A", count: 1, pages: [1], totalPages: 1 }] }, { pause: now });
      expect(longer.bands[0]!.things[0]!.label!.length).toBeLessThan(200);
      expect(longer.bands[0]!.things[0]!.label!.startsWith("y".repeat(100))).toBe(true);
      expect(things[2]!.label).toBe("tab\there");
    });

    it("stops before reading anything when already asked to", async () => {
      const table = vi.fn();
      const stop = new AbortController();
      stop.abort();
      const p: Plan = { whole: true, types: [{ type: "A", count: 3, pages: [1], totalPages: 1 }] };
      await expect(readOverview({ table } as never, p, { signal: stop.signal, pause: now })).rejects.toBeInstanceOf(OverviewStopped);
      expect(table).not.toHaveBeenCalled();
    });

    it("stops between pages, and does not read the next one", async () => {
      const stop = new AbortController();
      const table = vi.fn(async () => ({ data: { rows: [["A:1", "one"]] } }));
      const p: Plan = { whole: true, types: [{ type: "A", count: 60, pages: [1, 2, 3], totalPages: 3 }] };
      const read = readOverview({ table } as never, p, { signal: stop.signal, onPage: (n) => n === 1 && stop.abort(), pause: now });
      await expect(read).rejects.toBeInstanceOf(OverviewStopped);
      expect(table).toHaveBeenCalledTimes(1);
    });

    it("names the type and page when the kit answers with an error", async () => {
      let calls = 0;
      const table = vi.fn(async () => (++calls === 2 ? { error: { message: "nope" } } : { data: { rows: [["A:1", "one"]] } }));
      const p: Plan = { whole: true, types: [{ type: "Wö", count: 60, pages: [1, 2, 3], totalPages: 3 }] };
      const failure = await readOverview({ table } as never, p, { pause: now }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(OverviewStopped);
      expect(failure!.message).toContain("Wö");
      expect(failure!.message).toContain("2");
      expect(failure!.message).toContain("nope");
    });
  });

  describe("the page keeps what it read for the session (G-10)", () => {
    const data: OverviewData = { whole: true, bands: [{ type: "A", count: 1, things: [{ id: "A:a", label: "Kept" }] }] };

    it("returns nothing for a file it has not kept, and what was kept for that file only", async () => {
      const one = await open(many("A", 2), ["A"]);
      const other = await open(many("A", 2), ["A"]);
      expect(keptOverview(one)).toBeUndefined();
      keepOverview(one, data);
      expect(keptOverview(one)).toBe(data);
      expect(keptOverview(other)).toBeUndefined();
    });

    it("draws the kept overview at once, without reading again", async () => {
      const file = await open(many("A", 2), ["A"]);
      keepOverview(file, data);
      const html = await draw(file, undefined);
      expect(attr(html, "data-shard")).toEqual(["A:a"]);
      expect(text(html)).not.toContain("Reading the things");
    });
  });

  describe("the overview of unusual mosaics (G-9)", () => {
    it("draws a mosaic with no things without failing, still marked Experimental, with no shard", async () => {
      const file = await open([], ["Item"]);
      const html = await draw(file, { whole: true, bands: [] });
      expect(text(html)).toContain("Experimental");
      expect(attr(html, "data-shard")).toEqual([]);
      expect(attr(html, "tabindex").filter((t) => t === "0")).toEqual([]);
    });

    it("draws a single thing as one shard in one band, reachable by Tab", async () => {
      const file = await open([{ type: "Solo", key: "only", label: "The only one" }], ["Solo"]);
      const html = await draw(file, await readOverview(file, await plan(file), { pause: now }));
      expect(attr(html, "data-shard")).toEqual(["Solo:only"]);
      expect(attr(html, "data-band")).toEqual(["Solo"]);
      expect(attr(html, "tabindex").filter((t) => t === "0")).toHaveLength(1);
    });

    it("orders bands of equal size by type name in UTF-8 bytes", async () => {
      const file = await open(
        [
          { type: "Tb", key: "1", label: "lower" },
          { type: "TB", key: "1", label: "upper" },
          { type: "T9", key: "1", label: "digit" },
          { type: "Ta", key: "1", label: "a" },
        ],
        ["Tb", "TB", "T9", "Ta"],
      );
      const html = await draw(file, await readOverview(file, await plan(file), { pause: now }));
      expect(attr(html, "data-band")).toEqual(["T9", "TB", "Ta", "Tb"]);
    });

    it("does not draw a band for a type with no things", async () => {
      const file = await open(many("Full", 3), ["Full", "Empty"]);
      const html = await draw(file, await readOverview(file, await plan(file), { pause: now }));
      expect(attr(html, "data-band")).toEqual(["Full"]);
    });

    it("draws the real sample of a mosaic too big to draw whole: stated, bounded, one shard per thing read", async () => {
      const file = await open([...many("A", 1700), ...many("B", 40)], ["A", "B"]);
      const data = await readOverview(file, await plan(file), { pause: now });
      expect(data.whole).toBe(false);
      const html = await draw(file, data);
      const shown = data.bands.reduce((s, b) => s + b.things.length, 0);
      expect(shown).toBeLessThan(1740);
      expect(shown).toBeLessThanOrEqual(SAMPLE_BUDGET + 20);
      const shards = attr(html, "data-shard");
      expect(shards).toHaveLength(shown);
      expect(new Set(shards).size).toBe(shown);
      expect(text(html)).toContain(`A sample: ${shown.toLocaleString("en-US")} of 1,740 things`);
      expect(text(html)).toContain("Experimental");
      expect(text(html)).toContain("A · " + data.bands[0]!.things.length.toLocaleString("en-US") + " of 1,700");
    });

    it("draws a thousand and more shards in reasonable time, the same markup twice", async () => {
      const file = await open(many("A", 1500), ["A"]);
      const data = await readOverview(file, await plan(file), { pause: now });
      expect(data.whole).toBe(true);
      const t0 = performance.now();
      const html = await draw(file, data);
      expect(performance.now() - t0).toBeLessThan(5000);
      expect(attr(html, "data-shard")).toHaveLength(1500);
      expect(await draw(file, data)).toBe(html);
    });
  });

  describe("text in the things is escaped (G-9, principle 9 of untrusted files)", () => {
    const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;

    it("shows a name with markup as text, in the picture, the list and the selection", async () => {
      const file = await open([{ type: "A", key: "a", label: evil }, { type: "A", key: "b", label: "plain" }], ["A"]);
      const data = await readOverview(file, await plan(file), { pause: now });
      const html = await draw(file, data, { selected: "A:a" });
      expect(html).not.toContain("<script");
      expect(html).not.toMatch(/<img[^>]*onerror/);
      expect(text(html)).toContain("alert(1)");
      // The accessible name is one attribute: the markup did not close it.
      expect(attr(html, "aria-label").some((a) => a.includes("&lt;script"))).toBe(true);
    });

    it("escapes a type's name and a view file's label for it", async () => {
      const file = await open([{ type: "A", key: "a", label: "x" }], ["A"]);
      const view = parseView({
        search: "semantic",
        theme: "auto",
        types: [{ name: "A", label: `<b onmouseover="x">Bold</b>`, columns: null, page: null, names: {}, describe: null }],
        edges: null,
        export: { types: null },
      });
      const html = await draw(file, await readOverview(file, await plan(file), { pause: now }), { view });
      expect(html).not.toContain("<b onmouseover");
      expect(text(html)).toContain("Bold");
    });

    it("keeps an id with markup and spaces in the address, encoded, and in data-shard, escaped", async () => {
      const file = await open([{ type: "A", key: `a&"<b> c`, label: "odd" }], ["A"]);
      const html = await draw(file, await readOverview(file, await plan(file), { pause: now }), { selected: `A:a&"<b> c` });
      expect(html).not.toContain('data-shard="A:a&"');
      expect(html).not.toContain("<b>");
      const panel = html.slice(html.indexOf('aria-label="Selection"'));
      expect(panel).not.toContain(`href="#node=A:a&"`);
      expect(panel).toContain(encodeURIComponent(`A:a&"<b> c`).slice(0, 12));
    });
  });

  describe("selecting (G-9)", () => {
    it("names a thing without a name by its id, and still opens its neighbourhood", async () => {
      const file = await open([{ type: "A", key: "nameless", label: null }], ["A"]);
      const html = await draw(file, await readOverview(file, await plan(file), { pause: now }), { selected: "A:nameless" });
      const panel = html.slice(html.indexOf('aria-label="Selection"'));
      expect(text(panel)).toContain("A:nameless");
      expect(panel).toContain(`href="${hoodHref("A:nameless").replaceAll("&", "&amp;")}"`);
      expect(attr(html, "aria-label").some((a) => a.includes("A") && a.length > "(A)".length)).toBe(true);
    });

    it("does not fail for a selection the sample did not draw, and does not name a stranger", async () => {
      const file = await open(many("A", 3), ["A"]);
      const data = await readOverview(file, await plan(file), { pause: now });
      const html = await draw(file, data, { selected: "A:not-there" });
      expect(attr(html, "data-shard")).toHaveLength(3);
      expect(text(html)).not.toContain("A 0 (A)A 1");
    });

    it("marks the selected shard in the picture, not only in the panel", async () => {
      const file = await open(many("A", 3), ["A"]);
      const data = await readOverview(file, await plan(file), { pause: now });
      const shardTag = (html: string, id: string) => html.match(new RegExp(`<[^>]*data-shard="${id}"[^>]*>`))![0];
      const plain = await draw(file, data);
      const chosen = await draw(file, data, { selected: "A:k0001" });
      expect(shardTag(chosen, "A:k0001")).not.toBe(shardTag(plain, "A:k0001"));
      expect(shardTag(chosen, "A:k0000")).toBe(shardTag(plain, "A:k0000"));
    });
  });

  describe("as a list, for narrow screens (G-11)", () => {
    it("lists every thing of a band of exactly the list's length and does not offer more", async () => {
      const file = await open(many("A", 20), ["A"]);
      const html = await draw(file, await readOverview(file, await plan(file), { pause: now }));
      const list = html.slice(html.indexOf('class="list'));
      expect(text(list)).toContain("A 19");
      expect(text(list)).not.toMatch(/\bAnd \d+ more\b/);
    });
  });
});

describe("overview: further cases", () => {
  const now = () => Promise.resolve();
  const hrefFor = (id: string) => routeHash({ query: "", node: id });
  const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
  const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });
  const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
  const pad = (i: number, n = 4) => String(i).padStart(n, "0");
  const PAGES = SAMPLE_BUDGET / 20;

  function thingsRead(plan: Plan): number {
    let n = 0;
    for (const t of plan.types) for (const p of t.pages) n += Math.min(20, t.count - 20 * (p - 1));
    return n;
  }
  const pagesRead = (plan: Plan) => plan.types.reduce((s, t) => s + t.pages.length, 0);
  const typesOf = (counts: number[]) => counts.map((count, i) => ({ name: `T${pad(i, 3)}`, count }));

  async function open(nodes: MosaicSpec["nodes"], types: string[]): Promise<SealedFile> {
    return openMosaic(
      buildMosaic({ typeProps: Object.fromEntries(types.map((t) => [t, '{"name":"text"}'])), edgeTypes: [], nodes, edges: [] }),
      "cases.mosaic",
    );
  }
  const many = (type: string, n: number): MosaicSpec["nodes"] => Array.from({ length: n }, (_, i) => ({ type, key: `k${pad(i)}`, label: `${type} ${i}` }));

  async function draw(file: SealedFile, data: OverviewData | undefined, extra: { selected?: string; view?: ViewSettings } = {}): Promise<string> {
    return render(OverviewView, {
      props: { file, shape: new Shape(extra.view ?? DEFAULT_VIEW, file), hrefFor, tableHref, hoodHref, initial: data, selected: extra.selected },
    }).body;
  }
  const bandOf = (type: string, count: number, shown: number) => ({
    type,
    count,
    things: Array.from({ length: shown }, (_, i) => ({ id: `${type}:${pad(i)}`, label: `${type} ${i}` })),
  });

  /** A small deterministic generator, so a property test is the same on every run. */
  function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  describe("a page for each type, the largest first, while the budget's pages last (G-9, G-10)", () => {
    it("gives every type exactly one page when there are exactly as many types as pages", () => {
      const plan = samplePlan(typesOf(Array(PAGES).fill(21)));
      expect(plan.whole).toBe(false);
      expect(plan.types).toHaveLength(PAGES);
      expect(plan.types.every((t) => t.pages.length === 1 && t.pages[0] === 1)).toBe(true);
    });

    it("leaves out exactly one type when there is one type more than pages: the last of the equals, by name", () => {
      const plan = samplePlan(typesOf(Array(PAGES + 1).fill(21)));
      const none = plan.types.filter((t) => t.pages.length === 0).map((t) => t.type);
      expect(none).toEqual([`T${pad(PAGES, 3)}`]);
      expect(pagesRead(plan)).toBe(PAGES);
    });

    it("leaves out the smallest type, not the last by name", () => {
      // "A" sorts first and has one thing; 75 types of 20 fill every page of the budget.
      const plan = samplePlan([{ name: "A", count: 1 }, ...Array.from({ length: PAGES }, (_, i) => ({ name: `T${pad(i, 3)}`, count: 20 }))]);
      expect(plan.types.find((t) => t.type === "A")!.pages).toEqual([]);
      expect(plan.types.filter((t) => t.pages.length === 0)).toHaveLength(1);
    });

    it("breaks a tie between equal types by UTF-8 bytes, whatever order the types come in", () => {
      // Budget of one page, two types of 20: U+FF5A sorts below U+1F600 by bytes, above it by UTF-16 units.
      const a = { name: "\u{1F600}", count: 20 };
      const b = { name: "ｚ", count: 20 };
      for (const input of [[a, b], [b, a]]) {
        const plan = samplePlan(input, 20);
        expect(plan.whole).toBe(false);
        expect(plan.types.find((t) => t.type === "ｚ")!.pages).toEqual([1]);
        expect(plan.types.find((t) => t.type === "\u{1F600}")!.pages).toEqual([]);
      }
    });

    it("reads nothing, and does not fail, when the budget is less than one page", () => {
      const plan = samplePlan([{ name: "A", count: 100 }], 19);
      expect(plan.whole).toBe(false);
      expect(thingsRead(plan)).toBe(0);
      expect(plan.types.every((t) => t.pages.length === 0)).toBe(true);
    });

    it("reads one page of one type when the budget is one page", () => {
      const plan = samplePlan([{ name: "A", count: 20 }, { name: "B", count: 25 }], 20);
      expect(plan.types.find((t) => t.type === "B")!.pages).toEqual([1]);
      expect(plan.types.find((t) => t.type === "A")!.pages).toEqual([]);
    });

    it("draws whole, every type with a page, when the things fit the budget though the types outnumber its pages", () => {
      // 200 types of 7 things are 1,400 things: within the budget, so no sample and no type left out.
      const plan = samplePlan(typesOf(Array(200).fill(7)));
      expect(plan.whole).toBe(true);
      expect(plan.types).toHaveLength(200);
      expect(plan.types.every((t) => t.pages.length === 1)).toBe(true);
    });

    it("a type of one thing is a band to see, with the first page of a bigger one beside it", () => {
      const plan = samplePlan([{ name: "Big", count: 10_000 }, { name: "One", count: 1 }]);
      expect(plan.types.find((t) => t.type === "One")).toEqual({ type: "One", count: 1, pages: [1], totalPages: 1 });
      expect(plan.types.find((t) => t.type === "Big")!.pages[0]).toBe(1);
    });

    it("keeps the same plan whatever order the types come in (property, 300 random mosaics)", () => {
      const next = random(7);
      for (let n = 0; n < 300; n++) {
        const k = 1 + Math.floor(next() * 120);
        const counts = Array.from({ length: k }, () => (next() < 0.3 ? 1 + Math.floor(next() * 25) : 1 + Math.floor(next() ** 3 * 60_000)));
        const types = typesOf(counts);
        const shuffled = [...types].sort(() => next() - 0.5);
        expect(samplePlan(shuffled)).toEqual(samplePlan(types));
      }
    });

    it("holds its promises over random mosaics: budget, pages, left out only for want of pages, largest first, in proportion", () => {
      const next = random(11);
      for (let n = 0; n < 400; n++) {
        const k = 1 + Math.floor(next() * 140);
        const counts = Array.from({ length: k }, () => (next() < 0.5 ? 1 + Math.floor(next() * 30) : 1 + Math.floor(next() ** 4 * 80_000)));
        const plan = samplePlan(typesOf(counts));
        const total = counts.reduce((a, b) => a + b, 0);
        expect(plan.whole).toBe(total <= SAMPLE_BUDGET);
        for (const t of plan.types) {
          expect(t.totalPages).toBe(Math.ceil(t.count / 20));
          expect(new Set(t.pages).size).toBe(t.pages.length);
          for (let i = 1; i < t.pages.length; i++) expect(t.pages[i]!).toBeGreaterThan(t.pages[i - 1]!);
          for (const p of t.pages) {
            expect(p).toBeGreaterThanOrEqual(1);
            expect(p).toBeLessThanOrEqual(t.totalPages);
          }
          if (t.pages.length > 1) {
            const gaps = t.pages.slice(1).map((p, i) => p - t.pages[i]!);
            if (t.pages.length < t.totalPages) expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
          }
        }
        if (plan.whole) {
          expect(plan.types.every((t) => t.pages.length === t.totalPages)).toBe(true);
          continue;
        }
        expect(pagesRead(plan)).toBeLessThanOrEqual(PAGES);
        if (k <= PAGES) {
          // No more types than pages: nobody is left out.
          expect(plan.types.every((t) => t.pages.length >= 1)).toBe(true);
        } else {
          // More types than pages: the types left out are never larger than a type with a page.
          const out = plan.types.filter((t) => t.pages.length === 0);
          const read = plan.types.filter((t) => t.pages.length > 0);
          expect(out).toHaveLength(k - PAGES);
          for (const o of out) for (const r of read) expect(o.count).toBeLessThanOrEqual(r.count);
        }
        // Bigger types never get fewer pages than smaller ones, unless the smaller one is left out.
        const read = plan.types.filter((t) => t.pages.length > 0).sort((a, b) => a.count - b.count);
        for (let i = 1; i < read.length; i++) expect(read[i]!.pages.length).toBeGreaterThanOrEqual(read[i - 1]!.pages.length);
      }
    });
  });

  describe("the note counts the types left out (G-9)", () => {
    const shown = (n: number) => `A sample: ${n.toLocaleString("en-US")}`;

    it("says nothing of types left out when every type has a page in the sample", () => {
      expect(sampleNote({ whole: false, bands: [bandOf("A", 40, 20), bandOf("B", 20, 20)] })).not.toMatch(/no page/);
    });

    it("says 1 smaller type, not 1 smaller types, then 2, and counts thousands", () => {
      const left = (n: number) => Array.from({ length: n }, (_, i) => bandOf(`Z${pad(i)}`, 20, 0));
      expect(sampleNote({ whole: false, bands: [bandOf("A", 40, 20), ...left(1)] })).toMatch(/\b1 smaller type has no page in it/);
      expect(sampleNote({ whole: false, bands: [bandOf("A", 40, 20), ...left(1)] })).not.toMatch(/1 smaller types/);
      expect(sampleNote({ whole: false, bands: [bandOf("A", 40, 20), ...left(2)] })).toMatch(/\b2 smaller types have no page in it/);
      expect(sampleNote({ whole: false, bands: [bandOf("A", 40, 20), ...left(1234)] })).toMatch(/\b1,234 smaller types have no page in it/);
    });

    it("still counts the things of a type left out in the total", () => {
      const note = sampleNote({ whole: false, bands: [bandOf("A", 40, 20), bandOf("B", 25, 0)] })!;
      expect(note).toContain(`${shown(20)} of 65 things`);
    });

    it("is the note of the real sample: 80 types, 75 pages, 5 left out, none of them drawn", async () => {
      const types = Array.from({ length: 80 }, (_, i) => `T${pad(i, 2)}`);
      const nodes = types.flatMap((t, ti) => many(t, ti < 5 ? 21 : 20));
      const file = await open(nodes, types);
      const plan = samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count })));
      expect(plan.whole).toBe(false);
      const data = await readOverview(file, plan, { pause: now });
      const html = await draw(file, data);
      expect(attr(html, "data-shard")).toHaveLength(1500);
      expect(text(html)).toContain("A sample: 1,500 of 1,605 things.");
      expect(text(html)).toContain("5 smaller types have no page in it");
      // A type with nothing drawn has no band, no legend entry and no list heading, and no empty swatch.
      expect(attr(html, "data-band")).toHaveLength(75);
      expect(attr(html, "data-list-band")).toHaveLength(75);
      for (const left of ["T75", "T76", "T77", "T78", "T79"]) expect(attr(html, "data-band")).not.toContain(left);
    });
  });

  describe("what the picture says, and the list leaves out (G-9, G-10, G-11)", () => {
    const pictureName = (html: string) => attr(html, "aria-label").find((a) => /thing/.test(a) && !/\(/.test(a.split(".")[0]!))!;

    it("lists the first 20 things of a band, by id, never the 21st", async () => {
      const file = await open(many("A", 3), ["A"]);
      const html = await draw(file, { whole: true, bands: [bandOf("A", 21, 21)] });
      const list = html.slice(html.indexOf('class="list'));
      const ids = attr(list, "href").filter((h) => h.includes("v=neighbourhood"));
      expect(ids).toHaveLength(20);
      expect(ids).toContain(hoodHref("A:0019").replaceAll("&", "&amp;"));
      expect(ids).not.toContain(hoodHref("A:0020").replaceAll("&", "&amp;"));
    });
  });

  describe("a shard opens its neighbourhood (G-9)", () => {
    it("makes every shard a link, with no pressed state, in the keyboard's one stop, whatever the sample", async () => {
      const file = await open(many("A", 5), ["A"]);
      const html = await draw(file, { whole: false, bands: [bandOf("A", 99_999, 5)] });
      const shards = [...html.matchAll(/<polygon[^>]*data-shard="[^"]*"[^>]*>/g)].map((m) => m[0]);
      expect(shards).toHaveLength(5);
      for (const s of shards) expect(s).toContain('role="link"');
      expect(html).not.toContain("aria-pressed");
      expect(shards.filter((s) => s.includes('tabindex="0"'))).toHaveLength(1);
      expect(shards.filter((s) => s.includes('tabindex="-1"'))).toHaveLength(4);
    });

    it("opens a neighbourhood at the thing chosen, whatever characters its id holds", async () => {
      const keys = ["a b", "a&b=c", "a#b", "100%", "a/b?c", "é\u{1F600}", "x;y,z", "a+b", "'\"<>"];
      const file = await open(keys.map((key) => ({ type: "A", key, label: `n ${key}` })), ["A"]);
      const data = await readOverview(file, samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count }))), { pause: now });
      for (const key of keys) {
        const html = await draw(file, data, { selected: `A:${key}` });
        const panel = html.slice(html.indexOf('aria-label="Selection"'));
        const hrefs = attr(panel, "href").map((h) => h.replaceAll("&amp;", "&"));
        const hood = hrefs.find((h) => h.includes("v=neighbourhood"))!;
        expect(hood).toBe(hoodHref(`A:${key}`));
        expect(parseRoute(hood).node).toBe(`A:${key}`);
        expect(parseRoute(hood).view).toBe("neighbourhood");
        // Its page opens the thing's card, not a neighbourhood.
        expect(hrefs).toContain(hrefFor(`A:${key}`));
        // And the list opens the same neighbourhood.
        const list = html.slice(html.indexOf('class="list'));
        expect(attr(list, "href").map((h) => h.replaceAll("&amp;", "&"))).toContain(hoodHref(`A:${key}`));
      }
    });

    it("names the thing pointed at, with the label its type's name gives it, never another thing's", async () => {
      const file = await open([...many("A", 2), ...many("B", 2)], ["A", "B"]);
      const data = await readOverview(file, samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count }))), { pause: now });
      const html = await draw(file, data, { selected: "B:k0001" });
      const panel = text(html.slice(html.indexOf('aria-label="Selection"')));
      expect(panel).toContain("B 1");
      expect(panel).toContain("B · B:k0001");
      expect(panel).not.toContain("A 1");
      expect(panel).not.toContain("B 0");
    });

    it("names a selected thing the sample did not draw by its id, not as another or as an error", async () => {
      // A link into the overview (#v=overview&node=…) may name a thing the sample left out.
      const file = await open(many("A", 3), ["A"]);
      const data = await readOverview(file, samplePlan(file.nodeTypes.map((t) => ({ name: t.name, count: t.count }))), { pause: now });
      const html = await draw(file, data, { selected: "A:not-drawn" });
      expect(text(html)).not.toMatch(/undefined|null|NaN|\[object/);
      expect(attr(html, "data-shard")).not.toContain("A:not-drawn");
    });
  });
});
