/**
 * The viewer's state: the open mosaic, the search and the node page. Each change asks the kit,
 * in the page, and keeps only the latest answer, so a slow answer never replaces a newer one.
 *
 * The view file's settings (lib/view.ts) shape what the page shows; the search mode starts as
 * the file's `search`. In *Text* mode the mosaic is opened without the query embedder, so `find`
 * searches names and full text only; in *Semantic* mode it is opened with the embedder, when
 * the page has one (section 3.8). Switching the mode opens the same bytes again.
 */
import { FileRefusedError, type QueryEmbedder, type SealedFile } from "@mosaic/kit";
import { cardFacts, type Fact } from "./cards.js";
import type { Chain } from "./chain.js";
import { LinkReader } from "./links.js";
import { PlaceSearches } from "./placesearch.svelte.js";
import { ChainTable } from "./chaintable.svelte.js";
import { resultCards, type ResultRow } from "./resultcards.js";
import { ResultTable } from "./resulttable.js";
import { ChainResults, type Count, type Result } from "./results.js";
import { nodePage, openMosaic, search, type NodeView, type SearchView, type ToolFailure } from "./mosaic.js";
import type { ChainLinkRoute, TableRoute } from "./route.js";
import { linkOf, linkSettings, tableChoices } from "./chainlink.js";
import { tableView, type TableView } from "./tables.js";
import { chooseCard } from "./cardpick.js";
import { checkChains, checkOne, type SavedChain } from "./viewchains.js";
import { DEFAULT_VIEW, Shape, type CardSettings, type SearchMode, type ViewSettings } from "./view.js";
import type { ViewId } from "./views.js";

/** A chain's count as the page shows it: the count so far, and whether it is done. */
export interface ChainCount extends Count {
  readonly done: boolean;
}

export type Status = "empty" | "loading" | "ready" | "error";

/**
 * Whether the open file is what was sealed: its hashes are checked after it shows, so the page
 * opens at once. A file that fails the check stays open, with a warning.
 */
export type Seal = "checking" | "verified" | "not verified";

export class Viewer {
  /** The open mosaic, or null before one is opened. */
  file = $state.raw<SealedFile | null>(null);
  status = $state<Status>("empty");
  /** The hash check of the open file, and what it found when the hashes differ. */
  seal = $state<Seal | null>(null);
  sealFailure = $state<string | null>(null);
  /** Why the last file could not be opened. */
  error = $state<string | null>(null);
  /** What embeds queries for `find`'s vector tier, when the page was given the model. */
  embedder = $state.raw<QueryEmbedder | null>(null);
  /** Why the model could not be loaded; the page then searches by names and full text only. */
  modelError = $state<string | null>(null);
  query = $state("");
  results = $state.raw<SearchView | ToolFailure | null>(null);
  nodeId = $state<string | null>(null);
  page = $state.raw<NodeView | ToolFailure | null>(null);
  /** The open thing's card facts with their rows (lib/cards.ts), once `cite` has answered. */
  facts = $state.raw<readonly Fact[] | null>(null);
  /** The table view asked for, and its page from `table`. */
  tableRoute = $state.raw<TableRoute | null>(null);
  table = $state.raw<TableView | ToolFailure | null>(null);
  /** The view file's settings; the defaults are M2's viewer. */
  view = $state.raw<ViewSettings>(DEFAULT_VIEW);
  /** The view file applied to the open mosaic, or null before one is opened. */
  shape = $state.raw<Shape | null>(null);
  /** How `find` searches: with the embedder (*Semantic*) or by names and full text (*Text*). */
  mode = $state<SearchMode>(DEFAULT_VIEW.search);
  /** The view of the whole mosaic the address names (lib/views.ts), or null. */
  viewId = $state<ViewId | null>(null);

  #searches = 0;
  #pages = 0;
  #tables = 0;
  #opens = 0;
  #opened: { bytes: Uint8Array; name: string } | null = null;

  /** The embedder `find` uses in the current mode, if any. */
  get searchEmbedder(): QueryEmbedder | null {
    return this.mode === "semantic" ? this.embedder : null;
  }

