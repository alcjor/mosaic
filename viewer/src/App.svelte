<script lang="ts">
  /**
   * The viewer's shell (brand book, section 6). The page fits the window and never scrolls as a
   * whole. From the top: the navy band, with the mosaic's name, its short knowledge hash and
   * the search field, whose results drop down under it (opening one lands in Explore); a row
   * with the four places (lib/places.ts) and, at its right, the verified mark, the Semantic /
   * Text switch and a menu; whatever the page has to say (errors, notices), which scrolls on
   * its own when long; then the place, one component each in `places/`:
   *
   * - Home: the map of types, and the view file's saved trails in the pane.
   * - Explore: the graph round the thing the address names, the selected thing's card in the
   *   pane, and the search results that led there.
   * - Trails: a chain, built step by step, shown as columns (one per place) or as one table.
   * - Tables: a type's table.
   *
   * The shell hands every place the same props (places/props.ts) and provides the type colours
   * (lib/typecolour.context.ts); a place's right pane is components/Pane.svelte.
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
   * Below 960px a place is one scrolling column and its pane goes under its main part.
   */
  import { onMount } from "svelte";
  import ModeSwitch from "./components/ModeSwitch.svelte";
  import PlaceBar from "./components/PlaceBar.svelte";
  import SearchField from "./components/SearchField.svelte";
  import Button from "./components/ui/Button.svelte";
  import EmptyState from "./components/ui/EmptyState.svelte";
  import Menu from "./components/ui/Menu.svelte";
  import Explore from "./places/Explore.svelte";
  import Home from "./places/Home.svelte";
  import type { PlaceLinks } from "./places/props.js";
  import Tables from "./places/Tables.svelte";
  import Trails from "./places/Trails.svelte";
  import { fetchNamedModel, fetchNamedMosaic, loadModel, search, shortHash } from "./lib/mosaic.js";
  import { hoodRoute } from "./lib/graph/hood-address.js";
  import type { HoodState } from "./lib/graph/hood.js";
  import type { PlaceId } from "./lib/places.js";
  import { parseRoute, routeHash, type ChainLinkRoute, type HoodChoices, type TableRoute } from "./lib/route.js";
  import { useSqliteWasm } from "@mosaic/kit";
  import { cutFrom, readExport, runtimeOf } from "./lib/exported.js";
  import { provideTypeColours } from "./lib/typecolour.context.js";
  import { applyTheme, DEFAULT_VIEW, Shape, watchView } from "./lib/view.js";
  import { Viewer } from "./lib/viewer.svelte.js";

  let {
    viewer = new Viewer(),
    exported = false,
    cutHash = null,
  }: {
    viewer?: Viewer;
    exported?: boolean;
    cutHash?: string | null;
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

  const links: PlaceLinks = { thing: hrefFor, table: tableHref, type: typeHref, trail: trailHref, place: placeHref };

  provideTypeColours((type) => shape?.typeColour(type) ?? null);

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

  let fileInput: HTMLInputElement;
  let about: HTMLDialogElement;

  async function picked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    if (chosen) await opened(new Uint8Array(await chosen.arrayBuffer()), chosen.name);
  }

  /** The search field's results as typed: the kit's `find`, in the mode the switch shows. */
  const findTyped = (query: string) => (viewer.file === null ? Promise.resolve(null) : search(viewer.file, query));

  /** Enter in the search field, or a result picked: Explore, on that thing when one was found. */
  function explore(id: string | null, query: string): void {
    location.hash = routeHash({ query, node: id ?? viewer.nodeId, view: "explore" });
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
      window.removeEventListener("hashchange", follow);
      stopWatching();
    };
  });
</script>

