// The picker as drawn (brand book, section 6: buttons, focus on every control).
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import CardPicker from "../src/components/CardPicker.svelte";
import { cardsText } from "../src/lib/cardpick.js";

const card = { name: "Title", show: ["rating", "summary"], links: ["directed_by"], counts: ["features"] };
const options = { show: ["summary", "release_year", "rating"], links: ["directed_by", "features"] };
const props = (more: Record<string, unknown> = {}) => ({
  type: "Title",
  options,
  card,
  chosen: false,
  text: cardsText([card]),
  onpick: () => {},
  onreset: () => {},
  ...more,
});

describe("the card picker, drawn", () => {
  it("one checkbox per fact the card can show, in each part, checked as the card is", () => {
    const { body } = render(CardPicker, { props: props() });
    const part = (name: string) => body.split(`data-part="${name}"`)[1]!.split("</fieldset>")[0]!;
    const boxes = (html: string) => [...html.matchAll(/<input type="checkbox" value="([^"]+)"([^>]*)>/g)].map((m) => [m[1], m[2]!.includes("checked")]);
    expect(boxes(part("show"))).toEqual([["summary", true], ["release_year", false], ["rating", true]]);
    expect(boxes(part("links"))).toEqual([["directed_by", true], ["features", false]]);
    expect(boxes(part("counts"))).toEqual([["directed_by", false], ["features", true]]);
    expect(body).toContain("Lists the things it links to by");
    expect(body).toContain("Counts the things it links to by");
  });

  it("names an incoming link with its direction", () => {
    const { body } = render(CardPicker, { props: props({ type: "Person", options: { show: ["summary"], links: ["features in"] }, card: { name: "Person", show: [], links: [], counts: ["features in"] } }) });
    expect(body).toContain("← features");
  });

  it("gives the view file's text to copy, read-only, with a button to copy it", () => {
    const { body } = render(CardPicker, { props: props() });
    expect(body).toMatch(/<textarea[^>]*readonly/);
    expect(body).toContain("show: [rating, summary]");
    expect(body).toContain(">Copy the text</button>");
    expect(body).toMatch(/role="status"/);
  });

  it("offers the view file's card again only once a card is chosen in the page", () => {
    expect(render(CardPicker, { props: props() }).body).not.toContain("Back to the view file");
    expect(render(CardPicker, { props: props({ chosen: true }) }).body).toContain("Back to the view file's card");
  });
});