  /**
   * The types whose card the person chose in the page, not yet in the view file, in
   * the order first chosen.
   */
  chosen = $state.raw<readonly string[]>([]);
  /** The view file's settings, as read, before any card chosen in the page. */
  #fileView: ViewSettings = DEFAULT_VIEW;

  /** The chain the *Chain* view builds, or null before one is started. */
  chain = $state.raw<Chain | null>(null);
  /** How many results the chain has, as counted so far: it grows until `done`. */
  chainCount = $state.raw<ChainCount | null>(null);
  /** The result of the chain shown as a row of cards, from 0, in the chain's order. */
  chainIndex = $state(0);
  /** That result's row of cards, or null when the chain has none to show. */
  chainRow = $state.raw<ResultRow | null>(null);
  /** Why the result asked for could not be shown, naming it; null when it was. */
  chainFailure = $state<string | null>(null);
  /**
   * While the table sorts or filters the results, how many rows its filters keep and how
   * many results there are: the cards then move among those rows, in the table's order; null
   * when the cards follow the chain's order.
   */
  chainArranged = $state.raw<{ readonly matching: number; readonly total: number } | null>(null);
  /** How the chain's results show: a row of cards per result, or all of them as one table. */
  chainShow = $state<"cards" | "table">("cards");
  /** The chain's results as one table, or null with no chain. */
  chainTable = $state.raw<ChainTable | null>(null);
  /** Settles when the result asked for last is shown; for tests and the page. */
  shown: Promise<void> = Promise.resolve();
  #results: ChainResults | null = null;
  #showing = 0;
  /** Stops the walk of the result asked for before, when another is asked for. */
  #showStop: AbortController | null = null;
  /** The result asked for last, which may still be on its way. */
  #wanted = 0;
  /** Settles when the result asked for last is shown, whoever asked for it. */
  #latestShow: Promise<void> = Promise.resolve();
  /** True once the table has opened on the cards' place since the last switch to it. */
  #tablePlaced = false;
  /** What the chain's places found when searched for a thing to pin, on the open mosaic. */
  readonly searches = new PlaceSearches();
  /** What the last link to a chain named that the open mosaic or the chain's table lacks. */
  linkNotices = $state.raw<readonly string[]>([]);
  /** True while a link to a chain is being applied: the address waits for it. */
  linking = $state(false);
  #linkings = 0;
  /** The chains the view file saves that the open mosaic can apply (V-16), in order. */
  savedChains = $state.raw<readonly SavedChain[]>([]);
  /** Why each other chain the view file saves cannot be applied, naming it (V-18). */
  chainNotices = $state.raw<readonly string[]>([]);
  /** Settles when the view file's chains have been checked on the open mosaic; for tests. */
  chainsChecked: Promise<void> = Promise.resolve();
  #checks = 0;
  /** Settles when the latest chain's count has; for tests and the page. */
  counted: Promise<void> = Promise.resolve();
  #counting: AbortController | null = null;
  /** The links read for chains on the open mosaic, kept across changes to the chain. */
  #links: { file: SealedFile; reader: LinkReader } | null = null;

