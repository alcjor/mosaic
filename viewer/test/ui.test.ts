// The shared building blocks: what each one renders for a given state, on the server side of Svelte.
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import Button from "../src/components/ui/Button.svelte";
import Chip from "../src/components/ui/Chip.svelte";
import EmptyState from "../src/components/ui/EmptyState.svelte";
import Table from "../src/components/ui/Table.svelte";
import Tabs from "../src/components/ui/Tabs.svelte";
import { nextSort } from "../src/components/ui/table.js";

const text = (s: string) => createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));

describe("Tabs", () => {
  const tabs = [
    { value: "near", label: "Neighbours" },
    { value: "src", label: "Sources" },
  ];
  const panel = createRawSnippet((v: () => string) => ({ render: () => `<p>panel ${v()}</p>` }));

  it("shows only the selected tab's panel, and marks that tab selected", () => {
    for (const value of ["near", "src"]) {
      const { body } = render(Tabs, { props: { tabs, value, label: "Context", panel } });
      expect(body).toContain(`panel ${value}`);
      expect(body).not.toContain(`panel ${value === "near" ? "src" : "near"}`);
      const label = tabs.find((t) => t.value === value)!.label;
      expect(body).toMatch(new RegExp(`aria-selected="true"[^>]*>(<!---->)?${label}<`));
    }
  });
});

describe("Table", () => {
  const columns = [
    { key: "name", label: "Name", sortable: true },
    { key: "year", label: "Year", sortable: true, numeric: true },
    { key: "note", label: "Note" },
  ];
  const row = createRawSnippet((r: () => { name: string }) => ({ render: () => `<td>${r().name}</td>` }));

  it("renders a row per item and marks only the sorted column", () => {
    const rows = [{ name: "Alpha" }, { name: "Beta" }];
    const sort = { key: "year", direction: "descending" as const };
    const { body } = render(Table<{ name: string }>, { props: { columns, rows, row, label: "Items", sort } });
    expect(body.match(/<td>/g)).toHaveLength(2);
    expect([...body.matchAll(/aria-sort="(\w+)"/g)].map((m) => m[1])).toEqual(["descending"]);
    expect(body.match(/<button/g)).toHaveLength(2);
  });

  it("a header click sorts ascending first, then flips, and starts over on another column", () => {
    const first = nextSort(null, "name");
    expect(first).toEqual({ key: "name", direction: "ascending" });
    expect(nextSort(first, "name")).toEqual({ key: "name", direction: "descending" });
    expect(nextSort(nextSort(first, "name"), "name")).toEqual(first);
    expect(nextSort(first, "year")).toEqual({ key: "year", direction: "ascending" });
  });
});

describe("Button", () => {
  it("a disabled button is disabled and keeps its label; a disabled link has no href", () => {
    const button = render(Button, { props: { disabled: true, children: text("Accept") } }).body;
    expect(button).toMatch(/<button[^>]*disabled/);
    expect(button).toContain("Accept");
    const link = render(Button, { props: { href: "#/x", disabled: true, children: text("Open") } }).body;
    expect(link).toContain('aria-disabled="true"');
    expect(link).not.toContain("href=");
    expect(render(Button, { props: { href: "#/x", children: text("Open") } }).body).toContain('href="#/x"');
  });
});

describe("Chip and EmptyState", () => {
  it("a pressed chip reports it, and a removable one has a named remove button", () => {
    const { body } = render(Chip, { props: { pressed: true, onremove: () => {}, removeLabel: "Remove Film", children: text("Film") } });
    expect(body).toContain('aria-pressed="true"');
    expect(body).toContain('aria-label="Remove Film"');
    const plain = render(Chip, { props: { children: text("Film") } }).body;
    expect(plain).not.toContain("<button");
  });

  it("an empty state shows its one line and its action", () => {
    const { body } = render(EmptyState, { props: { message: "Nothing matches.", action: text("Clear") } });
    expect(body).toContain("Nothing matches.");
    expect(body).toContain("Clear");
  });
});
