# Phase 5A protocol report

Implemented `packages/protocol/index.ts` with Zod strict runtime validation for every fixed client/server envelope, all 18 Engine Intent shapes, complete projected PlayerView, LegalAction, PendingDecision, RoomState and PlayerPacket. The package imports Engine/client types only and contains no Engine runtime or rule adjudication.

Concealed cards accept exactly `{hidden:true}`. Visible cards use separate PARTNER/CHARACTER/EVENT/CASE shapes matching the current projector. WAITING decisions require empty actions/candidates and reject submitIntent. Nested state, RNG, effect metadata, unknown properties, spoofed client playerId and malformed numbers are rejected. Identifiers, text and key arrays have transport shape bounds; state/revision numbers are nonnegative safe integers. No protocolVersion wire field was added.

Verification: test-first initial reject-all placeholder produced three expected assertion failures; implemented validators passed them. Expanded roundtrip and security checks cover every client/server message, all Intent variants, nested projection privacy, hidden identity, malformed payloads and unknown commands. `node --import tsx --test tests/protocol.test.ts`: **42 passed, 0 failed**. `npx tsc --noEmit` reported no protocol errors; at this checkpoint only the concurrently pending client files were missing.

Files owned: `packages/protocol/index.ts`, `tests/protocol.test.ts`, this report.
