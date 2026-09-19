import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import { displayError } from "../src/client/errors.ts";

test("production errors have friendly text, keep stable codes and suppress raw server diagnostics", () => {
  for (const code of ["INVALID_SESSION", "SERVER_ERROR", "DATABASE_UNAVAILABLE", "STALE_STATE", "STALE_DECISION", "NOT_DECISION_OWNER", "ROOM_NOT_FOUND", "ROOM_FULL", "MATCH_FINISHED", "VERSION_INCOMPATIBLE", "RULE_BLOCKED", "RATE_LIMITED", "ALPHA_ACCESS_REQUIRED"]) {
    const message = displayError(code, "raw database/password diagnostics");
    assert.ok(message.includes(code), code);
    assert.match(message, /[\u3400-\u9fff]/, code);
    assert.doesNotMatch(message, /raw database|password/, code);
  }
  assert.match(displayError("RULE_QUESTION_002"), /Unsupported Rule.*RQ-002/);
  assert.equal(displayError("UNKNOWN_RULE", "Unavailable action"), "Unavailable action");
});

test("runtime config accepts only the current HTTPS origin and exact WSS endpoint", async () => {
  const { parsePublicConfig } = await import("../src/ui/ProductionBootstrap.tsx");
  const valid = { webPublicUrl: "https://alpha.example.test", gameServerPublicUrl: "wss://alpha.example.test/ws", alphaRequired: true };
  assert.deepEqual(parsePublicConfig(valid, "https://alpha.example.test/?mode=local"), valid);
  const withPort = { ...valid, webPublicUrl: "https://alpha.example.test:8443", gameServerPublicUrl: "wss://alpha.example.test:8443/ws" };
  assert.deepEqual(parsePublicConfig(withPort, "https://alpha.example.test:8443/"), withPort);
  for (const value of [null, {}, { ...valid, alphaRequired: false }, { ...valid, alphaRequired: "true" },
    { ...valid, webPublicUrl: "http://alpha.example.test" },
    { ...valid, webPublicUrl: "https://other.example.test" },
    { ...valid, webPublicUrl: "https://alpha.example.test/path" },
    { ...valid, webPublicUrl: "https://alpha.example.test/?code=secret" },
    { ...valid, webPublicUrl: "https://user:secret@alpha.example.test" },
    ...["ws://alpha.example.test/ws", "wss://evil.example.test/ws", "wss://alpha.example.test:444/ws", "wss://alpha.example.test/other", "wss://alpha.example.test/ws?code=secret", "wss://alpha.example.test/ws#fragment", "wss://user:secret@alpha.example.test/ws", "wss://alpha.example.test/path/../ws"].map(gameServerPublicUrl => ({ ...valid, gameServerPublicUrl }))]) {
    assert.throws(() => parsePublicConfig(value, "https://alpha.example.test/"), /設定/);
  }
  assert.throws(() => parsePublicConfig(valid, "http://alpha.example.test/"), /設定/);
  assert.deepEqual(parsePublicConfig({ ...valid, ignoredSecret: "must not propagate" }, "https://alpha.example.test/"), valid);
});

test("public access requests stay on relative same-origin paths and refuse redirects", async () => {
  const { loadPublicConfig, fetchAlphaAccess, submitAlphaCode } = await import("../src/ui/ProductionBootstrap.tsx");
  const requests: { input: string; init: RequestInit }[] = [];
  const config = { webPublicUrl: "https://alpha.example.test", gameServerPublicUrl: "wss://alpha.example.test/ws", alphaRequired: true };
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ input: String(input), init: init! });
    return Response.json(String(input).endsWith("public-config") ? config : { authenticated: init?.method === "POST" });
  };
  assert.deepEqual(await loadPublicConfig("https://alpha.example.test/", fetcher), config);
  assert.equal(await fetchAlphaAccess(fetcher), false);
  await submitAlphaCode("transient-alpha-code", fetcher);
  assert.deepEqual(requests.map(request => request.input), ["/api/public-config", "/api/alpha", "/api/alpha"]);
  for (const { init } of requests) {
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
  }
  assert.equal(requests[2]!.init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[2]!.init.body)), { code: "transient-alpha-code" });
  assert.equal(new Headers(requests[2]!.init.headers).get("Content-Type"), "application/json");
});

