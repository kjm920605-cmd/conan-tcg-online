import { test, expect } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";

test("an active match can reset an invalid resume session without reloading", async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage(), b = await cb.newPage();
  let original: WebSocketRoute | undefined;
  let serverSide: WebSocketRoute | undefined;
  let sessionsLost = false;
  await a.routeWebSocket("**", route => {
    if (!sessionsLost) {
      original = route;
      serverSide = route.connectToServer();
      return;
    }
    // Emulate a restarted server's fresh socket session and rejection of the
    // now-unknown resume credential, keeping the existing page/packet intact.
    route.send(JSON.stringify({ type: "SESSION", playerSessionId: "fresh-session", resumeToken: "fresh-token" }));
    route.onMessage(raw => {
      if (JSON.parse(String(raw)).type === "RESUME_MATCH") route.send(JSON.stringify({
        type: "COMMAND_REJECTED", commandId: null, code: "INVALID_SESSION", message: "INVALID_SESSION", stateVersion: null,
      }));
    });
  });
  try {
    await a.goto("/?mode=online"); await b.goto("/?mode=online");
    await a.getByRole("button", { name: "Create Room", exact: true }).click();
    const code = await a.getByTestId("room-code").innerText();
    await b.getByLabel("Room Code", { exact: true }).fill(code);
    await b.getByRole("button", { name: "Join Room", exact: true }).click();
    await a.getByRole("button", { name: "Room Ready", exact: true }).click();
    await b.getByRole("button", { name: "Room Ready", exact: true }).click();
    await expect(a.getByTestId("game-board")).toBeVisible();
    await expect(b.getByTestId("game-board")).toBeVisible();
    const version = await a.getByTestId("state-version").innerText();
    sessionsLost = true;
    await original!.close({ code: 1001, reason: "Server restart simulation" });
    await serverSide!.close();
    await expect(a.getByTestId("online-connection")).toHaveText("DISCONNECTED");
    await a.getByRole("button", { name: "Reconnect", exact: true }).click();
    await expect(a.getByRole("alert")).toContainText("INVALID_SESSION");
    await expect(a.getByTestId("state-version")).toHaveText(version);
    const reset = a.getByRole("button", { name: "New anonymous session", exact: true });
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(a.getByTestId("game-board")).toHaveCount(0);
    await expect(a.getByRole("button", { name: "Create Room", exact: true })).toBeEnabled();
  } finally { await ca.close(); await cb.close(); }
});
