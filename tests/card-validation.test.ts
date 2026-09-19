import assert from "node:assert/strict";
import test from "node:test";
import { compileContent, parseCatalog, validateCardDefinition, validateEffectProgram, readCardCatalog } from "../src/cards/index.ts";

function program(): any {
  return { programId: "draw", program: { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE", duration: "INSTANT", invalidTargetBehavior: "BLOCK", instructions: [{ op: "DRAW", player: "SELF", count: 1 }] } };
}
function card(): any {
  return { cardId: "F-test", provenance: { kind: "FIXTURE", description: "Synthetic validation card" }, supportStatus: "SUPPORTED", blockedBy: [], mechanics: ["DRAW"], unsupportedMechanics: [],
    definition: { definitionId: "F-test", printedId: "F-test", name: "FIXTURE Test", recognizedNames: ["Fixture Test"], colors: ["BLUE"], support: "VERIFIED_CORE", type: "CHARACTER", level: 0, ap: 1000, lp: 1, triggers: [{ event: "CHARACTER_ENTERED", player: "SELF", subject: "SOURCE", programId: "draw" }] } };
}
const programs = () => ({ draw: program().program });

test("CARD-SCHEMA valid catalog is immutable, deterministic and separate from Engine Content", () => {
  const c = card(), p = program(); validateCardDefinition(c, programs()); validateEffectProgram(p);
  const catalog = parseCatalog([c], [p]), content = compileContent(catalog);
  assert.deepEqual(content.definitions["F-test"], c.definition);
  assert.ok(!Object.hasOwn(content.definitions["F-test"]!, "supportStatus"));
  assert.ok(Object.isFrozen(catalog.cards["F-test"]!.definition));
  Object.assign(c.definition, { ap: 999 }); Object.assign(p.program.instructions[0]!, { count: 999 });
  assert.equal(content.definitions["F-test"]!.type === "CHARACTER" && content.definitions["F-test"]!.ap, 1000);
  assert.equal(content.programs.draw!.instructions.length, 1);
});

for (const [label, mutate] of [
  ["id", (c: any) => { c.cardId = "bad/id"; }],
  ["id binding", (c: any) => { c.definition.definitionId = "different"; }],
  ["type", (c: any) => { c.definition.type = "MONSTER"; }],
  ["level", (c: any) => { c.definition.level = -1; }],
  ["color", (c: any) => { c.definition.colors = [2]; }],
  ["AP", (c: any) => { c.definition.ap = 0.5; }],
  ["LP", (c: any) => { c.definition.lp = "2"; }],
  ["keyword", (c: any) => { c.definition.keywords = [{ kind: "UNKNOWN" }]; }],
  ["trigger", (c: any) => { c.definition.triggers[0].event = "UNKNOWN"; }],
  ["program reference", (c: any) => { c.definition.triggers[0].programId = "missing"; }],
  ["provenance", (c: any) => { c.provenance.kind = "OFFICIAL"; }],
  ["fixture label", (c: any) => { c.definition.name = "Unofficial disguised as official"; }],
  ["support status", (c: any) => { c.supportStatus = "MAYBE"; }],
  ["blocked RQ", (c: any) => { c.blockedBy = ["RULE-QUESTION-999"]; }],
  ["supported with blockers", (c: any) => { c.blockedBy = ["RULE-QUESTION-014"]; }],
] as const) test("CARD-SCHEMA rejects invalid " + label + " before match creation", () => {
  const c = card(); mutate(c); assert.throws(() => validateCardDefinition(c, programs()));
});

for (const [label, mutate] of [
  ["id", (p: any) => { p.programId = "bad/id"; }],
  ["opcode", (p: any) => { p.program.instructions[0].op = "SEARCH"; }],
  ["target zone", (p: any) => { p.program.targetZone = "REMOVE"; }],
  ["duration", (p: any) => { p.program.duration = "FOREVER"; }],
  ["source requirements", (p: any) => { delete p.program.sourceRequirements; }],
  ["target selection", (p: any) => { p.program.targetSelectionPoint = "REBIND"; }],
  ["invalid target", (p: any) => { p.program.invalidTargetBehavior = "IGNORE"; }],
  ["count", (p: any) => { p.program.instructions[0].count = -1; }],
] as const) test("PROGRAM-SCHEMA rejects invalid " + label + " at load", () => {
  const p = program(); mutate(p); assert.throws(() => validateEffectProgram(p));
});

test("CARD-SCHEMA duplicate IDs, orphan references and post-edit corruption are rejected", () => {
  assert.throws(() => parseCatalog([card(), card()], [program()]), /DUPLICATE_CARD/);
  assert.throws(() => parseCatalog([card()], [program(), program()]), /DUPLICATE_PROGRAM/);
  assert.throws(() => parseCatalog([card()], []), /MISSING_PROGRAM/);
  const changed = structuredClone(parseCatalog([card()], [program()]));
  changed.cards["F-test"]!.definition.colors = [];
  assert.throws(() => compileContent(changed));
});

test("CARD-SCHEMA impossible source, contact and duration bindings fail before play", () => {
  for (const mode of ["source", "contact", "expiry", "keyword"]) {
    const c = card(), p = program();
    p.program = { sourceRequirements: "FIELD_ENTRY", targetSelectionPoint: "RESOLUTION", targetZone: "FIELD", duration: "UNTIL_CONTACT_END", invalidTargetBehavior: "BLOCK", instructions: [{ op: "AP_MOD", target: "SOURCE", value: 1000 }] };
    if (mode === "source") c.definition.triggers[0].event = "CHARACTER_REMOVED";
    if (mode === "contact") { p.program.sourceRequirements = "INDEPENDENT"; p.program.instructions[0].target = "OWN_CONTACT"; }
    if (mode === "expiry") { p.program.duration = "UNTIL_TURN_END"; c.definition.triggers[0].event = "TURN_END"; }
    if (mode === "keyword") { p.program.duration = "INSTANT"; p.program.instructions = [{ op: "INVOKE_KEYWORD", keyword: "INVESTIGATE_X" }]; }
    assert.throws(() => parseCatalog([c], [p]), /RULE_QUESTION_0(14|23)/);
  }
});

test("CARD-SCHEMA every blocking RQ is valid metadata but never playable", () => {
  for (const id of ["002", "009", "012", "013", "014", "023", "025", "027"]) {
    const c = card(), rq = "RULE-QUESTION-" + id;
    c.supportStatus = "BLOCKED"; c.blockedBy = [rq];
    c.unsupportedMechanics = [{ mechanic: "UNKNOWN_INTERACTION", reason: "Await official ruling", blockedBy: [rq] }];
    const catalog = parseCatalog([c], [program()]);
    assert.throws(() => compileContent(catalog, [c.cardId]), new RegExp("RULE_QUESTION_" + id));
  }
});

test("CARD-SCHEMA AP_COMPARED cannot load a modifier into the closing Contact scope", async () => {
  const catalog = structuredClone(await readCardCatalog(new URL("../data/", import.meta.url)));
  catalog.cards["F-COMBO-ENTER"]!.definition.triggers[1]!.event = "AP_COMPARED";
  assert.throws(() => compileContent(catalog), /RULE_QUESTION_023/);
});

test("CARD-DATA loads 28 FIXTURE records; only 24 SUPPORTED enter Content", async () => {
  const catalog = await readCardCatalog(new URL("../data/", import.meta.url));
  assert.equal(Object.keys(catalog.cards).length, 28);
  assert.deepEqual(Object.values(catalog.cards).reduce((n, c) => ({ ...n, [c.supportStatus]: n[c.supportStatus] + 1 }), { SUPPORTED: 0, PARTIAL: 0, BLOCKED: 0 }), { SUPPORTED: 24, PARTIAL: 1, BLOCKED: 3 });
  assert.ok(Object.values(catalog.cards).every(c => c.provenance.kind === "FIXTURE"));
  const content = compileContent(catalog); assert.equal(Object.keys(content.definitions).length, 24);
  assert.throws(() => compileContent(catalog, ["F-SEARCH"]), /UNSUPPORTED_CARD_STATUS/);
});
