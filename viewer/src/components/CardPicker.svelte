<script lang="ts">
  /**
   * CardPicker (V-6, V-7, V-15): from a thing's card, the person picks which facts
   * its type's card shows: properties (or the summary), the things it links to by a link, and
   * how many things it links to by a link. A pick changes every card of the type in the page at
   * once. The page cannot write the view file, so the picker gives the view file's `cards` text
   * to copy into it.
   *
   * A button opens the picker below the card (`aria-expanded`), or, with `button` off, the
   * caller's own control does, through `open`; each fact is a checkbox, so the
   * picker works by keyboard (Tab, Space) as by pointer. Controls follow the brand book, section
   * 6: secondary buttons, the focus ring on every control.
   */
  import Button from "./ui/Button.svelte";
  import type { Part, PickOptions } from "../lib/cardpick.js";
  import type { CardSettings, Shape } from "../lib/view.js";

  let {
    type,
    options,
    card,
    chosen,
    text,
    shape = null,
    button = true,
    open = $bindable(false),
    onpick,
    onreset,
  }: {
    type: string;
    /** What the type's card can show (lib/cardpick.ts). */
    options: PickOptions;
    /** The type's card as it is now. */
    card: CardSettings;
    /** True when the card was chosen in the page and is not yet in the view file. */
    chosen: boolean;
    /** The view file's `cards` text for every card as it is now. */
    text: string;
    shape?: Shape | null;
    /** Whether the picker has its own button; without it the caller opens it. */
    button?: boolean;
    open?: boolean;
    onpick: (part: Part, name: string, on: boolean) => void;
    onreset: () => void;
  } = $props();

  const id = $props.id();
  let said = $state("");
  let area = $state<HTMLTextAreaElement | null>(null);

  let typeName = $derived(shape?.typeLabel(type) ?? type);

  /** What the page calls a fact: the summary, a property, or a link with its direction. */
  function named(name: string, from: "show" | "links"): string {
    if (from === "show") return name === "summary" ? "Summary" : (shape?.label(type, name) ?? name);
    const [edge, direction] = name.split(" ");
    const label = shape?.edgeLabel(type, edge!) ?? edge!;
    return direction === "in" ? `← ${label}` : direction === "out" ? `→ ${label}` : label;
  }

  const PARTS: readonly { part: Part; legend: string; from: "show" | "links" }[] = [
    { part: "show", legend: "Shows", from: "show" },
    { part: "links", legend: "Lists the things it links to by", from: "links" },
    { part: "counts", legend: "Counts the things it links to by", from: "links" },
  ];

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      said = "Copied. Paste it into the view file, in place of its cards section.";
    } catch {
      area?.select();
      said = "The page cannot copy here: the text is selected, copy it with your keyboard.";
    }
  }
</script>

<section class="picker" aria-label="Choose what {typeName} cards show">
  {#if button}
    <Button aria-expanded={open} aria-controls="{id}-panel" onclick={() => (open = !open)}>
      Choose what {typeName} cards show
    </Button>
  {/if}
  <div class="panel" id="{id}-panel" hidden={!open}>
    <p class="note caption">
      Every {typeName} card in the page shows what you pick, in the order picked. The page cannot change the view file: copy the text below into it to keep the card.
    </p>
    {#each PARTS as { part, legend, from } (part)}
      {#if options[from].length > 0}
        <fieldset class="part" data-part={part}>
          <legend class="section-label">{legend}</legend>
          {#each options[from] as name (name)}
            <label class="option body-screen">
              <input type="checkbox" value={name} checked={card[part].includes(name)} onchange={(e) => onpick(part, name, e.currentTarget.checked)} />
              {named(name, from)}
            </label>
          {/each}
        </fieldset>
      {/if}
    {/each}
    <label class="section-label" for="{id}-text">View file text</label>
    <textarea class="text code" id="{id}-text" readonly wrap="off" rows={text.split("\n").length} value={text} bind:this={area}></textarea>
    <div class="actions">
      <Button onclick={copy}>Copy the text</Button>
      {#if chosen}
        <Button variant="ghost" onclick={onreset}>Back to the view file's card</Button>
      {/if}
      <p class="said caption" role="status">{said}</p>
    </div>
  </div>
</section>

<style>
  .picker:has(.panel:not([hidden])) {
    margin-block-end: var(--space-4);
  }

  .option input:focus-visible,
  .text:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .panel {
    margin-block-start: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .panel[hidden] {
    display: none;
  }

  .note,
  .said {
    margin: 0;
    color: var(--ink-muted);
  }

  .part {
    margin: var(--space-3) 0 0;
    padding: 0;
    border: none;
  }

  .part legend {
    padding: 0;
    color: var(--ink-muted);
  }

  .option {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-1) 0;
    color: var(--ink);
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .option input {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .section-label[for] {
    display: block;
    margin-block-start: var(--space-3);
    color: var(--ink-muted);
  }

  .text {
    box-sizing: border-box;
    inline-size: 100%;
    margin-block-start: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-tint);
    color: var(--ink);
    resize: vertical;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    margin-block-start: var(--space-2);
  }
</style>
