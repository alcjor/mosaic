/**
 * The overview's data (needs G-9, G-7, G-10): the things of every type, read through
 * the kit's `table` (section 8.6: 20 rows a page, in id order when no order is given), for one
 * shard per thing in bands by type.
 *
 * A mosaic with more things than the picture can hold ({@link SAMPLE_BUDGET}) draws a sample, and
 * says so: for each type, whole pages spread evenly through it: one page, so every type is a band
 * one can see, and its share of the budget's other pages, in proportion to its size and rounded
 * down. Only when there are more types than pages does a type get none: the largest get one each,
 * and the note says how many are left out. The sample never reads more than the budget. Which
 * pages depends only on the types' counts, so the same mosaic always draws the same sample (G-7). Reading runs in the
 * background a page at a time, giving way to the page between pages (G-10), and can be stopped.
 */
import type { SealedFile } from "@mosaic/kit";
import { byBytes } from "./bytes.js";
import { noun, number } from "./mapview.js";
import { yieldToPage } from "./tally.js";

/** The most shards the overview draws; past it, a sample. */
export const SAMPLE_BUDGET = 1500;

/** Rows in a `table` page (section 8.6). */
const PAGE = 20;

export interface PagePlan {
  readonly type: string;
  /** How many things the type holds. */
  readonly count: number;
  /** The pages to read, in order. */
  readonly pages: readonly number[];
  readonly totalPages: number;
}

export interface Plan {
  /** Every type with things, by name (UTF-8 bytes). */
  readonly types: readonly PagePlan[];
  /** True when every page of every type is read. */
  readonly whole: boolean;
}

/** Which pages of each type the overview reads (G-9): all of them, or a stated sample. */
export function samplePlan(types: readonly { name: string; count: number }[], budget = SAMPLE_BUDGET): Plan {
  const kept = types.filter((t) => t.count > 0).sort((a, b) => byBytes(a.name, b.name));
  const total = kept.reduce((s, t) => s + t.count, 0);
  const whole = total <= budget;
  if (whole) return { whole, types: kept.map((t) => ({ type: t.name, count: t.count, pages: range(pagesOf(t.count)), totalPages: pagesOf(t.count) })) };
  // A page each, while the budget's pages last (the largest types first), then the rest of the
  // pages in proportion to size, rounded down so the shares never pass the budget.
  const budgetPages = Math.floor(budget / PAGE);
  const share = new Map<string, number>();
  const first = [...kept].sort((a, b) => b.count - a.count || byBytes(a.name, b.name)).slice(0, budgetPages);
  const rest = budgetPages - first.length;
  for (const t of first) share.set(t.name, Math.min(pagesOf(t.count), 1 + Math.floor((rest * t.count) / total)));
  return {
    whole,
    types: kept.map((t) => {
      const totalPages = pagesOf(t.count);
      const wanted = share.get(t.name) ?? 0;
      const pages = wanted === totalPages ? range(totalPages) : Array.from({ length: wanted }, (_, i) => 1 + Math.floor((i * totalPages) / wanted));
      return { type: t.name, count: t.count, pages, totalPages };
    }),
  };
}

const pagesOf = (count: number) => Math.ceil(count / PAGE);
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

export interface Band {
  readonly type: string;
  /** How many things the type holds. */
  readonly count: number;
  /** The things read, in id order. */
  readonly things: readonly { readonly id: string; readonly label: string | null }[];
}

export interface OverviewData {
  readonly bands: readonly Band[];
  /** True when every thing was read. */
  readonly whole: boolean;
}

/** What the overview says of what it shows: null when it shows every thing, else the sample stated. */
export function sampleNote(data: OverviewData): string | null {
  if (data.whole) return null;
  const shown = data.bands.reduce((s, b) => s + b.things.length, 0);
  const total = data.bands.reduce((s, b) => s + b.count, 0);
  const out = data.bands.filter((b) => b.things.length === 0).length;
  const rest = out === 0 ? "" : ` ${number(out)} smaller ${noun(out, "type has", "types have")} no page in it: there are more types than pages of the sample.`;
  return `A sample: ${number(shown)} of ${number(total)} things. For each type, pages of ${PAGE} things spread evenly through it in id order, in proportion to its size.${rest}`;
}

/** Read the pages `plan` asks for, telling `onPage` after each with how many have been read. */
export async function readOverview(
  source: Pick<SealedFile, "table">,
  plan: Plan,
  { signal, onPage, pause = yieldToPage }: { signal?: AbortSignal; onPage?: (read: number, total: number) => void; pause?: () => Promise<void> } = {},
): Promise<OverviewData> {
  const pages = plan.types.reduce((s, t) => s + t.pages.length, 0);
  let read = 0;
  const bands: Band[] = [];
  for (const t of plan.types) {
    const things: { id: string; label: string | null }[] = [];
    for (const page of t.pages) {
      if (signal?.aborted) throw new OverviewStopped();
      const answer = await source.table({ type: t.type, columns: ["label"], page });
      if ("error" in answer) throw new Error(`${t.type}: table, page ${page}: ${answer.error.message}`);
      for (const row of answer.data.rows) things.push({ id: String(row[0]), label: row[1] === null || row[1] === undefined ? null : String(row[1]) });
      read++;
      onPage?.(read, pages);
      await pause();
    }
    bands.push({ type: t.type, count: t.count, things });
  }
  if (signal?.aborted) throw new OverviewStopped();
  return { bands, whole: plan.whole };
}

/** Reading stopped: the person left the view. */
export class OverviewStopped extends Error {
  override readonly name = "OverviewStopped";
  constructor() {
    super("reading the overview stopped");
  }
}

/**
 * The shard tokens bands take in turn, from the middle out, chosen so that neighbouring bands
 * (and the first and last, where the colours repeat) differ by at least 14 in lightness (CIE L*):
 * of the shard tokens bar the palest, which barely shows on the light ground, the order whose
 * closest neighbours are furthest apart. The brand keeps shards blue (other hues
 * carry status and kinds of data), so the legend's names and the bands' places tell types apart.
 */
export const BAND_COLOURS = ["--shard-2", "--shard-4", "--shard-7", "--shard-3", "--shard-5", "--shard-1"] as const;
