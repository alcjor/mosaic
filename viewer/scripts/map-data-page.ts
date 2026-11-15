/**
 * The page side of `map-data.ts`: opens a mosaic with the kit, walks every type in the
 * background as the map does, and reports the map's data, the most linked things,
 * how long each walk took and how long the page was ever kept from handling input meanwhile.
 */
import { openFile } from "@mosaic/kit";
import { mapData, mostLinkedByEdge, mostLinkedOfType } from "../src/lib/graph/map.js";
import { Tallies } from "../src/lib/graph/tally.js";
import { DEFAULT_VIEW, parseView, Shape } from "../src/lib/view.js";

export interface WalkReport {
  readonly type: string;
  readonly ms: number;
  readonly pages: number;
}

export async function report(bytes: Uint8Array, name: string, settings: unknown) {
  const file = await openFile(bytes, name);
  try {
    const shape = new Shape(settings === null ? DEFAULT_VIEW : parseView(settings), file);
    const once = async () => {
      const tallies = new Tallies(file);
      const first = mapData(file, shape, tallies);
      // The walks the map needs first, then the rest, as a person selecting each type would.
      const order = [...first.needs, ...file.nodeTypes.map((t) => t.name).filter((t) => !first.needs.includes(t))];
      const walks: WalkReport[] = [];
      for (const type of order) {
        let pages = 0;
        const started = performance.now();
        await tallies.run(type, { onTally: () => void pages++ });
        walks.push({ type, ms: Math.round(performance.now() - started), pages });
      }
      const data = mapData(file, shape, tallies);
      return {
        before: first,
        map: data,
        types: Object.fromEntries(file.nodeTypes.map((t) => [t.name, mostLinkedOfType(tallies, t.name)])),
        edges: Object.fromEntries(file.edgeTypes.map((e) => [e.name, mostLinkedByEdge(file, tallies, e.name)])),
        walks,
      };
    };
    // How long input waits: a heartbeat every 16 ms, and the longest gap between two beats.
    let last = performance.now();
    let longest = 0;
    const beat = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 16);
    // Long tasks that began once the walks did: opening the file, before, is not the map's.
    const began = performance.now();
    const tasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.startTime >= began) tasks.push(entry.duration);
    });
    try {
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      // No long-task timing in this browser: the heartbeat still measures.
    }
    const first = await once();
    clearInterval(beat);
    observer.disconnect();
    const second = await once();
    const strip = (r: typeof first) => ({ ...r, walks: r.walks.map((w) => ({ type: w.type, pages: w.pages })) });
    return {
      ...first,
      same_twice: JSON.stringify(strip(first)) === JSON.stringify(strip(second)),
      longest_wait_ms: Math.round(longest),
      longest_task_ms: Math.round(Math.max(0, ...tasks)),
    };
  } finally {
    file.close();
  }
}
