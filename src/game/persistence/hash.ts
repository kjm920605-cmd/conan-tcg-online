import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Identical synchronous SHA-256 in Node and the browser; no snapshot migration. */
export function hashText(text: string): string { return bytesToHex(sha256(new TextEncoder().encode(text))); }
