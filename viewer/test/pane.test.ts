// A pane's width and collapsed state are kept per place, within limits, and survive bad storage.
import { expect, test } from "vitest";
import { clampWidth, PANE_DEFAULT, PANE_MAX, PANE_MIN, readPane, writePane } from "../src/lib/pane.js";

function memory(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const kept = new Map<string, string>();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v) };
}

test("a pane is kept per place", () => {
  const store = memory();
  writePane("home", { width: 400, collapsed: true }, store);
  expect(readPane("home", store)).toEqual({ width: 400, collapsed: true });
  expect(readPane("explore", store)).toEqual(PANE_DEFAULT);
});

test("a width stays within the limits and leaves room for the place", () => {
  expect(clampWidth(10)).toBe(PANE_MIN);
  expect(clampWidth(5000)).toBe(PANE_MAX);
  expect(clampWidth(600, 800)).toBe(800 - PANE_MIN);
});

test("storage that is missing, refuses or holds something else gives the default", () => {
  expect(readPane("home", null)).toEqual(PANE_DEFAULT);
  const refuses = {
    getItem: (): string => {
      throw new Error("refused");
    },
    setItem: (): void => {
      throw new Error("refused");
    },
  };
  expect(readPane("home", refuses)).toEqual(PANE_DEFAULT);
  expect(() => writePane("home", PANE_DEFAULT, refuses)).not.toThrow();
  const store = memory();
  store.setItem("mosaic.pane.home", '{"width":"wide"}');
  expect(readPane("home", store)).toEqual(PANE_DEFAULT);
});
