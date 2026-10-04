import type { FieldKind, Rule, RuleConflict, RuleFork } from './types'

export const FIELD_LABELS: Record<FieldKind, string> = {
  delay: '联锁延时',
  interlock: '互锁条件',
  priority: '优先级',
  suppression: '抑制条件',
  enabled: '启停状态',
}

const MERGE_FIELDS: FieldKind[] = ['delay', 'interlock', 'priority', 'suppression', 'enabled']

// 三路合并单条规则：
// - 值班室相对基线没动 → 取现场值（现场即权威）
// - 现场相对基线没动 → 取值班室值
// - 两端改了同一字段 → 保留现场值为主值，值班室版本进冲突队列
// - 现场虽未随本批 fork 提交，但字段已在现场确认账本（fieldConfirmed）→ 同样按两端同改处理
// - 两端改了不同字段 → 字段级合并，无冲突
export function mergeRule(
  base: Rule | undefined,
  incomingFork: Partial<RuleFork>,
  ticketId: string,
  now: string,
  confirmedMap: Record<string, string | number | boolean> = {},
): { rule: Rule; conflicts: RuleConflict[] } {
  const fieldFork = incomingFork.field
  const dutyFork = incomingFork.duty
  // 以现场版本为骨架；现场没提交但值班室提交了则用值班室
  const skeleton = fieldFork ?? dutyFork ?? base
  if (!skeleton) throw new Error('缺少可合并的规则')

  const conflicts: RuleConflict[] = []
  const merged: Rule = { ...skeleton }

  for (const key of MERGE_FIELDS) {
    const baseValue = base ? (base[key] as Rule[FieldKind]) : undefined
    const fieldForkValue = fieldFork ? (fieldFork[key] as Rule[FieldKind]) : undefined
    const dutyValue = dutyFork ? (dutyFork[key] as Rule[FieldKind]) : undefined
    const confirmedKey = `${skeleton.id}.${key}`
    const hasConfirmed = Object.prototype.hasOwnProperty.call(confirmedMap, confirmedKey)
    const confirmedValue = hasConfirmed ? confirmedMap[confirmedKey] : undefined

    const fieldChanged = fieldFork ? !looseEqual(fieldForkValue, baseValue) : hasConfirmed
    const dutyChanged = dutyFork ? !looseEqual(dutyValue, baseValue) : false
    // 现场当前有效值：本批 fork 优先，否则取现场确认账本
    const fieldEffective = fieldFork ? fieldForkValue : confirmedValue

    if (fieldChanged && dutyChanged && !looseEqual(fieldEffective, dutyValue)) {
      merged[key] = fieldEffective as never
      conflicts.push({
        id: `CF-${skeleton.id}-${key}`,
        ruleId: skeleton.id,
        field: key,
        label: FIELD_LABELS[key],
        fieldValue: fieldEffective as string | number | boolean,
        dutyValue: dutyValue as string | number | boolean,
        status: '待处理',
        detectedAt: now,
        ticketId,
      })
    } else if (dutyChanged && !fieldChanged) {
      merged[key] = dutyValue as never
    } else if (fieldChanged) {
      merged[key] = fieldEffective as never
    } else if (dutyValue !== undefined) {
      merged[key] = dutyValue as never
    } else if (fieldForkValue !== undefined) {
      merged[key] = fieldForkValue as never
    }
  }

  if (fieldFork) {
    merged.triggerId = fieldFork.triggerId
    merged.actionId = fieldFork.actionId
  }

  return { rule: merged, conflicts }
}

function looseEqual(a: unknown, b: unknown) {
  return a === b || String(a) === String(b)
}

// 合并一整批 fork（用于"值班室晚回记录"到达时）
export function mergeForks(
  baseRules: Record<string, Rule>,
  currentRules: Rule[],
  forks: Record<string, Partial<RuleFork>>,
  ticketId: string,
  confirmedMap: Record<string, string | number | boolean> = {},
  now = new Date().toISOString(),
): { rules: Rule[]; conflicts: RuleConflict[]; mergedIds: string[] } {
  const nextRules = [...currentRules]
  const indexById = new Map(nextRules.map((rule, index) => [rule.id, index]))
  const conflicts: RuleConflict[] = []
  const mergedIds: string[] = []

  for (const [ruleId, fork] of Object.entries(forks)) {
    const base = baseRules[ruleId]
    const { rule, conflicts: ruleConflicts } = mergeRule(base, fork, ticketId, now, confirmedMap)
    const index = indexById.get(ruleId)
    if (index !== undefined) nextRules[index] = rule
    else nextRules.push(rule)
    indexById.set(ruleId, index ?? nextRules.length - 1)
    conflicts.push(...ruleConflicts)
    mergedIds.push(ruleId)
  }

  return { rules: nextRules, conflicts, mergedIds }
}

// 处置冲突：维持现场（主值即现场，无需改规则）/ 采用值班室（把主值改为值班室值）
export function resolveConflictValue(conflict: RuleConflict, rules: Rule[]): Rule[] {
  if (conflict.status !== '采用值班室') return rules
  return rules.map((rule) =>
    rule.id === conflict.ruleId ? ({ ...rule, [conflict.field]: conflict.dutyValue } as Rule) : rule,
  )
}

export function openConflicts(conflicts: RuleConflict[]): RuleConflict[] {
  return conflicts.filter((conflict) => conflict.status === '待处理')
}

export function conflictsForRule(conflicts: RuleConflict[], ruleId: string): RuleConflict[] {
  return conflicts.filter((conflict) => conflict.ruleId === ruleId)
}
