/**
 * Browser tests of the built viewer (`viewer/dist`): build a small invented mosaic, open the page on it
 * in Chromium, assert on what the page shows and save screenshots by name.
 *
 *     const viewer = useViewer({ nodes: [...] });          // once per test file
 *     test("...", async () => {
 *       const { page, shot } = await viewer.open();         // a fresh page, ready to use
 *       await page.getByRole("searchbox").fill("x");
 *       await shot("search-results");                       // viewer/screenshots/<file>-search-results.png
 *     });
 *
 * Run with `bun run build && bun run test:browser`. Screenshots are for people to look at (CI
 * uploads the folder): they are never compared with baselines. Playwright is not a dependency
 * of the viewer: the environment provides it with its browser.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect } from "vitest";
import { buildMosaic, type MosaicSpec } from "../../kit/test/build-mosaic.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
export const SCREENSHOTS = fileURLToPath(new URL("../screenshots/", import.meta.url));
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
};

export interface OpenViewer {
  page: Page;
  /** Save a screenshot of the page as `<test file>-<name>.png` in the screenshots folder. */
  shot: (name: string) => Promise<string>;
}

/** Serve the built viewer and a mosaic built from `spec`; one browser for the test file. */
export function useViewer(spec: MosaicSpec, file = "invented.mosaic") {
  let server: ReturnType<typeof Bun.serve>;
  let browser: Browser;
  const prefix = (expect.getState().testPath ?? "test").split("/").pop()!.replace(/\.browser\.ts$|\.ts$/, "");
  const mosaic = buildMosaic(spec);

  beforeAll(async () => {
    if (!existsSync(join(dist, "index.html"))) throw new Error("build the viewer first: bun run build");
    mkdirSync(SCREENSHOTS, { recursive: true });
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = decodeURIComponent(new URL(request.url).pathname);
        if (path === `/${file}`) return new Response(mosaic);
        const local = normalize(join(dist, path === "/" ? "index.html" : path));
        if (!local.startsWith(dist) || !existsSync(local)) return new Response("not found", { status: 404 });
        return new Response(readFileSync(local), { headers: { "content-type": types[extname(local)] ?? "application/octet-stream" } });
      },
    });
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  return {
    /** A new page on the mosaic, once the page can search. Fails the test on a page error. */
    async open(hash = ""): Promise<OpenViewer> {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://localhost:${server.port}/?mosaic=${encodeURIComponent(file)}${hash}`);
      await page.waitForFunction(() => {
        const box = document.querySelector('input[type="search"]') as HTMLInputElement | null;
        return box !== null && !box.disabled;
      }, null, { timeout: 60_000 });
      const shot = async (name: string) => {
        expect(errors).toEqual([]);
        const path = join(SCREENSHOTS, `${prefix}-${name}.png`);
        await page.screenshot({ path });
        return path;
      };
      return { page, shot };
    },
  };
}
