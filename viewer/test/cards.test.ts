// One card per type, every fact with its source (docs/design.md, "Viewer: chains and
// cards"): V-6, a type's card shows the facts chosen for it (properties, the things it links to,
// how many things it links to by a link); V-7, a type's card looks the same wherever the type
// appears, set once per type; V-8, every fact on a card keeps its source: the viewer lets a
// person open the passage or row behind any value; V-9, a type with no card set gets a sensible
// default from what the mosaic holds. Brand book §6: EntityCard, PropertyTable, CitationChip.
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import App from "../src/App.svelte";
import EntityCard from "../src/components/EntityCard.svelte";
import { cardFacts, chipLabel, type Fact, SHOWN } from "../src/lib/cards.js";
import { nodePage, openMosaic, type NodeView } from "../src/lib/mosaic.js";
import { parseView, Shape } from "../src/lib/view.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { buildMosaic, type EvidenceSpec, type MosaicSpec } from "../../kit/test/build-mosaic.js";
import { reading } from "./fixtures.js";
import { type SealedFile } from "@mosaic/kit";

/** Items have a code and a size, and are in a group; Item:a has two evidence rows, Item:b a summary. */
async function open() {
  const file = await openMosaic(reading("mosaic.mosaic"), "mosaic.mosaic");
  return file;
}

function view(json: Record<string, unknown>) {
  return parseView({ search: "semantic", theme: "auto", types: null, export: { types: null }, cards: null, ...json });
}

const kinds = (facts: readonly Fact[]) => facts.map((f) => (f.kind === "property" ? `property:${f.name}` : f.kind === "summary" ? "summary" : `${f.kind}:${f.edge} ${f.direction}`));

describe("a type's card shows the facts chosen for it", () => {
  it("properties, linked things and counts, in the order the view file sets them", async () => {
    const file = await open();
    const shape = new Shape(view({ cards: [{ name: "Item", show: ["size", "code"], links: ["in_group"], counts: ["in_group"] }] }), file);
    const page = (await nodePage(file, "Item:a")) as NodeView;
    const facts = await cardFacts(file, page, shape);
    expect(kinds(facts)).toEqual(["property:size", "property:code", "links:in_group out", "count:in_group out"]);
    const links = facts.find((f) => f.kind === "links")!;
    expect(links.kind === "links" && links.things.map((t) => [t.id, t.label])).toEqual([["Group:x", "Group x"]]);
    const count = facts.find((f) => f.kind === "count")!;
    expect(count.kind === "count" && count.count).toBe(1);
    file.close();
  });

  it("the summary when chosen, and nothing the card does not list", async () => {
    const file = await open();
    const shape = new Shape(view({ cards: [{ name: "Item", show: ["summary"], links: [], counts: [] }] }), file);
    expect(kinds(await cardFacts(file, (await nodePage(file, "Item:b")) as NodeView, shape))).toEqual(["summary"]);
    // Item:a has no summary: a chosen fact the thing does not have is left out.
    expect(kinds(await cardFacts(file, (await nodePage(file, "Item:a")) as NodeView, shape))).toEqual([]);
    file.close();
  });

  it("a count by a link the thing has none of is zero, and a link with none lists none", async () => {
    const file = await open();
    const shape = new Shape(view({ cards: [{ name: "Group", show: [], links: ["in_group"], counts: ["in_group"] }] }), file);
    const facts = await cardFacts(file, (await nodePage(file, "Group:x")) as NodeView, shape);
    expect(kinds(facts)).toEqual(["links:in_group in", "count:in_group in"]);
    const links = facts[0]!;
    expect(links.kind === "links" && links.things.map((t) => t.id)).toEqual(["Item:a", "Item:b"]);
    expect(facts[1]!.kind === "count" && facts[1]!.count).toBe(2);
    file.close();
  });

  it("the card is the type's, not the page's: the same facts for every thing of the type (V-7)", async () => {
    const file = await open();
    const shape = new Shape(view({ cards: [{ name: "Item", show: ["code"], links: [], counts: ["in_group"] }] }), file);
    for (const id of ["Item:a", "Item:b"]) {
      expect(kinds(await cardFacts(file, (await nodePage(file, id)) as NodeView, shape))).toEqual(["property:code", "count:in_group out"]);
    }
    file.close();
  });
});

