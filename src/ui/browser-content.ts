import { parseCatalog, compileContent } from "../cards/catalog.ts";
const cards = import.meta.glob("../../data/cards/*.json", { eager: true, import: "default" });
const programs = import.meta.glob("../../data/card-programs/*.json", { eager: true, import: "default" });
export const content = compileContent(parseCatalog(Object.values(cards), Object.values(programs)));
