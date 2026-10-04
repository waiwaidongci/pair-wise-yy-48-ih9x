import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  AcceptanceItem,
  BatchSnapshot,
  ConflictStatus,
  DebugBatch,
  Device,
  DeviceType,
  Editor,
  Rule,
  RuleConflict,
  RuleFork,
  RulePriority,
} from '../domain/types'
import { ensureAcceptances, pathId, recomputePaths, syncAcceptances } from '../domain/paths'
import { FIELD_LABELS, mergeForks, openConflicts, resolveConflictValue } from '../domain/merge'
import { passAcceptance, signBlockers, validateRules } from '../domain/acceptance'
import { appendAudit } from '../domain/audit'
import { BATCH_STORAGE_KEY, CURRENT_SCHEMA_VERSION, LEGACY_STORAGE_KEYS, isBatch, isLegacy, migrateLegacy } from '../domain/migrate'
import { snapshotDigest, syncService } from '../api/sync'

export type { Device, DeviceType, Rule, RulePriority, RuleConflict }

export const seedDevices: Device[] = [
  { id: 'D-01-01', name: '一层大厅感烟 01', type: '感烟探测器', floor: '1F', zone: 'A 区', address: '1-A-01-01' },
  { id: 'D-01-02', name: '一层大厅感烟 02', type: '感烟探测器', floor: '1F', zone: 'A 区', address: '1-A-01-02' },
  { id: 'D-01-11', name: '一层东侧手报', type: '手动报警按钮', floor: '1F', zone: 'A 区', address: '1-A-02-01' },
  { id: 'A-01-01', name: '一层排烟风机 PF-1', type: '排烟风机', floor: '1F', zone: 'A 区', address: '1-F-01-01' },
  { id: 'A-01-02', name: '中庭防火卷帘 01', type: '防火卷帘', floor: '1F', zone: '中庭', address: '1-R-01-01' },
  { id: 'A-01-03', name: '一层消防广播', type: '消防广播', floor: '1F', zone: 'A 区', address: '1-B-01-01' },
  { id: 'D-02-01', name: '二层机房感温 01', type: '感温探测器', floor: '2F', zone: 'B 区', address: '2-B-01-01' },
  { id: 'D-02-02', name: '二层机房感烟 01', type: '感烟探测器', floor: '2F', zone: 'B 区', address: '2-B-01-02' },
  { id: 'A-02-01', name: '二层排烟风机 PF-2', type: '排烟风机', floor: '2F', zone: 'B 区', address: '2-F-01-01' },
  { id: 'A-02-02', name: '1 号客梯归位', type: '电梯', floor: '2F', zone: 'B 区', address: '2-L-01-01' },
]

export const seedRules: Rule[] = [
  { id: 'R-001', triggerId: 'D-01-01', actionId: 'A-01-01', delay: 0, interlock: '卷帘全开后启动', priority: 1, suppression: '无', enabled: true },
  { id: 'R-002', triggerId: 'D-01-01', actionId: 'A-01-03', delay: 5, interlock: '无', priority: 2, suppression: '手动广播优先', enabled: true },
  { id: 'R-003', triggerId: 'D-01-02', actionId: 'A-01-02', delay: 0, interlock: '排烟风机运行', priority: 1, suppression: '无', enabled: true },
  { id: 'R-004', triggerId: 'D-01-11', actionId: 'A-01-03', delay: 3, interlock: '无', priority: 1, suppression: '无', enabled: true },
  { id: 'R-005', triggerId: 'D-02-01', actionId: 'A-02-01', delay: 0, interlock: '防火阀开启反馈', priority: 1, suppression: '无', enabled: true },
  { id: 'R-006', triggerId: 'D-02-01', actionId: 'A-02-02', delay: 10, interlock: '轿厢无人确认', priority: 2, suppression: '消防电梯模式', enabled: true },
  { id: 'R-007', triggerId: 'D-02-02', actionId: 'A-01-01', delay: 0, interlock: '无', priority: 3, suppression: '无', enabled: false },
  { id: 'R-008', triggerId: 'D-01-01', actionId: 'A-02-02', delay: 0, interlock: '无', priority: 1, suppression: '无', enabled: true },
]