describe("a type with no card set", () => {
  it("shows a default from what the mosaic holds: summary, properties, link counts", async () => {
    const file = await open();
    const b = await cardFacts(file, (await nodePage(file, "Item:b")) as NodeView, null);
    expect(kinds(b)).toEqual(["summary", "property:code", "count:in_group out"]);
    const a = await cardFacts(file, (await nodePage(file, "Item:a")) as NodeView, new Shape(view({}), file));
    expect(kinds(a)).toEqual(["property:code", "property:size", "count:in_group out"]);
    file.close();
  });

  it("keeps the view file's node page setting for which properties show", async () => {
    const file = await open();
    const shape = new Shape(view({ types: [{ name: "Item", label: null, columns: null, page: ["size"], names: {} }] }), file);
    expect(kinds(await cardFacts(file, (await nodePage(file, "Item:a")) as NodeView, shape))).toEqual(["property:size"]);
    const both = new Shape(view({ types: [{ name: "Item", label: null, columns: null, page: ["in_group", "size"], names: {} }] }), file);
    expect(kinds(await cardFacts(file, (await nodePage(file, "Item:a")) as NodeView, both))).toEqual(["property:size", "count:in_group out"]);
    file.close();
  });
});

describe("every fact keeps its source (V-8)", () => {
  it("a property or the summary carries the rows behind the thing, from cite", async () => {
    const file = await open();
    const facts = await cardFacts(file, (await nodePage(file, "Item:a")) as NodeView, null);
    const cited = await file.cite({ id: "Item:a" });
    if ("error" in cited) throw new Error(cited.error.message);
    for (const f of facts.filter((f) => f.kind === "property")) {
      expect(f.evidence.rows).toEqual(cited.data.evidence);
      expect(f.evidence.total).toBe(cited.data.total);
    }
    file.close();
  });

  it("each linked thing, and each link a count counts, carries the rows behind its link", async () => {
    const file = await open();
    const shape = new Shape(view({ cards: [{ name: "Group", show: [], links: ["in_group"], counts: ["in_group"] }] }), file);
    const facts = await cardFacts(file, (await nodePage(file, "Group:x")) as NodeView, shape);
    for (const f of facts) {
      if (f.kind !== "links" && f.kind !== "count") continue;
      expect(f.things.map((t) => t.id)).toEqual(["Item:a", "Item:b"]);
      for (const t of f.things) {
        const cited = await file.cite({ from: t.id, type: "in_group", to: "Group:x" });
        if ("error" in cited) throw new Error(cited.error.message);
        expect(t.evidence.rows).toEqual(cited.data.evidence);
      }
    }
    file.close();
  });

  it("a chip names the source and the row, and how many more rows there are", () => {
    const row = { source: "first/doc", source_hash: "h", locator: "row=1", method: "extracted" as const, confidence: null, snippet: "a,1,x" };
    expect(chipLabel({ rows: [row], total: 1 })).toBe("doc:row=1");
    expect(chipLabel({ rows: [row, row], total: 3 })).toBe("doc:row=1 +2");
    expect(chipLabel({ rows: [], total: 0 })).toBe("no source");
    // A locator's file part that repeats the source's name is left out of the chip.
    const csv = { ...row, source: "net/titles.csv", locator: "file=titles.csv;row=412;field=cast" };
    expect(chipLabel({ rows: [csv], total: 1 })).toBe("titles.csv:row=412;field=cast");
    expect(chipLabel({ rows: [{ ...csv, locator: "file=other.csv;row=2" }], total: 1 })).toBe("titles.csv:file=other.csv;row=2");
  });
});

describe("a card lists each fact once, and says when a source could not be read", () => {
  it("a link written alone and with its direction is one fact, not two (each kind, edge and direction once)", async () => {
    const file = await open();
    const shape = new Shape(view({ cards: [{ name: "Item", show: ["code", "size"], links: ["in_group", "in_group out"], counts: ["in_group out", "in_group"] }] }), file);
    const page = (await nodePage(file, "Item:a")) as NodeView;
    const facts = await cardFacts(file, page, shape);
    expect(kinds(facts)).toEqual(["property:code", "property:size", "links:in_group out", "count:in_group out"]);
    // Drawn, the card has one row per fact (a repeated key would stop the page from drawing).
    expect(() => render(EntityCard, { props: { node: page.node, shape, facts } })).not.toThrow();
    file.close();
  });

  it("a cite that fails is shown as a failure with its message, never as no source", async () => {
    const file = await open();
    const failing = Object.create(file) as typeof file;
    failing.cite = async () => ({ error: { code: "time_limit", message: "cite took too long", suggestions: [] } }) as never;
    const shape = new Shape(view({ cards: [{ name: "Item", show: [], links: ["in_group"], counts: [] }] }), file);
    const page = (await nodePage(file, "Item:a")) as NodeView;
    const facts = await cardFacts(failing, page, shape);
    const links = facts[0]!;
    if (links.kind !== "links") throw new Error("expected a links fact");
    expect(links.things[0]!.evidence).toEqual({ rows: [], total: 0, error: "cite took too long" });
    expect(chipLabel(links.things[0]!.evidence)).toBe("source unreadable");
    const { body } = render(EntityCard, { props: { node: page.node, shape, facts } });
    expect(body).toContain("Could not read the source: cite took too long");
    expect(body).not.toContain("No source row is recorded.");
    file.close();
  });
});

