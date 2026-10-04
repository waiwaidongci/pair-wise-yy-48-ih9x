// 调试批次领域模型：设备 + 因果规则 + 依赖路径 + 验收签字，围绕一个现场单号组织
export type DeviceType =
  | '感烟探测器'
  | '感温探测器'
  | '手动报警按钮'
  | '输入模块'
  | '输出模块'
  | '排烟风机'
  | '防火卷帘'
  | '消防广播'
  | '电梯'

export type Device = {
  id: string
  name: string
  type: DeviceType
  floor: string
  zone: string
  address: string
}

export type RulePriority = 1 | 2 | 3

export type Rule = {
  id: string
  triggerId: string
  actionId: string
  delay: number
  interlock: string
  priority: RulePriority
  suppression: string
  enabled: boolean
}

export type Editor = '现场' | '值班室'

// 一条规则上两个编辑端各自持有、尚未合并的版本
export type RuleFork = {
  field: Rule
  duty: Rule
}

// 规则字段级冲突：现场值已保留为主值，值班室版本进冲突队列等待处置
export type FieldKind = 'delay' | 'interlock' | 'priority' | 'suppression' | 'enabled'
export type ConflictStatus = '待处理' | '采用值班室' | '维持现场'
export type RuleConflict = {
  id: string
  ruleId: string
  field: FieldKind
  label: string
  fieldValue: string | number | boolean
  dutyValue: string | number | boolean
  status: ConflictStatus
  detectedAt: string
  resolvedAt?: string
  ticketId: string
}

// 依赖路径：触发设备 -> 规则 -> 动作设备，互锁变化会改变路径前置条件
export type DependencyPath = {
  id: string
  ruleId: string
  triggerId: string
  actionId: string
  viaZones: string[]
  interlock: string
  priority: RulePriority
  crossZone: boolean
  version: number
  // 路径输入指纹（设备分区 / 优先级 / 互锁 / 启停）；指纹变化即失效
  fingerprint: string
  stale: boolean
  invalidatedAt?: string
  invalidReason?: string
}

export type AcceptanceStatus = '待测' | '通过' | '失效'
export type AcceptanceItem = {
  id: string
  pathId: string
  ruleId: string
  title: string
  owner: string
  status: AcceptanceStatus
  // 结论所基于的路径版本；路径重算升版后旧结论不再放行
  basedOnPathVersion: number
  signedBy?: string
  signedAt?: string
  result?: string
}

export type AuditEntry = {
  id: string
  ticketId: string
  at: string
  actor: Editor | '系统'
  action: string
  detail: string
}

export type PendingWrite = {
  ticketId: string
  // 待提交的完整批次快照；恢复时按单号整体回放到服务器
  snapshot: BatchSnapshot
  attempts: number
  lastError: string
  firstFailedAt: string
}

export type BatchSnapshot = {
  devices: Device[]
  rules: Rule[]
  pathsVersion: number
}

// 签字状态
export type SignOff = {
  signed: boolean
  signedAt?: string
  signedBy?: string
  revision: number
  // 签字时封存的规则/路径版本，解锁后再改动会产生新修订
  snapshot?: BatchSnapshot
}

export type DebugBatch = {
  schemaVersion: number
  ticketId: string
  devices: Device[]
  rules: Rule[]
  // 合并基线（上一次两端一致时的规则），用于三路合并
  baseRules: Record<string, Rule>
  // 现场已确认值账本：key 为 规则id.字段名。值班室晚回时，凡是命中该账本的字段，
  // 一律按"两端同改"处理：保留现场值，值班室版本进冲突（晚回不盖确认值）。
  fieldConfirmed: Record<string, string | number | boolean>
  conflicts: RuleConflict[]
  paths: DependencyPath[]
  pathsVersion: number
  acceptances: AcceptanceItem[]
  audits: AuditEntry[]
  pendingWrite?: PendingWrite
  signOff: SignOff
  revision: number
  locked: boolean
  selectedRuleIds: string[]
  acceptedChanges: string[]
}
