<script lang="ts">
  /**
   * CitationChip (brand book, section 6): the source and row behind a value, in `mono` on
   * `page`. The kind of source is said in its label, never by colour. Hovering shows the first row's text; activating it opens the rows behind the
   * value, each with its source, locator, method and passage (V-8: a person can open the passage
   * or row behind any value). A value backed by several links (a count, say) lists each link's
   * rows under the thing it leads to. As an `icon`, it is a small "source" button that keeps a
   * heading clean: its tooltip names the source, and activating it opens the rows the same way.
   */
  import { chipLabel, type Evidence } from "../lib/cards.js";

  let {
    sections,
    short = false,
    icon = false,
  }: {
    /** Show a small source icon in place of the source's text. */
    icon?: boolean;
    /** The rows behind the value; a title names the thing a group of rows is about. */
    /** Say the row alone, without the source's name: the rows it opens name the source. */
    short?: boolean;
    sections: readonly { readonly title: string | null; readonly evidence: Evidence }[];
  } = $props();

  const id = $props.id();
  let open = $state(false);

  let first = $derived(sections.find((s) => s.evidence.rows.length > 0)?.evidence ?? sections.find((s) => s.evidence.error !== undefined)?.evidence ?? sections[0]?.evidence ?? { rows: [], total: 0 });
  let hint = $derived(first.rows[0]?.snippet ?? undefined);
  let label = $derived.by(() => {
    const whole = chipLabel(first);
    const row = first.rows[0];
    if (!short || row === undefined) return whole;
    const name = `${row.source.slice(row.source.lastIndexOf("/") + 1)}:`;
    return whole.startsWith(name) && whole.length > name.length ? whole.slice(name.length) : whole;
  });
</script>

{#if icon}
  <button class="chip icon" type="button" aria-label="Source: {label}" aria-expanded={open} aria-controls="{id}-rows" title="Source: {label}" onclick={() => (open = !open)}>
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2h5l3 3v9H4z M9 2v3h3 M6 8h4 M6 11h4" /></svg>
  </button>
{:else}
  <button
    class="chip code"
    type="button"
    aria-expanded={open}
    aria-controls="{id}-rows"
    title={hint}
    onclick={() => (open = !open)}>{label}</button
  >
{/if}
<div class="rows" id="{id}-rows" hidden={!open}>
  {#each sections as section, i (i)}
    {#if section.title !== null}
      <p class="about caption">{section.title}</p>
    {/if}
    {#if section.evidence.error !== undefined}
      <p class="failed caption">Could not read the source: {section.evidence.error}</p>
    {:else if section.evidence.rows.length === 0}
      <p class="none caption">No source row is recorded.</p>
    {:else}
      <ul class="list">
        {#each section.evidence.rows as row, j (j)}
          <li class="row">
            <span class="where code">{row.source}:{row.locator}</span>
            <span class="how caption">{row.method}{row.confidence === null ? "" : ` · confidence ${row.confidence}`}</span>
            {#if row.snippet !== null}
              <blockquote class="passage caption">{row.snippet}</blockquote>
            {/if}
          </li>
        {/each}
      </ul>
      {#if section.evidence.total > section.evidence.rows.length}
        <p class="more caption">and {section.evidence.total - section.evidence.rows.length} more rows</p>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .chip {
    padding: 0 var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--ink-muted);
    cursor: pointer;
    overflow-wrap: anywhere;
    text-align: start;
  }

  .icon {
    display: inline-flex;
    align-items: center;
    align-self: center;
  }

  .icon svg {
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.3;
  }

  .chip:hover {
    color: var(--accent);
  }

  .chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .chip[aria-expanded="true"] {
    color: var(--accent);
  }

  .rows {
    margin-block-start: var(--space-1);
    padding: var(--space-2);
    border-inline-start: 3px solid var(--border);
    background: var(--surface-tint);
  }

  .rows[hidden] {
    display: none;
  }

  .failed {
    margin: 0;
    color: var(--majolica-text);
  }

  .about,
  .none,
  .more {
    margin: 0;
    color: var(--ink-muted);
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row + .row {
    margin-block-start: var(--space-2);
  }

  .where {
    overflow-wrap: anywhere;
  }

  .how {
    margin-inline-start: var(--space-2);
    color: var(--ink-muted);
  }

  .passage {
    margin: var(--space-1) 0 0;
    color: var(--ink);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
</style>