describe("two links of one type between the same two things, told apart by qualifier (§3.4)", () => {
  it("are two linked things, each with the rows of its own link", async () => {
    const bytes = buildMosaic({
      nodes: [
        { type: "Film", key: "f" },
        { type: "Person", key: "p" },
      ],
      edgeTypes: [["credits", "Film", "Person"]],
      edges: [
        { type: "credits", from: "Film:f", to: "Person:p", qualifier: "director", evidence: [{ locator: "row=1;role=director" }] },
        { type: "credits", from: "Film:f", to: "Person:p", qualifier: "writer", evidence: [{ locator: "row=1;role=writer" }] },
      ],
    });
    const file = await openMosaic(bytes, "q.mosaic");
    const shape = new Shape(view({ cards: [{ name: "Film", show: [], links: ["credits"], counts: ["credits"] }] }), file);
    const page = (await nodePage(file, "Film:f")) as NodeView;
    const facts = await cardFacts(file, page, shape);
    const links = facts.find((f) => f.kind === "links")!;
    if (links.kind !== "links") throw new Error("expected a links fact");
    expect(links.things.map((t) => [t.id, t.qualifier])).toEqual([
      ["Person:p", "director"],
      ["Person:p", "writer"],
    ]);
    expect(links.things.map((t) => t.evidence.rows.map((r) => r.locator))).toEqual([["row=1;role=director"], ["row=1;role=writer"]]);
    // Drawn, each linked thing is its own item: the key is the id and the qualifier.
    const { body } = render(EntityCard, { props: { node: page.node, shape, facts } });
    expect(body.match(/data-id="Person:p"/g)).toHaveLength(2);
    expect(body).toContain(">doc:row=1;role=director<");
    expect(body).toContain(">doc:row=1;role=writer<");
    file.close();
  });
});

