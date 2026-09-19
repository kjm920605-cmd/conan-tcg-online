import { readFile, readdir } from "node:fs/promises";
import { check } from "../game/persistence/json.ts";
import { parseCatalog } from "./catalog.ts";
import type { CardCatalog } from "./model.ts";

export async function readCardCatalog(root: URL): Promise<CardCatalog> {
  async function readDirectory(directory: string, idKey: string): Promise<unknown[]> {
    const url = new URL(directory + "/", root);
    const names = (await readdir(url)).filter(n => n.endsWith(".json")).sort();
    check(names.length > 0, "CATALOG_EMPTY_DIRECTORY");
    return Promise.all(names.map(async name => {
      const value: unknown = JSON.parse(await readFile(new URL(name, url), "utf8"));
      check(value && typeof value === "object" && (value as Record<string, unknown>)[idKey] === name.slice(0, -5), "CATALOG_FILENAME");
      return value;
    }));
  }
  const [cards, programs] = await Promise.all([readDirectory("cards", "cardId"), readDirectory("card-programs", "programId")]);
  return parseCatalog(cards, programs);
}
