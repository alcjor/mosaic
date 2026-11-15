<script lang="ts">
  /**
   * CitationChip (brand book, section 6): the source and row behind a value, in `mono` on
   * `page`. The kind of source is said in its label, never by colour. Hovering shows the first row's text; activating it opens the rows behind the
   * value, each with its source, locator, method and passage (V-8: a person can open the passage
   * or row behind any value). A value backed by several links (a count, say) lists each link's
   * rows under the thing it leads to.
   */
  import { chipLabel, type Evidence } from "../lib/cards.js";

  let {
    sections,
  }: {
    /** The rows behind the value; a title names the thing a group of rows is about. */
    sections: readonly { readonly title: string | null; readonly evidence: Evidence }[];
  } = $props();

  const id = $props.id();
  let open = $state(false);

  let first = $derived(sections.find((s) => s.evidence.rows.length > 0)?.evidence ?? sections.find((s) => s.evidence.error !== undefined)?.evidence ?? sections[0]?.evidence ?? { rows: [], total: 0 });
  let hint = $derived(first.rows[0]?.snippet ?? undefined);
</script>

<button
  class="chip code"
  type="button"
  aria-expanded={open}
  aria-controls="{id}-rows"
  title={hint}
  onclick={() => (open = !open)}>{chipLabel(first)}</button
>
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
