/**
 * Open the plain page example in Chromium and print the lines of its answer as JSON.
 *
 *     bun examples/embed/open-page.ts URL [WORDS]
 *
 * With WORDS, types them into the page's box first. Used by the slow tests.
 */
import { chromium } from "playwright";

const [url, words] = process.argv.slice(2);
if (!url) {
  console.error("usage: bun examples/embed/open-page.ts URL [WORDS]");
  process.exit(2);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  if (words) {
    await page.locator("#words").fill(words);
    await page.locator("#words").press("Enter");
  }
  await page.locator(`#answer[data-ready=${JSON.stringify(words ?? "Group x")}]`).waitFor({ timeout: 30_000 });
  console.log(JSON.stringify({ lines: await page.locator("#answer li").allTextContents(), errors }));
} finally {
  await browser.close();
}
