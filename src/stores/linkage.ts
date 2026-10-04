import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

export type DeviceType = '感烟探测器' | '感温探测器' | '手动报警按钮' | '输入模块' | '输出模块' | '排烟风机' | '防火卷帘' | '消防广播' | '电梯'
export type Device = { id: string; name: string; type: DeviceType; floor: string; zone: string; address: string }
export type Rule = {
  id: string
  triggerId: string
  actionId: string
  delay: number
  interlock: string
  priority: 1 | 2 | 3
  suppression: string
  enabled: boolean
}
export type Validation = { id: string; severity: '错误' | '警告'; ruleIds: string[]; title: string; detail: string; suggestion: string }

// 调试批次 / 并发 / 失效 / 写入恢复 相关类型
export type EditSource = '现场' | '值班室'
export type RuleVersion = { source: EditSource; orderNo: string; patch: Partial<Rule>; at: number }
export type RuleConflict = { ruleId: string; field: RuleVersion; duty: RuleVersion; detectedAt: number }
export type DependencyPath = { id: string; ruleId: string; from: string; to: string; valid: boolean; reason: string }
export type AcceptanceItem = { id: string; title: string; owner: string; done: boolean; valid: boolean; reason: string; ruleIds: string[]; signedAt?: number; signer?: string }
export type WriteKind = 'rule' | 'device' | 'sign'
export type WriteEntry = {
  orderNo: string
  batchId: string
  kind: WriteKind
  summary: string
  payload: Record<string, unknown>
  status: 'pending' | 'committed' | 'failed'
  attempts: number
  at: number
  committedAt?: number
  error?: string
}
export type BatchMeta = { id: string; name: string; orderNo: string; migratedFrom?: string }

