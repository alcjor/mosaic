/**
 * The graph explorer's map data on one mosaic, worked out in Chromium (through Playwright) as the
 * page works it out (needs G-1, G-2, G-7, G-10): the kit and the viewer's graph code
 * are bundled for the browser with SQLite's WebAssembly beside them, served from a local port,
 * and every type is walked in the page. Prints one JSON line: the map's data before and after
 * the walks, each type's and edge type's most linked things, each walk's time and pages, whether
 * a second run gave the same data, and the longest the page was kept from input meanwhile
 * (`longest_wait_ms`, a 16 ms heartbeat's longest gap; `longest_task_ms`, Chromium's long tasks).
 *
 *     bun viewer/scripts/map-data.ts FILE [--view SETTINGS.json]
 *
 * SETTINGS.json is a view file's settings as `ViewSettings.as_json` writes them. Playwright is
 * not a dependency: the environment provides it with its browser (`require("playwright")`).
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const file = args[0];
const viewAt = args.indexOf("--view");
const viewPath = viewAt >= 0 ? args[viewAt + 1] : undefined;
if (!file || (viewAt >= 0 && !viewPath)) {
  console.error("usage: bun viewer/scripts/map-data.ts FILE [--view SETTINGS.json]");
  process.exit(2);
}
const settings: unknown = viewPath === undefined ? null : JSON.parse(readFileSync(viewPath, "utf8"));

const here = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
const out = mkdtempSync(join(tmpdir(), "viewer-map-data-"));

try {
  const built = await Bun.build({ entrypoints: [join(here, "map-data-page.ts")], outdir: out, target: "browser", naming: "page.js" });
  if (!built.success) throw new Error(`bundling the page failed: ${built.logs.join("\n")}`);
  const kitRoot = dirname(require.resolve("@mosaic/kit/package.json", { paths: [join(here, "..")] }));
  const wasm = join(dirname(createRequire(join(kitRoot, "package.json")).resolve("@sqlite.org/sqlite-wasm/package.json")), "dist", "sqlite3.wasm");
  copyFileSync(wasm, join(out, "sqlite3.wasm"));
  copyFileSync(file, join(out, "file.bin"));
  writeFileSync(join(out, "index.html"), '<!doctype html><meta charset="utf-8"><title>map data</title>');

  const types: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const name = basename(new URL(request.url).pathname) || "index.html";
      try {
        const body = readFileSync(join(out, name));
        const ext = name.slice(name.lastIndexOf("."));
        return new Response(body, { headers: { "content-type": types[ext] ?? "application/octet-stream" } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  });

  const { chromium } = require("playwright") as typeof import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${server.port}/index.html`);
    const result = await page.evaluate(
      async ({ name, settings }) => {
        const { report } = (await import("/page.js")) as typeof import("./map-data-page.js");
        const bytes = new Uint8Array(await (await fetch("/file.bin")).arrayBuffer());
        return report(bytes, name, settings);
      },
      { name: basename(file), settings },
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
    server.stop(true);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