  /**
   * Make `chain` the chain, and count its results at once (V-5): the count of the chain it
   * replaces stops, and the new one reports as it grows, then exactly (V-13).
   */
  setChain(chain: Chain | null): void {
    this.#counting?.abort();
    this.#counting = null;
    this.chain = chain;
    const file = this.file;
    if (chain === null || file === null) {
      this.chainCount = null;
      this.counted = Promise.resolve();
      this.#results = null;
      this.chainTable?.dispose();
      this.chainTable = null;
      this.#showStop?.abort();
      this.#showing++;
      this.chainIndex = 0;
      this.chainRow = null;
      this.chainArranged = null;
      this.chainFailure = null;
      this.shown = Promise.resolve();
      return;
    }
    if (this.#links?.file !== file) this.#links = { file, reader: new LinkReader(file) };
    this.#results = new ChainResults(file, chain, this.#links.reader);
    this.#newTable();
    this.chainRow = null;
    this.shown = this.showResult(0);
    const stop = new AbortController();
    this.#counting = stop;
    this.chainCount = { total: 0, exact: false, done: false, notes: [] };
    const live = () => !stop.signal.aborted;
    this.counted = new ChainResults(file, chain, this.#links.reader)
      .count({ signal: stop.signal, progress: (n) => live() && (this.chainCount = { total: n, exact: false, done: false, notes: [] }) })
      .then(
        (c) => {
          if (live()) this.chainCount = { ...c, done: true };
        },
        (e: unknown) => {
          if (live()) this.chainCount = { total: this.chainCount?.total ?? 0, exact: false, done: true, notes: [`the count stopped: ${String(e)}`] };
        },
      );
  }

  /**
   * Show result `index` of the chain, in the chain's order, kept between the first
   * and the last there is: a row of cards, one per place, joined by the links between them. A
   * newer call stops this one's walk; a failure clears the row and says which result failed.
   */
  showResult(index: number): Promise<void> {
    const shown = this.#showResult(index);
    this.#latestShow = shown;
    return shown;
  }

  async #showResult(index: number): Promise<void> {
    const results = this.#results;
    const file = this.file;
    const chain = this.chain;
    if (results === null || file === null || chain === null) return;
    this.#showStop?.abort();
    const stop = new AbortController();
    this.#showStop = stop;
    const mine = ++this.#showing;
    const want = Number.isNaN(index) || index < 0 ? 0 : Math.min(Math.trunc(index), Number.MAX_SAFE_INTEGER);
    this.#wanted = want;
    try {
      const table = this.chainTable;
      let found: { at: number; result: Result } | null;
      let arranged: { matching: number; total: number } | null = null;
      if (table !== null && table.arranged) {
        // The table's rows as sorted and filtered: the place is a position among them.
        const rows = await table.arrangedRows();
        // Only a filter changes how many there are: a sort alone says "Result i of N".
        if (table.filtered) arranged = { matching: rows.length, total: table.read ?? rows.length };
        const at = Math.min(want, rows.length - 1);
        const [result] = at < 0 ? [] : await results.page(rows[at]!.index, 1, stop.signal);
        found = result === undefined ? null : { at, result };
      } else {
        found = await this.#lastUpTo(results, want, stop.signal);
      }
      const row = found === null ? null : await resultCards(file, chain, found.result, this.shape);
      if (mine !== this.#showing) return;
      this.chainIndex = found?.at ?? 0;
      // The table's place follows the cards: a later sort or filter starts from this result.
      if (found !== null && table !== null && table === this.chainTable && this.chainShow === "cards") table.current = found.at;
      this.chainRow = row;
      this.chainArranged = arranged;
      this.chainFailure = null;
    } catch (e) {
      if (mine !== this.#showing) return;
      this.chainRow = null;
      this.chainFailure = `Result ${want + 1} could not be shown: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * Result `want`, or when the chain has fewer, the last it has: found by halving between the
   * last result known to be there (the count so far) and `want`, never by one walk per step.
   */
  async #lastUpTo(results: ChainResults, want: number, signal: AbortSignal): Promise<{ at: number; result: Result } | null> {
    const [result] = await results.page(want, 1, signal);
    if (result !== undefined) return { at: want, result };
    // The count, done or not, has found this many: there are at least as many results; once it
    // is done and exact, there are no more.
    const count = this.chainCount;
    let there = Math.min(count?.total ?? 0, want) - 1;
    let missing = count?.done === true && count.exact ? Math.min(count.total, want) : want;
    while (missing - there > 1) {
      const mid = there + Math.floor((missing - there) / 2);
      if ((await results.page(mid, 1, signal))[0] !== undefined) there = mid;
      else missing = mid;
    }
    if (there < 0) return null;
    const [last] = await results.page(there, 1, signal);
    return last === undefined ? null : { at: there, result: last };
  }

  /**
   * The view file's chains on the open mosaic: those it can apply, and a notice for each
   * other one, naming it and what the mosaic lacks (V-18), in the order the file writes them;
   * pinned things are looked up with the kit, so this settles later (`chainsChecked`). The
   * latest check wins.
   */
  #checkChains(): void {
    const n = ++this.#checks;
    const file = this.file;
    if (file === null) {
      this.savedChains = [];
      this.chainNotices = [];
      this.chainsChecked = Promise.resolve();
      return;
    }
    this.savedChains = [];
    this.chainNotices = [];
    const reader = this.#links?.file === file ? this.#links.reader : new LinkReader(file);
    this.chainsChecked = checkChains(this.view.chains, file, async (id) => (await reader.thing(id)) !== null).then((checked) => {
      if (n !== this.#checks) return;
      this.savedChains = checked.chains;
      this.chainNotices = checked.notices;
    });
  }

  /**
   * Shape the page by the view file's settings; the search mode becomes the file's `search`. A
   * view file read again replaces the cards chosen in the page: it is what they were copied into.
   */
  async setView(view: ViewSettings): Promise<void> {
    this.#fileView = view;
    this.chosen = [];
    this.view = view;
    if (this.file !== null) this.shape = new Shape(view, this.file);
    this.#checkChains();
    if (this.chainTable !== null) this.#newTable();
    await Promise.all([this.#cardFacts(this.#pages), this.#redrawRow()]);
    await this.setMode(view.search);
    if (this.tableRoute !== null) await this.showTable(this.tableRoute);
  }

  /** Make `card` its type's card on every card of the type in the page (V-6, V-7). */
  async chooseCard(card: CardSettings): Promise<void> {
    if (!this.chosen.includes(card.name)) this.chosen = [...this.chosen, card.name];
    await this.#reshape(chooseCard(this.view, card));
  }

  /** Give `type` the view file's card again (or the default, with none set). */
  async resetCard(type: string): Promise<void> {
    if (!this.chosen.includes(type)) return;
    this.chosen = this.chosen.filter((t) => t !== type);
    const set = this.#fileView.cards?.find((c) => c.name === type);
    const cards = (this.view.cards ?? []).flatMap((c) => (c.name !== type ? [c] : set === undefined ? [] : [set]));
    await this.#reshape({ ...this.view, cards: this.#fileView.cards === null && cards.length === 0 ? null : cards });
  }

  async #reshape(view: ViewSettings): Promise<void> {
    this.view = view;
    if (this.file !== null) this.shape = new Shape(view, this.file);
    if (this.chainTable !== null) this.#newTable();
    await Promise.all([this.#cardFacts(this.#pages), this.#redrawRow()]);
  }

  /**
   * The link to the chain shown (V-17): the chain, its pins, the view, the place in the
   * results (the cards' result, or the table's current row) and the table's sort and filters;
   * null without a chain.
   */
  chainLink(): ChainLinkRoute | null {
    const chain = this.chain;
    const table = this.chainTable;
    if (chain === null || table === null) return null;
    const place = this.chainShow === "table" ? table.current : this.chainIndex;
    return linkOf(chain, this.chainShow, place, table.table.columns, { sort: table.sort, filters: table.filters });
  }

  /**
   * The chain the address should hold: the link to the chain shown, null for none, or undefined
   * to leave the address as it is, while a link's chain could not open: the link and what it
   * names stay there, beside the notice (V-18).
   */
  chainAddress(): ChainLinkRoute | null | undefined {
    if (this.chain === null && this.linkNotices.length > 0) return undefined;
    return this.chainLink();
  }

  /** Make `chain` the chain the person chose (the builder, a saved chain): a link's notices go. */
  chooseChain(chain: Chain | null): void {
    this.linkNotices = [];
    this.setChain(chain);
  }

  /**
   * Open the chain a link names (V-17, V-18) with its view, place, sort and filters, as far
   * as the open mosaic allows; `linkNotices` says what it could not apply. A chain the mosaic
   * cannot apply opens no chain. A later link, or another mosaic, stops this one.
   */
  async openChainLink(link: ChainLinkRoute): Promise<void> {
    const file = this.file;
    if (file === null) return;
    const mine = ++this.#linkings;
    this.linking = true;
    const live = () => mine === this.#linkings && this.file === file;
    try {
      const reader = this.#links?.file === file ? this.#links.reader : new LinkReader(file);
      const { chain, faults } = await checkOne(linkSettings(link), file, async (id) => (await reader.thing(id)) !== null);
      if (!live()) return;
      const notices = faults.map((f) => `link: ${f}`);
      if (chain === null) {
        this.setChain(null);
        this.linkNotices = notices;
        return;
      }
      this.chainShow = "cards";
      this.setChain(chain);
      const table = this.chainTable!;
      const chosen = tableChoices(link, table.table.columns);
      table.restore(chosen.choices);
      // The place is found as the cards find it, kept to the results there are; then the table.
      await (this.shown = this.showResult(link.at - 1));
      if (!live()) return;
      if (link.show === "table") {
        this.chainShow = "table";
        await table.showAt(this.chainIndex);
      }
      this.linkNotices = [...notices, ...chosen.notices];
    } finally {
      if (mine === this.#linkings) this.linking = false;
    }
  }

  /** Said beside the result when the table's last change dropped it and the place moved. */
  get chainNotice(): string | null {
    return this.chainTable?.moved === true ? "The result you were on no longer matches." : null;
  }

  /** Move to result `index` from the cards' buttons: the place is the person's again. */
  moveResult(index: number): Promise<void> {
    if (this.chainTable !== null) this.chainTable.moved = false;
    return (this.shown = this.showResult(index));
  }

  /** Clear the table's filters (the empty state's action); the cards show again. */
  async clearChainFilters(): Promise<void> {
    const table = this.chainTable;
    if (table === null) return;
    await table.clearFilters();
    if (this.chainTable === table && this.chainShow === "cards") await (this.shown = this.showResult(table.current));
  }

  /**
   * Show the chain's results as cards or as one table, keeping the chain, the place in the
   * results and the table's sort and filters (V-12): the table opens on the page that holds
   * the result the cards show; the cards show the table's current result, among the rows its
   * filters keep, in its order.
   */
  async showChainAs(show: "cards" | "table"): Promise<void> {
    const was = this.chainShow;
    this.chainShow = show;
    const table = this.chainTable;
    if (table === null || show === was) {
      if (show === "table" && table !== null && table.rows === null) await table.show(table.page);
      return;
    }
    if (show === "table") {
      this.#tablePlaced = false;
      // A result asked for just before the switch is the place (V-12): wait until the last one
      // asked for has shown, then open the table on it.
      let waited: Promise<void> | null = null;
      while (waited !== this.#latestShow) {
        waited = this.#latestShow;
        await waited;
      }
      if (this.chainTable !== table || this.chainShow !== "table") return;
      this.#tablePlaced = true;
      await table.showAt(this.chainIndex);
    } else {
      // Back before the table opened on the place: the cards keep the result asked for last.
      const place = this.#tablePlaced ? table.current : this.#wanted;
      await (this.shown = this.showResult(place));
    }
  }

  /** A new table of the chain's results, with the cards as they are now; shown at once in table mode. */
  #newTable(): void {
    const file = this.file;
    const chain = this.chain;
    const results = this.#results;
    this.chainTable?.dispose();
    if (file === null || chain === null || results === null) {
      this.chainTable = null;
      return;
    }
    this.chainTable = new ChainTable(new ResultTable(file, chain, results, this.shape));
    if (this.chainShow === "table") {
      this.#tablePlaced = true;
      void this.chainTable.show(0);
    }
  }

  /**
   * The result asked for last (shown, or still on its way), drawn again with the cards as they
   * are now (V-7: one card per type).
   */
  #redrawRow(): Promise<void> {
    if (this.chain === null || this.#results === null) return Promise.resolve();
    return (this.shown = this.showResult(this.#wanted));
  }

  /** Search in `mode`; an open mosaic is opened again, and its search and pages asked again. */
  async setMode(mode: SearchMode): Promise<void> {
    if (mode === this.mode) return;
    const previous = this.mode;
    this.mode = mode;
    const opened = this.#opened;
    if (opened === null) return;
    const { query, nodeId, tableRoute } = this;
    const before = this.file;
    await this.open(opened.bytes, opened.name);
    if (this.file === before) {
      this.mode = previous; // the open failed: the file still searches as before
      return;
    }
    await Promise.all([this.search(query), this.show(nodeId), this.showTable(tableRoute)]);
  }

  /** Check `file`'s hashes while the page is used, and say what was found if it is still open. */
  #verify(file: SealedFile): void {
    this.seal = "checking";
    this.sealFailure = null;
    file.verify().then(
      () => {
        if (this.file === file) this.seal = "verified";
      },
      (e: unknown) => {
        if (this.file !== file) return; // closed for another file: nothing to say about this one
        this.seal = "not verified";
        this.sealFailure = e instanceof FileRefusedError ? e.message : String(e);
      },
    );
  }

  /** Open `bytes` as the mosaic `name`, closing the one before; a refused file is an error. */
  async open(bytes: Uint8Array, name: string): Promise<void> {
    this.status = "loading";
    this.error = null;
    const n = ++this.#opens;
    try {
      const file = await openMosaic(bytes, name, this.searchEmbedder);
      if (n !== this.#opens) {
        file.close(); // a newer open (another file, or another search mode) came after this one
        return;
      }
      // The chain's count reads the file being replaced: stop it before the file closes.
      this.#counting?.abort();
      const same = this.#opened?.bytes === bytes;
      this.file?.close();
      this.file = file;
      // The same bytes opened again (another search mode) keep what the check found.
      if (!same || this.seal === null || this.seal === "checking") this.#verify(file);
      this.#opened = { bytes, name };
      this.shape = new Shape(this.view, file);
      this.#checkChains();
      // The same mosaic opened again (another search mode) keeps its chain, counted again on
      // the file now open; another mosaic starts with none (V-3: its own types and links).
      this.setChain(same ? this.chain : null);
      if (!same) {
        this.searches.reset();
        // A link's notices are about the mosaic it was opened on; one still applying stops.
        this.#linkings++;
        this.linking = false;
        this.linkNotices = [];
      }
      this.status = "ready";
      this.results = null;
      this.page = null;
      this.facts = null;
      this.table = null;
    } catch (e) {
      if (n !== this.#opens) return;
      this.status = this.file === null ? "error" : "ready";
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Search the open mosaic with `find`; an empty query clears the results. */
  async search(query: string): Promise<void> {
    this.query = query;
    const n = ++this.#searches;
    if (this.file === null || query.trim() === "") {
      this.results = null;
      return;
    }
    const view = await search(this.file, query);
    if (n === this.#searches) this.results = view;
  }

  /** Show the page of the node `id` (null closes it). */
  async show(id: string | null): Promise<void> {
    this.nodeId = id;
    const n = ++this.#pages;
    if (this.file === null || id === null) {
      this.page = null;
      this.facts = null;
      return;
    }
    const view = await nodePage(this.file, id);
    if (n !== this.#pages) return;
    this.page = view;
    this.facts = null;
    await this.#cardFacts(n);
  }

  /** The open thing's card facts, as its type's card in the view file sets them. */
  async #cardFacts(n: number): Promise<void> {
    const page = this.page;
    if (this.file === null || page === null || "message" in page) return;
    const facts = await cardFacts(this.file, page, this.shape);
    if (n === this.#pages && this.page === page) this.facts = facts;
  }

  /** Show a page of a table view with `table` (null closes it). */
  async showTable(route: TableRoute | null): Promise<void> {
    this.tableRoute = route;
    const n = ++this.#tables;
    if (this.file === null || route === null) {
      this.table = null;
      return;
    }
    const shape = this.shape;
    const view =
      shape !== null && !shape.lists(route.type)
        ? { message: `The view file does not list ${route.type}, so its table is not shown.`, suggestions: [] }
        : await tableView(this.file, route, shape?.columns(route.type) ?? null);
    if (n === this.#tables) this.table = view;
  }
}
