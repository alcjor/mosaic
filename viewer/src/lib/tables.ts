/**
 * Tables rebuilt from node types (docs/design.md, First milestone: Viewer; Specification 0.1,
 * sections 8.1 and 8.6): every page of a table view is one `table` call, with the view's
 * sorting, filters and page. The page sorts, filters and pages nothing itself.
 *
 * A table also shows the type's links as columns: the edge types that leave it, each cell the
 * things a row links to, as chips that open them. `table` can sort and filter by such a column
 * (an edge type is one of its column names) but its cells hold labels, not ids, so the links of
 * the rows on the page, and only those, are read with `neighbors` ({@link rowLinks}).
 */
import type { EdgeType, SealedFile, TableAnswer } from "@mosaic/kit";
import type { ToolFailure } from "./mosaic.js";
import type { Condition, TableRoute } from "./route.js";

/** Rows a `table` page holds (section 8.6). */
export const PAGE_ROWS = 20;

export interface TableView {
  readonly route: TableRoute;
  /** `id`, then the columns shown. */
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly page: number;
  readonly total: number;
  /** How many pages `total` makes, at least 1. */
  readonly pages: number;
}

/**
 * The arguments of `table` for a table view; with `columns`, the view file's, the node's name
 * (`label`) then those columns, else `table`'s default.
 */
export function tableArgs(route: TableRoute, columns: readonly string[] | null = null): Record<string, unknown> {
  const args: Record<string, unknown> = { type: route.type, page: route.page };
  if (columns !== null) args.columns = ["label", ...columns.filter((c) => c !== "label")];
  if (route.order) args.order = { column: route.order.column, direction: route.order.desc ? "desc" : "asc" };
  if (route.where.length > 0) args.where = route.where.map((c) => ({ column: c.column, op: c.op, value: c.value }));
  return args;
}

/** One page of a table view, from `table`. */
export async function tableView(
  file: SealedFile,
  route: TableRoute,
  columns: readonly string[] | null = null,
): Promise<TableView | ToolFailure> {
  const answer = await file.table(tableArgs(route, columns));
  if ("error" in answer) return { message: answer.error.message, suggestions: answer.error.suggestions };
  const data: TableAnswer["data"] = answer.data;
  return {
    route,
    columns: data.columns,
    rows: data.rows,
    page: data.page,
    total: data.total,
    pages: Math.max(1, Math.ceil(data.total / PAGE_ROWS)),
  };
}

/** The value a filter's text stands for, read as the kind the reader picked. */
export function filterValue(text: string, kind: "text" | "number" | "boolean"): Condition["value"] | null {
  if (kind === "text") return text;
  if (kind === "boolean") return text.trim() === "true" ? true : text.trim() === "false" ? false : null;
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** A cell as text: text as it is, lists joined by commas, other values as JSON, null as empty. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || v === null)) {
    return value.map((v) => v ?? "").join(", ");
  }
  return JSON.stringify(value);
}

/** The most link columns a table shows, and the most things one of their cells names. */
export const LINK_COLUMNS = 6;
export const LINKS_SHOWN = 3;

/**
 * The link types `type`'s table shows as columns: the edge types leaving it, by name, that
 * `table` reads as edge types (a property or node field of the same name comes first there).
 */
export function linkColumns(file: Pick<SealedFile, "edgeTypes" | "propsOf">, type: string): EdgeType[] {
  const taken = new Set(["key", "label", "summary", ...file.propsOf(type)]);
  return file.edgeTypes.filter((e) => e.from === type && e.to !== null && !taken.has(e.name)).slice(0, LINK_COLUMNS);
}

/** What one cell of a link column holds: the first things linked, and how many there are. */
export interface CellLinks {
  readonly things: readonly { readonly id: string; readonly label: string | null }[];
  readonly total: number;
}

/**
 * The links of the rows `ids` by each of `edges`, out: row id, then edge type. One `neighbors`
 * call a row where it lists every link, else one a row and edge type. A row whose links cannot
 * be read has none here.
 */
export async function rowLinks(
  file: Pick<SealedFile, "neighbors">,
  ids: readonly string[],
  edges: readonly string[],
): Promise<Map<string, Map<string, CellLinks>>> {
  const out = new Map<string, Map<string, CellLinks>>();
  if (edges.length === 0) return out;
  for (const id of ids) {
    const cells = new Map<string, CellLinks>();
    const all = await file.neighbors({ id, direction: "out" });
    if ("error" in all) continue;
    const whole = all.data.edges.length === all.data.total;
    for (const edge of edges) {
      const listed = all.data.edges.filter((e) => e.edge === edge);
      if (whole) {
        if (listed.length > 0) cells.set(edge, { things: listed.slice(0, LINKS_SHOWN), total: listed.length });
        continue;
      }
      const one = await file.neighbors({ id, edge, direction: "out", limit: LINKS_SHOWN });
      if (!("error" in one) && one.data.total > 0) cells.set(edge, { things: one.data.edges, total: one.data.total });
    }
    out.set(id, cells);
  }
  return out;
}

/** The kind of value a filter on `column` takes: that of the column's first value on the page, else what the text looks like. */
export function filterKind(view: Pick<TableView, "columns" | "rows"> | null, column: string, text: string): "text" | "number" | "boolean" {
  const at = view?.columns.indexOf(column) ?? -1;
  const sample = at < 0 ? undefined : view!.rows.map((row) => row[at]).find((v) => v !== null && v !== undefined);
  if (typeof sample === "number") return "number";
  if (typeof sample === "boolean") return "boolean";
  if (sample !== undefined) return "text";
  if (text.trim() === "true" || text.trim() === "false") return "boolean";
  return text.trim() !== "" && Number.isFinite(Number(text.trim())) ? "number" : "text";
}
