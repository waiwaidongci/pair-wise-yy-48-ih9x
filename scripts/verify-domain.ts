import { mergeForks } from '../src/domain/merge'
import { recomputePaths, syncAcceptances, ensureAcceptances } from '../src/domain/paths'
import { signBlockers, validateRules, passAcceptance } from '../src/domain/acceptance'
import { migrateLegacy, isLegacy, CURRENT_SCHEMA_VERSION } from '../src/domain/migrate'
import { appendAudit } from '../src/domain/audit'
import { snapshotDigest, syncService } from '../src/api/sync'
import { seedDevices, seedRules } from '../src/stores/linkage'
import type { DebugBatch, Rule } from '../src/domain/types'

let passed = 0
let failed = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

function cloneRules() {
  return structuredClone(seedRules) as Rule[]
}
function cloneDevices() {
  return structuredClone(seedDevices)
}
function makeBatch(rules: Rule[], devices = cloneDevices()): DebugBatch {
  const paths = recomputePaths([], rules, devices).map((p) => ({ ...p, stale: false }))
  const acceptances = ensureAcceptances([], paths, rules, devices).map((a) => ({
    ...a,
    ...passAcceptance(a, 1, '现场调试工程师'),
  }))
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ticketId: 'XC-TEST-01',
    devices,
    rules,
    baseRules: Object.fromEntries(rules.map((r) => [r.id, structuredClone(r)])),
    fieldConfirmed: {},
    conflicts: [],
    paths,
    pathsVersion: 1,
    acceptances,
    audits: [],
    signOff: { signed: false, revision: 1 },
    revision: 1,
    locked: false,
    selectedRuleIds: [],
    acceptedChanges: [],
  }
}

console.log('1) 两端同改同一字段：保留现场值，值班室版本进冲突')
{
  const base = cloneRules()
  const field = structuredClone(base)
  const duty = structuredClone(base)
  field[1].delay = 4 // R-002 现场 5→4
  duty[1].delay = 12 // R-002 值班室 5→12
  const fieldForks = Object.fromEntries(field.map((r) => [r.id, { field: r }]))
  // 现场先提交（无 duty）
  const afterField = mergeForks(Object.fromEntries(base.map((r) => [r.id, r])), cloneRules(), fieldForks, 'T')
  const confirmed: Record<string, string | number | boolean> = { 'R-002.delay': 4 }
  // 值班室晚回（只带 duty）
  const afterDuty = mergeForks(
    Object.fromEntries(base.map((r) => [r.id, r])),
    afterField.rules,
    { ['R-002']: { duty: duty[1] } },
    'T',
    confirmed,
  )
  const r002 = afterDuty.rules.find((r) => r.id === 'R-002')!
  check('主值保留现场延时 4', r002.delay === 4, `got ${r002.delay}`)
  check('生成 1 条待处理冲突', afterDuty.conflicts.length === 1, `got ${afterDuty.conflicts.length}`)
  check('冲突记录值班室值 12', afterDuty.conflicts[0]?.dutyValue === 12)
  check('冲突字段是联锁延时', afterDuty.conflicts[0]?.field === 'delay')
}

console.log('2) 两端改不同字段：字段级合并且无冲突')
{
  const base = cloneRules()
  const fieldRules = cloneRules()
  const dutyRules = cloneRules()
  fieldRules[1].delay = 4
  dutyRules[1].interlock = '广播主机在线'
  const afterField = mergeForks(
    Object.fromEntries(base.map((r) => [r.id, r])),
    cloneRules(),
    Object.fromEntries(fieldRules.map((r) => [r.id, { field: r }])),
    'T',
  )
  const afterDuty = mergeForks(
    Object.fromEntries(base.map((r) => [r.id, r])),
    afterField.rules,
    { ['R-002']: { duty: dutyRules[1] } },
    'T',
    { 'R-002.delay': 4 },
  )
  const r002 = afterDuty.rules.find((r) => r.id === 'R-002')!
  check('现场延时保留', r002.delay === 4)
  check('值班室互锁并入', r002.interlock === '广播主机在线', `got ${r002.interlock}`)
  check('无冲突', afterDuty.conflicts.length === 0, `got ${afterDuty.conflicts.length}`)
}