// 首次建账：无旧稿时以种子数据建立调试批次（首版路径、验收项）
function createFreshBatch(ticketId: string): DebugBatch {
  const now = new Date().toISOString()
  const rules = structuredClone(seedRules)
  const devices = structuredClone(seedDevices)
  const baseRules = Object.fromEntries(rules.map((rule) => [rule.id, structuredClone(rule)]))
  const paths = recomputePaths([], rules, devices).map((path) => ({ ...path, stale: false, invalidatedAt: undefined, invalidReason: undefined }))
  const acceptances = ensureAcceptances([], paths, rules, devices)
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
    audits: [
      {
        id: `AUD-init-${ticketId}`,
        ticketId,
        at: now,
        actor: '系统',
        action: '建立调试批次',
        detail: `现场单号 ${ticketId} 建账：${devices.length} 台设备、${rules.length} 条规则。`,
      },
    ],
    signOff: { signed: false, revision: 1 },
    revision: 8,
    locked: false,
    selectedRuleIds: [],
    acceptedChanges: ['CH-01'],
  }
}

function loadInitialBatch(): DebugBatch {
  const ticketId = `XC-${new Date().getFullYear()}-1004-01`
  const rawV2 = localStorage.getItem(BATCH_STORAGE_KEY)
  if (rawV2) {
    const parsed = JSON.parse(rawV2) as unknown
    if (isBatch(parsed)) return parsed
    if (isLegacy(parsed)) {
      return migrateLegacy(parsed, { devices: seedDevices, rules: seedRules }, ticketId)
    }
  }
  for (const key of LEGACY_STORAGE_KEYS) {
    const rawLegacy = localStorage.getItem(key)
    if (rawLegacy) {
      const parsed = JSON.parse(rawLegacy) as unknown
      if (isLegacy(parsed)) {
        const batch = migrateLegacy(parsed, { devices: seedDevices, rules: seedRules }, ticketId)
        // 迁移成功后落 v2，并保留旧稿文件不动（回退用）
        localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(batch))
        return batch
      }
    }
  }
  return createFreshBatch(ticketId)
}

