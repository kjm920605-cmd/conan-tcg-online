export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type AuditEvent = 'request.completed' | 'request.failed' | 'connection.opened' | 'connection.closed' | 'connection.rejected'
  | 'room.created' | 'room.joined' | 'match.started' | 'match.restored' | 'match.finished' | 'session.resumed'
  | 'command.accepted' | 'command.duplicate' | 'command.rejected' | 'persistence.failed' | 'rate.limited' | 'server.started' | 'server.stopped';
export type AuditContext = { requestId?: string; connectionId?: string; roomId?: string; matchId?: string; stateVersion?: number;
  commandType?: string; code?: string; status?: number; durationMs?: number };
export type AuditLogger = (level: Exclude<LogLevel, 'silent'>, event: AuditEvent, context?: AuditContext) => void;
const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
export const silentLogger: AuditLogger = () => {};

/** Only explicit scalar metadata crosses this boundary; never pass payloads, tokens, URLs or Error objects. */
export function createAuditLogger(level: LogLevel, write: (line: string) => void = line => process.stdout.write(line + '\n')): AuditLogger {
  return (severity, event, context = {}) => {
    if (priorities[severity] < priorities[level]) return;
    const safe: Record<string, string | number> = { time: new Date().toISOString(), level: severity, event };
    for (const key of ['requestId', 'connectionId', 'roomId', 'matchId', 'commandType', 'code'] as const) {
      const value = context[key]; if (typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)) safe[key] = value;
    }
    for (const key of ['stateVersion', 'status', 'durationMs'] as const) {
      const value = context[key]; if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
    }
    try { write(JSON.stringify(safe)); } catch { /* A broken log sink must not change game authority or transaction results. */ }
  };
}