console.log('3) 冲突未处理不能签字；处理并验收通过后放行')
{
  const batch = makeBatch(cloneRules().map((r) => (r.id === 'R-007' ? { ...r, enabled: true } : r)))
  const base = cloneRules()
  const fieldRules = cloneRules().map((r) => (r.id === 'R-007' ? { ...r, enabled: true } : r))
  const dutyRules = cloneRules()
  fieldRules[0].delay = 3 // R-001
  dutyRules[0].delay = 6
  batch.rules = fieldRules
  batch.fieldConfirmed = { 'R-001.delay': 3 }
  const merged = mergeForks(
    Object.fromEntries(base.map((r) => [r.id, r])),
    fieldRules,
    { ['R-001']: { duty: dutyRules[0] } },
    batch.ticketId,
    batch.fieldConfirmed,
  )
  batch.rules = merged.rules
  batch.conflicts = merged.conflicts
  // 合并改变规则 → 路径升版失效；模拟现场重算确认后重新验收
  batch.paths = recomputePaths(batch.paths, batch.rules, batch.devices).map((p) => ({ ...p, stale: false }))
  batch.acceptances = ensureAcceptances(batch.acceptances, batch.paths, batch.rules, batch.devices).map((a) => ({
    ...a,
    ...passAcceptance(a, batch.paths.find((p) => p.id === a.pathId)!.version, '现场调试工程师'),
  }))
  const validations = validateRules(batch)
  const blockersBefore = signBlockers(batch, validations)
  check('未处理冲突阻断签字', blockersBefore.some((b) => b.code === 'conflict'))

  // 维持现场
  batch.conflicts = batch.conflicts.map((c) => ({ ...c, status: '维持现场' as const, resolvedAt: new Date().toISOString() }))
  const blockersAfterResolve = signBlockers(batch, validateRules(batch))
  check('冲突处置后不再有冲突阻断', !blockersAfterResolve.some((b) => b.code === 'conflict'))
  check('无其他阻断时可签字', signBlockers(batch, validateRules(batch)).length === 0, signBlockers(batch, validateRules(batch)).map((b) => b.message).join('; '))
}

console.log('4) 设备分区 / 优先级 / 互锁变化 → 路径失效升版 → 旧验收结论作废，重测后恢复')
{
  const devices = cloneDevices()
  const rules = cloneRules()
  let paths = recomputePaths([], rules, devices).map((p) => ({ ...p, stale: false }))
  let acceptances = ensureAcceptances([], paths, rules, devices)
  const r002PathId = paths.find((p) => p.ruleId === 'R-002')!.id
  acceptances = acceptances.map((a) => (a.pathId === r002PathId ? passAcceptance(a, 1, 's') : a))

  // 改设备分区：D-01-01 从 A 区移到中庭（R-001/R-002/R-008 受影响）
  const movedDevices = devices.map((d) => (d.id === 'D-01-01' ? { ...d, zone: '中庭' } : d))
  paths = recomputePaths(paths, rules, movedDevices)
  acceptances = syncAcceptances(acceptances, paths)
  const affected = paths.filter((p) => ['R-001', 'R-002', 'R-008'].includes(p.ruleId))
  check('分区变化路径全部升版', affected.every((p) => p.version === 2), affected.map((p) => `${p.ruleId}=v${p.version}`).join(','))
  check('分区变化路径标记失效', affected.every((p) => p.stale))
  const acc = acceptances.find((a) => a.pathId === r002PathId)!
  check('旧验收结论作废为失效', acc.status === '失效', `got ${acc.status}`)

  // 路径重算确认 → 验收回待测；重新通过后基于 v2
  paths = paths.map((p) => ({ ...p, stale: false }))
  acceptances = syncAcceptances(acceptances.map((a) => (a.status === '失效' ? { ...a, status: '待测' as const, basedOnPathVersion: 2 } : a)), paths)
  const reAcc = acceptances.find((a) => a.pathId === r002PathId)!
  check('确认后验收回待测', reAcc.status === '待测')
  const passed2 = passAcceptance(reAcc, 2, 's')
  check('重测通过绑定路径 v2', passed2.status === '通过' && passed2.basedOnPathVersion === 2)

  // 再改优先级 → 再次失效
  const prioRules = rules.map((r) => (r.id === 'R-002' ? { ...r, priority: 1 as const } : r))
  paths = recomputePaths(paths, prioRules, movedDevices)
  acceptances = syncAcceptances(acceptances.map((a) => (a.id === passed2.id ? passed2 : a)), paths)
  const v3 = paths.find((p) => p.ruleId === 'R-002')!
  check('优先级变化再次升版失效', v3.version === 3 && v3.stale)
  check('v2 的通过结论再次作废', acceptances.find((a) => a.id === passed2.id)!.status === '失效')
}

