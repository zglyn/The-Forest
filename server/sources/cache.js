// Small JSON file cache in ./cache so repeat lookups don't hit public APIs again.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve("cache");

export async function loadCache(name) {
  try {
    return JSON.parse(await readFile(path.join(DIR, name + ".json"), "utf8"));
  } catch {
    return {};
  }
}

export async function saveCache(name, data) {
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, name + ".json"), JSON.stringify(data));
}
