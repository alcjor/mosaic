/**
 * `cite` (Specification 0.1, section 8.1): the evidence rows of a node, given as `id`, or of an
 * edge, given as `from`, `type` and `to`; each with its source id and hash, locator, method,
 * confidence and snippet, and `via` when the evidence passed through mosaics (section 3.5).
 *
 * - Rows come in evidence order (`evid`, section 3.6), at most 20, with `total` counting them
 *   all (section 8.2).
 * - An edge is identified by `(src, type, dst, qualifier)` (section 3.4). `cite` takes an optional
 *   `qualifier`: with it, the rows of that one edge, and `subject` echoes
 *   it; without it, the rows of every edge of that type from `from` to `to`.
 * - `from` or `to` that no node has is `unknown_id`, naming the closest matches (section 8.1);
 *   a type that is not a declared edge type, or no such edge between the two nodes, is
 *   `unknown_edge`.
 * - With `around`, 1 to {@link AROUND_LIMIT}, a row whose source has its text in `source_text`
 *   (full text tier, section 7.3) and whose locator has `chars=<start>-<end>` also gives
 *   `passage`: the source text from `around` characters before the range to `around` after it,
 *   clipped to the text, with the offsets it really covers. Offsets count Unicode code points,
 *   start inclusive, end exclusive. A row without source text or a usable range has no passage.
 */
import type { Database } from "@sqlite.org/sqlite-wasm";
import { type CiteAnswer, type CiteEvidence, ToolError, shownArgument } from "./answers.js";
import { RESULT_LIMIT } from "./bounds.js";
import { TEXT_LIMITS } from "./constants.js";
import { OTHER_TEXT_LIMIT, argumentsOf, idArgument, nodeOf, text } from "./lookup.js";

export type CiteArgs = (
  | { readonly id: string }
  | { readonly from: string; readonly type: string; readonly to: string; readonly qualifier?: string }
) & { readonly around?: number };

const TAKES = "id, or from, type and to and an optional qualifier; and an optional around";

/** Most characters of context `around` gives on each side of an evidence range. */
export const AROUND_LIMIT = 2000;

/** Longest passage, in characters: the context on both sides and a range as long as a snippet. */
const PASSAGE_LIMIT = 2 * AROUND_LIMIT + TEXT_LIMITS.snippet;

const EVIDENCE = `
  SELECT s.id, s.hash, v.locator, v.method, v.confidence, sn.text, v.via, count(*) OVER (), v.sid
    FROM evidence AS v
    JOIN source AS s ON s.sid = v.sid
    LEFT JOIN snippet AS sn ON sn.evid = v.evid
   WHERE %SUBJECT%
   ORDER BY v.evid
   LIMIT $limit`;

const NODE_EVIDENCE = EVIDENCE.replace("%SUBJECT%", "v.nid = $nid");
const EDGE_EVIDENCE = EVIDENCE.replace(
  "%SUBJECT%",
  "v.eid IN (SELECT eid FROM edge WHERE src = $src AND type = $type AND dst = $dst " +
    "AND ($qualifier IS NULL OR qualifier = $qualifier))",
);

const HASH = /^[0-9a-f]{64}$/;

/** `via` read from the file: the array of knowledge hashes, or undefined when it has none. */
function viaOf(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((h) => typeof h === "string" && HASH.test(h))) return parsed as string[];
  } catch {
    // Not JSON: the file says nothing usable about the path, so `via` is left out.
  }
  return undefined;
}

const CHARS = /(?:^|;)chars=(\d{1,15})-(\d{1,15})(?:;|$)/;

/** SQLite counts and cuts text by code points, so a long text never becomes a JavaScript array. */
const PASSAGE = "SELECT substr(text, $from + 1, $to - $from) FROM source_text WHERE sid = $sid AND length(text) >= $end";

/** The text around the `chars` range of `locator` in the source `sid`, or undefined when there is none. */
function passageOf(db: Database, sid: unknown, locator: unknown, around: number): CiteEvidence["passage"] {
  const range = typeof locator === "string" ? CHARS.exec(locator) : null;
  if (range === null) return undefined;
  const start = Number(range[1]);
  const end = Number(range[2]);
  if (start > end) return undefined;
  const from = Math.max(0, start - around);
  const to = Math.min(end + around, from + PASSAGE_LIMIT);
  // substr stops at the end of the text, so `to` may lie past it: the text's length gives the end.
  const found = db.selectValue(PASSAGE, { $sid: sid, $from: from, $to: to, $end: end } as never);
  if (typeof found !== "string") return undefined;
  let length = 0;
  for (const _ of found) length++;
  return { text: found, start: from, end: from + length };
}

