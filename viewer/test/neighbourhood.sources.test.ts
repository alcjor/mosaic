// Sources in the graph (needs G-6, V-7): every link drawn keeps its source. Selecting
// a thing in the neighbourhood shows its type's card, the same card its page and a chain show
//, and where it comes from; selecting a link shows its source through `cite`. Rendered on
// the server from a neighbourhood and sources read through the kit, as the page draws them once
// read; the browser test selects by keyboard and pointer. Data is invented.
import { type SealedFile } from "@mosaic/kit";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import EntityCard from "../src/components/EntityCard.svelte";
import NeighbourhoodView from "../src/components/NeighbourhoodView.svelte";
import { HoodLoader, hoodOf } from "../src/lib/graph/hood.js";
import { Sources, type LinkRef } from "../src/lib/graph/sources.js";
import { openMosaic } from "../src/lib/mosaic.js";
import { routeHash, type TableRoute } from "../src/lib/route.js";
import { DEFAULT_VIEW, parseView, Shape, type ViewSettings } from "../src/lib/view.js";

/** A hub that carries three tags (one twice, by two qualifiers), each from its own rows. */
function spec(): MosaicSpec {
  return {
    typeProps: { Hub: '{"name":"text","size":"integer"}', Tag: '{"name":"text"}' },
    edgeTypes: [["carries", "Hub", "Tag"]],
    nodes: [
      { type: "Hub", key: "h", label: "The hub", summary: "A hub of tags.", props: '{"size":3}', evidence: [{ locator: "row=1", snippet: "h,The hub,3" }] },
      { type: "Tag", key: "t0", label: "Tag zero", evidence: [{ locator: "row=7", snippet: "t0,Tag zero" }, { locator: "row=8", snippet: "t0 again" }] },
      { type: "Tag", key: "t1", label: "Tag one", evidence: [{ locator: "row=9" }] },
      { type: "Tag", key: "t2", label: "Tag two", evidence: [{ locator: "row=10" }] },
    ],
    edges: [
      { type: "carries", from: "Hub:h", to: "Tag:t0", qualifier: "a", evidence: [{ locator: "link=1", snippet: "h carries t0 (a)" }] },
      { type: "carries", from: "Hub:h", to: "Tag:t0", qualifier: "b", evidence: [{ locator: "link=2", snippet: "h carries t0 (b)" }] },
      { type: "carries", from: "Hub:h", to: "Tag:t1", evidence: [{ locator: "link=3" }] },
      { type: "carries", from: "Hub:h", to: "Tag:t2", evidence: [{ locator: "link=4" }] },
    ],
  };
}

const hrefFor = (id: string) => routeHash({ query: "", node: id });
const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });
const T0: LinkRef = { from: "Hub:h", edge: "carries", to: "Tag:t0" };

function viewWith(json: Record<string, unknown>): ViewSettings {
  return parseView({ search: "semantic", theme: "auto", types: null, export: { types: null }, cards: null, ...json });
}

async function drawn(opts: { file?: SealedFile; view?: ViewSettings; selected?: string; link?: LinkRef; read?: (s: Sources) => Promise<unknown> } = {}) {
  const file = opts.file ?? (await openMosaic(buildMosaic(spec()), "hub.mosaic"));
  const shape = new Shape(opts.view ?? DEFAULT_VIEW, file);
  const initial = await new HoodLoader(file).load(hoodOf("Hub:h"));
  const sources = new Sources(file, shape);
  await opts.read?.(sources);
  const { body } = render(NeighbourhoodView, {
    props: { file, shape, centre: "Hub:h", hrefFor, tableHref, hoodHref, initial, selected: opts.selected, selectedLink: opts.link, sources },
  });
  return { body, file, shape, sources, panel: body.slice(body.indexOf('aria-label="Selection"')) };
}

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
/** Markup without Svelte's hydration marks, which differ by where a component is placed. */
const bare = (html: string) => html.replace(/<!--[^>]*-->/g, "");

