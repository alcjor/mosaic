// Under `mosaic view --view FILE` the page asks for the view file's settings again every
// second and is reshaped when they change; a file saved with an error answers that error, which
// the page shows while it keeps what it shows (docs/design.md, View file: "mosaic view watches
// it and reloads the page on save").
import { describe, expect, it, vi } from "vitest";
import { fetchNamedView, watchView, type ViewSettings } from "../src/lib/view.js";
import { Viewer } from "../src/lib/viewer.svelte.js";
import { reading } from "./fixtures.js";

const BASE = "http://127.0.0.1:8000/?mosaic=file/a.mosaic&view=view.json";
const SEARCH = new URL(BASE).search;

const ok = (json: object) => new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
const bad = (error: string) => new Response(JSON.stringify({ error }), { status: 422 });

/** A fetcher that answers each call with the next of `answers`, the last one from then on. */
function answering(...answers: (() => Response)[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => answers[Math.min(i++, answers.length - 1)]!()) as unknown as typeof fetch;
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(done()).toBe(true);
}

describe("the view file's settings from mosaic view", () => {
  it("an answer with an error is that error, as mosaic view names it", async () => {
    const fetcher = answering(() => bad("view.yaml:2: view file: theme must be one of auto, light, dark, not 'sepia'"));
    await expect(fetchNamedView(SEARCH, BASE, fetcher)).rejects.toThrow("view.yaml:2: view file: theme must be one of auto, light, dark, not 'sepia'");
  });

  it("are asked for again, and a change reshapes the page", async () => {
    const fetcher = answering(
      () => ok({ search: "semantic" }),
      () => ok({ search: "semantic" }),
      () => ok({ search: "text" }),
    );
    const seen: ViewSettings[] = [];
    const stop = watchView(SEARCH, BASE, (v) => seen.push(v), () => {}, { fetcher, everyMs: 5 });
    await until(() => seen.length === 2);
    stop();
    expect(seen.map((v) => v.search)).toEqual(["semantic", "text"]);
    expect(String(vi.mocked(fetcher).mock.calls[0]![0])).toBe("http://127.0.0.1:8000/view.json");
  });

  it("settings saved with an error are reported and change nothing; fixed, they clear the error", async () => {
    const fetcher = answering(
      () => ok({ theme: "dark" }),
      () => bad("view.yaml:1: view file: theme must be one of auto, light, dark, not 'sepia'"),
      () => bad("view.yaml:1: view file: theme must be one of auto, light, dark, not 'sepia'"),
      () => ok({ theme: "light" }),
    );
    const seen: string[] = [];
    const errors: (string | null)[] = [];
    const stop = watchView(SEARCH, BASE, (v) => seen.push(v.theme), (e) => errors.push(e), { fetcher, everyMs: 5 });
    await until(() => seen.length === 2);
    stop();
    expect(seen).toEqual(["dark", "light"]);
    expect(errors[0]).toMatch(/view\.yaml:1: view file: theme/);
    expect(errors.at(-1)).toBeNull();
    expect(errors.filter((e) => e === null)).toHaveLength(1);
  });

  it("a view file that cannot be fetched (mosaic view stopped) is an error, and the page keeps its settings", async () => {
    const fetcher = answering(
      () => ok({ search: "text" }),
      () => {
        throw new TypeError("Failed to fetch");
      },
    );
    const seen: ViewSettings[] = [];
    const errors: (string | null)[] = [];
    const stop = watchView(SEARCH, BASE, (v) => seen.push(v), (e) => errors.push(e), { fetcher, everyMs: 5 });
    await until(() => errors.length > 0);
    stop();
    expect(seen).toHaveLength(1);
    expect(errors[0]).toMatch(/could not fetch the view file's settings/);
  });

  it("without ?view= nothing is watched", () => {
    const fetcher = answering(() => ok({}));
    const stop = watchView("?mosaic=file/a.mosaic", BASE, () => {}, () => {}, { fetcher, everyMs: 5 });
    stop();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stopping stops the asking", async () => {
    const fetcher = answering(() => ok({}));
    const stop = watchView(SEARCH, BASE, () => {}, () => {}, { fetcher, everyMs: 5 });
    await until(() => vi.mocked(fetcher).mock.calls.length >= 1);
    stop();
    const calls = vi.mocked(fetcher).mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(vi.mocked(fetcher).mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });
});

describe("switching the search mode", () => {
  it("when the mosaic cannot be opened again, the mode stays as the file searches", async () => {
    const viewer = new Viewer();
    await viewer.open(reading("mosaic.mosaic"), "mosaic.mosaic");
    const file = viewer.file;
    const open = vi.spyOn(viewer, "open").mockImplementation(async () => {
      viewer.error = "could not open";
    });
    await viewer.setMode("text");
    expect(open).toHaveBeenCalled();
    expect(viewer.file).toBe(file);
    expect(viewer.mode).toBe("semantic");
  });
});

describe("view watch: further cases", () => {
  const BASE = "http://127.0.0.1:8000/?mosaic=file/a.mosaic&view=view.json";
  const SEARCH = new URL(BASE).search;

  const ok = (json: object) => new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });

  function answering(...answers: (() => Response | Promise<Response>)[]): typeof fetch {
    let i = 0;
    return vi.fn(async () => answers[Math.min(i++, answers.length - 1)]!()) as unknown as typeof fetch;
  }

  async function until(done: () => boolean): Promise<void> {
    for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(done()).toBe(true);
  }

  describe("watching the view file's settings: answers that are not settings", () => {
    it.each([
      ["an HTML error page with status 500", () => new Response("<html>oops</html>", { status: 500 })],
      ["a 404", () => new Response("not found", { status: 404 })],
      ["a 200 that is not JSON", () => new Response("<html></html>", { status: 200 })],
      ["a 200 with an empty body", () => new Response("", { status: 200 })],
      ["settings with a wrong value", () => ok({ theme: "sepia" })],
      ["a JSON array", () => ok([] as unknown as object)],
    ])("%s is an error, keeps the page's settings, and the next good answer recovers", async (_name, broken) => {
      const fetcher = answering(() => ok({ search: "text" }), broken, broken, () => ok({ search: "semantic" }));
      const seen: ViewSettings[] = [];
      const errors: (string | null)[] = [];
      const stop = watchView(SEARCH, BASE, (v) => seen.push(v), (e) => errors.push(e), { fetcher, everyMs: 2 });
      await until(() => seen.length === 2);
      stop();
      expect(seen.map((v) => v.search)).toEqual(["text", "semantic"]);
      expect(typeof errors[0]).toBe("string");
      expect(errors[0]).not.toBe("");
      expect(errors.at(-1)).toBeNull();
    });
  });

  describe("watching the view file's settings: timing", () => {
    it("a stop while an answer is still on its way reports nothing afterwards", async () => {
      let release: (r: Response) => void = () => {};
      const slow = new Promise<Response>((resolve) => (release = resolve));
      const fetcher = answering(() => slow);
      const seen: ViewSettings[] = [];
      const errors: (string | null)[] = [];
      const stop = watchView(SEARCH, BASE, (v) => seen.push(v), (e) => errors.push(e), { fetcher, everyMs: 2 });
      await until(() => vi.mocked(fetcher).mock.calls.length === 1);
      stop();
      release(ok({ search: "text" }));
      await new Promise((r) => setTimeout(r, 30));
      expect(seen).toEqual([]);
      expect(errors).toEqual([]);
      expect(vi.mocked(fetcher).mock.calls.length).toBe(1);
    });

    it("a slow answer is not overlapped by another request", async () => {
      let inFlight = 0;
      let most = 0;
      const fetcher = vi.fn(async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight--;
        return ok({ search: "text" });
      }) as unknown as typeof fetch;
      const stop = watchView(SEARCH, BASE, () => {}, () => {}, { fetcher, everyMs: 1 });
      await new Promise((r) => setTimeout(r, 80));
      stop();
      expect(most).toBe(1);
    });

    it("the same error twice is not a change, and settings that come back to an earlier value are", async () => {
      const fetcher = answering(
        () => ok({ search: "text" }),
        () => ok({ search: "semantic" }),
        () => ok({ search: "text" }),
      );
      const seen: string[] = [];
      const stop = watchView(SEARCH, BASE, (v) => seen.push(v.search), () => {}, { fetcher, everyMs: 2 });
      await until(() => seen.length === 3);
      stop();
      expect(seen).toEqual(["text", "semantic", "text"]);
    });

    it("keeps asking after a failure, so a mosaic view restarted on the same address is found again", async () => {
      const fetcher = answering(
        () => {
          throw new TypeError("Failed to fetch");
        },
        () => ok({ search: "text" }),
      );
      const seen: ViewSettings[] = [];
      const errors: (string | null)[] = [];
      const stop = watchView(SEARCH, BASE, (v) => seen.push(v), (e) => errors.push(e), { fetcher, everyMs: 2 });
      await until(() => seen.length === 1);
      stop();
      expect(errors[0]).not.toBeNull();
      expect(errors.at(-1)).toBeNull();
    });
  });

  describe("watching the view file's settings: the address", () => {
    it.each([["?view="], ["?mosaic=file/a.mosaic"], [""]])("%j names no view file: nothing is asked", (search) => {
      const fetcher = answering(() => ok({}));
      const stop = watchView(search, BASE, () => {}, () => {}, { fetcher, everyMs: 2 });
      stop();
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("the settings address is resolved against the page, not against the mosaic's", async () => {
      const fetcher = answering(() => ok({}));
      const base = "http://127.0.0.1:9/deep/?mosaic=file/a.mosaic&view=view.json";
      const stop = watchView(new URL(base).search, base, () => {}, () => {}, { fetcher, everyMs: 50 });
      await until(() => vi.mocked(fetcher).mock.calls.length >= 1);
      stop();
      expect(String(vi.mocked(fetcher).mock.calls[0]![0])).toBe("http://127.0.0.1:9/deep/view.json");
    });
  });
});