function rows(
  db: Database,
  sql: string,
  bind: Record<string, unknown>,
  around: number | undefined,
): { evidence: CiteEvidence[]; total: number } {
  const found = db.selectArrays(sql, { ...bind, $limit: RESULT_LIMIT } as never);
  const evidence = found.map(([source, hash, locator, method, confidence, snippet, via, , sid]) => {
    const row: CiteEvidence = {
      source: text(source, OTHER_TEXT_LIMIT) ?? "",
      source_hash: String(hash),
      locator: text(locator, OTHER_TEXT_LIMIT) ?? "",
      method: method === "inferred" ? "inferred" : "extracted",
      confidence: typeof confidence === "number" ? confidence : null,
      snippet: text(snippet, TEXT_LIMITS.snippet),
    };
    const path = viaOf(via);
    const passage = around === undefined ? undefined : passageOf(db, sid, locator, around);
    return { ...row, ...(path === undefined ? {} : { via: path }), ...(passage === undefined ? {} : { passage }) };
  });
  return { evidence, total: found.length === 0 ? 0 : Number(found[0]![7]) };
}

/** Run `cite` on `db`, which passed the reading rules; the caller bounds its time. */
export function cite(db: Database, mosaic: string, args: unknown): CiteAnswer {
  const given = argumentsOf("cite", args, ["id", "from", "type", "to", "qualifier", "around"], TAKES);
  const around = given.around;
  if (around !== undefined && (typeof around !== "number" || !Number.isInteger(around) || around < 1 || around > AROUND_LIMIT)) {
    throw new ToolError("bad_argument", `cite's around must be a whole number from 1 to ${AROUND_LIMIT}`);
  }
  const edgeArgs = ["from", "type", "to", "qualifier"].filter((name) => given[name] !== undefined);
  if (given.id !== undefined) {
    if (edgeArgs.length > 0) throw new ToolError("bad_argument", `cite takes ${TAKES}, not both`);
    const id = idArgument("cite", "id", given.id);
    const nid = nodeOf(db, mosaic, "cite", id);
    return { tool: "cite", mosaic, data: { subject: id, ...rows(db, NODE_EVIDENCE, { $nid: nid }, around) } };
  }
  if (["from", "type", "to"].some((name) => given[name] === undefined)) throw new ToolError("bad_argument", `cite takes ${TAKES}`);
  const from = idArgument("cite", "from", given.from);
  const to = idArgument("cite", "to", given.to);
  if (typeof given.type !== "string") throw new ToolError("bad_argument", "cite's type must be an edge type name, a string");
  const type = given.type;
  if (given.qualifier !== undefined && typeof given.qualifier !== "string") {
    throw new ToolError("bad_argument", "cite's qualifier must be a string");
  }
  const qualifier = given.qualifier as string | undefined;
  const src = nodeOf(db, mosaic, "cite", from);
  const dst = nodeOf(db, mosaic, "cite", to);
  if (db.selectValue("SELECT 1 FROM type WHERE name = ? AND kind = 'edge'", [type]) === undefined) {
    throw new ToolError("unknown_edge", `${shownArgument(type)} is not an edge type of this mosaic`);
  }
  const edge = { $src: src, $type: type, $dst: dst, $qualifier: qualifier ?? null };
  const exists = "SELECT 1 FROM edge WHERE src = $src AND type = $type AND dst = $dst AND ($qualifier IS NULL OR qualifier = $qualifier)";
  if (db.selectValue(exists, edge) === undefined) {
    const which = qualifier === undefined ? "" : ` with qualifier ${shownArgument(qualifier)}`;
    throw new ToolError(
      "unknown_edge",
      `no ${shownArgument(type)} edge goes from ${shownArgument(from)} to ${shownArgument(to)}${which}`,
    );
  }
  const subject = qualifier === undefined ? { from, type, to } : { from, type, to, qualifier };
  return { tool: "cite", mosaic, data: { subject, ...rows(db, EDGE_EVIDENCE, edge, around) } };
}
