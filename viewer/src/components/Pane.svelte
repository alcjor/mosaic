<script lang="ts" module>
  /**
   * The widths of the panes on the page, as one stylesheet the document adopts: a width a person
   * drags is not a token, and the page carries no inline styles.
   */
  const widths = new Map<string, number>();
  let sheet: CSSStyleSheet | null | undefined;

  function publish(): void {
    if (sheet === null) return;
    try {
      if (sheet === undefined) {
        sheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      const rules = [...widths].map(([place, width]) => `aside.pane[data-pane="${CSS.escape(place)}"]:not(.collapsed){inline-size:${width}px}`);
      sheet.replaceSync(`@media (width >= 960px){${rules.join("")}}`);
    } catch {
      sheet = null; // No constructed stylesheets here: panes keep their default width.
    }
  }
</script>

<script lang="ts">
  /**
   * Pane (brand book, section 6, Shell): a place's one right pane. From 960px it sits at the
   * right of the place, scrolls on its own, is resized by dragging its left edge (or with the
   * arrow keys on it) and collapses to a rail; its width and whether it is collapsed are kept
   * per `place` (lib/pane.ts). Below 960px it is a plain section under the place's main part.
   *
   *     <div class="body"><main>…</main><Pane place="home" label="Saved trails">…</Pane></div>
   *
   * `head` fills the top row, left of the collapse button; `strip` is the rail's text (by
   * default the label). Other attributes (`hidden`, `aria-*`, `data-*`) go to the `<aside>`.
   */
  import { onMount, untrack, type Snippet } from "svelte";
  import Shard from "./Shard.svelte";
  import { clampWidth, readPane, writePane } from "../lib/pane.js";

  let {
    place,
    label,
    strip = null,
    stripType = null,
    head,
    children,
    ...rest
  }: {
    /** Whose pane this is: the key its width and collapsed state are kept under. */
    place: string;
    /** Its accessible name. */
    label: string;
    /** What the collapsed strip says (by default the label), and the type whose shard goes before it. */
    strip?: string | null;
    stripType?: string | null;
    head?: Snippet;
    children: Snippet;
    [attribute: string]: unknown;
  } = $props();

  const first = untrack(() => readPane(place));
  let width = $state(first.width);
  let collapsed = $state(first.collapsed);
  let element: HTMLElement;
  let drag: { x: number; width: number } | null = null;

  $effect(() => {
    widths.set(place, width);
    publish();
  });

  // A window narrower than the one the width was dragged in still leaves the place its room.
  onMount(() => {
    width = clampWidth(width, room());
  });

  const room = (): number => element.parentElement?.clientWidth ?? Infinity;
  const keep = (): void => writePane(place, { width, collapsed });

  function toggle(): void {
    collapsed = !collapsed;
    keep();
  }

  function grab(event: PointerEvent): void {
    drag = { x: event.clientX, width };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function move(event: PointerEvent): void {
    if (drag !== null) width = clampWidth(drag.width + drag.x - event.clientX, room());
  }

  function drop(): void {
    if (drag === null) return;
    drag = null;
    keep();
  }

  function nudge(event: KeyboardEvent): void {
    const by = event.key === "ArrowLeft" ? 16 : event.key === "ArrowRight" ? -16 : 0;
    if (by === 0) return;
    event.preventDefault();
    width = clampWidth(width + by, room());
    keep();
  }
</script>

<aside {...rest} bind:this={element} class="pane" class:collapsed data-pane={place} aria-label={label}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="grip"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize {label}"
    aria-valuenow={width}
    tabindex="0"
    onpointerdown={grab}
    onpointermove={move}
    onpointerup={drop}
    onpointercancel={drop}
    onkeydown={nudge}
  ></div>
  <button class="rail" type="button" aria-label="Show {label}" aria-expanded="false" onclick={toggle}>
    <span class="icon">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
    </span>
    {#if collapsed}
      {#if stripType !== null}<Shard type={stripType} />{/if}
      <span class="up caption">{strip ?? label}</span>
    {/if}
  </button>
  <div class="content">
    <div class="head">
      <div class="lead">{@render head?.()}</div>
      <button class="icon fold" type="button" aria-label="Collapse {label}" aria-expanded="true" onclick={toggle}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
      </button>
    </div>
    <div class="scroll body-app">{@render children()}</div>
  </div>
</aside>

<style>
  /* Below 960px: a plain section under the place's main part. */
  .pane {
    position: relative;
    box-sizing: border-box;
    min-inline-size: 0;
    border-block-start: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
    overflow-wrap: anywhere;
  }

  .pane[hidden] {
    display: none;
  }

  .grip,
  .rail,
  .pane .fold {
    display: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: 28px;
    padding: var(--space-3) var(--space-4) 0;
  }

  .head:not(:has(.lead > *)) {
    padding-block-start: 0;
    min-block-size: 0;
  }

  .lead {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-inline-size: 0;
  }

  .scroll {
    padding: var(--space-3) var(--space-4) var(--space-5);
  }

  .icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 28px;
    block-size: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
  }

  .icon:hover,
  .rail:hover .icon {
    background: var(--selection);
    color: var(--heading);
  }

  .icon:focus-visible,
  .rail:focus-visible,
  .grip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* From 960px: at the right of the place, scrolling on its own. */
  @media (width >= 960px) {
    .pane {
      flex: none;
      display: flex;
      flex-direction: column;
      inline-size: 340px;
      min-block-size: 0;
      border-block-start: none;
      border-inline-start: 1px solid var(--border);
    }

    .pane.collapsed {
      inline-size: var(--app-rail);
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-block-size: 0;
    }

    .head:not(:has(.lead > *)) {
      min-block-size: 28px;
      padding-block-start: var(--space-3);
    }

    .pane .fold {
      display: inline-flex;
    }

    .scroll {
      flex: 1;
      min-block-size: 0;
      overflow: auto;
    }

    .grip {
      display: block;
      position: absolute;
      z-index: 1;
      inset-block: 0;
      inset-inline-start: calc(-1 * var(--space-1));
      inline-size: var(--space-2);
      cursor: col-resize;
      touch-action: none;
    }

    .grip::after {
      content: "";
      position: absolute;
      inset-block-start: calc(50% - var(--space-5));
      inset-inline-start: var(--space-1);
      inline-size: var(--space-1);
      block-size: calc(2 * var(--space-5));
      border-radius: var(--radius-sm);
      background: var(--border);
    }

    .collapsed .grip,
    .collapsed .content {
      display: none;
    }

    .collapsed .rail {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      min-block-size: 0;
      padding: var(--space-2) 0;
      overflow: hidden;
      border: 0;
      background: none;
      cursor: pointer;
    }

    .up {
      writing-mode: vertical-rl;
      font-weight: bold;
      overflow: hidden;
      color: var(--ink-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
</style>
