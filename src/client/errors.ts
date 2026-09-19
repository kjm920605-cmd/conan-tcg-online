const friendlyErrors = {
  INVALID_SESSION: "重連憑證無效或已失效；請確認原分頁，或建立新的匿名身分。",
  SERVER_ERROR: "伺服器暫時無法處理請求，請稍後重試。",
  DATABASE_UNAVAILABLE: "對局資料暫時無法存取，請稍後重新連線。",
  STALE_STATE: "牌局已更新，請同步牌桌後再操作。",
  STALE_DECISION: "這個選擇已失效，請依目前牌桌重新選擇。",
  NOT_DECISION_OWNER: "目前正在等待另一位玩家做決定。",
  ROOM_NOT_FOUND: "找不到房間，請確認房間代碼。",
  ROOM_FULL: "房間已滿，請使用其他房間。",
  MATCH_FINISHED: "這場對局已結束。",
  VERSION_INCOMPATIBLE: "對局版本不相容，請聯絡測試管理者。",
  RULE_BLOCKED: "此互動正在等待官方規則裁定，目前無法繼續。",
  RATE_LIMITED: "操作過於頻繁，請稍候再試。",
  ALPHA_ACCESS_REQUIRED: "請輸入有效的 Alpha 測試通行碼後再連線。",
} as const;

export function isKnownErrorCode(code: unknown): code is keyof typeof friendlyErrors {
  return typeof code === "string" && Object.hasOwn(friendlyErrors, code);
}

export function displayError(code: string, message = code): string {
  const rq = code.match(/(?:RULE_QUESTION_|RULE-QUESTION-)(\d+)/);
  if (rq) return `Unsupported Rule：此互動目前等待官方規則裁定（RQ-${rq[1]}）`;
  return isKnownErrorCode(code) ? `${code}：${friendlyErrors[code]}` : message;
}
