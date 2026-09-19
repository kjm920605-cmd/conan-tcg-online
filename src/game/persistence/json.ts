import { hashText } from "./hash.ts";
import type { DeepReadonly } from "../model.ts";

export class RuleError extends Error {
  readonly code: string;
  readonly category: "UnsupportedRule" | "UnsupportedFeature" | "InvalidCommand";
  constructor(code: string, message: string) {
    super(code + ": " + message);
    this.code = code.replace("RULE-QUESTION-", "RULE_QUESTION_");
    this.category = this.code.startsWith("RULE_QUESTION_") ? "UnsupportedRule" : this.code.startsWith("UNSUPPORTED") ? "UnsupportedFeature" : "InvalidCommand";
  }
}
export function check(condition: unknown, code: string, message = code): asserts condition {
  if (!condition) throw new RuleError(code, message);
}
export function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { check(Number.isFinite(value), "JSON_NUMBER"); return; }
  check(typeof value === "object", "JSON_TYPE");
  check(!ancestors.has(value), "JSON_CYCLE");
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  check(isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, "JSON_OBJECT");
  check(Object.getOwnPropertySymbols(value).length === 0, "JSON_SYMBOL");
  ancestors.add(value);
  const keys = Object.getOwnPropertyNames(value).filter(key => !(isArray && key === "length"));
  if (isArray) {
    check(keys.length === value.length && keys.every((key, index) => key === String(index)), "JSON_ARRAY", "Dense indexed arrays only");
  }
  for (const key of keys) {
    check(!["__proto__", "constructor", "prototype"].includes(key), "JSON_KEY");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    check("value" in descriptor, "JSON_ACCESSOR");
    check(descriptor.enumerable, "JSON_PROPERTY");
    assertJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}
export function canonical(value: unknown): string {
  assertJson(value);
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered((item as Record<string, unknown>)[key])]));
    return item;
  }
  return JSON.stringify(ordered(value));
}
export function fingerprint(value: unknown): string { return hashText(canonical(value)); }
export function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
export function exactKeys(value: object, allowed: string[], code: string): void {
  check(Object.keys(value).every(k => allowed.includes(k)), code, "Unexpected or unsupported property");
}
export function integer(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}
export function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value) && !["constructor", "prototype", "__proto__"].includes(value);
}
