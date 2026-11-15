/**
 * What the page has read from the open mosaic, kept for the session (need G-10): one loader of
 * neighbourhoods and one set of cards per open mosaic.
 */
import type { SealedFile } from "@mosaic/kit";
import type { Shape } from "../view.js";
import { HoodLoader } from "./hood.js";
import { Sources } from "./sources.js";

const loaders = new WeakMap<SealedFile, HoodLoader>();

/** The neighbourhoods of `file` loaded so far, kept for as long as the page has it open (G-10). */
export function hoodLoaderFor(file: SealedFile): HoodLoader {
  let loader = loaders.get(file);
  if (loader === undefined) {
    loader = new HoodLoader(file);
    loaders.set(file, loader);
  }
  return loader;
}

const sources = new WeakMap<SealedFile, Sources>();

/** The cards and link rows of `file` read so far, with `shape`, kept for the session (G-6, G-10). */
export function sourcesFor(file: SealedFile, shape: Shape): Sources {
  let found = sources.get(file);
  if (found === undefined || !found.isFor(file, shape)) {
    found = new Sources(file, shape);
    sources.set(file, found);
  }
  return found;
}