export const useLinkageStore = defineStore('linkage', () => {
  const batch = ref<DebugBatch>(loadInitialBatch())
  const syncing = ref(false)
  const syncMessage = ref('')
  const syncFault = ref(false)

  // 向后兼容的切片
  const devices = computed(() => batch.value.devices)
  const rules = computed(() => batch.value.rules)
  const revision = computed(() => batch.value.revision)
  const locked = computed(() => batch.value.locked)
  const acceptedChanges = computed(() => batch.value.acceptedChanges)
  const selectedRuleIds = computed({
    get: () => batch.value.selectedRuleIds,
    set: (value: string[]) => {
      batch.value.selectedRuleIds = value
    },
  })
  const paths = computed(() => batch.value.paths)
  const acceptances = computed(() => batch.value.acceptances)
  const conflicts = computed(() => batch.value.conflicts)
  const openConflictList = computed(() => openConflicts(batch.value.conflicts))
  const audits = computed(() => batch.value.audits)
  const ticketId = computed(() => batch.value.ticketId)
  const pendingWrite = computed(() => batch.value.pendingWrite)
  const signOff = computed(() => batch.value.signOff)

  const validations = computed(() => validateRules({ devices: batch.value.devices, rules: batch.value.rules }))
  const blockers = computed(() => signBlockers(batch.value, validations.value))
  const canSign = computed(() => blockers.value.length === 0)

  watch(
    batch,
    (value) => {
      localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

  // ---- 内部：重算路径 + 同步验收失效 + 补建验收项 ----
  function rebuildPathsAndAcceptances(reasonPrefix?: string) {
    const nextPaths = recomputePaths(batch.value.paths, batch.value.rules, batch.value.devices)
    const changedCount = nextPaths.filter((path) => path.stale && !batch.value.paths.find((old) => old.id === path.id && old.version === path.version)).length
    if (changedCount > 0) batch.value.pathsVersion += 1
    batch.value.paths = nextPaths
    let nextAcceptances = syncAcceptances(batch.value.acceptances, batch.value.paths)
    nextAcceptances = ensureAcceptances(nextAcceptances, batch.value.paths, batch.value.rules, batch.value.devices).map((item) => {
      // 同步标题/规则对齐（规则改名或触发关系变化后）
      const rule = batch.value.rules.find((rule) => rule.id === item.ruleId)
      if (!rule) return item
      const trigger = batch.value.devices.find((device) => device.id === rule.triggerId)?.name ?? rule.triggerId
      const action = batch.value.devices.find((device) => device.id === rule.actionId)?.name ?? rule.actionId
      const title = `${trigger} → ${action} 联动验证（延时 ${rule.delay}s / 优先级 ${rule.priority}）`
      return item.title === title ? item : { ...item, title }
    })
    batch.value.acceptances = nextAcceptances
    if (changedCount > 0 && reasonPrefix) {
      batch.value.audits = appendAudit(batch.value.audits, {
        ticketId: batch.value.ticketId,
        actor: '系统',
        action: '依赖路径失效重算',
        detail: `${reasonPrefix}，${changedCount} 条路径升版失效，关联验收结论作废待重测。`,
      })
    }
    // 清理已不存在规则的冲突
    const ruleIds = new Set(batch.value.rules.map((rule) => rule.id))
    batch.value.conflicts = batch.value.conflicts.filter((conflict) => ruleIds.has(conflict.ruleId))
  }

  function audit(actor: Editor | '系统', action: string, detail: string, idempotencyKey?: string) {
    batch.value.audits = appendAudit(batch.value.audits, { ticketId: batch.value.ticketId, actor, action, detail, idempotencyKey })
  }

  // ---- 规则编辑（现场端为权威主值）----
  function updateRule(id: string, patch: Partial<Rule>, actor: Editor = '现场') {
    if (batch.value.locked || batch.value.pendingWrite) return
    const before = batch.value.rules.find((item) => item.id === id)
    if (!before) return
    const changedFields = (Object.keys(patch) as Array<keyof Rule>).filter((key) => before[key] !== patch[key])
    if (changedFields.length === 0) return
    batch.value.rules = batch.value.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    // 现场确认值记账：值班室之后晚回同字段时不覆盖，进冲突队列
    for (const field of changedFields) {
      batch.value.fieldConfirmed[`${id}.${field}`] = patch[field] as string | number | boolean
    }
    batch.value.revision += 1
    const labels = changedFields.map((field) => FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? String(field)).join('、')
    audit(actor, '规则修改', `${id} 经${actor}调整 ${labels}。`)
    rebuildPathsAndAcceptances(`${actor}修改 ${id}（${labels}）`)
  }

  function addRule() {
    if (batch.value.locked || batch.value.pendingWrite) return
    const nextNumber = batch.value.rules.length + 1
    const id = `R-${String(nextNumber).padStart(3, '0')}`
    const rule: Rule = {
      id,
      triggerId: batch.value.devices[0]?.id ?? '',
      actionId: batch.value.devices.at(-1)?.id ?? '',
      delay: 0,
      interlock: '无',
      priority: 2,
      suppression: '无',
      enabled: true,
    }
    batch.value.rules.push(rule)
    batch.value.baseRules[id] = structuredClone(rule)
    batch.value.revision += 1
    audit('现场', '新增规则', `${id} 由现场调试新建。`)
    rebuildPathsAndAcceptances()
  }

  function batchUpdate(patch: Partial<Rule>) {
    if (batch.value.locked || batch.value.pendingWrite) return
    const ids = batch.value.selectedRuleIds
    if (ids.length === 0) return
    const changedKeys = Object.keys(patch) as Array<keyof Rule>
    batch.value.rules = batch.value.rules.map((rule) => {
      if (!ids.includes(rule.id)) return rule
      const next = { ...rule, ...patch }
      for (const field of changedKeys) {
        if (rule[field] !== patch[field]) batch.value.fieldConfirmed[`${rule.id}.${field}`] = patch[field] as string | number | boolean
      }
      return next
    })
    batch.value.revision += 1
    audit('现场', '批量修改', `现场对 ${ids.length} 条规则批量调整：${changedKeys.map((key) => FIELD_LABELS[key as keyof typeof FIELD_LABELS] ?? String(key)).join('、')}。`)
    rebuildPathsAndAcceptances(`现场批量调整 ${ids.join('、')}`)
  }

  function toggleSelected(enabled: boolean) {
    batchUpdate({ enabled })
  }

  // ---- 设备 / 分区：分区变化使受影响依赖路径与验收失效重算 ----
  function updateDevice(id: string, patch: Partial<Device>) {
    if (batch.value.locked || batch.value.pendingWrite) return
    const before = batch.value.devices.find((item) => item.id === id)
    if (!before) return
    batch.value.devices = batch.value.devices.map((device) => (device.id === id ? { ...device, ...patch } : device))
    if (patch.zone && patch.zone !== before.zone) {
      const affectedRuleIds = new Set(
        batch.value.rules.filter((rule) => rule.triggerId === id || rule.actionId === id).map((rule) => rule.id),
      )
      audit('现场', '设备分区调整', `${before.name} 分区由「${before.zone}」改为「${patch.zone}」。`)
      rebuildPathsAndAcceptances(`设备 ${id} 分区变化，影响规则 ${[...affectedRuleIds].join('、')}`)
    }
  }

  function addDevice(device: Device) {
    if (batch.value.locked || batch.value.pendingWrite) return
    batch.value.devices.push({ ...device })
    batch.value.revision += 1
    audit('现场', '新增点位', `${device.id} / ${device.name} 登记入台账。`)
  }

  // ---- 值班室晚回记录：三路合并，同改一字段保留现场值、另一版进冲突 ----
  function receiveDutySync(forks: Record<string, Partial<RuleFork>>) {
    if (batch.value.locked || batch.value.pendingWrite) return
    const { rules: mergedRules, conflicts: newConflicts, mergedIds } = mergeForks(
      batch.value.baseRules,
      batch.value.rules,
      forks,
      batch.value.ticketId,
      batch.value.fieldConfirmed,
    )
    if (mergedIds.length === 0) return
    batch.value.rules = mergedRules
    batch.value.revision += 1

    // 冲突去重（同一规则同一字段只保留一条，最新检测时间置顶）；已解决过的不重新打开
    const conflictMap = new Map(batch.value.conflicts.map((conflict) => [conflict.id, conflict]))
    for (const conflict of newConflicts) {
      const existing = conflictMap.get(conflict.id)
      if (existing && existing.status !== '待处理') continue
      conflictMap.set(conflict.id, conflict)
    }
    batch.value.conflicts = [...conflictMap.values()]

    if (newConflicts.length > 0) {
      const summary = newConflicts.map((conflict) => `${conflict.ruleId} ${conflict.label}`).join('、')
      audit(
        '值班室',
        '晚回记录冲突',
        `值班室晚回与现场同改：保留现场值，${newConflicts.length} 项进冲突队列（${summary}），冲突未处理不能签字。`,
        `duty-sync-${batch.value.ticketId}-${newConflicts.map((conflict) => conflict.id).sort().join('|')}`,
      )
    } else {
      audit('值班室', '晚回记录合并', `值班室晚回 ${mergedIds.length} 条规则，字段级合并无冲突：${mergedIds.join('、')}。`)
    }
    rebuildPathsAndAcceptances('值班室晚回记录合并')
  }

  // 端到端演示：现场先确认一批联锁延时/优先级/互锁，随后值班室晚回对同一批规则的旧修改。
  // 现场已确认的值不被覆盖，值班室版本进冲突队列。
  function simulateDutyLateSync() {
    // 1) 现场先改：R-001 延时 0→3，R-002 延时 5→4，R-006 延时 10→8 且优先级保持 2
    const fieldEdits: Record<string, Partial<Rule>> = {
      'R-001': { delay: 3 },
      'R-002': { delay: 4 },
      'R-006': { delay: 8 },
    }
    for (const [id, patch] of Object.entries(fieldEdits)) {
      updateRule(id, patch, '现场')
    }

    // 2) 值班室基于旧基线晚回：与现场同改同字段
    const byId = new Map(batch.value.rules.map((rule) => [rule.id, rule]))
    const forkOf = (id: string, patch: Partial<Rule>): Partial<RuleFork> => {
      const current = byId.get(id)
      return current ? { duty: { ...current, ...patch, id } } : {}
    }
    receiveDutySync({
      ['R-001']: forkOf('R-001', { delay: 6, interlock: '风机远程启停反馈' }),
      ['R-002']: forkOf('R-002', { delay: 12, interlock: '广播主机在线' }),
      ['R-006']: forkOf('R-006', { delay: 12, priority: 1 }),
    })
  }

  // ---- 冲突处置 ----
  function resolveConflict(conflictId: string, status: Exclude<ConflictStatus, '待处理'>) {
    if (batch.value.locked || batch.value.pendingWrite) return
    const conflict = batch.value.conflicts.find((item) => item.id === conflictId)
    if (!conflict || conflict.status !== '待处理') return
    if (status === '采用值班室') {
      batch.value.rules = resolveConflictValue({ ...conflict, status }, batch.value.rules)
      batch.value.fieldConfirmed[`${conflict.ruleId}.${conflict.field}`] = conflict.dutyValue
    } else {
      // 维持现场：把现场主值固化为确认值，晚回重放不再重复报同一冲突
      const current = batch.value.rules.find((rule) => rule.id === conflict.ruleId)
      if (current) batch.value.fieldConfirmed[`${conflict.ruleId}.${conflict.field}`] = current[conflict.field] as string | number | boolean
    }
    batch.value.conflicts = batch.value.conflicts.map((item) =>
      item.id === conflictId ? { ...item, status, resolvedAt: new Date().toISOString() } : item,
    )
    batch.value.revision += 1
    audit(
      '现场',
      '冲突处置',
      `${conflict.ruleId} ${conflict.label}：${status === '采用值班室' ? '改用值班室值' : '维持现场值'}（现场 ${String(conflict.fieldValue)} / 值班室 ${String(conflict.dutyValue)}）。`,
      `resolve-${conflictId}`,
    )
    // 采用值班室值会改规则，需要再走一次失效重算
    rebuildPathsAndAcceptances(`冲突处置 ${conflict.ruleId} ${conflict.label}`)
  }

  // ---- 依赖路径确认 / 验收 ----
  function confirmPath(pathIdValue: string) {
    if (batch.value.locked || batch.value.pendingWrite) return
    const path = batch.value.paths.find((item) => item.id === pathIdValue)
    if (!path || !path.stale) return
    batch.value.paths = batch.value.paths.map((item) =>
      item.id === pathIdValue ? { ...item, stale: false, invalidatedAt: undefined, invalidReason: undefined } : item,
    )
    // 路径重算确认后，挂在该路径上的失效验收项回到待测
    batch.value.acceptances = batch.value.acceptances.map((item) =>
      item.pathId === pathIdValue && item.status === '失效'
        ? { ...item, status: '待测', basedOnPathVersion: path.version, result: undefined }
        : item,
    )
    audit('现场', '路径重算确认', `${path.ruleId} 依赖路径 v${path.version} 已按最新分区/互锁/优先级重新核算确认。`, `confirm-path-${pathIdValue}-v${path.version}`)
  }

  function confirmAllPaths() {
    batch.value.paths.filter((path) => path.stale).forEach((path) => confirmPath(path.id))
  }

  function passAcceptanceItem(acceptanceId: string, signer = '现场调试工程师') {
    if (batch.value.locked || batch.value.pendingWrite) return
    const item = batch.value.acceptances.find((entry) => entry.id === acceptanceId)
    if (!item) return
    const path = batch.value.paths.find((entry) => entry.id === item.pathId)
    if (!path || path.stale) return
    batch.value.acceptances = batch.value.acceptances.map((entry) =>
      entry.id === acceptanceId ? passAcceptance(entry, path.version, signer) : entry,
    )
    audit('现场', '验收通过', `${item.id}（${item.ruleId}）按路径 v${path.version} 完成联调并签字确认。`, `pass-${acceptanceId}-v${path.version}`)
  }

  function resetAcceptance(acceptanceId: string) {
    batch.value.acceptances = batch.value.acceptances.map((item) =>
      item.id === acceptanceId ? { ...item, status: '待测', result: undefined, signedBy: undefined, signedAt: undefined } : item,
    )
  }

  // ---- 写入服务器：失败按现场单号挂起，恢复时同单号回放，不重复追加审计 ----
  function currentSnapshot(): BatchSnapshot {
    return {
      devices: structuredClone(batch.value.devices),
      rules: structuredClone(batch.value.rules),
      pathsVersion: batch.value.pathsVersion,
    }
  }

  async function commitToServer(): Promise<boolean> {
    if (syncing.value) return false
    syncing.value = true
    syncMessage.value = ''
    const snapshot = currentSnapshot()
    const digest = snapshotDigest(snapshot)
    const result = await syncService.commit(batch.value.ticketId, snapshot)
    syncing.value = false
    if (result.ok) {
      // 恢复成功或正常成功：清除挂起；成功审计按单号+摘要幂等
      const recovered = Boolean(batch.value.pendingWrite)
      batch.value.pendingWrite = undefined
      syncFault.value = false
      syncMessage.value = recovered
        ? `现场单号 ${batch.value.ticketId} 已按原单号恢复落库（${digest}），未重复记账。`
        : `现场单号 ${batch.value.ticketId} 写入成功（${digest}）。`
      audit('系统', recovered ? '写入恢复' : '写入成功', syncMessage.value, `write-ok-${batch.value.ticketId}-${digest}`)
      // 成功写入后，当前规则成为两端新基线，现场确认账本随之结账
      batch.value.baseRules = Object.fromEntries(batch.value.rules.map((rule) => [rule.id, structuredClone(rule)]))
      batch.value.fieldConfirmed = {}
      return true
    }
    // 失败：挂起现场单号，失败审计只记一次（按单号+摘要幂等）
    batch.value.pendingWrite = {
      ticketId: batch.value.ticketId,
      snapshot,
      attempts: (batch.value.pendingWrite?.attempts ?? 0) + 1,
      lastError: result.error,
      firstFailedAt: batch.value.pendingWrite?.firstFailedAt ?? new Date().toISOString(),
    }
    syncFault.value = true
    syncMessage.value = result.error
    audit('系统', '写入失败待恢复', `现场单号 ${batch.value.ticketId} 写入失败（${digest}）：${result.error}。编辑已冻结，待链路恢复后按原单号恢复。`, `write-fail-${batch.value.ticketId}-${digest}`)
    return false
  }

  async function recoverPendingWrite() {
    if (!batch.value.pendingWrite) return
    syncService.setMode('online')
    await commitToServer()
  }

  function toggleFaultMode(enabled: boolean) {
    syncFault.value = enabled
    syncService.setMode(enabled ? 'fail' : 'online')
    syncMessage.value = enabled ? '已模拟写入链路故障，下一次提交将失败并挂起现场单号。' : '链路故障已解除，可按现场单号恢复。'
  }

  // ---- 签字锁定 / 解锁 ----
  function lockBaseline(signer = '消防审阅人') {
    if (!canSign.value || batch.value.locked) return
    batch.value.locked = true
    batch.value.signOff = {
      signed: true,
      signedAt: new Date().toISOString(),
      signedBy: signer,
      revision: batch.value.revision,
      snapshot: currentSnapshot(),
    }
    batch.value.revision += 1
    audit(signer === '消防审阅人' ? '值班室' : '现场', '签字锁定', `调试批次 R${batch.value.signOff.revision} 冲突清零、路径全部确认、验收全部通过后签字锁定。`, `sign-${batch.value.ticketId}-${batch.value.signOff.revision}`)
  }

  function unlock() {
    batch.value.locked = false
    batch.value.signOff = { ...batch.value.signOff, signed: false }
    audit('系统', '解锁修订', '基线解锁，后续修改将产生新的修订草稿，受影响验收需重新签字。')
  }

  // 演示重置
  function resetDemo() {
    localStorage.removeItem(BATCH_STORAGE_KEY)
    batch.value = createFreshBatch(`XC-${new Date().getFullYear()}-1004-${String(Math.floor(Math.random() * 90) + 10)}`)
    syncMessage.value = ''
    syncFault.value = false
    syncService.setMode('online')
  }

  return {
    // 状态切片
    batch,
    devices,
    rules,
    revision,
    locked,
    acceptedChanges,
    selectedRuleIds,
    validations,
    paths,
    acceptances,
    conflicts,
    openConflictList,
    audits,
    ticketId,
    pendingWrite,
    signOff,
    blockers,
    canSign,
    syncing,
    syncMessage,
    syncFault,
    // 规则
    updateRule,
    addRule,
    batchUpdate,
    toggleSelected,
    // 设备
    updateDevice,
    addDevice,
    // 协同合并 / 冲突
    receiveDutySync,
    simulateDutyLateSync,
    resolveConflict,
    // 路径 / 验收
    confirmPath,
    confirmAllPaths,
    passAcceptanceItem,
    resetAcceptance,
    // 同步
    commitToServer,
    recoverPendingWrite,
    toggleFaultMode,
    // 签字
    lockBaseline,
    unlock,
    resetDemo,
  }
})
