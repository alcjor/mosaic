<script lang="ts">
  /**
   * SearchField (brand book, section 6): the one search box, on the header band. What is typed
   * is searched as it is typed (`find`) and the results drop down under the field, grouped by
   * how they matched. Arrow keys move through them, Enter opens the one marked (the first,
   * until a key moves it) and Escape closes the list. `onopen` gets the thing to open, or
   * null when the search found nothing, and the query as typed.
   */
  import { TIER_NAMES, type SearchView, type ToolFailure } from "../lib/mosaic.js";
  import Shard from "./Shard.svelte";

  let {
    value = "",
    disabled = false,
    mode = "",
    find,
    onopen,
    typeLabel = (type) => type,
  }: {
    value?: string;
    disabled?: boolean;
    /** The search mode: results found in another mode are searched again. */
    mode?: string;
    /** Search the open mosaic for what is typed. */
    find: (query: string) => Promise<SearchView | ToolFailure | null>;
    onopen: (id: string | null, query: string) => void;
    typeLabel?: (type: string) => string;
  } = $props();

  const id = $props.id();
  /** How long typing rests before it is searched. */
  const REST_MS = 150;

  let draft = $derived(value);
  let open = $state(false);
  let found = $state.raw<{ query: string; mode: string; view: SearchView | ToolFailure | null } | null>(null);
  let active = $state(0);
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** The answer for the text in the field now, in this mode; an earlier text's answer is never shown. */
  let current = $derived(found !== null && found.query === draft && found.mode === mode ? found : null);
  let rows = $derived(current !== null && current.view !== null && !("message" in current.view) ? current.view.groups.flatMap((g) => g.results) : []);
  let shown = $derived(open && current !== null && current.view !== null && draft.trim() !== "");

  /** Search for what is typed now; resolves once its answer shows, or a later search took over. */
  async function ask(): Promise<void> {
    clearTimeout(timer);
    const query = draft;
    if (found?.query === query && found.mode === mode) return;
    const mine = ++asked;
    const view = query.trim() === "" ? null : await find(query);
    if (mine !== asked) return;
    found = { query, mode, view };
    active = 0;
  }

  function typed(): void {
    open = true;
    clearTimeout(timer);
    timer = setTimeout(() => void ask(), REST_MS);
  }

  function close(): void {
    open = false;
    clearTimeout(timer);
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const query = draft;
    // Each ask answers the latest text or gives way to a later one: wait for this text's answer.
    while (query === draft && current === null) await ask();
    if (query !== draft) return;
    close();
    onopen(rows[active]?.id ?? null, query);
  }

  function key(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (shown) event.preventDefault();
      close();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && rows.length > 0) {
      event.preventDefault();
      if (!open) open = true;
      else active = (active + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
    }
  }
</script>

<form
  class="search"
  role="search"
  onsubmit={submit}
  onfocusout={(event) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) close();
  }}
>
  <input
    class="field body-app"
    type="search"
    name="q"
    aria-label="Search the mosaic"
    aria-autocomplete="list"
    aria-controls="{id}-found"
    aria-activedescendant={shown && rows[active] ? `${id}-${active}` : undefined}
    placeholder="Search names, aliases, text…"
    autocomplete="off"
    {disabled}
    bind:value={draft}
    oninput={typed}
    onkeydown={key}
  />
  <div class="found body-app" id="{id}-found" role="listbox" aria-label="Results as you type" hidden={!shown}>
    {#if shown && current !== null && current.view !== null}
      {#if "message" in current.view}
        <p class="none" role="alert">{current.view.message}</p>
      {:else if rows.length === 0}
        <p class="none">No results for “{current.query}”.</p>
      {:else}
        {#each current.view.groups as group (group.match)}
          <div class="tier section-label" role="presentation">{TIER_NAMES[group.match]} · {group.results.length}</div>
          {#each group.results as result (result.id)}
            {@const at = rows.indexOf(result)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="row"
              class:active={at === active}
              id="{id}-{at}"
              role="option"
              tabindex="-1"
              aria-selected={at === active}
              data-id={result.id}
              data-match={group.match}
              onpointermove={() => (active = at)}
              onclick={() => {
                close();
                onopen(result.id, current?.query ?? draft);
              }}
            >
              <Shard type={result.type} />
              <span class="label label-app">{result.label ?? result.id}</span>
              <span class="type caption">{typeLabel(result.type)}</span>
              {#if at === active}<span class="hint caption">Enter to explore</span>{/if}
            </div>
          {/each}
        {/each}
        <p class="foot caption">Arrow keys to move · Enter opens in Explore</p>
      {/if}
    {/if}
  </div>
</form>

<style>
  .search {
    position: relative;
    flex: 1;
    min-inline-size: 0;
    max-inline-size: 560px;
  }

  .field {
    box-sizing: border-box;
    inline-size: 100%;
    block-size: 34px;
    padding-inline: var(--space-3);
    border: 1px solid var(--band-field-line);
    border-radius: var(--radius-md);
    background: var(--band-field);
    color: var(--band-ink);
  }

  .field::-webkit-search-cancel-button {
    display: none;
  }

  .field::placeholder {
    color: var(--band-muted);
    opacity: 1;
  }

  .field:focus-visible {
    outline: 2px solid var(--band-ink);
    outline-offset: 1px;
  }

  .field:disabled {
    opacity: 0.6;
  }

  .found {
    position: absolute;
    z-index: 20;
    inset-block-start: calc(100% + var(--space-2));
    inset-inline: 0;
    box-sizing: border-box;
    max-block-size: min(70vh, 480px);
    overflow: auto;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--raised);
    color: var(--ink);
    box-shadow: 0 var(--space-2) var(--space-5) var(--shadow);
  }

  .found[hidden] {
    display: none;
  }

  .tier {
    padding: var(--space-2) var(--space-2) var(--space-1);
    color: var(--ink-muted);
    text-transform: uppercase;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .row.active {
    background: var(--selection);
  }

  .label {
    overflow: hidden;
    color: var(--heading);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .type,
  .hint,
  .foot,
  .none {
    color: var(--ink-muted);
  }

  .type {
    flex: none;
  }

  .hint {
    flex: none;
    margin-inline-start: auto;
  }

  .foot {
    margin: var(--space-2) 0 0;
    padding: var(--space-2) var(--space-2) var(--space-1);
    border-block-start: 1px solid var(--border);
  }

  .none {
    margin: 0;
    padding: var(--space-2);
  }
</style>
