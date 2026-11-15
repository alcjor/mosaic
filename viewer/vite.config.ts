import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  base: "./",
  build: {
    // The packed fonts go into the stylesheet as data URLs, so `mosaic export`, which inlines
    // the stylesheet, carries them too; every other asset keeps Vite's default.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? true : undefined),
  },
});
