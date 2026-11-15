/** A table's sort: the column key and its direction, as `aria-sort` names it. */
export type Sort = { key: string; direction: "ascending" | "descending" };

/** A table column; `numeric` aligns it to the end. */
export type Column = { key: string; label: string; sortable?: boolean; numeric?: boolean };

/** The sort after a click on `key`'s header: ascending first, then it flips on the same column. */
export function nextSort(current: Sort | null | undefined, key: string): Sort {
  if (current?.key === key && current.direction === "ascending") return { key, direction: "descending" };
  return { key, direction: "ascending" };
}
