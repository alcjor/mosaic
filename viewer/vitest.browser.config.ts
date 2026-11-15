import { defineConfig } from "vitest/config";

// Browser tests of the built page (`bun run build` first): see browser/harness.ts.
export default defineConfig({
  test: { include: ["browser/**/*.browser.ts"], testTimeout: 60_000, hookTimeout: 60_000 },
});