export const seedDevices: Device[] = [
  { id: 'D-01-01', name: '一层大厅感烟 01', type: '感烟探测器', floor: '1F', zone: 'A 区', address: '1-A-01-01' },
  { id: 'D-01-02', name: '一层大厅感烟 02', type: '感烟探测器', floor: '1F', zone: 'A 区', address: '1-A-02-02' },
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

const DRAFT_V1_KEY = 'fire-linkage-draft-v1'
const BATCH_V2_KEY = 'fire-linkage-batch-v2'

function defaultAcceptances(): AcceptanceItem[] {
  return [
    { id: 'ACC-01', title: '设备地址与竣工图一致', owner: '消防电专业', done: true, valid: true, reason: '', ruleIds: [] },
    { id: 'ACC-02', title: '所有报警点完成单点调试', owner: '调试组', done: true, valid: true, reason: '', ruleIds: [] },
    { id: 'ACC-03', title: '跨区联动完成现场确认', owner: '消防审阅人', done: false, valid: true, reason: '', ruleIds: [] },
    { id: 'ACC-04', title: '互锁反馈时长完成测试', owner: '暖通专业', done: false, valid: true, reason: '', ruleIds: [] },
    { id: 'ACC-05', title: '签字交付包完成哈希校验', owner: '项目负责人', done: false, valid: true, reason: '', ruleIds: [] },
  ]
}

export const useLinkageStore = defineStore('linkage', () => {
  // ---- 核心批次状态（同时被各视图直接使用）----
  const devices = ref<Device[]>(structuredClone(seedDevices))
  const rules = ref<Rule[]>(structuredClone(seedRules))
  const revision = ref(8)
  const locked = ref(false)
  const acceptedChanges = ref<string[]>(['CH-01'])
  const selectedRuleIds = ref<string[]>([])

  // ---- 调试批次层 ----
  const batchMeta = ref<BatchMeta>({ id: 'BATCH-001', name: '调试批次 001', orderNo: 'XC-0001' })
  const ruleVersions = ref<Record<string, { field?: RuleVersion; duty?: RuleVersion }>>({})
  const conflicts = ref<RuleConflict[]>([])
  const paths = ref<DependencyPath[]>([])
  const acceptances = ref<AcceptanceItem[]>([])
  const writeJournal = ref<WriteEntry[]>([])
  const armNextFailure = ref(false)
  let privateOrderCounter = 0

  function nextOrderNo(): string {
    privateOrderCounter += 1
    return `XC-${String(privateOrderCounter).padStart(4, '0')}`
  }

  // ---- 校验（保留原有矩阵校验）----
  const validations = computed<Validation[]>(() => {
    const result: Validation[] = []
    const triggers = devices.value.filter((device) => ['感烟探测器', '感温探测器', '手动报警按钮', '输入模块'].includes(device.type))
    for (const trigger of triggers) {
      const enabled = rules.value.filter((rule) => rule.triggerId === trigger.id && rule.enabled)
      if (enabled.length === 0) {
        result.push({ id: `missing-${trigger.id}`, severity: '错误', ruleIds: [], title: `${trigger.name} 缺少联动动作`, detail: '报警点未配置任何启用的因果规则。', suggestion: '至少配置广播、排烟或疏散相关动作。' })
      }
      const actionCount = new Map<string, number>()
      enabled.forEach((rule) => actionCount.set(rule.actionId, (actionCount.get(rule.actionId) ?? 0) + 1))
      actionCount.forEach((count, actionId) => {
        if (count > 1) result.push({ id: `duplicate-${trigger.id}-${actionId}`, severity: '警告', ruleIds: enabled.filter((rule) => rule.actionId === actionId).map((rule) => rule.id), title: `${trigger.name} 存在重复动作`, detail: `同一个动作 ${actionId} 被重复配置 ${count} 次。`, suggestion: '合并规则或明确主备关系。' })
      })
    }
    rules.value.filter((rule) => rule.enabled).forEach((rule) => {
      const trigger = devices.value.find((device) => device.id === rule.triggerId)
      const action = devices.value.find((device) => device.id === rule.actionId)
      if (trigger && action && trigger.zone !== action.zone && rule.suppression === '无') {
        result.push({ id: `cross-${rule.id}`, severity: '警告', ruleIds: [rule.id], title: `${rule.id} 跨区联动未配置抑制`, detail: `${trigger.zone} 报警将直接触发 ${action.zone} 动作。`, suggestion: '确认疏散边界并增加分区确认或抑制条件。' })
      }
      if (rule.interlock && rule.delay > 5 && rule.priority === 1) {
        result.push({ id: `contradiction-${rule.id}`, severity: '错误', ruleIds: [rule.id], title: `${rule.id} 互锁与高优先级延时冲突`, detail: '一级优先规则在互锁未明确反馈前延时超过 5 秒。', suggestion: '缩短延时或改为反馈后触发。' })
      }
    })
    return result
  })

  // ---- 失效与重算 ----
  function recalculatePaths() {
    paths.value = rules.value.map((rule) => {
      const trigger = devices.value.find((d) => d.id === rule.triggerId)
      const action = devices.value.find((d) => d.id === rule.actionId)
      const structurallyValid = rule.enabled && !!trigger && !!action
      return {
        id: `PATH-${rule.id}`,
        ruleId: rule.id,
        from: rule.triggerId,
        to: rule.actionId,
        valid: structurallyValid,
        reason: structurallyValid ? '' : '规则未启用或设备引用缺失',
      }
    })
  }

  function recalculateAcceptances() {
    // 重新推导验收项对规则的依赖
    acceptances.value.forEach((acc) => {
      if (acc.id === 'ACC-03') {
        acc.ruleIds = rules.value.filter((r) => {
          const t = devices.value.find((d) => d.id === r.triggerId)
          const a = devices.value.find((d) => d.id === r.actionId)
          return t && a && t.zone !== a.zone
        }).map((r) => r.id)
      } else if (acc.id === 'ACC-04') {
        acc.ruleIds = rules.value.filter((r) => r.interlock !== '无').map((r) => r.id)
      }
      const allValid = acc.ruleIds.every((rid) => paths.value.find((p) => p.ruleId === rid)?.valid)
      acc.valid = allValid
      acc.reason = allValid ? '' : '依赖路径已失效，需重算'
    })
  }

  function recalculateAll() {
    recalculatePaths()
    recalculateAcceptances()
  }

  function invalidateForRule(ruleId: string, reason: string) {
    const path = paths.value.find((p) => p.ruleId === ruleId)
    if (path) {
      path.valid = false
      path.reason = reason
    }
    acceptances.value.forEach((acc) => {
      if (acc.ruleIds.includes(ruleId)) {
        acc.valid = false
        acc.reason = reason
      }
    })
  }

  function invalidateForDevice(deviceId: string, reason: string) {
    const relatedRuleIds = rules.value.filter((r) => r.triggerId === deviceId || r.actionId === deviceId).map((r) => r.id)
    relatedRuleIds.forEach((rid) => invalidateForRule(rid, reason))
  }

  // ---- 并发版本与冲突 ----
  function applyPatch(ruleId: string, patch: Partial<Rule>) {
    const rule = rules.value.find((r) => r.id === ruleId)
    if (rule) Object.assign(rule, patch)
  }

  function raiseConflict(ruleId: string) {
    const versions = ruleVersions.value[ruleId]
    if (!versions?.field || !versions?.duty) return
    const idx = conflicts.value.findIndex((c) => c.ruleId === ruleId)
    const conflict: RuleConflict = { ruleId, field: versions.field, duty: versions.duty, detectedAt: Date.now() }
    if (idx >= 0) conflicts.value[idx] = conflict
    else conflicts.value.push(conflict)
  }

  /** 现场/值班室提交同一规则：现场值优先，另一版进冲突；冲突未处理不能签字。 */
  function submitRule(ruleId: string, patch: Partial<Rule>, source: EditSource) {
    if (locked.value) return
    const orderNo = commitWrite('rule', `${source}提交 ${ruleId}`, { ruleId, patch, source })
    const entry = writeJournal.value.find((w) => w.orderNo === orderNo)
    if (entry?.status === 'failed') return // 写入失败，等待按单号恢复
    applyRuleVersion(ruleId, patch, source, orderNo)
  }

  function applyRuleVersion(ruleId: string, patch: Partial<Rule>, source: EditSource, orderNo: string) {
    const versions = (ruleVersions.value[ruleId] ??= {})
    const version: RuleVersion = { source, orderNo, patch, at: Date.now() }
    if (source === '现场') {
      versions.field = version
      applyPatch(ruleId, patch) // 现场值始终保留在主数据
      if (versions.duty) raiseConflict(ruleId)
    } else {
      versions.duty = version
      if (versions.field) raiseConflict(ruleId) // 现场已改 → 值班室版进冲突，不覆盖现场值
      else applyPatch(ruleId, patch)
    }
    invalidateForRule(ruleId, `${source}提交后依赖路径失效，需重算`)
  }

  /** 处理冲突：默认保留现场值；也可改用值班室版。 */
  function resolveConflict(ruleId: string, keep: '现场' | '值班室') {
    const conflict = conflicts.value.find((c) => c.ruleId === ruleId)
    if (!conflict) return
    if (keep === '值班室') {
      applyPatch(ruleId, conflict.duty.patch)
      invalidateForRule(ruleId, '冲突已按值班室版处理，依赖路径需重算')
    }
    const versions = ruleVersions.value[ruleId]
    if (versions) {
      if (keep === '现场') versions.duty = undefined
      else versions.field = undefined
    }
    conflicts.value = conflicts.value.filter((c) => c.ruleId !== ruleId)
  }

  // ---- 设备分区变更 → 失效重算 ----
  function updateDeviceZone(deviceId: string, zone: string) {
    if (locked.value) return
    const orderNo = commitWrite('device', `设备分区变更 ${deviceId}`, { deviceId, zone })
    const entry = writeJournal.value.find((w) => w.orderNo === orderNo)
    if (entry?.status === 'failed') return
    const device = devices.value.find((d) => d.id === deviceId)
    if (device) device.zone = zone
    invalidateForDevice(deviceId, '设备分区变更后依赖路径失效，需重算')
  }

  // ---- 写入日志：按现场单号恢复，不重复追加审计 ----
  function commitWrite(kind: WriteKind, summary: string, payload: Record<string, unknown>): string {
    const orderNo = nextOrderNo()
    const entry: WriteEntry = {
      orderNo,
      batchId: batchMeta.value.id,
      kind,
      summary,
      payload,
      status: 'pending',
      attempts: 1,
      at: Date.now(),
    }
    writeJournal.value.unshift(entry)
    if (armNextFailure.value) {
      entry.status = 'failed'
      entry.error = '模拟写入失败：现场网络中断'
      armNextFailure.value = false
    } else {
      entry.status = 'committed'
      entry.committedAt = Date.now()
    }
    return orderNo
  }

  /** 按现场单号恢复写入：同一单号重试，更新原审计条目而不重复追加。 */
  function recoverWrite(orderNo: string) {
    const entry = writeJournal.value.find((w) => w.orderNo === orderNo)
    if (!entry || entry.status === 'committed') return // 幂等：已提交则不再重复审计
    entry.attempts += 1
    entry.status = 'committed'
    entry.error = undefined
    entry.committedAt = Date.now()
    if (entry.kind === 'rule') {
      const { ruleId, patch, source } = entry.payload as { ruleId: string; patch: Partial<Rule>; source: EditSource }
      applyRuleVersion(ruleId, patch, source, orderNo)
    } else if (entry.kind === 'device') {
      const { deviceId, zone } = entry.payload as { deviceId: string; zone: string }
      const device = devices.value.find((d) => d.id === deviceId)
      if (device) device.zone = zone
      invalidateForDevice(deviceId, '设备分区变更后依赖路径失效，需重算')
    } else if (entry.kind === 'sign') {
      locked.value = true
      revision.value += 1
      acceptances.value.forEach((a) => {
        if (!a.done) {
          a.done = true
          a.signedAt = Date.now()
          a.signer = '现场负责人'
        }
      })
    }
  }

  // ---- 签字：冲突未处理、路径/验收失效、错误校验均阻断 ----
  const conflictCount = computed(() => conflicts.value.length)
  const invalidPathCount = computed(() => paths.value.filter((p) => !p.valid).length)
  const invalidAcceptanceCount = computed(() => acceptances.value.filter((a) => !a.valid).length)
  const failedWriteCount = computed(() => writeJournal.value.filter((w) => w.status === 'failed').length)

  const canSign = computed(
    () =>
      !locked.value &&
      conflictCount.value === 0 &&
      invalidPathCount.value === 0 &&
      invalidAcceptanceCount.value === 0 &&
      validations.value.filter((v) => v.severity === '错误').length === 0,
  )

  function sign() {
    if (locked.value || !canSign.value) return
    const orderNo = commitWrite('sign', `签字锁定 ${batchMeta.value.orderNo}`, {})
    const entry = writeJournal.value.find((w) => w.orderNo === orderNo)
    if (entry?.status === 'failed') return
    locked.value = true
    revision.value += 1
    acceptances.value.forEach((a) => {
      if (!a.done) {
        a.done = true
        a.signedAt = Date.now()
        a.signer = '现场负责人'
      }
    })
  }

  function unlock() {
    locked.value = false
  }

  // ---- 草稿编辑（现场内联，自动保存）----
  function updateRule(id: string, patch: Partial<Rule>) {
    if (locked.value) return
    applyPatch(id, patch)
    const versions = (ruleVersions.value[id] ??= {})
    versions.field = { source: '现场', orderNo: `draft-${id}-${Date.now()}`, patch, at: Date.now() }
    if (versions.duty) raiseConflict(id)
    invalidateForRule(id, '规则变更后依赖路径失效，需重算')
  }

  function addRule() {
    if (locked.value) return
    rules.value.push({
      id: `R-${String(rules.value.length + 1).padStart(3, '0')}`,
      triggerId: devices.value[0]?.id ?? '',
      actionId: devices.value.at(-1)?.id ?? '',
      delay: 0,
      interlock: '无',
      priority: 2,
      suppression: '无',
      enabled: true,
    })
    revision.value += 1
    recalculateAll()
  }

  function batchUpdate(patch: Partial<Rule>) {
    if (locked.value) return
    rules.value = rules.value.map((rule) => (selectedRuleIds.value.includes(rule.id) ? { ...rule, ...patch } : rule))
    selectedRuleIds.value.forEach((id) => invalidateForRule(id, '批量变更后依赖路径失效，需重算'))
  }

  function toggleSelected(enabled: boolean) {
    batchUpdate({ enabled })
  }

  function lockBaseline() {
    if (!canSign.value) return
    sign()
  }

  // ---- 持久化与迁移 ----
  watch(
    [devices, rules, revision, locked, acceptedChanges, batchMeta, ruleVersions, conflicts, paths, acceptances, writeJournal],
    () => {
      localStorage.setItem(
        BATCH_V2_KEY,
        JSON.stringify({
          devices: devices.value,
          rules: rules.value,
          revision: revision.value,
          locked: locked.value,
          acceptedChanges: acceptedChanges.value,
          batchMeta: batchMeta.value,
          ruleVersions: ruleVersions.value,
          conflicts: conflicts.value,
          paths: paths.value,
          acceptances: acceptances.value,
          writeJournal: writeJournal.value,
          orderCounter: privateOrderCounter,
        }),
      )
    },
    { deep: true },
  )

  function init() {
    const v2 = localStorage.getItem(BATCH_V2_KEY)
    if (v2) {
      const data = JSON.parse(v2)
      devices.value = data.devices ?? structuredClone(seedDevices)
      rules.value = data.rules ?? structuredClone(seedRules)
      revision.value = data.revision ?? 8
      locked.value = data.locked ?? false
      acceptedChanges.value = data.acceptedChanges ?? ['CH-01']
      batchMeta.value = data.batchMeta ?? { id: 'BATCH-001', name: '调试批次 001', orderNo: 'XC-0001' }
      ruleVersions.value = data.ruleVersions ?? {}
      conflicts.value = data.conflicts ?? []
      paths.value = data.paths ?? []
      acceptances.value = data.acceptances ?? defaultAcceptances()
      writeJournal.value = data.writeJournal ?? []
      privateOrderCounter = data.orderCounter ?? 0
      if (paths.value.length === 0) recalculateAll()
      return
    }
    const v1 = localStorage.getItem(DRAFT_V1_KEY)
    if (v1) {
      const old = JSON.parse(v1)
      devices.value = old.devices ?? structuredClone(seedDevices)
      rules.value = old.rules ?? structuredClone(seedRules)
      revision.value = old.revision ?? 8
      locked.value = old.locked ?? false
      acceptedChanges.value = old.acceptedChanges ?? ['CH-01']
      batchMeta.value = { id: 'BATCH-001', name: '首版草稿（迁移）', orderNo: 'XC-0001', migratedFrom: 'v1' }
      privateOrderCounter = 0
      recalculateAll()
      return
    }
    devices.value = structuredClone(seedDevices)
    rules.value = structuredClone(seedRules)
    batchMeta.value = { id: 'BATCH-001', name: '调试批次 001', orderNo: 'XC-0001' }
    privateOrderCounter = 0
    recalculateAll()
  }

  init()

  return {
    // 核心状态
    devices,
    rules,
    revision,
    locked,
    acceptedChanges,
    selectedRuleIds,
    validations,
    // 调试批次层
    batchMeta,
    ruleVersions,
    conflicts,
    paths,
    acceptances,
    writeJournal,
    armNextFailure,
    conflictCount,
    invalidPathCount,
    invalidAcceptanceCount,
    failedWriteCount,
    canSign,
    // 并发与冲突
    submitRule,
    resolveConflict,
    // 失效重算
    updateDeviceZone,
    recalculatePaths,
    recalculateAcceptances,
    recalculateAll,
    invalidateForRule,
    invalidateForDevice,
    // 写入恢复
    commitWrite,
    recoverWrite,
    // 签字
    sign,
    unlock,
    // 草稿编辑
    updateRule,
    addRule,
    batchUpdate,
    toggleSelected,
    lockBaseline,
  }
})
