<script lang="ts">
  /**
   * The viewer's shell (brand book, section 6): a header band with the mosaic's name, its short
   * knowledge hash and the search field; then the results, the node's card, and its links and
   * sources; or the tables rebuilt from the mosaic's node types, each page one `table` call. The
   * kit runs in this page: a mosaic is opened from a file the reader picks, or from
   * the address's `?mosaic=<url>`, and nothing is asked of a server but the file itself. When the
   * address also names the model (`?model=<url>`, from `mosaic view --model`), it is loaded in
   * the page first, so `find` searches by vectors too; a model that fails to load is shown as an
   * error and the page searches by names and full text only (section 3.8). The view file's
   * settings, from the address's `?view=<url>` (lib/view.ts), shape the page: the types listed,
   * their labels, columns and node pages, the theme and the search mode; what they name that the
   * mosaic does not have is shown as a notice, and the page still opens. The page asks for them
   * again every second, so a view file saved under `mosaic view` reshapes it; settings that
   * cannot be read (a file saved with an error) are shown as an error and the page stays as it was.
   * A single-file export (lib/exported.ts) holds its mosaic, its view file's settings and SQLite's
   * WebAssembly in the document: the page opens them, fetches nothing, watches nothing, and says
   * it is a read-only export (brand book, section 6, Shell).
   *
   * The shell: the header band with the dark mark; below it the view switcher
   * (components/ViewBar.svelte, lib/views.ts), whose views not built yet say when they come; then
   * three columns at 1280px and up (results, the card, the context column), two from 960px
   * (the context column under the card), and below 960px one column at a time, chosen by tabs.
   * A table view keeps the thing that was open in the address, so the switch's Card goes back
   * to it.
   */
  import { onMount, tick } from "svelte";
  import CardPicker from "./components/CardPicker.svelte";
  import ChainView from "./components/ChainView.svelte";
  import EntityCard from "./components/EntityCard.svelte";
  import NodeContext from "./components/NodeContext.svelte";
  import ResultList from "./components/ResultList.svelte";
  import ResultRow from "./components/ResultRow.svelte";
  import ResultTableView from "./components/ResultTableView.svelte";
  import NeighbourhoodView from "./components/NeighbourhoodView.svelte";
  import OverviewView from "./components/OverviewView.svelte";
  import SchemaView from "./components/SchemaView.svelte";
  import SearchField from "./components/SearchField.svelte";
  import TableView from "./components/TableView.svelte";
  import TypeList from "./components/TypeList.svelte";
  import ViewBar from "./components/ViewBar.svelte";
  import { fetchNamedModel, fetchNamedMosaic, loadModel, shortHash } from "./lib/mosaic.js";
  import { hoodRoute } from "./lib/graph/hood-address.js";
  import type { HoodState } from "./lib/graph/hood.js";
  import { parseRoute, routeHash, type ChainLinkRoute, type Condition, type HoodChoices, type TableRoute } from "./lib/route.js";
  import { useSqliteWasm } from "@mosaic/kit";
  import { cutFrom, readExport, runtimeOf } from "./lib/exported.js";
  import { cardsText, pickOptions, startingCard, toggle } from "./lib/cardpick.js";
  import { findThings, type Answer } from "./lib/placesearch.svelte.js";
  import { applyTheme, DEFAULT_VIEW, Shape, watchView } from "./lib/view.js";
  import { Viewer } from "./lib/viewer.svelte.js";
  import { viewNamed, type ThingViewId, type ViewId } from "./lib/views.js";

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

  const hrefFor = (id: string): string => routeHash({ query: viewer.query, node: id });
  const tableHref = (table: TableRoute): string => routeHash({ query: viewer.query, node: viewer.nodeId, table });
  const typeHref = (type: string): string => tableHref({ type, page: 1, order: null, where: [] });
  const viewHref = (view: ViewId): string => routeHash({ query: viewer.query, node: viewer.nodeId, view });

  /** The view of the whole mosaic that is open, if the address names one. */
  let view = $derived(viewer.viewId === null ? undefined : viewNamed(viewer.viewId));

  /** How the current thing is shown: its card, its type's table, or nothing. */
  let thing = $derived<ThingViewId | null>(
    view
      ? view.id === "neighbourhood" && viewer.nodeId !== null
        ? "graph"
        : null
      : viewer.tableRoute
        ? "table"
        : viewer.nodeId !== null
          ? "card"
          : null,
  );

  /** The type of the thing whose page is open, once `get` has answered. */
  let thingType = $derived(viewer.page && "node" in viewer.page ? viewer.page.node.type : null);
  /** The open thing's type's card, as the picker starts from it. */
  let pickedCard = $derived(viewer.file !== null && thingType !== null ? startingCard(viewer.view, viewer.file, thingType) : null);

  /** Things of `type` named like `query`, for pinning a chain's place: the kit's `find`. */
  function findIn(type: string, query: string): Promise<Answer> {
    return viewer.file === null ? Promise.resolve([]) : findThings(viewer.file, type, query);
  }

  function thingHref(id: ThingViewId): string | null {
    if (id === "card") return viewer.nodeId === null ? null : hrefFor(viewer.nodeId);
    // A thing's graph is its neighbourhood, centred on it (G-3).
    if (id === "graph") return viewer.nodeId === null ? null : viewHref("neighbourhood");
    if (id === "table") {
      if (viewer.tableRoute) return tableHref(viewer.tableRoute);
      return thingType === null ? null : typeHref(thingType);
    }
    return null;
  }

  function thingNote(id: ThingViewId): string {
    if (id === "graph") return "Open a thing first to see its neighbourhood: search for it, or pick a row of a table.";
    return id === "card"
      ? "Open a thing first: search for it, or pick a row of a table."
      : "Open a thing first to see its type's table, or pick a type under Tables.";
  }

  type Tab = "results" | "main" | "context";

  /** The tab a person picked since the address last changed, if any. */
  let pickedTab = $state<Tab | null>(null);

  /** The columns as tabs: the context column only beside a thing's page. */
  let tabs = $derived.by(() => {
    const main = view ? view.label : viewer.tableRoute ? "Table" : "Card";
    const all: { id: Tab; label: string }[] = [
      { id: "results", label: "Results" },
      { id: "main", label: main },
    ];
    if (!view && !viewer.tableRoute) all.push({ id: "context", label: "Links and sources" });
    return all;
  });

  /** The tab shown below 960px: the one picked, else the open thing, view or table, else the results. */
  let tab = $derived.by((): Tab => {
    if (pickedTab !== null && tabs.some((t) => t.id === pickedTab)) return pickedTab;
    return view || viewer.tableRoute || viewer.nodeId !== null ? "main" : "results";
  });

  /** A column's attributes as a tab panel, below 960px only. */
  function panel(id: Tab): Record<string, string | boolean | undefined> {
    if (!narrow) return {};
    return { role: "tabpanel", id: `panel-${id}`, "aria-labelledby": `tab-${id}`, hidden: id !== tab };
  }

  async function choose(id: Tab, focus: boolean): Promise<void> {
    pickedTab = id;
    if (focus) {
      await tick();
      document.getElementById(`tab-${id}`)?.focus();
    }
  }

  /** Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern, automatic activation). */
  function tabKey(event: KeyboardEvent): void {
    const at = tabs.findIndex((t) => t.id === tab);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    void choose(tabs[(to + tabs.length) % tabs.length]!.id, true);
  }

  function filtered(condition: Condition): void {
    const table = viewer.tableRoute;
    if (table) location.hash = tableHref({ ...table, page: 1, where: [...table.where, condition] });
  }

  /** The choices a neighbourhood's address holds (G-8), for the neighbourhood view to open. */
  let hoodAddress = $state<HoodChoices | null>(null);

  /** The neighbourhood's address follows each choice made in it, without a step for Back (G-8). */
  function writeHood(state: HoodState): void {
    const hash = routeHash({ ...hoodRoute(state), query: viewer.query });
    if (hash !== location.hash) history.replaceState(history.state, "", hash);
  }

  /** True once the address has been read on the open mosaic: until then, the page does not write it. */
  let addressRead = $state(false);

  /**
   * The chain view's address follows the chain, the view, the place and the table's sort and
   * filters, without a step for Back (V-17): it is the link to give a colleague. It waits
   * while a link is applied, and until the address has been read on the open mosaic.
   */
  $effect(() => {
    if (!addressRead || viewer.linking || viewer.viewId !== "chain" || viewer.status !== "ready") return;
    const chain = viewer.chainAddress();
    if (chain === undefined) return;
    const hash = routeHash({ query: viewer.query, node: viewer.nodeId, view: "chain", chain });
    if (hash !== location.hash) history.replaceState(history.state, "", hash);
  });

  /** The link part of a chain view's address, to tell whether a link names the chain shown. */
  const chainHash = (chain: ChainLinkRoute | null): string => routeHash({ query: "", node: null, view: "chain", chain });

  /** Follow the address after `#`: the query, and the node, the table view or the chain it names. */
  function follow(): void {
    const route = parseRoute(location.hash);
    viewer.viewId = route.view ?? null;
    hoodAddress = route.hood ?? null;
    pickedTab = null;
    if (route.query !== viewer.query || viewer.results === null) void viewer.search(route.query);
    if (route.node !== viewer.nodeId || viewer.page === null) void viewer.show(route.node);
    const table = route.table ?? null;
    if (routeHash({ query: "", node: null, table }) !== routeHash({ query: "", node: null, table: viewer.tableRoute }) || viewer.table === null) {
      void viewer.showTable(table);
    }
    if (route.view === "chain" && route.chain && viewer.file !== null && chainHash(route.chain) !== chainHash(viewer.chainLink())) {
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
      onsearch={(query) => (location.hash = routeHash({ query, node: viewer.nodeId }))}
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
  <ViewBar view={viewer.viewId} {thing} {viewHref} {thingHref} {thingNote} />
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

{#if viewer.file === null}
  <main class="start">
    <p class="empty body-screen">Open a mosaic to search it. It is read in this page; nothing is sent anywhere.</p>
  </main>
{:else}
  <main class="columns">
    {#if narrow}
      <div class="tabs" role="tablist" aria-label="Columns" tabindex="-1" onkeydown={tabKey}>
        {#each tabs as t (t.id)}
          <button
            class="tab body-screen"
            type="button"
            role="tab"
            id="tab-{t.id}"
            aria-selected={t.id === tab}
            aria-controls="panel-{t.id}"
            tabindex={t.id === tab ? 0 : -1}
            onclick={() => void choose(t.id, false)}>{t.label}</button
          >
        {/each}
      </div>
    {/if}
    <nav class="results" aria-label="Results" {...panel("results")}>
      {#if viewer.results}
        <ResultList view={viewer.results} selected={viewer.nodeId} {hrefFor} typeLabel={(type) => viewer.shape?.typeLabel(type) ?? type} />
      {:else}
        <p class="empty body-screen">Search for a name, an alias or words in the text.</p>
      {/if}
      <TypeList
        types={viewer.shape?.types ?? viewer.file.nodeTypes}
        selected={viewer.tableRoute?.type ?? null}
        hrefFor={typeHref}
        labelFor={(type) => viewer.shape?.typeLabel(type) ?? type}
      />
    </nav>
    {#if view}
      <section class="wide" aria-label={view.label} {...panel("main")}>
        <h2 class="title panel-title">{view.label}</h2>
        {#if !view.available}
          <p class="empty body-screen">{view.note}</p>
        {:else if view.id === "schema"}
          <SchemaView file={viewer.file} shape={viewer.shape ?? new Shape(DEFAULT_VIEW, viewer.file)} {hrefFor} {tableHref} />
        {:else if view.id === "overview"}
          <OverviewView
            file={viewer.file}
            shape={viewer.shape ?? new Shape(DEFAULT_VIEW, viewer.file)}
            {hrefFor}
            {tableHref}
            hoodHref={(id) => routeHash({ query: viewer.query, node: id, view: "neighbourhood" })}
          />
        {:else if view.id === "neighbourhood"}
          <NeighbourhoodView
            file={viewer.file}
            shape={viewer.shape ?? new Shape(DEFAULT_VIEW, viewer.file)}
            centre={viewer.nodeId}
            {hrefFor}
            {tableHref}
            hoodHref={(id) => routeHash({ query: viewer.query, node: id, view: "neighbourhood" })}
            address={hoodAddress}
            onchoices={writeHood}
          />
        {:else if view.id === "chain"}
          <ChainView schema={viewer.file} chain={viewer.chain} count={viewer.chainCount} shape={viewer.shape} onchange={(c) => viewer.chooseChain(c)} find={findIn} searches={viewer.searches} saved={viewer.savedChains} fileChains={viewer.view.chains ?? []} />
          {#if viewer.chain !== null}
            <div class="show-as" role="group" aria-label="Show the results as">
              <button class="step-title" type="button" aria-pressed={viewer.chainShow === "cards"} onclick={() => void viewer.showChainAs("cards")}>Cards</button>
              <button class="step-title" type="button" aria-pressed={viewer.chainShow === "table"} onclick={() => void viewer.showChainAs("table")}>Table</button>
            </div>
          {/if}
          {#if viewer.chainShow === "table" && viewer.chainTable !== null}
            <ResultTableView table={viewer.chainTable} count={viewer.chainCount} {hrefFor} onshow={() => void viewer.showChainAs("cards")} onclear={() => void viewer.clearChainFilters()} />
          {:else if viewer.chainRow !== null}
            <ResultRow row={viewer.chainRow} index={viewer.chainIndex} count={viewer.chainCount} arranged={viewer.chainArranged} notice={viewer.chainNotice} shape={viewer.shape} {hrefFor} onmove={(i) => void viewer.moveResult(i)} />
          {:else if viewer.chainArranged !== null && viewer.chainArranged.matching === 0}
            <div class="empty no-match">
              <p class="body-screen" role="status">No result matches the table's filters.</p>
              <button class="clear step-title" type="button" onclick={() => void viewer.clearChainFilters()}>Clear filters</button>
            </div>
          {:else if viewer.chainFailure !== null}
            <p class="empty body-screen" role="alert">{viewer.chainFailure}</p>
          {/if}
        {/if}
      </section>
    {:else if viewer.tableRoute}
      <div class="wide" {...panel("main")}>
        {#key viewer.tableRoute.type}
          <TableView
            view={viewer.table}
            route={viewer.tableRoute}
            hrefFor={tableHref}
            nodeHref={hrefFor}
            onfilter={filtered}
            shape={viewer.shape}
          />
        {/key}
      </div>
    {:else if viewer.page && "message" in viewer.page}
      <section class="entity" {...panel("main")}>
        <p class="banner body-screen" role="alert">{viewer.page.message}</p>
        {#if viewer.page.suggestions.length > 0}
          <p class="caption">Closest:</p>
          <ul class="suggestions code">
            {#each viewer.page.suggestions as id (id)}
              <li><a href={hrefFor(id)}>{id}</a></li>
            {/each}
          </ul>
        {/if}
      </section>
      <aside class="context" {...panel("context")}></aside>
    {:else if viewer.page}
      <section class="entity" {...panel("main")}>
        <EntityCard node={viewer.page.node} shape={viewer.shape} facts={viewer.facts} {hrefFor} />
        {#if viewer.file !== null && pickedCard !== null}
          {@const file = viewer.file}
          {@const card = pickedCard}
          <CardPicker
            type={card.name}
            options={pickOptions(file, card.name)}
            {card}
            chosen={viewer.chosen.includes(card.name)}
            text={cardsText(viewer.view.cards?.length ? viewer.view.cards : [card])}
            shape={viewer.shape}
            onpick={(part, name, on) => void viewer.chooseCard(toggle(card, part, name, on))}
            onreset={() => void viewer.resetCard(card.name)}
          />
        {/if}
      </section>
      <aside class="context" aria-label="Links and sources" {...panel("context")}>
        <NodeContext view={viewer.page} {hrefFor} shape={viewer.shape} />
      </aside>
    {:else}
      <section class="entity" {...panel("main")}><p class="empty body-screen">Pick a result to see its page.</p></section>
      <aside class="context" {...panel("context")}>
        <p class="empty body-screen">A thing's links and sources show here.</p>
      </aside>
    {/if}
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
    padding: var(--space-5) var(--space-4);
  }

  .show-as {
    display: inline-flex;
    margin-block-start: var(--space-4);
  }

  .show-as button {
    min-block-size: var(--space-6);
    padding: 0 var(--space-3);
    border: 1px solid var(--accent);
    background: var(--surface);
    color: var(--accent);
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .show-as button:first-child {
    border-start-start-radius: var(--radius-md);
    border-end-start-radius: var(--radius-md);
  }

  .show-as button:last-child {
    border-inline-start: none;
    border-start-end-radius: var(--radius-md);
    border-end-end-radius: var(--radius-md);
  }

  .no-match {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .no-match p {
    margin: 0;
  }

  .clear {
    min-block-size: var(--space-6);
    padding: 0 var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--accent);
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .clear:hover {
    background: var(--surface-tint);
  }

  .clear:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .show-as button[aria-pressed="true"] {
    background: var(--accent);
    color: var(--surface);
  }

  .show-as button:focus-visible {
    position: relative;
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .empty {
    margin: var(--space-3);
    color: var(--ink-muted);
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
  }

  .columns > [hidden] {
    display: none;
  }

  .tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4) 0;
    border-block-end: 1px solid var(--border);
  }

  .tab {
    padding: var(--space-2) var(--space-3);
    border: none;
    border-block-end: 2px solid transparent;
    background: none;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }

  .tab:hover:not([aria-selected="true"]) {
    background: var(--surface-tint);
  }

  .tab:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .tab[aria-selected="true"] {
    border-block-end-color: var(--accent);
    background: var(--surface-tint);
    color: var(--accent);
  }

  .results,
  .context {
    border-block-end: 1px solid var(--border);
  }

  .wide {
    min-inline-size: 0;
  }

  .title {
    margin: var(--space-5) var(--space-4) var(--space-2);
    color: var(--heading);
  }

  .suggestions {
    margin: 0;
    padding-inline-start: var(--space-4);
  }

  /* From 960px: the results beside the card, the context column under the card. */
  @media (width >= 960px) {
    .columns {
      grid-template-columns: 320px minmax(0, 1fr);
      grid-template-areas:
        "results main"
        "results context";
      grid-template-rows: auto 1fr;
      min-block-size: calc(100vh - var(--app-header));
    }

    .results {
      grid-area: results;
      border-block-end: none;
      border-inline-end: 1px solid var(--border);
    }

    .entity,
    .wide {
      grid-area: main;
    }

    .context {
      grid-area: context;
      border-block: 1px solid var(--border) none;
    }

    .wide {
      grid-row: 1 / span 2;
    }
  }

  /* From 1280px: three columns, results (320px), the card, the context column (320px). */
  @media (width >= 1280px) {
    .columns {
      grid-template-columns: 320px minmax(0, 1fr) 320px;
      grid-template-areas: "results main context";
      grid-template-rows: auto;
    }

    .context {
      border-block: none;
      border-inline-start: 1px solid var(--border);
    }

    .wide {
      grid-area: 1 / 2 / 2 / 4;
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
