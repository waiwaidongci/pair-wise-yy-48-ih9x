import type { AcceptanceItem, AuditEntry, DebugBatch, Device, Rule } from './types'
import { ensureAcceptances, recomputePaths } from './paths'

export const CURRENT_SCHEMA_VERSION = 2
export const LEGACY_STORAGE_KEYS = ['fire-linkage-draft-v1']
export const BATCH_STORAGE_KEY = 'fire-linkage-batch-v2'

// 旧稿结构（v1：只有 devices/rules/revision/locked/acceptedChanges）
type LegacyDraft = {
  devices?: Device[]
  rules?: Rule[]
  revision?: number
  locked?: boolean
  acceptedChanges?: string[]
  // 不带 schemaVersion 的一律视为 v1
}

export function isLegacy(raw: unknown): raw is LegacyDraft {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as Record<string, unknown>
  return value.schemaVersion === undefined && (Array.isArray(value.devices) || Array.isArray(value.rules))
}

export function isBatch(raw: unknown): raw is DebugBatch {
  return Boolean(raw && typeof raw === 'object' && (raw as Record<string, unknown>).schemaVersion === CURRENT_SCHEMA_VERSION)
}

// 旧稿按首版迁移：
// 旧规则同时作为基线与唯一版本（无分叉、无冲突）；依赖路径与验收项首版全量生成，只记一条迁移审计。
export function migrateLegacy(
  legacy: LegacyDraft,
  seed: { devices: Device[]; rules: Rule[] },
  ticketId: string,
  now = new Date().toISOString(),
): DebugBatch {
  const devices = legacy.devices ?? structuredClone(seed.devices)
  const rules = legacy.rules ?? structuredClone(seed.rules)
  const baseRules = Object.fromEntries(rules.map((rule) => [rule.id, structuredClone(rule)]))

  // 旧数据既无现场/值班室分叉，首版路径视为已确认基线（stale=false）；
  // 迁移之后任何输入再变，统一按失效重算流程处理。
  const paths = recomputePaths([], rules, devices).map((path) => ({
    ...path,
    stale: false,
    invalidatedAt: undefined,
    invalidReason: undefined,
  }))
  const acceptances = ensureAcceptances([], paths, rules, devices)

  const audit: AuditEntry = {
    id: `AUD-migrate-${now}`,
    ticketId,
    at: now,
    actor: '系统',
    action: '旧稿迁移',
    detail: `v1 草稿按首版迁移：${devices.length} 台设备、${rules.length} 条规则；路径与验收项首次建账，未产生重复审计。`,
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ticketId,
    devices,
    rules,
    baseRules,
    fieldConfirmed: {},
    conflicts: [],
    paths,
    pathsVersion: 1,
    acceptances,
    audits: [audit],
    signOff: { signed: false, revision: legacy.revision ?? 1 },
    revision: legacy.revision ?? 1,
    locked: legacy.locked ?? false,
    selectedRuleIds: [],
    acceptedChanges: legacy.acceptedChanges ?? ['CH-01'],
  }
}