describe("the card, drawn", () => {
  it("every value has a citation chip, a button that opens the rows behind it", async () => {
    const file = await open();
    const shape = new Shape(view({ cards: [{ name: "Item", show: ["size", "code"], links: ["in_group"], counts: ["in_group"] }] }), file);
    const page = (await nodePage(file, "Item:a")) as NodeView;
    const facts = await cardFacts(file, page, shape);
    const { body } = render(EntityCard, { props: { node: page.node, shape, facts } });
    // Each fact's markup runs from its data-fact attribute to the next one, or the card's end.
    const parts = body.split(/(?=data-fact=")/).slice(1);
    const rows = parts.map((part) => [part, /^data-fact="([^"]+)"/.exec(part)![1]] as const);
    expect(rows.map((r) => r[1])).toEqual(["property:size", "property:code", "links:in_group out", "count:in_group out"]);
    for (const [row] of rows) {
      const chips = [...row.matchAll(/<button[^>]*class="chip[^"]*"[^>]*>/g)].map((m) => m[0]);
      expect(chips.length, row).toBeGreaterThan(0);
      for (const chip of chips) expect(chip).toContain('aria-expanded="false"');
    }
    expect(body).toContain(">doc:row=1 +1<");
    expect(body).toContain(">Group x<");
    file.close();
  });

  it("the type's labels from the view file name its facts", async () => {
    const file = await open();
    const shape = new Shape(
      view({
        types: [{ name: "Item", label: "Thing", columns: null, page: null, names: { size: "How big", in_group: "Belongs to" } }],
        cards: [{ name: "Item", show: ["size"], links: [], counts: ["in_group"] }],
      }),
      file,
    );
    const page = (await nodePage(file, "Item:a")) as NodeView;
    const { body } = render(EntityCard, { props: { node: page.node, shape, facts: await cardFacts(file, page, shape) } });
    expect(body).toContain(">How big<");
    expect(body).toContain(">Belongs to<");
    expect(body).toContain(">Thing<");
    file.close();
  });

  it("the node page shows the type's card, with its chips", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    await viewer.show("Item:a");
    expect(viewer.facts).not.toBeNull();
    const { body } = render(App, { props: { viewer } });
    expect(body).toMatch(/data-fact="property:code"/);
    expect(body).toMatch(/data-fact="count:in_group out"/);
    expect(body).toContain(">doc:row=1 +1<");
  });
});

describe("cards: further cases", () => {
  async function open(spec: MosaicSpec): Promise<SealedFile> {
    return openMosaic(buildMosaic(spec), "edges.mosaic");
  }

  function view(json: Record<string, unknown>) {
    return parseView({ search: "semantic", theme: "auto", types: null, export: { types: null }, cards: null, ...json });
  }

  const cardOf = (file: SealedFile, name: string, rest: Partial<{ show: string[]; links: string[]; counts: string[] }>) =>
    new Shape(view({ cards: [{ name, show: [], links: [], counts: [], ...rest }] }), file);

  const kinds = (facts: readonly Fact[]) =>
    facts.map((f) => (f.kind === "property" ? `property:${f.name}` : f.kind === "summary" ? "summary" : `${f.kind}:${f.edge} ${f.direction}`));

  async function page(file: SealedFile, id: string): Promise<NodeView> {
    const p = await nodePage(file, id);
    if ("message" in p) throw new Error(p.message);
    return p;
  }

  const rows = (n: number): EvidenceSpec[] => Array.from({ length: n }, (_, i) => ({ locator: `row=${String(i).padStart(3, "0")}` }));

  /** Hub:h has `count` spokes linking to it, spokes named s000...; Hub:h also links to Spoke:s000 ("owns"). */
  function star(count: number): MosaicSpec {
    const keys = Array.from({ length: count }, (_, i) => `s${String(i).padStart(3, "0")}`);
    return {
      typeProps: { Hub: '{"name":"text"}', Spoke: '{"name":"text"}' },
      edgeTypes: [["to_hub", "Spoke", "Hub"], ["owns", "Hub", "Spoke"]],
      nodes: [{ type: "Hub", key: "h", label: "Hub h" }, ...keys.map((k) => ({ type: "Spoke", key: k, label: `Spoke ${k}` }))],
      edges: [...keys.map((k) => ({ type: "to_hub", from: `Spoke:${k}`, to: "Hub:h" })), ...(count > 0 ? [{ type: "owns", from: "Hub:h", to: "Spoke:s000" }] : [])],
    };
  }

  describe("empty and single inputs", () => {
    it("a card that lists nothing shows no fact (V-6)", async () => {
      const file = await open(star(2));
      expect(await cardFacts(file, await page(file, "Hub:h"), cardOf(file, "Hub", {}))).toEqual([]);
      file.close();
    });

    it("a card that is set for another type leaves this type to the default (V-9)", async () => {
      const file = await open({ ...star(1), nodes: [{ type: "Hub", key: "h", label: "Hub h", props: '{"name":"h"}' }, { type: "Spoke", key: "s000", label: "S" }] });
      const facts = await cardFacts(file, await page(file, "Hub:h"), cardOf(file, "Spoke", { show: ["name"] }));
      expect(kinds(facts)).toContain("property:name");
      expect(kinds(facts)).toContain("count:owns out");
      file.close();
    });

    it("a mosaic with one thing and no links: the default is the properties and nothing else (V-9)", async () => {
      const file = await open({ typeProps: { T: '{"name":"text"}' }, nodes: [{ type: "T", key: "k", label: "K", props: '{"name":"k"}' }] });
      const facts = await cardFacts(file, await page(file, "T:k"), null);
      expect(kinds(facts)).toEqual(["property:name"]);
      file.close();
    });

    it("a thing with no properties and no summary and no links has an empty default (V-9)", async () => {
      const file = await open({ nodes: [{ type: "T", key: "k" }] });
      expect(await cardFacts(file, await page(file, "T:k"), null)).toEqual([]);
      file.close();
    });

    it("a thing with neither label nor summary still gets a drawn card whose title is its id or key (V-9)", async () => {
      const file = await open({ nodes: [{ type: "T", key: "k" }] });
      const p = await page(file, "T:k");
      const { body } = render(EntityCard, { props: { node: p.node, shape: null, facts: await cardFacts(file, p, null) } });
      expect(body).toContain("k");
      file.close();
    });
  });

  describe("more linked things than a card lists (V-6, V-8)", () => {
    it("lists at most SHOWN things, says how many there are, and cites each one it lists", async () => {
      const n = SHOWN + 3;
      const file = await open(star(n));
      const facts = await cardFacts(file, await page(file, "Hub:h"), cardOf(file, "Hub", { links: ["to_hub in"], counts: ["to_hub in"] }));
      const links = facts.find((f) => f.kind === "links")!;
      const count = facts.find((f) => f.kind === "count")!;
      if (links.kind !== "links" || count.kind !== "count") throw new Error("kinds");
      expect(links.total).toBe(n);
      expect(links.things.length).toBeLessThanOrEqual(SHOWN);
      expect(links.things.length).toBeGreaterThan(0);
      expect(count.count).toBe(n);
      for (const t of [...links.things, ...count.things]) {
        expect(t.evidence.rows.length, t.id).toBeGreaterThan(0);
        expect(t.id.startsWith("Spoke:")).toBe(true);
      }
      file.close();
    });

    it("exactly SHOWN and SHOWN + 1 linked things: the total is the true number (boundary)", async () => {
      for (const n of [SHOWN, SHOWN + 1]) {
        const file = await open(star(n));
        const facts = await cardFacts(file, await page(file, "Hub:h"), cardOf(file, "Hub", { links: ["to_hub in"], counts: ["to_hub in"] }));
        const links = facts[0]!;
        const count = facts[1]!;
        expect(links.kind === "links" && links.total, `n=${n}`).toBe(n);
        expect(count.kind === "count" && count.count, `n=${n}`).toBe(n);
        expect(links.kind === "links" && links.things.length, `n=${n}`).toBe(Math.min(n, SHOWN));
        file.close();
      }
    });

    it("the things listed are the same, in the same order, every time (determinism)", async () => {
      const file = await open(star(SHOWN + 4));
      const shape = cardOf(file, "Hub", { links: ["to_hub in"], counts: ["to_hub in"] });
      const p = await page(file, "Hub:h");
      const a = await cardFacts(file, p, shape);
      const b = await cardFacts(file, p, shape);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const links = a[0]!;
      const ids = links.kind === "links" ? links.things.map((t) => t.id) : [];
      // Canonical order of the kit's neighbours: by UTF-8 bytes of the id.
      expect(ids).toEqual([...ids].sort());
      file.close();
    });
  });

  describe("direction (V-6)", () => {
    it("a link written with no direction is outgoing, with ' in' incoming; both can be on one card", async () => {
      const file = await open(star(2));
      const shape = cardOf(file, "Hub", { links: ["owns", "to_hub in"], counts: ["owns", "to_hub in"] });
      const facts = await cardFacts(file, await page(file, "Hub:h"), shape);
      expect(kinds(facts)).toEqual(["links:owns out", "links:to_hub in", "count:owns out", "count:to_hub in"]);
      const owns = facts[2]!;
      expect(owns.kind === "count" && owns.count).toBe(1);
      const inbound = facts[3]!;
      expect(inbound.kind === "count" && inbound.count).toBe(2);
      file.close();
    });

    it("a self link counts once outgoing and once incoming for the same thing", async () => {
      const file = await open({
        typeProps: { E: '{"name":"text"}' },
        edgeTypes: [["reports_to", "E", "E"]],
        nodes: [{ type: "E", key: "a" }, { type: "E", key: "b" }],
        edges: [{ type: "reports_to", from: "E:a", to: "E:a" }, { type: "reports_to", from: "E:a", to: "E:b" }],
      });
      const shape = cardOf(file, "E", { counts: ["reports_to out", "reports_to in"] });
      const a = await cardFacts(file, await page(file, "E:a"), shape);
      expect(a.map((f) => f.kind === "count" && f.count)).toEqual([2, 1]);
      const b = await cardFacts(file, await page(file, "E:b"), shape);
      expect(b.map((f) => f.kind === "count" && f.count)).toEqual([0, 1]);
      file.close();
    });

    it("two links between the same two things that differ in a qualifier are two links in the count", async () => {
      const file = await open({
        typeProps: { A: '{"name":"text"}' },
        edgeTypes: [["knows", "A", "A"]],
        nodes: [{ type: "A", key: "a" }, { type: "A", key: "b" }],
        edges: [
          { type: "knows", from: "A:a", to: "A:b", qualifier: "work" },
          { type: "knows", from: "A:a", to: "A:b", qualifier: "home" },
        ],
      });
      const facts = await cardFacts(file, await page(file, "A:a"), cardOf(file, "A", { counts: ["knows"] }));
      expect(facts[0]!.kind === "count" && facts[0]!.count).toBe(2);
      file.close();
    });
  });

  describe("names the mosaic does not have (V-18)", () => {
    it("a property, a link or a count the thing does not have is left out and nothing throws", async () => {
      const file = await open(star(2));
      const shape = cardOf(file, "Hub", { show: ["nope", "summary"], links: ["no_such_link", "owns"], counts: ["no_such_link", "to_hub in"] });
      const facts = await cardFacts(file, await page(file, "Hub:h"), shape);
      const k = kinds(facts);
      expect(k).not.toContain("property:nope");
      expect(k).not.toContain("links:no_such_link out");
      expect(k).toContain("links:owns out");
      expect(k).toContain("count:to_hub in");
      file.close();
    });

    it("a link asked in a direction the thing has none in counts zero or is left out, never throws", async () => {
      const file = await open(star(2));
      // Hub has no outgoing to_hub link.
      const facts = await cardFacts(file, await page(file, "Hub:h"), cardOf(file, "Hub", { links: ["to_hub out"], counts: ["to_hub out"] }));
      for (const f of facts) {
        if (f.kind === "count") expect(f.count).toBe(0);
        if (f.kind === "links") expect(f.things).toEqual([]);
      }
      file.close();
    });

    it("a card naming a type the mosaic does not have changes nothing for the others", async () => {
      const file = await open(star(1));
      const withGhost = await cardFacts(file, await page(file, "Hub:h"), cardOf(file, "Ghost", { show: ["x"] }));
      const without = await cardFacts(file, await page(file, "Hub:h"), null);
      expect(JSON.stringify(withGhost)).toBe(JSON.stringify(without));
      file.close();
    });
  });

  describe("values and their order (V-6, V-9)", () => {
    const props = '{"Z":"upper","a":"lower","ab":"two","b":"b","é":"accent"}';
    const spec: MosaicSpec = { typeProps: { T: '{"Z":"text","a":"text","ab":"text","b":"text","é":"text"}' }, nodes: [{ type: "T", key: "k", props }] };

    it("a card keeps the order written, even when it is not byte order", async () => {
      const file = await open(spec);
      const facts = await cardFacts(file, await page(file, "T:k"), cardOf(file, "T", { show: ["é", "b", "Z", "a"] }));
      expect(kinds(facts)).toEqual(["property:é", "property:b", "property:Z", "property:a"]);
      file.close();
    });

    it("the default lists properties in UTF-8 byte order of their names (upper case, then lower, then non-ASCII)", async () => {
      const file = await open(spec);
      const facts = await cardFacts(file, await page(file, "T:k"), null);
      expect(kinds(facts)).toEqual(["property:Z", "property:a", "property:ab", "property:b", "property:é"]);
      file.close();
    });

    it("values of every JSON kind are kept as they are", async () => {
      const file = await open({
        typeProps: { T: '{"flag":"boolean","list":"list","n":"integer","nested":"object","s":"text"}' },
        nodes: [{ type: "T", key: "k", props: '{"flag":false,"list":[1,"x"],"n":0,"nested":{"a":1},"s":""}' }],
      });
      const facts = await cardFacts(file, await page(file, "T:k"), null);
      const byName = Object.fromEntries(facts.filter((f) => f.kind === "property").map((f) => [f.name, f.value]));
      expect(byName).toEqual({ flag: false, list: [1, "x"], n: 0, nested: { a: 1 }, s: "" });
      file.close();
    });

    it("a very long value is kept whole in the facts", async () => {
      const long = "x".repeat(20000);
      const file = await open({ typeProps: { T: '{"s":"text"}' }, nodes: [{ type: "T", key: "k", props: JSON.stringify({ s: long }) }] });
      const facts = await cardFacts(file, await page(file, "T:k"), null);
      const s = facts.find((f) => f.kind === "property" && f.name === "s")!;
      expect(s.kind === "property" && typeof s.value === "string" && s.value.length).toBeGreaterThan(0);
      file.close();
    });
  });

  describe("evidence on a fact (V-8)", () => {
    it("a thing with more than 20 rows shows at most 20 and says how many there are", async () => {
      const file = await open({
        typeProps: { T: '{"s":"text"}' },
        nodes: [{ type: "T", key: "k", props: '{"s":"v"}', evidence: rows(25) }],
      });
      const facts = await cardFacts(file, await page(file, "T:k"), null);
      const s = facts.find((f) => f.kind === "property")!;
      if (s.kind !== "property" || s.evidence === null) throw new Error("no evidence");
      expect(s.evidence.rows.length).toBe(20);
      expect(s.evidence.total).toBe(25);
      // In the kit's evidence order, the first rows.
      expect(s.evidence.rows[0]!.locator).toBe("row=000");
      file.close();
    });

    it("exactly 20 rows, no more", async () => {
      const file = await open({ typeProps: { T: '{"s":"text"}' }, nodes: [{ type: "T", key: "k", props: '{"s":"v"}', evidence: rows(20) }] });
      const s = (await cardFacts(file, await page(file, "T:k"), null)).find((f) => f.kind === "property")!;
      expect(s.kind === "property" && s.evidence?.rows.length).toBe(20);
      expect(s.kind === "property" && s.evidence?.total).toBe(20);
      file.close();
    });

    it("a link with several rows of evidence keeps them on the linked thing", async () => {
      const file = await open({
        typeProps: { A: '{"name":"text"}' },
        edgeTypes: [["knows", "A", "A"]],
        nodes: [{ type: "A", key: "a" }, { type: "A", key: "b" }],
        edges: [{ type: "knows", from: "A:a", to: "A:b", evidence: rows(3) }],
      });
      const facts = await cardFacts(file, await page(file, "A:a"), cardOf(file, "A", { links: ["knows"] }));
      const f = facts[0]!;
      expect(f.kind === "links" && f.things[0]!.evidence.rows.map((r) => r.locator)).toEqual(["row=000", "row=001", "row=002"]);
      expect(f.kind === "links" && f.things[0]!.evidence.total).toBe(3);
      file.close();
    });

    it("an inferred row keeps its method and confidence, so a person can tell it from an extracted one", async () => {
      const file = await open({
        typeProps: { T: '{"s":"text"}' },
        nodes: [{ type: "T", key: "k", props: '{"s":"v"}', evidence: [{ method: "inferred", confidence: 0.25, locator: "row=1", snippet: "guess" }] }],
      });
      const s = (await cardFacts(file, await page(file, "T:k"), null)).find((f) => f.kind === "property")!;
      const row = s.kind === "property" ? s.evidence?.rows[0] : undefined;
      expect(row?.method).toBe("inferred");
      expect(row?.confidence).toBe(0.25);
      expect(row?.snippet).toBe("guess");
      file.close();
    });

    it("the same card asked twice has the same facts and the same evidence (determinism)", async () => {
      const file = await open({
        typeProps: { T: '{"s":"text"}' },
        nodes: [{ type: "T", key: "k", props: '{"s":"v"}', evidence: rows(7) }],
      });
      const p = await page(file, "T:k");
      expect(JSON.stringify(await cardFacts(file, p, null))).toBe(JSON.stringify(await cardFacts(file, p, null)));
      file.close();
    });
  });

  describe("the card, drawn, with hostile text (V-8, brand book section 6)", () => {
    const hostile = '<img src=x onerror=alert(1)>&"\'';

    it("markup in a label, a value, a linked label and a property name is escaped, never run", async () => {
      const file = await open({
        typeProps: { T: JSON.stringify({ [hostile]: "text" }) },
        edgeTypes: [["to", "T", "T"]],
        nodes: [
          { type: "T", key: "a", label: hostile, summary: hostile, props: JSON.stringify({ [hostile]: hostile }), evidence: [{ locator: hostile, snippet: hostile }] },
          { type: "T", key: "b", label: hostile },
        ],
        edges: [{ type: "to", from: "T:a", to: "T:b", evidence: [{ locator: hostile }] }],
      });
      const p = await page(file, "T:a");
      const shape = cardOf(file, "T", { show: ["summary", hostile], links: ["to"], counts: ["to"] });
      const { body } = render(EntityCard, { props: { node: p.node, shape, facts: await cardFacts(file, p, shape) } });
      expect(body).not.toContain("<img");
      expect(body).toContain("&lt;img");
      file.close();
    });

    it("a NUL and a non-BMP character in a value do not break the card", async () => {
      const odd = "a\u0000b \u{1F600} ‮";
      const file = await open({ typeProps: { T: '{"s":"text"}' }, nodes: [{ type: "T", key: "k", props: JSON.stringify({ s: odd }) }] });
      const p = await page(file, "T:k");
      const facts = await cardFacts(file, p, null);
      expect(() => render(EntityCard, { props: { node: p.node, shape: null, facts } })).not.toThrow();
      file.close();
    });

    it("a card with no facts is drawn, without a chip", async () => {
      const file = await open({ nodes: [{ type: "T", key: "k", label: "K" }] });
      const p = await page(file, "T:k");
      const { body } = render(EntityCard, { props: { node: p.node, shape: null, facts: [] } });
      expect(body).toContain("K");
      expect(body).not.toMatch(/<button/);
      file.close();
    });

    it("a type's card is drawn the same for two things of the type, apart from their own values (V-7)", async () => {
      const file = await open({
        typeProps: { T: '{"s":"text"}' },
        nodes: [
          { type: "T", key: "a", label: "L", props: '{"s":"v"}', evidence: [{ locator: "row=1" }] },
          { type: "T", key: "b", label: "L", props: '{"s":"v"}', evidence: [{ locator: "row=1" }] },
        ],
      });
      const shape = cardOf(file, "T", { show: ["s"] });
      const pa = await page(file, "T:a");
      const pb = await page(file, "T:b");
      const a = render(EntityCard, { props: { node: pa.node, shape, facts: await cardFacts(file, pa, shape) } }).body;
      const b = render(EntityCard, { props: { node: pb.node, shape, facts: await cardFacts(file, pb, shape) } }).body;
      const strip = (s: string) => s.replace(/T:[ab]/g, "T:_");
      expect(strip(a)).toBe(strip(b));
      file.close();
    });

    it("a linked thing with no label is named by its id", async () => {
      const file = await open({
        typeProps: { T: '{"name":"text"}' },
        edgeTypes: [["to", "T", "T"]],
        nodes: [{ type: "T", key: "a" }, { type: "T", key: "unlabelled" }],
        edges: [{ type: "to", from: "T:a", to: "T:unlabelled" }],
      });
      const p = await page(file, "T:a");
      const shape = cardOf(file, "T", { links: ["to"] });
      const facts = await cardFacts(file, p, shape);
      const { body } = render(EntityCard, { props: { node: p.node, shape, facts } });
      expect(body).toMatch(/unlabelled/);
      file.close();
    });
  });

  describe("what a chip says (brand book section 6)", () => {
    const row = { source: "net/titles.csv", source_hash: "h", locator: "row=1", method: "extracted" as const, confidence: null, snippet: null };

    it("a source id with no slash is its own name", () => {
      expect(chipLabel({ rows: [{ ...row, source: "doc" }], total: 1 })).toBe("doc:row=1");
    });

    it("only the last part of a deep source id is shown", () => {
      expect(chipLabel({ rows: [{ ...row, source: "a/b/c/d.csv" }], total: 1 })).toBe("d.csv:row=1");
    });

    it("a file part that only starts like the name is kept", () => {
      expect(chipLabel({ rows: [{ ...row, locator: "file=titles.csv.bak;row=2" }], total: 1 })).toBe("titles.csv:file=titles.csv.bak;row=2");
    });

    it("a locator that is only the file part leaves the name alone, with no dangling colon", () => {
      const label = chipLabel({ rows: [{ ...row, locator: "file=titles.csv" }], total: 1 });
      expect(label.startsWith("titles.csv")).toBe(true);
      expect(label.endsWith(":")).toBe(false);
    });

    it("the count of more rows is total - 1, even when the card holds only the first 20", () => {
      const twenty = Array.from({ length: 20 }, () => row);
      expect(chipLabel({ rows: twenty, total: 20 })).toBe("titles.csv:row=1 +19");
      expect(chipLabel({ rows: twenty, total: 300 })).toBe("titles.csv:row=1 +299");
    });

    it("a non-ASCII source name and locator are kept as they are", () => {
      expect(chipLabel({ rows: [{ ...row, source: "x/données.csv", locator: "file=données.csv;ligne=é" }], total: 1 })).toBe("données.csv:ligne=é");
    });
  });
});