test("access failures expose stable safe errors and malformed success cannot open the gate", async () => {
  const { fetchAlphaAccess, submitAlphaCode } = await import("../src/ui/ProductionBootstrap.tsx");
  const fetcher = (payload: unknown, status = 200): typeof fetch => async () => Response.json(payload, { status });
  await assert.rejects(submitAlphaCode("secret", fetcher({ error: { code: "ALPHA_ACCESS_REQUIRED", requestId: "safe-id", message: "secret internal detail" } }, 401)), error => error instanceof Error && /ALPHA_ACCESS_REQUIRED/.test(error.message) && !/secret/.test(error.message));
  await assert.rejects(submitAlphaCode("secret", fetcher({ error: { code: "RATE_LIMITED" } }, 429)), /RATE_LIMITED/);
  await assert.rejects(fetchAlphaAccess(fetcher({ error: { code: "secret-in-database" } }, 500)), error => error instanceof Error && /SERVER_ERROR/.test(error.message) && !/secret/.test(error.message));
  await assert.rejects(fetchAlphaAccess(fetcher({ authenticated: "true" })), /SERVER_ERROR/);
  await assert.rejects(submitAlphaCode("secret", fetcher({ authenticated: false })), /ALPHA_ACCESS_REQUIRED/);
  await assert.rejects(fetchAlphaAccess(async () => { throw new Error("secret network detail"); }), error => error instanceof Error && /SERVER_ERROR/.test(error.message) && !/secret/.test(error.message));
});

test("production SSR has no online client before access; access form is a blank password field", async () => {
  const { default: ProductionBootstrap, AlphaAccessForm } = await import("../src/ui/ProductionBootstrap.tsx");
  const bootstrap = renderToStaticMarkup(createElement(ProductionBootstrap));
  assert.doesNotMatch(bootstrap, /online-room|online-connection|game-board|dev-panel|data-card-id/);
  const form = renderToStaticMarkup(createElement(AlphaAccessForm, { onSubmit: async () => {} }));
  assert.match(form, /type="password"/);
  assert.match(form, /aria-label="Alpha access"/);
  assert.match(form, /Alpha 通行碼/);
  assert.match(form, /進入 Alpha/);
  assert.match(form, /value=""/);
  assert.match(form, /Alpha/);
  assert.doesNotMatch(form, /online-connection|game-board|dev-panel/);
});

test("reconnect waits for the alpha gate before continuing the same client", async () => {
  const { connectAfterAccess } = await import("../src/ui/OnlineScreen.tsx");
  let connections = 0;
  let grant!: () => void;
  const access = new Promise<void>(resolve => { grant = resolve; });
  const reconnecting = connectAfterAccess(() => { connections++; }, () => access);
  await Promise.resolve();
  assert.equal(connections, 0);
  grant();
  await reconnecting;
  assert.equal(connections, 1);
  await assert.rejects(connectAfterAccess(() => { connections++; }, async () => { throw new Error("ALPHA_ACCESS_REQUIRED"); }), /ALPHA_ACCESS_REQUIRED/);
  assert.equal(connections, 1);
});

test("production bundle defaults online and excludes local engine, catalog and developer tools", async () => {
  const result = await build({ logLevel: "silent", build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(output => "output" in output ? output.output : []);
  const chunks = outputs.filter(output => output.type === "chunk");
  assert.ok(chunks.length > 0);
  const code = chunks.map(chunk => chunk.code).join("\n");
  const modules = chunks.flatMap(chunk => Object.keys(chunk.modules)).map(id => id.replaceAll("\\", "/"));
  assert.ok(modules.some(id => id.endsWith("/src/ui/ProductionBootstrap.tsx")));
  assert.ok(modules.some(id => id.endsWith("/src/ui/OnlineScreen.tsx")));
  assert.ok(!modules.some(id => /\/src\/(local|cards|game)\/|\/LocalBootstrap\.tsx$|\/localGameClient\.ts$|\/data\//.test(id)), modules.join("\n"));
  assert.doesNotMatch(code, /Local hot-seat|Developer tools|Export Snapshot|Reveal private snapshot|conan-local-snapshot|VITE_GAME_SERVER_URL|SESSION_SECRET|ALPHA_ACCESS_SECRET|DATABASE_URL/);
});
