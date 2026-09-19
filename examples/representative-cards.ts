import { readCardCatalog, compileContent } from "../src/cards/index.ts";
import { entryContactCombo, disguiseCombo, mrCombo, traceRefreshCombo } from "./representative-combos.ts";

const catalog = await readCardCatalog(new URL("../data/", import.meta.url));
const cards = Object.values(catalog.cards);
const content = compileContent(catalog);
console.log("Phase 3B catalog", {
  fixtureCards: cards.length, officialCards: 0,
  supported: cards.filter(c => c.supportStatus === "SUPPORTED").length,
  partial: cards.filter(c => c.supportStatus === "PARTIAL").length,
  blocked: cards.filter(c => c.supportStatus === "BLOCKED").length,
  compiledCards: Object.keys(content.definitions).length,
  programs: Object.keys(catalog.programs).length,
});
for (const [name, run] of [
  ["Entry / pending / compound / Contact / Cut-in / expiry", entryContactCombo],
  ["Disguise inheritance", disguiseCombo],
  ["MR movement and uniqueness", mrCombo],
  ["Refresh and TRACE", traceRefreshCombo],
] as const) {
  const session = await run();
  session.assertReplay();
  console.log(name, { recordedSteps: session.log.length, restoreChecks: session.restoreChecks, replay: "identical", status: session.state.status });
}
