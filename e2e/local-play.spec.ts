import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function setup(page: Page) {
  await page.goto("/");
  for (let n = 0; n < 2; n++) {
    await page.getByTestId("ready-button").click();
    await page.getByRole("button", { name: "Keep hand", exact: true }).click();
  }
  if (await page.getByTestId("handoff").count()) await page.getByTestId("ready-button").click();
  await expect(page.getByTestId("legal-actions")).toBeVisible();
}

async function savedState(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("conan-local-fixture-v1")!));
}

test("initial hot-seat board, mulligan handoff and reload privacy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("handoff")).toBeVisible();
  await expect(page.getByTestId("game-board")).toHaveCount(0);
  await page.getByTestId("ready-button").click();
  await expect(page.getByTestId("game-board")).toBeVisible();
  await expect(page.getByTestId("decision-panel")).toContainText("MULLIGAN");
  await page.getByRole("button", { name: "Keep hand", exact: true }).click();
  await expect(page.getByTestId("handoff")).toBeVisible();
  await expect(page.getByTestId("game-board")).toHaveCount(0);
  await page.getByTestId("ready-button").click();
  await expect(page.getByTestId("decision-panel")).toContainText("MULLIGAN");
  await page.reload();
  await expect(page.getByTestId("handoff")).toBeVisible();
  await expect(page.getByTestId("game-board")).toHaveCount(0);
});

test("Next Hint, UnsupportedRule explanations and dev privacy on turn transition", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "ASSIST", exact: true }).click();
  await expect(page.getByTestId("legal-actions")).toContainText("RQ-025");
  await page.getByRole("button", { name: "NEXT HINT", exact: true }).click();
  await expect(page.getByTestId("decision-panel")).toContainText("NEXT HINT CARD");
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByTestId("legal-actions")).toContainText("RQ-009");
  await expect(page.getByRole("button", { name: "NEXT HINT", exact: true })).toBeDisabled();
  await page.getByTestId("dev-panel").locator("summary").first().click();
  await page.getByRole("button", { name: "Reveal private snapshot", exact: true }).click();
  await expect(page.getByTestId("private-snapshot")).toBeVisible();
  await page.getByRole("button", { name: "END MAIN", exact: true }).click();
  await expect(page.getByTestId("handoff")).toBeVisible();
  await expect(page.getByTestId("private-snapshot")).toHaveCount(0);
  await expect(page.getByTestId("dev-panel")).toHaveCount(0);
  await expect(page.locator("[data-card-id]")).toHaveCount(0);
});

test("snapshot export/import preserves the match and restores UI behind Ready", async ({ page }, testInfo) => {
  await setup(page);
  await page.getByTestId("dev-panel").locator("summary").first().click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Snapshot", exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath("snapshot.json"); await download.saveAs(path);
  const snapshot = await readFile(path, "utf8");
  const before = JSON.parse(snapshot);
  await page.getByPlaceholder("Paste snapshot JSON").fill("{}");
  await page.getByRole("button", { name: "Import Snapshot", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Snapshot import failed");
  expect((await savedState(page)).revision).toBe(before.revision);
  await page.getByPlaceholder("Paste snapshot JSON").fill(snapshot);
  await page.getByRole("button", { name: "Import Snapshot", exact: true }).click();
  await expect(page.getByTestId("handoff")).toBeVisible();
  await expect(page.getByTestId("game-board")).toHaveCount(0);
  await page.getByTestId("ready-button").click();
  expect(await savedState(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "END MAIN", exact: true })).toBeEnabled();
});

test("complete fixture match through browser commands: setup, mulligan, play, deductions, turns and loss", async ({ page }) => {
  await setup(page);
  let played = false;
  for (let step = 0; step < 180; step++) {
    if (await page.getByTestId("handoff").count()) { await page.getByTestId("ready-button").click(); continue; }
    if ((await savedState(page)).status === "FINISHED") break;
    const decision = page.getByTestId("decision-panel");
    if (await decision.count()) {
      const pass = decision.getByRole("button", { name: /^(Pass Mislead|No guard|Pass|Decline|Keep hand)$/ }).first();
      if (await pass.count()) await pass.click();
      else await decision.locator("button:enabled").last().click();
      continue;
    }
    if (!played) {
      const play = page.getByTestId("legal-actions").getByRole("button", { name: /^Play / }).and(page.locator("button:enabled")).first();
      if (await play.count()) { await play.click(); played = true; continue; }
    }
    const deduce = page.getByRole("button", { name: /^Deduce: FIXTURE Partner/ }).and(page.locator("button:enabled"));
    if (await deduce.count()) { await deduce.click(); continue; }
    await page.getByRole("button", { name: "END MAIN", exact: true }).click();
  }
  const final = await savedState(page);
  expect(played).toBe(true); expect(final.status).toBe("FINISHED");
  expect(final.turn.number).toBeGreaterThan(2);
  expect(final.events.some((e: { type: string }) => e.type === "CHARACTER_ENTERED" || e.type === "CARD_PLAYED")).toBe(true);
  expect(final.events.some((e: { type: string }) => e.type === "DEDUCTION_DECLARED")).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "勝利" })).toBeVisible();
});

test("narrow viewport remains operable without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "NEXT HINT", exact: true }).click();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByTestId("game-board")).toBeVisible();
});
