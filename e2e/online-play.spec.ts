import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { PlayerPacket } from "../packages/protocol/index.ts";

test("independent online browsers create a room, start a match and resume the same private seat", async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage(), b = await cb.newPage();
  try {
    await a.goto("/?mode=online"); await b.goto("/?mode=online");
    await expect(a.getByRole("button", { name: "Create Room", exact: true })).toBeEnabled();
    await a.getByRole("button", { name: "Create Room", exact: true }).click();
    const code = await a.getByTestId("room-code").innerText();
    await b.getByLabel("Room Code", { exact: true }).fill(code);
    await b.getByRole("button", { name: "Join Room", exact: true }).click();
    await a.getByRole("button", { name: "Room Ready", exact: true }).click();
    await b.getByRole("button", { name: "Room Ready", exact: true }).click();
    await expect(a.getByTestId("game-board")).toBeVisible(); await expect(b.getByTestId("game-board")).toBeVisible();
    await expect(a.getByTestId("dev-panel")).toHaveCount(0); await expect(b.getByTestId("dev-panel")).toHaveCount(0);
    await expect(a.getByTestId("online-seat")).toHaveText("A"); await expect(b.getByTestId("online-seat")).toHaveText("B");
    const active = await a.getByRole("button", { name: "Keep hand", exact: true }).count() ? a : b;
    await active.getByRole("button", { name: "Keep hand", exact: true }).click();
    const other = active === a ? b : a;
    await other.getByRole("button", { name: "Keep hand", exact: true }).click();
    await b.reload();
    await expect(b.getByTestId("game-board")).toBeVisible(); await expect(b.getByTestId("online-seat")).toHaveText("B");
    await expect(b.getByTestId("online-connection")).toHaveText("CONNECTED");
    expect(await b.evaluate(() => localStorage.getItem("conan-local-fixture-v1"))).toBeNull();
    const ownA = a.locator('[aria-label="A HAND"] [data-card-id]');
    const ids = await ownA.evaluateAll(cards => cards.map(c => c.getAttribute("data-card-id")));
    for (const id of ids) await expect(b.locator(`[data-card-id="${id}"]`)).toHaveCount(0);
  } finally { await ca.close(); await cb.close(); }
});

test("two online browsers finish a fixture match through board commands after reconnect", async ({ browser }) => {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const pages = [await contexts[0]!.newPage(), await contexts[1]!.newPage()];
  const packets = new Map<Page, PlayerPacket>();
  const finished = new Set<Page>();
  const requests: string[] = [];
  for (const page of pages) {
    page.on("request", request => requests.push(request.url()));
    page.on("websocket", socket => socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.packet) packets.set(page, message.packet);
      if (message.type === "GAME_FINISHED") finished.add(page);
    }));
  }
  const [a, b] = pages as [Page, Page];
  try {
    await a.goto("/?mode=online"); await b.goto("/?mode=online");
    await a.getByRole("button", { name: "Create Room", exact: true }).click();
    const code = await a.getByTestId("room-code").innerText();
    await b.getByLabel("Room Code", { exact: true }).fill(code);
    await b.getByRole("button", { name: "Join Room", exact: true }).click();
    await a.getByRole("button", { name: "Room Ready", exact: true }).click();
    await b.getByRole("button", { name: "Room Ready", exact: true }).click();
    for (const page of pages) await expect(page.getByTestId("game-board")).toBeVisible();
    let played = false, resumed = false;
    for (let step = 0; step < 180; step++) {
      const current = packets.get(a)!;
      if (current.view.status === "FINISHED") break;
      expect(current.view.status).not.toBe("RULE_BLOCKED");
      if (!resumed && current.view.turn.number >= 3) {
        await b.reload();
        await expect(b.getByTestId("online-seat")).toHaveText("B");
        await expect(b.getByTestId("state-version")).toHaveText(String(current.stateVersion));
        resumed = true;
      }
      const ownerId = current.decision?.playerId ?? current.view.turn.playerId;
      const page = ownerId === "A" ? a : b;
      const packet = packets.get(page)!;
      expect(packet.stateVersion).toBe(current.stateVersion);
      const options = (packet.decision?.actions ?? packet.legalActions).filter(action => action.available);
      let action = packet.decision ? options.find(action => /^(Pass Mislead|No guard|Pass|Decline|Keep hand)$/.test(action.label)) ?? options[0] : undefined;
      if (!packet.decision) {
        if (!played) action = options.find(action => action.intent.kind === "PLAY_CARD" && packet.view.players[ownerId]!.zones.HAND.some(card => !card.hidden && card.id === action.sourceId && card.type === "CHARACTER"));
        action ??= options.find(action => action.intent.kind === "DEDUCE" && action.label.startsWith("Deduce: FIXTURE Partner"));
        action ??= options.find(action => action.intent.kind === "END_MAIN");
      }
      if (action) {
        if (action.intent.kind === "PLAY_CARD") played = true;
        await page.getByRole("button", { name: action.label, exact: true }).click();
      } else if (packet.decision?.mode === "ORDERED") {
        await page.getByRole("button", { name: "確認調查順序", exact: true }).click();
      } else throw new Error(`No legal board command at ${current.view.status}/${current.decision?.kind}`);
      for (const peer of pages) await expect(peer.getByTestId("state-version")).toHaveText(String(current.stateVersion + 1));
    }
    expect(played).toBe(true); expect(resumed).toBe(true);
    for (const page of pages) {
      expect(packets.get(page)!.view.status).toBe("FINISHED");
      expect(finished.has(page)).toBe(true);
      await expect(page.getByRole("status").filter({ hasText: "勝利" })).toBeVisible();
      await expect(page.getByTestId("dev-panel")).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("conan-local-fixture-v1"))).toBeNull();
    }
    expect(packets.get(a)!.view.outcome).toEqual(packets.get(b)!.view.outcome);
    expect(packets.get(a)!.view.events.some(event => event.type === "DEDUCTION_DECLARED")).toBe(true);
    expect(requests.filter(url => /LocalBootstrap|\/src\/local\/|\/src\/game\/engine\/|\/src\/cards\/|\/data\//.test(url))).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});