<div class="shell">
  <header class="top">
    <div class="band">
      {#if viewer.file}
        <span class="name code">{viewer.file.name}</span>
        <span class="hash code" title={viewer.file.header.knowledge_hash}>{shortHash(viewer.file.header.knowledge_hash)}</span>
      {:else}
        <span class="name code">Mosaic viewer</span>
      {/if}
      <div class="find">
        <SearchField
          value={viewer.query}
          disabled={viewer.file === null}
          mode={viewer.mode}
          find={findTyped}
          onopen={explore}
          typeLabel={(type) => shape?.typeLabel(type) ?? type}
        />
      </div>
      {#if exported}
        <span class="note caption">Read-only export</span>
        {@const from = viewer.file && viewer.file.header.knowledge_hash === cutHash ? cutFrom(viewer.file.pieces) : null}
        {#if from}
          <span class="note caption" title={from.hash}>from {from.id} {shortHash(from.hash)}</span>
        {/if}
      {:else}
        <span class="note caption">Read in this page · nothing is sent anywhere</span>
      {/if}
    </div>
    {#if viewer.status === "loading"}
      <div class="loading" role="progressbar" aria-label="Opening the mosaic"></div>
    {/if}
    <PlaceBar place={viewer.place} hrefFor={viewer.file ? placeHref : null}>
      {#snippet status()}
        {#if viewer.seal}
          <span class="seal" data-seal={viewer.seal} role="status">{viewer.seal === "checking" ? "checking…" : viewer.seal}</span>
        {/if}
        <ModeSwitch mode={viewer.mode} disabled={viewer.file === null} onmode={(mode) => void viewer.setMode(mode)} />
        <Menu
          label="More"
          items={[
            { label: "Open a mosaic…", onselect: () => fileInput.click() },
            { label: "About", onselect: () => about.showModal() },
          ]}
        />
      {/snippet}
    </PlaceBar>
    <input class="file" type="file" accept=".mosaic" aria-label="Open a mosaic" hidden bind:this={fileInput} onchange={picked} />
  </header>

  <!-- What the page has to say: it scrolls on its own, so it never pushes the place past the window. -->
  <div class="says body-app">
    {#if viewer.seal === "not verified"}
      <p class="banner" role="alert" data-seal-warning>
        This file was changed after it was sealed, so it is not the mosaic its hash names. You can
        still browse it. {viewer.sealFailure}
      </p>
    {/if}
    {#if viewer.error}
      <p class="banner" role="alert">{viewer.error}</p>
    {/if}
    {#if viewer.modelError}
      <p class="banner" role="alert">{viewer.modelError}</p>
    {/if}
    {#if viewError}
      <p class="banner" role="alert">{viewError}</p>
    {/if}
    {#if (viewer.shape?.notices.length ?? 0) + viewer.chainNotices.length > 0}
      <ul class="notices" role="status" aria-label="View file notices">
        {#each [...(viewer.shape?.notices ?? []), ...viewer.chainNotices] as notice, i (i)}
          <li>{notice}</li>
        {/each}
      </ul>
    {/if}
    {#if viewer.linkNotices.length > 0}
      <ul class="notices" role="status" aria-label="Link notices">
        {#each viewer.linkNotices as notice, i (i)}
          <li>{notice}</li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if viewer.file === null || shape === null}
    <main class="start">
      <EmptyState message="Open a mosaic to search it. It is read in this page; nothing is sent anywhere.">
        {#snippet action()}<Button onclick={() => fileInput.click()}>Choose a file</Button>{/snippet}
      </EmptyState>
    </main>
  {:else if viewer.place === "home"}
    <Home {viewer} {shape} {links} />
  {:else if viewer.place === "explore"}
    <Explore {viewer} {shape} {links} hood={hoodAddress} onhood={writeHood} />
  {:else if viewer.place === "trails"}
    <Trails {viewer} {shape} {links} />
  {:else}
    <Tables {viewer} {shape} {links} />
  {/if}
</div>

<dialog class="about body-app" bind:this={about} aria-labelledby="about-title">
  <h2 class="panel-title" id="about-title">Mosaic viewer</h2>
  <p>A mosaic is one sealed file of things, their links and the source of every fact. This page reads it here; nothing is sent anywhere.</p>
  {#if viewer.file}
    <p class="code">{viewer.file.name} · {viewer.file.header.knowledge_hash}</p>
  {/if}
  <form method="dialog"><Button type="submit">Close</Button></form>
</dialog>

<style>
  :global(html),
  :global(body) {
    block-size: 100%;
    margin: 0;
    overflow: hidden;
  }

  :global(body) {
    background: var(--page);
    color: var(--ink);
    font-family: var(--font-sans);
  }

  /* The page fits the window: the shell's rows keep their height and the place takes the rest. */
  .shell {
    display: flex;
    flex-direction: column;
    block-size: 100dvh;
    overflow: hidden;
  }

  .top {
    flex: none;
  }

  /* Below 960px the band wraps: its first line names the mosaic, the search field takes the next. */
  .band {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    min-block-size: var(--app-header);
    padding: var(--space-2) var(--space-5);
    box-sizing: border-box;
    background: var(--slab);
    color: var(--band-ink);
  }

  .find {
    display: flex;
    flex: 1 1 100%;
    order: 1;
    min-inline-size: 0;
  }

  .note {
    margin-inline-start: auto;
    color: var(--band-muted);
  }

  .note + .note {
    margin-inline-start: 0;
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

    .note {
      margin-inline-start: 0;
    }
  }

  .name {
    overflow: hidden;
    min-inline-size: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hash {
    color: var(--shard-4);
  }

  .seal[data-seal="not verified"] {
    color: var(--majolica-text);
  }

  .loading {
    block-size: 2px;
    background: var(--accent);
  }

  .says {
    flex: none;
    max-block-size: 25vh;
    overflow: auto;
    background: var(--page);
  }

  .banner {
    margin: var(--space-2) var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--majolica-tint);
    color: var(--majolica-text);
  }

  .notices {
    margin: var(--space-2) var(--space-4);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-5);
    border-inline-start: 3px solid var(--status-warning);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
  }

  .start {
    flex: 1;
    min-block-size: 0;
    overflow: auto;
    inline-size: 100%;
    max-inline-size: 40rem;
    margin-inline: auto;
  }

  .about {
    max-inline-size: 30rem;
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--raised);
    color: var(--ink);
    overflow-wrap: anywhere;
  }

  .about h2 {
    margin: 0;
    color: var(--heading);
  }
</style>