console.log('5) 写入失败按现场单号恢复：同单号同快照幂等，审计不重复')
{
  const rules = cloneRules()
  const devices = cloneDevices()
  const snapshot = { devices, rules, pathsVersion: 1 }
  syncService.setMode('fail')
  const fail1 = await syncService.commit('XC-001', snapshot)
  const fail2 = await syncService.commit('XC-001', snapshot)
  check('故障下两次提交都失败', !fail1.ok && !fail2.ok)

  let audits = appendAudit([], { ticketId: 'XC-001', actor: '系统', action: '写入失败待恢复', detail: 'd', idempotencyKey: 'write-fail-XC-001-D1' })
  audits = appendAudit(audits, { ticketId: 'XC-001', actor: '系统', action: '写入失败待恢复', detail: 'd', idempotencyKey: 'write-fail-XC-001-D1' })
  check('重复失败只记一条审计', audits.length === 1)

  syncService.setMode('online')
  const ok = await syncService.commit('XC-001', snapshot)
  check('恢复成功', ok.ok)
  const okAgain = await syncService.commit('XC-001', snapshot)
  check('同单号同快照重复提交仍幂等成功', okAgain.ok)
  audits = appendAudit(audits, { ticketId: 'XC-001', actor: '系统', action: '写入恢复', detail: 'r', idempotencyKey: 'write-ok-XC-001-D1' })
  audits = appendAudit(audits, { ticketId: 'XC-001', actor: '系统', action: '写入恢复', detail: 'r', idempotencyKey: 'write-ok-XC-001-D1' })
  check('恢复审计不重复追加', audits.length === 2)
  check('快照摘要稳定', snapshotDigest(snapshot) === snapshotDigest(snapshot))
}

console.log('6) 旧稿按首版迁移：只产生一条迁移审计，路径/验收建账')
{
  const legacy = { devices: cloneDevices(), rules: cloneRules(), revision: 8, locked: false, acceptedChanges: ['CH-01'] }
  check('识别为旧稿', isLegacy(legacy))
  const batch1 = migrateLegacy(legacy, { devices: seedDevices, rules: seedRules }, 'XC-MIG-01')
  const batch2 = migrateLegacy(legacy, { devices: seedDevices, rules: seedRules }, 'XC-MIG-01')
  check('schema 升级到 v2', batch1.schemaVersion === CURRENT_SCHEMA_VERSION)
  check('路径按规则建账', batch1.paths.length === legacy.rules.length)
  check('验收项按路径建账', batch1.acceptances.length === legacy.rules.length)
  check('只有一条迁移审计', batch1.audits.length === 1)
  check('重复迁移不追加审计', batch2.audits.length === 1)
  check('迁移基线无冲突', batch1.conflicts.length === 0)
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
