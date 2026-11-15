<script lang="ts">
  /**
   * EntityCard (brand book, section 6): one thing's card, as its type's card sets it
   * (V-6, V-7, V-9): its name and id, its summary, where it opens (its table, a trail), its
   * properties, each with a CitationChip that opens the rows behind it (V-8), its links grouped
   * by link type as chips in the linked thing's type colour, and its own source rows. Then its
   * aliases and external references.
   *
   * The facts come from lib/cards.ts: the card's properties, and the link types its links and
   * counts name. Until they are given (or where a caller has none), the card shows the thing's
   * summary and properties as the view file's `page` names them, and every link type.
   */
  import type { GetData } from "@mosaic/kit";
  import { factId, plainFacts, type Evidence, type Fact, type Linked } from "../lib/cards.js";
  import { typeOfId } from "../lib/graph/hood.js";
  import type { LinkGroup } from "../lib/mosaic.js";
  import { typeColours } from "../lib/typecolour.context.js";
  import { inPageOrder, type Shape } from "../lib/view.js";
  import CitationChip from "./CitationChip.svelte";
  import Shard from "./Shard.svelte";
  import TypeChip from "./TypeChip.svelte";
  import Button from "./ui/Button.svelte";

  let {
    node,
    shape = null,
    facts = null,
    hrefFor = null,
    links = null,
    sources = null,
    chip = true,
    tableHref = null,
    trailHref = null,
    onpick,
  }: {
    node: GetData;
    shape?: Shape | null;
    /** The thing's card facts with their rows (lib/cards.ts), or null for the plain card. */
    facts?: readonly Fact[] | null;
    /** Where a linked thing opens. */
    hrefFor?: ((id: string) => string) | null;
    /** The thing's links as `neighbors` gives them: a link type's chips are these, not the few a fact cites. */
    links?: readonly LinkGroup[] | null;
    /** The thing's own source rows, shown last. */
    sources?: Evidence | null;
    /** Whether the card says its type (a pane that says it in its head does not). */
    chip?: boolean;
    /** Where "Open in its table" and "Start a trail here" go; without them the card has no such buttons. */
    tableHref?: string | null;
    trailHref?: string | null;
    /** A linked thing's chip was picked; true when the caller showed it, so the chip's link is not followed. */
    onpick?: (id: string) => boolean;
  } = $props();

  const colourOf = typeColours();
  const colour = (type: string | null) => (type === null ? undefined : (colourOf(type) ?? undefined));

  /** A property value as text: strings as they are, anything else as JSON. */
  function shown(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  let all = $derived(facts ?? plainFacts(node, shape));
  let summaries = $derived(all.filter((f) => f.kind === "summary"));
  let rows = $derived(all.filter((f) => f.kind === "property"));
  /** The plain card shows the summary as M3's did, before the facts. */
  let plainSummary = $derived(facts === null ? node.summary : null);

  interface Group {
    readonly key: string;
    readonly edge: string;
    readonly direction: "out" | "in";
    readonly count: number;
    /** The linked things shown as chips. */
    readonly things: readonly { readonly id: string; readonly label: string | null }[];
    /** The linked things whose rows the group's citation chip opens. */
    readonly cited: readonly Linked[];
  }
  /**
   * The link types shown, with their things: one per links or count fact of the card that the
   * thing has links for, else every link type it has. A fact's chips are the things `links`
   * lists; without `links`, a links fact shows the things it cites and a count its number alone.
   */
  let groups = $derived.by((): Group[] => {
    if (facts === null) {
      return inPageOrder(links ?? [], shape?.page(node.type) ?? null, (g) => g.edge).map((g) => ({ key: `${g.edge} ${g.direction}`, edge: g.edge, direction: g.direction, count: g.count, things: g.edges, cited: [] }));
    }
    const out: Group[] = [];
    for (const f of facts) {
      if (f.kind !== "links" && f.kind !== "count") continue;
      const count = f.kind === "links" ? f.total : f.count;
      if (count === 0) continue;
      // A link type the card both lists and counts shows its chips once, with the list.
      const twice = f.kind === "count" && facts.some((o) => o.kind === "links" && o.edge === f.edge && o.direction === f.direction);
      const listed = links?.find((g) => g.edge === f.edge && g.direction === f.direction)?.edges;
      out.push({ key: factId(f), edge: f.edge, direction: f.direction, count, things: twice ? [] : (listed ?? (f.kind === "links" ? f.things : [])), cited: f.things });
    }
    return out;
  });

  function edgeName(edge: string, direction: "out" | "in"): string {
    const label = shape?.edgeLabel(node.type, edge) ?? edge.replaceAll("_", " ");
    return direction === "in" ? `← ${label}` : label;
  }

  function pick(event: MouseEvent, id: string): void {
    if (onpick?.(id)) event.preventDefault();
  }
</script>

<article class="card body-app" aria-label={node.id}>
  {#if chip}
    <p class="kind"><TypeChip type={node.type} label={shape?.typeLabel(node.type) ?? null} /></p>
  {/if}
  <h1 class="title category">{node.label ?? node.id}</h1>
  <p class="id code">{node.id}</p>
  {#if plainSummary !== null}
    <p class="summary">{plainSummary}</p>
  {/if}
  {#each summaries as fact, i (i)}
    {#if fact.kind === "summary"}
      <div class="summary" data-fact="summary">
        <p class="text">{fact.value}</p>
        {#if fact.evidence !== null}
          <CitationChip sections={[{ title: null, evidence: fact.evidence }]} />
        {/if}
      </div>
    {/if}
  {/each}
  {#if tableHref !== null || trailHref !== null}
    <p class="actions">
      {#if tableHref !== null}<Button href={tableHref} data-action="table">Open in its table</Button>{/if}
      {#if trailHref !== null}<Button variant="ghost" href={trailHref} data-action="trail">Start a trail here</Button>{/if}
    </p>
  {/if}

  {#if rows.length > 0}
    <h2 class="heading section-label">Properties</h2>
    <dl class="facts">
      {#each rows as fact (factId(fact))}
        {#if fact.kind === "property"}
          <div class="fact" data-fact={factId(fact)}>
            <dt class="key" data-prop={fact.name}>{shape?.label(node.type, fact.name) ?? fact.name}</dt>
            <dd class="value" class:mono={typeof fact.value !== "string"}>{shown(fact.value)}</dd>
            {#if fact.evidence !== null}
              <dd class="cite"><CitationChip short sections={[{ title: null, evidence: fact.evidence }]} /></dd>
            {/if}
          </div>
        {/if}
      {/each}
    </dl>
  {/if}

  {#if groups.length > 0}
    <section class="block" aria-label="Links">
      <h2 class="heading section-label">Links</h2>
      {#each groups as group (group.key)}
        <section class="group" aria-label={edgeName(group.edge, group.direction)} data-fact={group.key} data-edge={group.edge} data-direction={group.direction}>
          <div class="edge">
            <h3 class="caption">{edgeName(group.edge, group.direction)} · {group.count}</h3>
            {#if group.cited.length > 0}
              <CitationChip sections={group.cited.map((t) => ({ title: `${t.label ?? t.id}${t.qualifier ? ` · ${t.qualifier}` : ""}`, evidence: t.evidence }))} />
            {/if}
          </div>
          <ul class="things">
            {#each group.things as thing, i (i)}
              {@const type = typeOfId(thing.id)}
              <li>
                {#if hrefFor}
                  <a class="thing" href={hrefFor(thing.id)} data-id={thing.id} data-type-colour={colour(type)} onclick={(e) => pick(e, thing.id)}>
                    <Shard {type} />{thing.label ?? thing.id}
                  </a>
                {:else}
                  <span class="thing" data-id={thing.id} data-type-colour={colour(type)}><Shard {type} />{thing.label ?? thing.id}</span>
                {/if}
              </li>
            {/each}
          </ul>
          {#if group.things.length > 0 && group.count > group.things.length}
            <p class="more caption">and {group.count - group.things.length} more</p>
          {/if}
        </section>
      {/each}
    </section>
  {/if}

  {#if sources !== null}
    <section class="block" aria-label="Sources">
      <h2 class="heading section-label">Source</h2>
      {#if sources.error !== undefined}
        <p class="more caption">Could not read the source: {sources.error}</p>
      {:else if sources.rows.length === 0}
        <p class="more caption">No source row is recorded.</p>
      {/if}
      <ul class="sources">
        {#each sources.rows as row, i (i)}
          <li class="source">
            <span class="where code">{row.source}{row.locator ? `:${row.locator}` : ""}</span>
            <span class="method caption">{row.method}{row.confidence !== null ? ` · confidence ${row.confidence}` : ""}</span>
            {#if row.snippet !== null}
              <blockquote class="snippet caption">{row.snippet}</blockquote>
            {/if}
          </li>
        {/each}
      </ul>
      {#if sources.total > sources.rows.length}
        <p class="more caption">and {sources.total - sources.rows.length} more</p>
      {/if}
    </section>
  {/if}

  {#if node.aliases.length > 0}
    <section class="block" aria-label="Also known as">
      <h2 class="heading section-label">Also known as</h2>
      <ul class="aliases">
        {#each node.aliases as alias (alias)}
          <li>{alias}</li>
        {/each}
      </ul>
      {#if node.aliases_total > node.aliases.length}
        <p class="more caption">and {node.aliases_total - node.aliases.length} more</p>
      {/if}
    </section>
  {/if}

  {#if node.external_refs.length > 0}
    <section class="block" aria-label="External references">
      <h2 class="heading section-label">External references</h2>
      <ul class="refs code">
        {#each node.external_refs as ref, i (i)}
          <li><span class="ref-chip">{ref.system} · {ref.kind}</span> {JSON.stringify(ref.locator)}</li>
        {/each}
      </ul>
    </section>
  {/if}
</article>

<style>
  .card {
    overflow-wrap: anywhere;
  }

  .kind,
  .id,
  .title {
    margin: 0;
  }

  .title {
    color: var(--heading);
    font-weight: bold;
  }

  .id {
    margin-block-start: var(--space-1);
    color: var(--ink-muted);
  }

  .summary {
    margin: var(--space-3) 0 0;
  }

  .summary .text {
    margin: 0 0 var(--space-1);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
  }

  .heading {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  /* A rule between the card's parts. */
  .block {
    margin-block-start: var(--space-4);
    border-block-start: 1px solid var(--border);
  }

  /* Key, value and source chip on one row; the rows a chip opens go under it, across the card. */
  .facts {
    display: grid;
    grid-template-columns: fit-content(40%) minmax(0, 1fr) fit-content(40%);
    gap: var(--space-2) var(--space-3);
    margin: 0;
  }

  .fact {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
  }

  .key {
    color: var(--ink-muted);
  }

  .value {
    margin: 0;
    color: var(--ink);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .cite {
    display: contents;
  }

  .cite :global(.chip) {
    justify-self: end;
    max-inline-size: 12rem;
  }

  .cite :global(.rows) {
    grid-column: 1 / -1;
  }

  .group {
    margin-block-start: var(--space-3);
  }

  /* A link type's name and count, and the chip that opens the rows behind its links. */
  .edge {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    margin-block-end: var(--space-2);
  }

  .edge h3 {
    margin: 0;
    color: var(--ink-muted);
    font-weight: normal;
  }

  .edge :global(.chip) {
    max-inline-size: 12rem;
  }

  .edge :global(.rows) {
    flex-basis: 100%;
  }

  .things {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* A linked thing: its type's shard and its name, on a tint of its type's colour. */
  .thing {
    position: relative;
    isolation: isolate;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--ink);
    text-decoration: none;
  }

  .thing::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: 0;
    border-radius: inherit;
    background: var(--type-colour);
    opacity: 0.15;
  }

  a.thing:hover::before {
    opacity: 0.3;
  }

  a.thing:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .sources {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .source {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  .where,
  .ref-chip {
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--ink-muted);
  }

  .method,
  .more {
    color: var(--ink-muted);
  }

  .more {
    margin: var(--space-1) 0 0;
  }

  .snippet {
    margin: 0;
    padding-inline-start: var(--space-2);
    border-inline-start: 2px solid var(--border);
    color: var(--ink);
  }

  .aliases,
  .refs {
    margin: 0;
    padding-inline-start: var(--space-4);
  }
</style>
