
import { useState } from "react";

import { App } from "./App.tsx";
import { content } from "./browser-content.ts";
import { LocalController } from "../local/controller.ts";
import { fixtureOptions } from "../local/decks.ts";

const key = "conan-local-fixture-v1";
export default function LocalBootstrap() {
  const [failure, setFailure] = useState<string | null>(null);
  const [controller, setController] = useState<LocalController | null>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? LocalController.restore(content, saved) : LocalController.create(content, fixtureOptions());
    } catch { return null; }
  });
  // Persistence belongs to the trusted local host, never to board components.
  const [connected] = useState(() => new WeakSet<LocalController>());
  if (controller && !connected.has(controller)) {
    connected.add(controller);
    controller.subscribe(() => {
      try { localStorage.setItem(key, controller.exportSnapshot()); }
      catch { setFailure("本機儲存不可用；請從開發工具匯出快照。"); }
    });
  }
  if (!controller) return <main><h1>無法還原本機對局</h1><p>保留的快照無效或與目前內容不相容。</p><button onClick={() => { localStorage.removeItem(key); setController(LocalController.create(content, fixtureOptions())); }}>清除舊快照並建立 FIXTURE 對局</button></main>;
  return <>{failure && <p role="alert">{failure}</p>}<App controller={controller}/></>;
}

