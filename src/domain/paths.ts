import type { AcceptanceItem, Device, DependencyPath, Rule, RulePriority } from './types'

// 路径指纹所覆盖的输入：设备分区变化、规则优先级 / 互锁 / 启停 / 延时变化都会改变路径
export function pathFingerprint(rule: Rule, trigger: Device | undefined, action: Device | undefined): string {
  return JSON.stringify({
    t: trigger?.zone ?? '',
    tf: trigger?.floor ?? '',
    a: action?.zone ?? '',
    af: action?.floor ?? '',
    d: rule.delay,
    i: rule.interlock,
    p: rule.priority,
    e: rule.enabled,
    s: rule.suppression,
  })
}

export function pathId(ruleId: string) {
  return `P-${ruleId}`
}

// 依据当前设备与规则全量重算依赖路径：
// 保留同 id 路径的 version；指纹变化（设备分区 / 优先级 / 互锁等）时升版并标记失效。
export function recomputePaths(prev: DependencyPath[], rules: Rule[], devices: Device[]): DependencyPath[] {
  const prevById = new Map(prev.map((path) => [path.id, path]))
  return rules.map((rule) => {
    const trigger = devices.find((device) => device.id === rule.triggerId)
    const action = devices.find((device) => device.id === rule.actionId)
    const id = pathId(rule.id)
    const fingerprint = pathFingerprint(rule, trigger, action)
    const crossZone = Boolean(trigger && action && trigger.zone !== action.zone)
    const prior = prevById.get(id)
    const changed = !prior || prior.fingerprint !== fingerprint

    let reason: string | undefined
    if (prior && changed) {
      const reasons: string[] = []
      if (prior.triggerId !== rule.triggerId || prior.actionId !== rule.actionId) reasons.push('关联设备变更')
      if (prior.interlock !== rule.interlock) reasons.push('互锁条件变更')
      if (prior.priority !== rule.priority) reasons.push('优先级变更')
      const pf = JSON.parse(prior.fingerprint) as Record<string, unknown>
      if (pf.t !== (trigger?.zone ?? '') || pf.a !== (action?.zone ?? '')) reasons.push('设备分区变更')
      if (pf.d !== rule.delay) reasons.push('联锁延时变更')
      if (pf.e !== rule.enabled) reasons.push('规则启停变更')
      reason = reasons.join('、') || '路径输入变更'
    }

    return {
      id,
      ruleId: rule.id,
      triggerId: rule.triggerId,
      actionId: rule.actionId,
      viaZones: [trigger?.zone, action?.zone].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i) as string[],
      interlock: rule.interlock,
      priority: rule.priority,
      crossZone,
      version: prior && !changed ? prior.version : (prior?.version ?? 0) + 1,
      fingerprint,
      // 新算或输入变化 → 失效待重新确认；无变化时保持原状态
      stale: changed ? true : prior?.stale ?? false,
      invalidatedAt: changed ? new Date().toISOString() : prior?.invalidatedAt,
      invalidReason: changed ? reason : prior?.invalidReason,
    }
  })
}

// 找到受设备分区变化影响的路径（触发或动作设备的 zone/floor 被修改）
export function pathsAffectedByDevice(prevDevice: Device, nextDevice: Device, rules: Rule[]): string[] {
  if (prevDevice.zone === nextDevice.zone && prevDevice.floor === nextDevice.floor) return []
  return rules
    .filter((rule) => rule.triggerId === nextDevice.id || rule.actionId === nextDevice.id)
    .map((rule) => pathId(rule.id))
}

export function rulesInZones(zones: string[], rules: Rule[], devices: Device[]): Set<string> {
  const affected = new Set<string>()
  for (const rule of rules) {
    const trigger = devices.find((device) => device.id === rule.triggerId)
    const action = devices.find((device) => device.id === rule.actionId)
    if ((trigger && zones.includes(trigger.zone)) || (action && zones.includes(action.zone))) affected.add(rule.id)
  }
  return affected
}

// 验收项与路径版本对齐：
// - 路径失效或升版后，原"通过"结论作废为"失效"（旧结论不放行）
// - "待测"项保持待测；路径恢复为最新后，"失效"项由调用方在重算确认时重置为待测
export function syncAcceptances(acceptances: AcceptanceItem[], paths: DependencyPath[]): AcceptanceItem[] {
  const pathById = new Map(paths.map((path) => [path.id, path]))
  return acceptances
    // 规则/路径已删除的验收项一并清除
    .filter((item) => pathById.has(item.pathId))
    .map((item) => {
      const path = pathById.get(item.pathId)!
      if (item.status === '通过' && (path.stale || item.basedOnPathVersion !== path.version)) {
        return {
          ...item,
          status: '失效' as const,
          result: item.result ? `${item.result}（路径已升版，旧结论不放行）` : '依赖路径变化，旧验收结论失效',
        }
      }
      return item
    })
}

export function acceptanceTitle(rule: Rule, devices: Device[]): string {
  const trigger = devices.find((device) => device.id === rule.triggerId)?.name ?? rule.triggerId
  const action = devices.find((device) => device.id === rule.actionId)?.name ?? rule.actionId
  return `${trigger} → ${action} 联动验证（延时 ${rule.delay}s / 优先级 ${rule.priority}）`
}

// 为新出现的路径补建验收项
export function ensureAcceptances(acceptances: AcceptanceItem[], paths: DependencyPath[], rules: Rule[], devices: Device[]): AcceptanceItem[] {
  const existing = new Set(acceptances.map((item) => item.pathId))
  const additions: AcceptanceItem[] = []
  for (const path of paths) {
    if (existing.has(path.id)) continue
    const rule = rules.find((item) => item.id === path.ruleId)
    if (!rule) continue
    additions.push({
      id: `A-${path.id.slice(2)}`,
      pathId: path.id,
      ruleId: rule.id,
      title: acceptanceTitle(rule, devices),
      owner: '调试组',
      status: '待测',
      basedOnPathVersion: path.version,
    })
  }
  return [...acceptances, ...additions]
}

export type Priority = RulePriority
