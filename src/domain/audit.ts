import type { AuditEntry, Editor } from './types'

// 审计以「现场单号 + 动作 + 明细」派生幂等键：
// 写入失败后按现场单号恢复（重试/回放）时，同一业务事件不重复追加审计。
export function auditKey(entry: Pick<AuditEntry, 'ticketId' | 'action' | 'detail'>): string {
  return `${entry.ticketId}::${entry.action}::${entry.detail}`
}

export type AuditInput = {
  ticketId: string
  actor: Editor | '系统'
  action: string
  detail: string
  at?: string
  idempotencyKey?: string
}

export function appendAudit(audits: AuditEntry[], input: AuditInput): AuditEntry[] {
  const at = input.at ?? new Date().toISOString()
  const key = input.idempotencyKey ?? auditKey(input)
  if (audits.some((entry) => (entry as AuditEntry & { idempotencyKey?: string }).idempotencyKey === key)) return audits
  const entry: AuditEntry & { idempotencyKey?: string } = {
    id: `AUD-${audits.length + 1}-${Date.now()}`,
    ticketId: input.ticketId,
    at,
    actor: input.actor,
    action: input.action,
    detail: input.detail,
    idempotencyKey: key,
  }
  return [...audits, entry]
}

// 批量追加，逐条幂等
export function appendAudits(audits: AuditEntry[], inputs: AuditInput[]): AuditEntry[] {
  return inputs.reduce((acc, input) => appendAudit(acc, input), audits)
}
