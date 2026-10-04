import type { AcceptanceItem, DebugBatch, RuleConflict } from './types'
import { openConflicts } from './merge'

export type SignBlocker = {
  code: 'conflict' | 'stale-path' | 'acceptance' | 'validation-error' | 'pending-write'
  message: string
}

export type Validation = { id: string; severity: '错误' | '警告'; ruleIds: string[]; title: string; detail: string; suggestion: string }

// 与旧版一致的矩阵校验（遗漏 / 重复 / 跨区 / 互锁高优先级延时矛盾）
export function validateRules(batch: { devices: DebugBatch['devices']; rules: DebugBatch['rules'] }): Validation[] {
  const result: Validation[] = []
  const { devices, rules } = batch
  const triggers = devices.filter((device) =>
    ['感烟探测器', '感温探测器', '手动报警按钮', '输入模块'].includes(device.type),
  )
  for (const trigger of triggers) {
    const enabled = rules.filter((rule) => rule.triggerId === trigger.id && rule.enabled)
    if (enabled.length === 0) {
      result.push({
        id: `missing-${trigger.id}`,
        severity: '错误',
        ruleIds: [],
        title: `${trigger.name} 缺少联动动作`,
        detail: '报警点未配置任何启用的因果规则。',
        suggestion: '至少配置广播、排烟或疏散相关动作。',
      })
    }
    const actionCount = new Map<string, number>()
    enabled.forEach((rule) => actionCount.set(rule.actionId, (actionCount.get(rule.actionId) ?? 0) + 1))
    actionCount.forEach((count, actionId) => {
      if (count > 1) {
        result.push({
          id: `duplicate-${trigger.id}-${actionId}`,
          severity: '警告',
          ruleIds: enabled.filter((rule) => rule.actionId === actionId).map((rule) => rule.id),
          title: `${trigger.name} 存在重复动作`,
          detail: `同一个动作 ${actionId} 被重复配置 ${count} 次。`,
          suggestion: '合并规则或明确主备关系。',
        })
      }
    })
  }
  rules
    .filter((rule) => rule.enabled)
    .forEach((rule) => {
      const trigger = devices.find((device) => device.id === rule.triggerId)
      const action = devices.find((device) => device.id === rule.actionId)
      if (trigger && action && trigger.zone !== action.zone && rule.suppression === '无') {
        result.push({
          id: `cross-${rule.id}`,
          severity: '警告',
          ruleIds: [rule.id],
          title: `${rule.id} 跨区联动未配置抑制`,
          detail: `${trigger.zone} 报警将直接触发 ${action.zone} 动作。`,
          suggestion: '确认疏散边界并增加分区确认或抑制条件。',
        })
      }
      if (rule.interlock && rule.interlock !== '无' && rule.delay > 5 && rule.priority === 1) {
        result.push({
          id: `contradiction-${rule.id}`,
          severity: '错误',
          ruleIds: [rule.id],
          title: `${rule.id} 互锁与高优先级延时冲突`,
          detail: '一级优先规则在互锁未明确反馈前延时超过 5 秒。',
          suggestion: '缩短延时或改为反馈后触发。',
        })
      }
    })
  return result
}

// 签字门控：冲突未处理、失效路径未重测、验收未通过、存在错误校验、写入未落盘，均不能签字
export function signBlockers(batch: DebugBatch, validations: Validation[]): SignBlocker[] {
  const blockers: SignBlocker[] = []
  const open: RuleConflict[] = openConflicts(batch.conflicts)
  if (open.length > 0) {
    blockers.push({
      code: 'conflict',
      message: `${open.length} 条现场/值班室冲突未处理：${open.map((item) => `${item.ruleId} ${item.label}`).join('、')}`,
    })
  }
  const stale = batch.paths.filter((path) => path.stale)
  if (stale.length > 0) {
    blockers.push({ code: 'stale-path', message: `${stale.length} 条依赖路径已失效待重算确认：${stale.map((item) => item.ruleId).join('、')}` })
  }
  const failedOrPending = batch.acceptances.filter((item) => item.status !== '通过')
  if (failedOrPending.length > 0) {
    blockers.push({
      code: 'acceptance',
      message: `${failedOrPending.length} 个验收项未通过（含失效重测项）：${failedOrPending.map((item) => item.id).join('、')}`,
    })
  }
  const errors = validations.filter((item) => item.severity === '错误')
  if (errors.length > 0) blockers.push({ code: 'validation-error', message: `矩阵存在 ${errors.length} 个阻断错误` })
  if (batch.pendingWrite) blockers.push({ code: 'pending-write', message: `现场单号 ${batch.pendingWrite.ticketId} 的写入仍未确认，请先恢复` })
  return blockers
}

export function passAcceptance(item: AcceptanceItem, pathVersion: number, signer: string): AcceptanceItem {
  return {
    ...item,
    status: '通过',
    basedOnPathVersion: pathVersion,
    signedBy: signer,
    signedAt: new Date().toISOString(),
    result: `路径 v${pathVersion} 现场联调通过`,
  }
}
