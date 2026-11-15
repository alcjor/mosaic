<script lang="ts">
  /**
   * The viewer's shell (brand book, section 6): a header band with the mosaic's name, its short
   * knowledge hash and the search field; under it the four places (lib/places.ts):
   *
   * - Home: the map of types and the view file's saved trails. A type leads to its table, a
   *   saved trail opens in Trails.
   * - Explore: the graph round the thing the address names, beside the selected thing's card,
   *   with the search results that led there. Opening a search result lands here.
   * - Trails: a chain, built step by step, shown as columns (one per place) or as one table.
   * - Tables: a type's table.
   *
   * The kit runs in this page: a mosaic is opened from a file the reader picks, or from the
   * address's `?mosaic=<url>`, and nothing is asked of a server but the file itself. When the
   * address also names the model (`?model=<url>`, from `mosaic view --model`), it is loaded in
   * the page first, so `find` searches by vectors too; a model that fails to load is shown as an
   * error and the page searches by names and full text only (section 3.8). The view file's
   * settings, from the address's `?view=<url>` (lib/view.ts), shape the page; what they name that
   * the mosaic does not have is shown as a notice, and the page still opens. The page asks for
   * them again every second, so a view file saved under `mosaic view` reshapes it; settings that
   * cannot be read are shown as an error and the page stays as it was. A single-file export
   * (lib/exported.ts) holds its mosaic, its view file's settings and SQLite's WebAssembly in the
   * document: the page opens them, fetches nothing, watches nothing, and says it is a read-only
   * export.
   *
   * Below 960px a place's side panes become tabs.
   */
  import { onMount } from "svelte";
  import CardPicker from "./components/CardPicker.svelte";
  import ChainView from "./components/ChainView.svelte";
  import NodeContext from "./components/NodeContext.svelte";
  import NeighbourhoodView from "./components/NeighbourhoodView.svelte";
  import PlaceBar from "./components/PlaceBar.svelte";
  import ResultList from "./components/ResultList.svelte";
  import ResultTableView from "./components/ResultTableView.svelte";
  import SchemaView from "./components/SchemaView.svelte";
  import SearchField from "./components/SearchField.svelte";
  import TableView from "./components/TableView.svelte";
  import TrailColumns from "./components/TrailColumns.svelte";
  import TypeList from "./components/TypeList.svelte";
  import Button from "./components/ui/Button.svelte";
  import EmptyState from "./components/ui/EmptyState.svelte";
  import Panel from "./components/ui/Panel.svelte";
  import Tabs from "./components/ui/Tabs.svelte";
  import { pin } from "./lib/chain.js";
  import { linkOf } from "./lib/chainlink.js";
  import { fetchNamedModel, fetchNamedMosaic, loadModel, shortHash, type NodeView } from "./lib/mosaic.js";
  import { hoodRoute } from "./lib/graph/hood-address.js";
  import type { HoodState } from "./lib/graph/hood.js";
  import type { PlaceId } from "./lib/places.js";
  import { parseRoute, routeHash, type ChainLinkRoute, type Condition, type HoodChoices, type TableRoute } from "./lib/route.js";
  import { useSqliteWasm } from "@mosaic/kit";
  import { cutFrom, readExport, runtimeOf } from "./lib/exported.js";
  import { cardsText, pickOptions, startingCard, toggle } from "./lib/cardpick.js";
  import { findThings, type Answer } from "./lib/placesearch.svelte.js";
  import { applyTheme, DEFAULT_VIEW, Shape, watchView } from "./lib/view.js";
  import { Viewer } from "./lib/viewer.svelte.js";

  let {
    viewer = new Viewer(),
    exported = false,
    cutHash = null,
    narrow = false,
  }: {
    viewer?: Viewer;
    exported?: boolean;
    cutHash?: string | null;
    /** Below 960px: one column at a time, chosen by tabs; followed from the window once mounted. */
    narrow?: boolean;
  } = $props();

  /** Why the view file's settings could not be read; the page then uses the defaults. */
  let viewError = $state<string | null>(null);
  let stopWatching: () => void = () => {};

  $effect(() => applyTheme(document.documentElement, viewer.view.theme));

  /** A thing opens in Explore. */
  const hrefFor = (id: string): string => routeHash({ query: viewer.query, node: id, view: "explore" });
  /** A table opens in Tables; the thing open in Explore stays in the address. */
  const tableHref = (table: TableRoute): string => routeHash({ query: viewer.query, node: viewer.nodeId, view: "tables", table });
  const typeHref = (type: string): string => tableHref({ type, page: 1, order: null, where: [] });
  /** A chain opens in Trails, as columns. */
  const trailHref = (chain: ChainLinkRoute | null): string => routeHash({ query: viewer.query, node: viewer.nodeId, view: "trails", chain });

  /** The graph's choices as last made, so going back to Explore finds the same picture. */
  let lastHood = $state.raw<HoodState | null>(null);

  /** Where a place's link leads: the place as it was left. */
  function placeHref(place: PlaceId): string {
    if (place === "explore") {
      const hood = lastHood !== null && lastHood.centre === viewer.nodeId ? (hoodRoute(lastHood).hood ?? null) : null;
      return routeHash({ query: viewer.query, node: viewer.nodeId, view: "explore", hood });
    }
    if (place === "trails") return trailHref(viewer.chainLink());
    if (place === "tables") return routeHash({ query: viewer.query, node: viewer.nodeId, view: "tables", table: viewer.tableRoute });
    return routeHash({ query: viewer.query, node: viewer.nodeId });
  }

  let shape = $derived(viewer.shape ?? (viewer.file === null ? null : new Shape(DEFAULT_VIEW, viewer.file)));

  /** Things of `type` named like `query`, for pinning a chain's place: the kit's `find`. */
  function findIn(type: string, query: string): Promise<Answer> {
    return viewer.file === null ? Promise.resolve([]) : findThings(viewer.file, type, query);
  }

  /** The tab a person picked since the address last changed, if any. */
  let pickedTab = $state<string | null>(null);

  /** Explore's panes as tabs, below 960px. */
  const exploreTabs = [
    { value: "results", label: "Results" },
    { value: "graph", label: "Graph" },
    { value: "card", label: "Card" },
  ];
  /** Tables' panes as tabs, below 960px. */
  const tableTabs = [
    { value: "types", label: "Types" },
    { value: "table", label: "Table" },
  ];

  /** The tab shown below 960px: the one picked, else what the address opened. */
  let tab = $derived.by((): string => {
    if (viewer.place === "explore") {
      if (pickedTab !== null && exploreTabs.some((t) => t.value === pickedTab)) return pickedTab;
      return viewer.nodeId !== null ? "card" : "results";
    }
    if (pickedTab !== null && tableTabs.some((t) => t.value === pickedTab)) return pickedTab;
    return viewer.tableRoute !== null ? "table" : "types";
  });

  function filtered(condition: Condition): void {
    const table = viewer.tableRoute;
    if (table) location.hash = tableHref({ ...table, page: 1, where: [...table.where, condition] });
  }

  /** The choices Explore's address holds (G-8), for the graph to open. */
  let hoodAddress = $state<HoodChoices | null>(null);

  /** Explore's address follows each choice made in the graph, without a step for Back (G-8). */
  function writeHood(state: HoodState): void {
    lastHood = state;
    if (viewer.place !== "explore" || state.centre !== viewer.nodeId) return;
    const hash = routeHash({ ...hoodRoute(state), query: viewer.query });
    if (hash !== location.hash) history.replaceState(history.state, "", hash);
  }

  /** True once the address has been read on the open mosaic: until then, the page does not write it. */
  let addressRead = $state(false);

  /**
   * Trails' address follows the chain, the view and the table's sort and
   * filters, without a step for Back (V-17): it is the link to give a colleague. It waits
   * while a link is applied, and until the address has been read on the open mosaic.
   */
  $effect(() => {
    if (!addressRead || viewer.linking || viewer.place !== "trails" || viewer.status !== "ready") return;
    const chain = viewer.chainAddress();
    if (chain === undefined) return;
    const hash = trailHref(chain);
    if (hash !== location.hash) history.replaceState(history.state, "", hash);
  });

  /** The link part of a Trails address, to tell whether a link names the chain shown. */
  const chainHash = (chain: ChainLinkRoute | null): string => routeHash({ query: "", node: null, view: "trails", chain });

  /** Follow the address after `#`: the place, the query, and the node, the table or the chain it names. */
  function follow(): void {
    const route = parseRoute(location.hash);
    viewer.place = route.view ?? "home";
    hoodAddress = route.hood ?? null;
    pickedTab = null;
    if (route.query !== viewer.query || viewer.results === null) void viewer.search(route.query);
    if (route.node !== viewer.nodeId || viewer.page === null) void viewer.show(route.node);
    // Another place's address does not name the table: Tables keeps the one it had.
    const table = route.view === "tables" ? (route.table ?? null) : viewer.tableRoute;
    if (routeHash({ query: "", node: null, table }) !== routeHash({ query: "", node: null, table: viewer.tableRoute }) || viewer.table === null) {
      void viewer.showTable(table);
    }
    if (route.view === "trails" && route.chain && viewer.file !== null && chainHash(route.chain) !== chainHash(viewer.chainLink())) {
      void viewer.openChainLink(route.chain);
    }
    addressRead = viewer.file !== null;
  }

  async function opened(bytes: Uint8Array, name: string): Promise<void> {
    addressRead = false;
    await viewer.open(bytes, name);
    if (viewer.status === "ready") {
      viewer.results = null;
      viewer.page = null;
      follow();
    }
  }

  async function picked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    if (chosen) await opened(new Uint8Array(await chosen.arrayBuffer()), chosen.name);
  }

  /** Open the export the document holds; true when it holds one. */
  async function openExport(): Promise<boolean> {
    let found;
    try {
      found = await readExport(document);
    } catch (e) {
      viewer.status = "error";
      viewer.error = e instanceof Error ? e.message : String(e);
      exported = true;
      return true;
    }
    if (found === null) return false;
    exported = true;
    useSqliteWasm(found.sqlite);
    if (found.model !== null) {
      try {
        viewer.embedder = await loadModel(found.model.files, await runtimeOf(found.model));
      } catch (e) {
        viewer.modelError = `search by names and full text only: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    await viewer.setView(found.view);
    await opened(found.mosaic, found.name);
    // The caption is for the carried cut only, not for a file opened later from this page.
    if (found.cut) cutHash = viewer.file?.header.knowledge_hash ?? null;
    return true;
  }

  onMount(() => {
    const below = window.matchMedia("(width < 960px)");
    const fit = (): void => {
      narrow = below.matches;
    };
    fit();
    below.addEventListener("change", fit);
    window.addEventListener("hashchange", follow);
    void (async () => {
      if (await openExport()) return;
      const model = (async () => {
        try {
          const files = await fetchNamedModel(location.search, location.href);
          if (files) viewer.embedder = await loadModel(files);
        } catch (e) {
          viewer.modelError = `search by names and full text only: ${e instanceof Error ? e.message : String(e)}`;
        }
      })();
      let first: () => void = () => {};
      const view = new Promise<void>((resolve) => (first = resolve));
      stopWatching = watchView(
        location.search,
        location.href,
        (settings) => void viewer.setView(settings).then(first),
        (error) => {
          viewError = error;
          first();
        },
      );
      if (!new URLSearchParams(location.search).get("view")) first();
      try {
        const named = await fetchNamedMosaic(location.search, location.href);
        await Promise.all([model, view]);
        if (named) await opened(named.bytes, named.name);
      } catch (e) {
        viewer.status = "error";
        viewer.error = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => {
      below.removeEventListener("change", fit);
      window.removeEventListener("hashchange", follow);
      stopWatching();
    };
  });
</script>

<header class="band">
  <span class="mark" role="img" aria-label="Mosaic"></span>
  {#if viewer.file}
    <span class="name code">{viewer.file.name}</span>
    <span class="hash code" title={viewer.file.header.knowledge_hash}>{shortHash(viewer.file.header.knowledge_hash)}</span>
    {#if viewer.seal}
      <span class="seal caption" data-seal={viewer.seal} role="status">
        {viewer.seal === "checking" ? "checking…" : viewer.seal}
      </span>
    {/if}
  {:else}
    <span class="name code">Mosaic viewer</span>
  {/if}
  <div class="find">
    <SearchField
      value={viewer.query}
      disabled={viewer.file === null}
      mode={viewer.mode}
      onsearch={(query) => (location.hash = routeHash({ query, node: viewer.nodeId, view: "explore" }))}
      onmode={(mode) => void viewer.setMode(mode)}
    />
  </div>
  {#if exported}
    <span class="export caption">Read-only export</span>
    {@const from = viewer.file && viewer.file.header.knowledge_hash === cutHash ? cutFrom(viewer.file.pieces) : null}
    {#if from}
      <span class="export caption" title={from.hash}>from {from.id} {shortHash(from.hash)}</span>
    {/if}
  {/if}
  <label class="open caption">
    Open a mosaic
    <input class="file" type="file" accept=".mosaic" onchange={picked} />
  </label>
</header>
{#if viewer.status === "loading"}
  <div class="loading" role="progressbar" aria-label="Opening the mosaic"></div>
{/if}
{#if viewer.file}
  <PlaceBar place={viewer.place} hrefFor={placeHref} />
{/if}
{#if viewer.seal === "not verified"}
  <p class="banner body-screen" role="alert" data-seal-warning>
    This file was changed after it was sealed, so it is not the mosaic its hash names. You can
    still browse it. {viewer.sealFailure}
  </p>
{/if}
{#if viewer.error}
  <p class="banner body-screen" role="alert">{viewer.error}</p>
{/if}
{#if viewer.modelError}
  <p class="banner body-screen" role="alert">{viewer.modelError}</p>
{/if}
{#if viewError}
  <p class="banner body-screen" role="alert">{viewError}</p>
{/if}
{#if (viewer.shape?.notices.length ?? 0) + viewer.chainNotices.length > 0}
  <ul class="notices body-screen" role="status" aria-label="View file notices">
    {#each [...(viewer.shape?.notices ?? []), ...viewer.chainNotices] as notice, i (i)}
      <li>{notice}</li>
    {/each}
  </ul>
{/if}

{#if viewer.linkNotices.length > 0}
  <ul class="notices body-screen" role="status" aria-label="Link notices">
    {#each viewer.linkNotices as notice, i (i)}
      <li>{notice}</li>
    {/each}
  </ul>
{/if}

{#snippet context(page: NodeView)}
  {#if viewer.file !== null}
    {@const card = startingCard(viewer.view, viewer.file, page.node.type)}
    <CardPicker
      type={card.name}
      options={pickOptions(viewer.file, card.name)}
      {card}
      chosen={viewer.chosen.includes(card.name)}
      text={cardsText(viewer.view.cards?.length ? viewer.view.cards : [card])}
      shape={viewer.shape}
      onpick={(part, name, on) => void viewer.chooseCard(toggle(card, part, name, on))}
      onreset={() => void viewer.resetCard(card.name)}
    />
    <aside aria-label="Links and sources">
      <NodeContext view={page} {hrefFor} shape={viewer.shape} />
    </aside>
  {/if}
{/snippet}

{#if viewer.file === null || shape === null}
  <main class="start">
    <EmptyState message="Open a mosaic to search it. It is read in this page; nothing is sent anywhere." />
  </main>
{:else if viewer.place === "home"}
  <main class="place home" data-place="home">
    <Panel title="Saved trails">
      {#if viewer.savedChains.length === 0}
        <EmptyState message="No saved trails yet. Build one in Trails and keep it in the view file.">
          {#snippet action()}<Button href={placeHref("trails")}>Build a trail</Button>{/snippet}
        </EmptyState>
      {:else}
        <ul class="saved">
          {#each viewer.savedChains as s (s.name)}
            <li><Button href={trailHref(linkOf(s.chain, "columns", 0, [], { sort: null, filters: [] }))} data-trail={s.name}>{s.name}</Button></li>
          {/each}
        </ul>
      {/if}
    </Panel>
    <section aria-labelledby="home-map">
      <h1 class="title panel-title" id="home-map">Map of types</h1>
      <SchemaView file={viewer.file} {shape} {hrefFor} {tableHref} />
    </section>
  </main>
{:else if viewer.place === "explore"}
  <main class="place explore" data-place="explore">
    {#if narrow}
      <div class="tabs"><Tabs tabs={exploreTabs} value={tab} label="Explore" onchange={(v) => (pickedTab = v)} /></div>
    {/if}
    <nav class="results" aria-label="Results" hidden={narrow && tab !== "results"}>
      {#if viewer.results}
        <ResultList view={viewer.results} selected={viewer.nodeId} {hrefFor} typeLabel={(type) => shape.typeLabel(type)} />
      {:else}
        <EmptyState message="Search for a name, an alias or words in the text." />
      {/if}
    </nav>
    <div class="graph" hidden={narrow && tab === "results"}>
      {#if viewer.nodeId === null}
        <EmptyState message="No thing is open. Search for one in the field above, then pick a result to see it and what it links to." />
      {:else if viewer.page && "message" in viewer.page}
        <p class="banner body-screen" role="alert">{viewer.page.message}</p>
        {#if viewer.page.suggestions.length > 0}
          <p class="caption">Closest:</p>
          <ul class="suggestions code">
            {#each viewer.page.suggestions as id (id)}
              <li><a href={hrefFor(id)}>{id}</a></li>
            {/each}
          </ul>
        {/if}
      {:else}
        <NeighbourhoodView
          file={viewer.file}
          {shape}
          centre={viewer.nodeId}
          {hrefFor}
          {tableHref}
          hoodHref={hrefFor}
          address={hoodAddress}
          onchoices={writeHood}
          only={narrow ? (tab === "card" ? "card" : "graph") : null}
          extra={context}
        />
      {/if}
    </div>
  </main>
{:else if viewer.place === "trails"}
  <main class="place trails" data-place="trails">
    <ChainView
      schema={viewer.file}
      chain={viewer.chain}
      count={viewer.chainCount}
      shape={viewer.shape}
      onchange={(c) => viewer.chooseChain(c)}
      find={findIn}
      searches={viewer.searches}
      saved={viewer.savedChains}
      fileChains={viewer.view.chains ?? []}
    />
    {#if viewer.chain === null}
      <EmptyState message="Choose a type to start a trail from, then add steps along its links." />
    {:else}
      {@const chain = viewer.chain}
      <div class="show-as" role="group" aria-label="Show the trail as">
        <Button pressed={viewer.chainShow === "columns"} onclick={() => void viewer.showChainAs("columns")}>Columns</Button>
        <Button pressed={viewer.chainShow === "table"} onclick={() => void viewer.showChainAs("table")}>Table</Button>
      </div>
      {#if viewer.chainShow === "table" && viewer.chainTable !== null}
        <ResultTableView table={viewer.chainTable} count={viewer.chainCount} {hrefFor} onclear={() => void viewer.clearChainFilters()} />
      {:else if viewer.chainFailure !== null}
        <p class="banner body-screen" role="alert">{viewer.chainFailure}</p>
      {:else if viewer.chainColumns !== null}
        <TrailColumns
          trail={viewer.chainColumns}
          shape={viewer.shape}
          {hrefFor}
          onpin={(place, id) => viewer.chooseChain(pin(chain, place === 0 ? "start" : place - 1, id))}
        />
      {:else}
        <p class="caption" role="status">Reading the trail…</p>
      {/if}
    {/if}
  </main>
{:else}
  <main class="place tables" data-place="tables">
    {#if narrow}
      <div class="tabs"><Tabs tabs={tableTabs} value={tab} label="Tables" onchange={(v) => (pickedTab = v)} /></div>
    {/if}
    <nav class="types" aria-label="Types" hidden={narrow && tab !== "types"}>
      <TypeList types={shape.types} selected={viewer.tableRoute?.type ?? null} hrefFor={typeHref} labelFor={(type) => shape.typeLabel(type)} />
    </nav>
    <div class="table" hidden={narrow && tab !== "table"}>
      {#if viewer.tableRoute}
        {#key viewer.tableRoute.type}
          <TableView view={viewer.table} route={viewer.tableRoute} hrefFor={tableHref} nodeHref={hrefFor} onfilter={filtered} shape={viewer.shape} />
        {/key}
      {:else}
        <EmptyState message="Pick a type to see its table." />
      {/if}
    </div>
  </main>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: var(--surface);
    color: var(--ink);
    font-family: var(--font-sans);
  }

  /* Below 960px the band wraps: its first line names the mosaic, the search field takes the next. */
  .band {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    min-block-size: var(--app-header);
    padding: var(--space-2) var(--space-4);
    box-sizing: border-box;
    background: var(--slab);
  }

  .find {
    display: flex;
    flex: 1 1 100%;
    order: 1;
    min-inline-size: 0;
  }

  @media (width >= 960px) {
    .band {
      flex-wrap: nowrap;
      block-size: var(--app-header);
      padding-block: 0;
    }

    .find {
      flex: 1 1 auto;
      order: 0;
      justify-content: center;
    }
  }

  .name {
    overflow: hidden;
    min-inline-size: 0;
    color: var(--shard-4);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hash {
    color: var(--shard-4);
    opacity: 0.8;
  }

  .seal {
    color: var(--shard-4);
    opacity: 0.8;
  }

  .seal[data-seal="not verified"] {
    color: var(--status-warning);
    opacity: 1;
  }

  .export {
    color: var(--shard-4);
  }

  .open {
    color: var(--shard-4);
    cursor: pointer;
  }

  .file {
    inline-size: 1px;
    block-size: 1px;
    opacity: 0;
  }

  /* The label around the hidden file input shows its focus ring (below), so the input shows none. */
  .file:focus {
    outline: none;
  }

  .open:focus-within {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .loading {
    block-size: 2px;
    background: var(--accent);
  }

  .banner {
    margin: var(--space-3) var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }

  .notices {
    margin: var(--space-3) var(--space-4);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-5);
    border-inline-start: 3px solid var(--status-warning);
    border-radius: var(--radius-md);
    background: var(--surface-tint);
    color: var(--ink);
  }

  .start {
    max-inline-size: 40rem;
    margin-inline: auto;
  }

  .place {
    box-sizing: border-box;
    min-inline-size: 0;
  }

  [hidden] {
    display: none;
  }

  .home,
  .trails {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    align-content: start;
    padding: var(--space-4);
  }

  .title {
    margin: 0 var(--space-4) var(--space-2);
    color: var(--heading);
  }

  .saved {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .show-as {
    display: inline-flex;
    gap: var(--space-1);
  }

  .explore,
  .tables {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
  }

  .tabs {
    padding: var(--space-2) var(--space-4) 0;
  }

  .graph,
  .table {
    min-inline-size: 0;
  }

  .graph {
    padding-block-start: var(--space-3);
  }

  .suggestions {
    margin: 0;
    padding-inline-start: var(--space-6);
  }

  /* From 960px: a place's side pane beside its main pane. */
  @media (width >= 960px) {
    .explore,
    .tables {
      grid-template-columns: 280px minmax(0, 1fr);
      min-block-size: calc(100vh - var(--app-header));
    }

    .results,
    .types {
      border-inline-end: 1px solid var(--border);
    }
  }

  /* The dark mark, as design/assets/logos/mosaic-mark-dark.svg draws it (brand book, section 6). */
  .mark {
    flex: none;
    inline-size: 24px;
    block-size: 24px;
    background: url("./assets/mosaic-mark-dark.svg") center / contain no-repeat;
  }
</style>