describe("selecting a thing (G-6, V-7)", () => {
  it("shows its type's card: the same card, with the same facts, as its page shows", async () => {
    const { panel, sources, shape } = await drawn({ selected: "Tag:t0", read: (s) => s.card("Tag:t0") });
    const card = (await sources.card("Tag:t0"))!;
    expect("page" in card).toBe(true);
    if (!("page" in card)) return;
    const alone = render(EntityCard, { props: { node: card.page.node, shape, facts: card.facts, hrefFor } }).body;
    expect(bare(panel)).toContain(bare(alone).trim());
  });

  it("shows a card set for the type in the view file, as every thing of the type shows it", async () => {
    const view = viewWith({ cards: [{ name: "Hub", show: ["summary", "size"], links: ["carries"], counts: [] }] });
    const { panel } = await drawn({ view, selected: "Hub:h", read: (s) => s.card("Hub:h") });
    const card = text(panel.slice(panel.indexOf("<article")));
    expect(card).toContain("A hub of tags.");
    expect(card).toContain("size");
    // The linked things the card lists, each with the rows of its link.
    expect(card).toContain("Tag zero");
    expect(attr(panel, "data-fact")).toContain("links:carries out");
  });

  it("keeps the thing's choices above its card", async () => {
    const { panel } = await drawn({ selected: "Tag:t0", read: (s) => s.card("Tag:t0") });
    expect(panel.indexOf('data-action="expand"')).toBeGreaterThan(-1);
    expect(panel.indexOf('data-action="expand"')).toBeLessThan(panel.indexOf("<article"));
  });

  it("lists the thing's links in the picture, each a button that selects the link", async () => {
    const { panel } = await drawn({ selected: "Tag:t0", read: (s) => s.card("Tag:t0") });
    const links = panel.slice(panel.indexOf("Its links in the picture"));
    expect(attr(links, "data-select-link")).toEqual([JSON.stringify(["Hub:h", "carries", "Tag:t0"]).replaceAll('"', "&quot;")]);
    expect(text(links)).toContain("The hub carries Tag zero");
  });
});

describe("selecting a link (G-6)", () => {
  it("draws each link as something the pointer can select, and marks the one selected", async () => {
    const { body } = await drawn({ link: T0, read: (s) => s.link(T0) });
    const keys = attr(body, "data-link");
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(body).toMatch(/class="hit[^"]*selected[^"]*"[^>]*data-link="[^"]*Tag:t0[^"]*"/);
  });

  it("shows the link, from and to, and its source through cite: every row behind it", async () => {
    const { panel } = await drawn({ link: T0, read: (s) => s.link(T0) });
    expect(text(panel)).toContain("Link");
    expect(text(panel)).toContain("The hub carries Tag zero");
    const from = panel.slice(panel.indexOf("Where it comes from"));
    // Two links of one type join the hub to Tag zero (qualifiers a and b): the rows of both.
    expect(text(from)).toContain("doc:link=1 +1");
    expect(text(from)).toContain("h carries t0 (a)");
    expect(text(from)).toContain("h carries t0 (b)");
  });

  it("gives the link's ends as pages to open", async () => {
    const { panel } = await drawn({ link: T0, read: (s) => s.link(T0) });
    expect(attr(panel, "href")).toEqual(expect.arrayContaining([hrefFor("Hub:h"), hrefFor("Tag:t0")]));
  });

  it("names the link with the view file's names for the edge type", async () => {
    const view = viewWith({ types: [{ name: "Hub", label: null, columns: null, page: null, names: { carries: "holds" }, describe: null }] });
    const { panel } = await drawn({ view, link: T0, read: (s) => s.link(T0) });
    expect(text(panel)).toContain("The hub holds Tag zero");
  });

  it("ignores a link that is not drawn", async () => {
    const { panel } = await drawn({ link: { from: "Hub:h", edge: "carries", to: "Tag:nowhere" } });
    expect(text(panel)).not.toContain("Link");
    expect(text(panel)).toContain("Select a thing or a bundle to see more.");
  });
});

describe("the sources read (G-6, G-10)", () => {
  it("asks the kit once per thing and once per link, however often they are selected", async () => {
    const real = await openMosaic(buildMosaic(spec()), "hub.mosaic");
    let cites = 0;
    const file = new Proxy(real, {
      get: (t, k) => {
        const v = Reflect.get(t, k);
        if (k !== "cite") return typeof v === "function" ? v.bind(t) : v;
        return (args: unknown) => {
          cites++;
          return (v as (a: unknown) => unknown).call(t, args);
        };
      },
    }) as SealedFile;
    const sources = new Sources(file, new Shape(DEFAULT_VIEW, file));
    await sources.link(T0);
    await sources.link({ ...T0 });
    expect(cites).toBe(1);
    await sources.card("Tag:t1");
    const after = cites;
    await sources.card("Tag:t1");
    expect(cites).toBe(after);
  });

  it("gives what it has read at once, and nothing for what it has not", async () => {
    const file = await openMosaic(buildMosaic(spec()), "hub.mosaic");
    const sources = new Sources(file, new Shape(DEFAULT_VIEW, file));
    expect(sources.cardNow("Tag:t0")).toBeNull();
    expect(sources.linkNow(T0)).toBeNull();
    await sources.card("Tag:t0");
    await sources.link(T0);
    expect(sources.cardNow("Tag:t0")).not.toBeNull();
    expect(sources.linkNow(T0)?.total).toBe(2);
  });
});

