/**
 * Open a single-file export (`mosaic export`) from `file://` in Chromium through Playwright, with
 * networking blocked, run each query in the search field, and print what a reader sees as one JSON
 * line.
 *
 *     bun viewer/scripts/search-export.ts EXPORT.html QUERY [QUERY ...]
 *
 * For each query it records the listed results in order (node id, how it matched, the text of the
 * row), none when the page says there are no results, the text of an error the results show in
 * their place (`alert`, else null), and the time from Enter to the answer.
 * Every request that is not to the file itself is refused and recorded. Playwright is not a
 * dependency: the environment provides it with its browser.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [file, ...queries] = process.argv.slice(2);
if (!file || queries.length === 0) {
  console.error("usage: bun viewer/scripts/search-export.ts EXPORT.html QUERY [QUERY ...]");
  process.exit(2);
}
const url = pathToFileURL(file).href;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch();
const blocked: string[] = [];
const errors: string[] = [];
try {
  const context = await browser.newContext({ offline: true });
  await context.route("**/*", (route) => {
    const asked = route.request().url();
    if (asked === url || asked.startsWith(`${url}#`)) return route.continue();
    blocked.push(asked);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  const started = performance.now();
  await page.goto(url);
  await page.waitForFunction(
    () => !(document.querySelector('input[type="search"]') as HTMLInputElement | null)?.disabled || document.querySelector('[role="alert"]') !== null,
    null,
    { timeout: 120_000 },
  );
  const readyMs = Math.round(performance.now() - started);
  const header = (await page.locator("header.top").innerText()).split("\n").map((s) => s.trim()).filter(Boolean);
  const alerts = await page.locator('[role="alert"]').allInnerTexts();
  const mode = alerts.length > 0 ? null : await page.locator('[data-mode][aria-pressed="true"]').getAttribute("data-mode");
  const searches: { query: string; ms: number; results: { id: string | null; match: string | null; text: string }[]; alert: string | null }[] = [];
  if (alerts.length === 0) {
    const box = page.getByRole("searchbox", { name: "Search the mosaic" });
    const nav = page.locator('nav[aria-label="Results"]');
    const rows = nav.locator("a[data-id]");
    const answered = rows.first().or(nav.getByText(/^No results for/)).or(nav.getByRole("alert"));
    const idle = nav.getByText("Search for a name, an alias or words in the text.");
    for (const query of queries) {
      // Clear the previous answer first, so what is read below belongs to this query.
      await box.fill("");
      await box.press("Enter");
      await idle.waitFor({ timeout: 30_000 });
      const asked = performance.now();
      await box.fill(query);
      await box.press("Enter");
      await answered.first().waitFor({ timeout: 120_000 });
      const ms = Math.round(performance.now() - asked);
      const results = await rows.evaluateAll((as) =>
        as.map((a) => ({
          id: a.getAttribute("data-id"),
          match: a.getAttribute("data-match"),
          text: (a as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        })),
      );
      const said = await nav.getByRole("alert").allInnerTexts();
      searches.push({ query, ms, results, alert: said.length > 0 ? said.join(" ") : null });
    }
  }
  console.log(JSON.stringify({ header, alerts, readyMs, mode, searches, blocked, errors }));
} finally {
  await browser.close();
}