describe("a source the kit could not give (G-6, G-10)", () => {
  it("is asked again the next time, as a bundle that failed to open is", async () => {
    const real = await openMosaic(buildMosaic(spec()), "hub.mosaic");
    let broken = true;
    const file = new Proxy(real, {
      get: (t, k) => {
        const v = Reflect.get(t, k);
        if (k !== "cite") return typeof v === "function" ? v.bind(t) : v;
        return (args: unknown) => (broken ? Promise.resolve({ error: { code: "internal", message: "cite broke", suggestions: [] } }) : (v as (a: unknown) => unknown).call(t, args));
      },
    }) as SealedFile;
    const sources = new Sources(file, new Shape(DEFAULT_VIEW, file));
    expect((await sources.link(T0)).error).toBe("cite broke");
    expect("message" in (await sources.card("Tag:t1"))).toBe(true);
    broken = false;
    expect((await sources.link(T0)).total).toBe(2);
    expect("page" in (await sources.card("Tag:t1"))).toBe(true);
  });
});

describe("neighbourhood sources: further cases", () => {
  const hrefFor = (id: string) => routeHash({ query: "", node: id });
  const tableHref = (table: TableRoute) => routeHash({ query: "", node: null, table });
  const hoodHref = (id: string) => routeHash({ query: "", node: id, view: "neighbourhood" });
  const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);

  interface Draw {
    centre?: string;
    selected?: string;
    link?: LinkRef;
    read?: (s: Sources) => Promise<unknown>;
  }

  async function drawn(spec: MosaicSpec, opts: Draw = {}) {
    const file = await openMosaic(buildMosaic(spec), "edges.mosaic");
    const centre = opts.centre ?? "Hub:h";
    const shape = new Shape(DEFAULT_VIEW, file);
    const initial = await new HoodLoader(file).load(hoodOf(centre));
    const sources = new Sources(file, shape);
    await opts.read?.(sources);
    const { body } = render(NeighbourhoodView, {
      props: { file, shape, centre, hrefFor, tableHref, hoodHref, initial, selected: opts.selected, selectedLink: opts.link, sources },
    });
    const i = body.indexOf('aria-label="Selection"');
    return { body, file, sources, panel: i < 0 ? "" : body.slice(i), from: (p: string) => p.slice(p.indexOf("Where it comes from")) };
  }

  const base = (extra: Partial<MosaicSpec> = {}): MosaicSpec => ({
    typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
    edgeTypes: [["carries", "Hub", "Tag"]],
    nodes: [
      { type: "Hub", key: "h", label: "The hub", evidence: [{ locator: "row=1", snippet: "hub row" }] },
      { type: "Tag", key: "t", label: "The tag", evidence: [{ locator: "row=2", snippet: "tag row" }] },
    ],
    edges: [{ type: "carries", from: "Hub:h", to: "Tag:t", evidence: [{ locator: "link=1", snippet: "hub carries tag" }] }],
    ...extra,
  });
  const L: LinkRef = { from: "Hub:h", edge: "carries", to: "Tag:t" };

  describe("selecting a link, edge cases (G-6)", () => {
    it("shows the source of a link seen from its far end, centred on the tag", async () => {
      const { panel, from } = await drawn(base(), { centre: "Tag:t", link: L, read: (s) => s.link(L) });
      expect(text(panel)).toContain("The hub carries The tag");
      expect(text(from(panel))).toContain("hub carries tag");
    });

    it("cites only the selected edge type when two types join the same two things", async () => {
      const spec = base({
        edgeTypes: [["carries", "Hub", "Tag"], ["marks", "Hub", "Tag"]],
        edges: [
          { type: "carries", from: "Hub:h", to: "Tag:t", evidence: [{ locator: "c=1", snippet: "the carries row" }] },
          { type: "marks", from: "Hub:h", to: "Tag:t", evidence: [{ locator: "m=1", snippet: "the marks row" }] },
        ],
      });
      const { panel, from } = await drawn(spec, { link: L, read: (s) => s.link(L) });
      expect(text(from(panel))).toContain("the carries row");
      expect(text(from(panel))).not.toContain("the marks row");
    });

    it("cites only the selected direction when two things link each way", async () => {
      const spec: MosaicSpec = {
        typeProps: { P: '{"name":"text"}' },
        edgeTypes: [["knows", "P", "P"]],
        nodes: [{ type: "P", key: "a", label: "Ann" }, { type: "P", key: "b", label: "Bob" }],
        edges: [
          { type: "knows", from: "P:a", to: "P:b", evidence: [{ locator: "r=1", snippet: "ann knows bob" }] },
          { type: "knows", from: "P:b", to: "P:a", evidence: [{ locator: "r=2", snippet: "bob knows ann" }] },
        ],
      };
      const link = { from: "P:a", edge: "knows", to: "P:b" };
      const { panel, from } = await drawn(spec, { centre: "P:a", link, read: (s) => s.link(link) });
      expect(text(from(panel))).toContain("ann knows bob");
      expect(text(from(panel))).not.toContain("bob knows ann");
    });

    it("selects a link from a thing to itself without failing", async () => {
      const spec: MosaicSpec = {
        typeProps: { P: '{"name":"text"}' },
        edgeTypes: [["knows", "P", "P"]],
        nodes: [{ type: "P", key: "a", label: "Ann" }],
        edges: [{ type: "knows", from: "P:a", to: "P:a", evidence: [{ locator: "r=1", snippet: "ann knows ann" }] }],
      };
      const link = { from: "P:a", edge: "knows", to: "P:a" };
      const { panel } = await drawn(spec, { centre: "P:a", link, read: (s) => s.link(link) });
      expect(text(panel)).toContain("Link");
      expect(text(panel)).toContain("ann knows ann");
    });

    it("gives the total and the first rows of a link made of thirty links, as cite counts them", async () => {
      const edges = Array.from({ length: 30 }, (_, i) => ({
        type: "carries",
        from: "Hub:h",
        to: "Tag:t",
        qualifier: String(i).padStart(2, "0"),
        evidence: [{ locator: `l=${String(i).padStart(2, "0")}`, snippet: `row ${i}` }],
      }));
      const { panel, file, from } = await drawn(base({ edges }), { link: L, read: (s) => s.link(L) });
      const cited = await file.cite({ from: L.from, type: L.edge, to: L.to });
      expect("error" in cited).toBe(false);
      const data = "data" in cited ? (cited.data as { evidence: unknown[]; total?: number }) : { evidence: [] };
      const total = data.total ?? data.evidence.length;
      expect(total).toBe(30);
      expect(text(from(panel))).toContain("doc:l=00 +29");
      expect(text(from(panel))).toContain("row 0");
    });

    it("names a source other than the default one, by the file's name", async () => {
      const spec = base({
        sources: [{ id: "data/links.csv", hash: "b".repeat(64) }],
        edges: [{ type: "carries", from: "Hub:h", to: "Tag:t", evidence: [{ source: "data/links.csv", locator: "row=4", snippet: "from csv" }] }],
      });
      const { panel, from } = await drawn(spec, { link: L, read: (s) => s.link(L) });
      expect(text(from(panel))).toContain("links.csv:row=4");
      expect(text(from(panel))).toContain("from csv");
    });

    it("keeps a link with no snippet shown by its locator, not as unsourced", async () => {
      const spec = base({ edges: [{ type: "carries", from: "Hub:h", to: "Tag:t", evidence: [{ locator: "link=9" }] }] });
      const { panel, from } = await drawn(spec, { link: L, read: (s) => s.link(L) });
      expect(text(from(panel))).toContain("doc:link=9");
      expect(text(from(panel))).not.toContain("no source");
    });

    it("escapes markup in a snippet and a label, in a thing's card and a link's source", async () => {
      const evil = '<script>alert("x")</script><img src=x onerror=alert(1)>';
      const spec = base({
        nodes: [
          { type: "Hub", key: "h", label: evil, evidence: [{ locator: "row=1", snippet: evil }] },
          { type: "Tag", key: "t", label: "The tag", evidence: [{ locator: "row=2", snippet: evil }] },
        ],
        edges: [{ type: "carries", from: "Hub:h", to: "Tag:t", evidence: [{ locator: "link=1", snippet: evil }] }],
      });
      for (const o of [
        { link: L, read: (s: Sources) => s.link(L) },
        { selected: "Tag:t", read: (s: Sources) => s.card("Tag:t") },
      ]) {
        const { panel } = await drawn(spec, o);
        expect(panel).not.toContain("<script>alert");
        expect(panel).not.toContain("<img src=x");
        expect(text(panel)).toContain("alert");
      }
    });

    it("keeps non-ASCII text whole: accents, emoji, right-to-left", async () => {
      const snippet = "Zoë ✓ 🎬 שלום";
      const spec = base({ edges: [{ type: "carries", from: "Hub:h", to: "Tag:t", evidence: [{ locator: "link=1", snippet }] }] });
      const { panel } = await drawn(spec, { link: L, read: (s) => s.link(L) });
      expect(text(panel)).toContain(snippet);
    });

    it("selects a link between things whose keys hold colons, quotes and spaces", async () => {
      const key = 'a:b "c" d';
      const spec: MosaicSpec = {
        typeProps: { Hub: '{"name":"text"}', Tag: '{"name":"text"}' },
        edgeTypes: [["carries", "Hub", "Tag"]],
        nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key, label: "Odd tag" }],
        edges: [{ type: "carries", from: "Hub:h", to: `Tag:${key}`, evidence: [{ locator: "link=1", snippet: "odd link" }] }],
      };
      const link = { from: "Hub:h", edge: "carries", to: `Tag:${key}` };
      const { body, panel } = await drawn(spec, { link, read: (s) => s.link(link) });
      expect(text(panel)).toContain("odd link");
      const keys = attr(body, "data-link").map((k) => JSON.parse(k.replaceAll("&quot;", '"').replaceAll("&amp;", "&")));
      expect(keys).toContainEqual([link.from, link.edge, link.to]);
    });
  });

  describe("selecting a thing, edge cases (G-6, V-7)", () => {
    it("shows a thing with no label by its key, with its source", async () => {
      const spec = base({ nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key: "t", label: null, evidence: [{ locator: "row=2", snippet: "unlabelled" }] }] });
      const { panel } = await drawn(spec, { selected: "Tag:t", read: (s) => s.card("Tag:t") });
      expect(text(panel)).toContain("unlabelled");
      expect(text(panel)).toContain("t");
    });

    it("claims nothing for a thing that is not drawn", async () => {
      const { panel } = await drawn(base(), { selected: "Tag:nowhere" });
      expect(text(panel)).toContain("Select a thing or a bundle to see more.");
      expect(panel).not.toContain("<article");
    });

    it("answers for an id the mosaic lacks without throwing", async () => {
      const { sources } = await drawn(base());
      const got = await sources.card("Tag:nowhere");
      expect("message" in got || "page" in got).toBe(true);
      await expect(sources.link({ from: "Hub:h", edge: "carries", to: "Tag:nowhere" })).resolves.toBeDefined();
    });

    it("shows the thing's own rows, not its links' rows, under where it comes from", async () => {
      const { panel, from } = await drawn(base(), { selected: "Tag:t", read: (s) => s.card("Tag:t") });
      expect(text(from(panel))).toContain("tag row");
      expect(text(from(panel))).not.toContain("hub carries tag");
    });

    it("draws the same markup twice from the same input", async () => {
      const run = async () => (await drawn(base(), { selected: "Tag:t", read: (s) => s.card("Tag:t") })).body;
      expect(await run()).toBe(await run());
      const runL = async () => (await drawn(base(), { link: L, read: (s) => s.link(L) })).body;
      expect(await runL()).toBe(await runL());
    });

    it("shows a thing with many rows by its first row and the count", async () => {
      const evidence = Array.from({ length: 12 }, (_, i) => ({ locator: `row=${String(i).padStart(2, "0")}`, snippet: `s${i}` }));
      const spec = base({ nodes: [{ type: "Hub", key: "h", label: "The hub" }, { type: "Tag", key: "t", label: "The tag", evidence }] });
      const { panel, from } = await drawn(spec, { selected: "Tag:t", read: (s) => s.card("Tag:t") });
      expect(text(from(panel))).toContain("doc:row=00 +11");
    });
  });
});
