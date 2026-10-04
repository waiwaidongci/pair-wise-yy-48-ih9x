<script setup lang="ts">
import { computed } from 'vue'
import { useLinkageStore } from '../stores/linkage'

const store = useLinkageStore()

const stalePaths = computed(() => store.paths.filter((path) => path.stale))
const pendingAcceptances = computed(() => store.acceptances.filter((item) => item.status !== '通过'))
const passedCount = computed(() => store.acceptances.filter((item) => item.status === '通过').length)

const changes = [
  { id: 'CH-01', title: 'PF-2 增加防火阀开启反馈互锁', source: '暖通专业', oldValue: '互锁：无', newValue: '互锁：防火阀开启反馈', risk: '低' },
  { id: 'CH-02', title: '电梯归位延时由 0 秒调整至 10 秒', source: '电梯专业', oldValue: '延时：0s', newValue: '延时：10s', risk: '中' },
  { id: 'CH-03', title: '机房感烟联动 1F 排烟风机', source: '智能化专业', oldValue: '无关系', newValue: 'R-007 / 当前停用', risk: '高' },
]

function ruleName(ruleId: string) {
  const rule = store.rules.find((item) => item.id === ruleId)
  if (!rule) return ruleId
  const trigger = store.devices.find((device) => device.id === rule.triggerId)?.name ?? rule.triggerId
  const action = store.devices.find((device) => device.id === rule.actionId)?.name ?? rule.actionId
  return `${ruleId} ${trigger} → ${action}`
}

function exportPackage() {
  const payload = JSON.stringify(
    {
      ticketId: store.ticketId,
      revision: store.revision,
      devices: store.devices,
      rules: store.rules,
      paths: store.paths,
      acceptances: store.acceptances,
      conflicts: store.conflicts,
      validations: store.validations,
      signOff: store.signOff,
    },
    null,
    2,
  )
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `调试交付包-${store.ticketId}-R${store.revision}.json`
  link.click()
  URL.revokeObjectURL(url)
}

const recentAudits = computed(() => [...store.audits].reverse().slice(0, 8))
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">REVIEW & SIGN-OFF / 调试批次审阅</p>
        <h1>冲突处置、失效重算、验收与签字</h1>
        <p class="muted">现场单号 <strong class="mono">{{ store.ticketId }}</strong> · 冲突未处理 / 路径未确认 / 验收未通过 / 写入未落库，均不能签字。</p>
      </div>
      <div class="actions">
        <v-btn variant="outlined" prepend-icon="mdi-download" @click="exportPackage">导出交付包</v-btn>
        <v-btn v-if="!store.locked" color="primary" prepend-icon="mdi-lock-outline" :disabled="!store.canSign" @click="store.lockBaseline()">签字锁定</v-btn>
        <v-btn v-else color="warning" variant="outlined" prepend-icon="mdi-lock-open-outline" @click="store.unlock">解锁修订</v-btn>
      </div>
    </div>

    <!-- 写入与恢复 -->
    <section class="panel sync-panel mb-3">
      <div class="panel-head"><h3>写入链路（按现场单号恢复）</h3>
        <v-switch :model-value="store.syncFault" color="error" hide-details density="compact" :label="store.syncFault ? '模拟故障中' : '模拟写入故障'" @update:model-value="store.toggleFaultMode(Boolean($event))" />
      </div>
      <div class="sync-body">
        <div class="sync-state">
          <v-icon :icon="store.pendingWrite ? 'mdi-sync-alert' : 'mdi-cloud-check-outline'" :color="store.pendingWrite ? 'error' : 'success'" size="26" />
          <div>
            <strong>{{ store.pendingWrite ? '写入失败已挂起' : '无挂起写入' }}</strong>
            <p>{{ store.syncMessage || '现场编辑提交后按现场单号落库；失败时保留整批快照，链路恢复后用同一单号恢复，审计不重复追加。' }}</p>
            <small v-if="store.pendingWrite">已尝试 {{ store.pendingWrite.attempts }} 次 · 首次失败 {{ new Date(store.pendingWrite.firstFailedAt).toLocaleTimeString() }}</small>
          </div>
        </div>
        <div class="sync-actions">
          <v-btn v-if="store.pendingWrite" color="error" variant="tonal" prepend-icon="mdi-restore-clock" :loading="store.syncing" @click="store.recoverPendingWrite()">按 {{ store.ticketId }} 恢复写入</v-btn>
          <v-btn v-else color="primary" variant="tonal" prepend-icon="mdi-cloud-upload-outline" :loading="store.syncing" :disabled="store.locked" @click="store.commitToServer()">提交当前批次</v-btn>
        </div>
      </div>
    </section>

    <!-- 签字门控 -->
    <v-alert v-if="store.locked" type="success" variant="tonal" class="mb-3" prepend-icon="mdi-lock-check">
      R{{ store.signOff.revision }} 已由 {{ store.signOff.signedBy }} 于 {{ store.signOff.signedAt ? new Date(store.signOff.signedAt).toLocaleString() : '' }} 签字锁定；任何修改需解锁后生成新修订。
    </v-alert>
    <v-alert v-else-if="store.blockers.length" type="error" variant="tonal" class="mb-3" prepend-icon="mdi-shield-alert-outline">
      <strong>签字被阻断（{{ store.blockers.length }}）：</strong>
      <ul class="blocker-list">
        <li v-for="blocker in store.blockers" :key="blocker.code">{{ blocker.message }}</li>
      </ul>
    </v-alert>
    <v-alert v-else type="success" variant="tonal" class="mb-3" prepend-icon="mdi-check-decagram-outline">冲突清零、路径全部为最新、验收全部通过且写入已确认，可以签字。</v-alert>

    <div class="review-grid">
      <!-- 冲突队列 -->
      <section class="panel">
        <div class="panel-head"><h3>现场 / 值班室冲突</h3><v-chip size="small" :color="store.openConflictList.length ? 'warning' : 'success'" variant="tonal">{{ store.openConflictList.length }} 待处理</v-chip></div>
        <div class="conflict-list">
          <article v-for="conflict in store.conflicts" :key="conflict.id" :class="['conflict-card', conflict.status === '待处理' ? 'open' : 'resolved']">
            <div class="conflict-title">
              <v-icon :icon="conflict.status === '待处理' ? 'mdi-call-merge' : 'mdi-check-circle-outline'" :color="conflict.status === '待处理' ? 'warning' : 'success'" size="18" />
              <strong>{{ ruleName(conflict.ruleId) }}</strong>
              <v-chip size="x-small" variant="outlined">{{ conflict.label }}</v-chip>
            </div>
            <div class="conflict-values">
              <div class="value field"><small>现场值（已保留为主值）</small><strong>{{ String(conflict.fieldValue) }}</strong></div>
              <v-icon icon="mdi-swap-horizontal" size="18" color="#90a0a5" />
              <div class="value duty"><small>值班室晚回值（挂起）</small><strong>{{ String(conflict.dutyValue) }}</strong></div>
            </div>
            <div class="conflict-actions">
              <template v-if="conflict.status === '待处理'">
                <v-btn size="small" color="primary" variant="tonal" :disabled="store.locked || !!store.pendingWrite" @click="store.resolveConflict(conflict.id, '维持现场')">维持现场</v-btn>
                <v-btn size="small" variant="outlined" :disabled="store.locked || !!store.pendingWrite" @click="store.resolveConflict(conflict.id, '采用值班室')">采用值班室</v-btn>
              </template>
              <v-chip v-else size="small" color="success" variant="tonal">{{ conflict.status }} · {{ conflict.resolvedAt ? new Date(conflict.resolvedAt).toLocaleTimeString() : '' }}</v-chip>
            </div>
          </article>
          <div v-if="store.conflicts.length === 0" class="empty-line">
            <v-icon icon="mdi-merge" color="success" /> 暂无冲突。可在因果矩阵页点击「模拟值班室晚回记录」生成同改冲突。
          </div>
        </div>
      </section>

      <!-- 右栏：失效路径 + 验收 -->
      <aside class="side-col">
        <section class="panel mb-3">
          <div class="panel-head"><h3>失效依赖路径</h3><v-chip size="small" :color="stalePaths.length ? 'error' : 'success'" variant="tonal">{{ stalePaths.length }}</v-chip></div>
          <div class="path-list">
            <div v-for="path in store.paths" :key="path.id" :class="['path-row', { stale: path.stale }]">
              <div>
                <strong>{{ path.ruleId }}</strong>
                <small>v{{ path.version }} · {{ path.interlock }} · 优先级 {{ path.priority }}<template v-if="path.crossZone"> · 跨区 {{ path.viaZones.join('→') }}</template></small>
                <small v-if="path.stale" class="reason">失效：{{ path.invalidReason }}</small>
              </div>
              <v-btn v-if="path.stale" size="x-small" color="primary" variant="text" :disabled="store.locked || !!store.pendingWrite" @click="store.confirmPath(path.id)">重算确认</v-btn>
              <v-icon v-else icon="mdi-check-circle" size="18" color="success" />
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>联调验收项</h3><v-chip size="small" variant="tonal">{{ passedCount }}/{{ store.acceptances.length }} 通过</v-chip></div>
          <div class="acceptance-list">
            <div v-for="item in store.acceptances" :key="item.id" :class="['acc-row', item.status]">
              <div>
                <strong>{{ item.id }}</strong>
                <small>{{ item.title }}</small>
                <small v-if="item.status === '失效'" class="reason">旧结论已作废，路径确认后需重测</small>
                <small v-else-if="item.status === '通过'" class="ok">{{ item.signedBy }} 基于路径 v{{ item.basedOnPathVersion }} 签字</small>
              </div>
              <v-btn v-if="item.status !== '通过'" size="x-small" color="success" variant="tonal" prepend-icon="mdi-check" :disabled="store.locked || !!store.pendingWrite || store.paths.find((path) => path.id === item.pathId)?.stale" @click="store.passAcceptanceItem(item.id)">通过</v-btn>
              <v-tooltip v-else text="重置为待测"><v-btn icon="mdi-undo-variant" size="x-small" variant="text" @click="store.resetAcceptance(item.id)" /></v-tooltip>
            </div>
          </div>
        </section>
      </aside>
    </div>

    <div class="review-grid mt-3">
      <!-- 校验 -->
      <section class="panel">
        <div class="panel-head"><h3>矩阵校验结果</h3><v-chip size="small" :color="store.validations.length ? 'error' : 'success'" variant="tonal">{{ store.validations.length }} 项</v-chip></div>
        <div class="validation-list">
          <article v-for="item in store.validations" :key="item.id" :class="item.severity">
            <v-icon :icon="item.severity === '错误' ? 'mdi-close-octagon-outline' : 'mdi-alert-outline'" />
            <div><strong>{{ item.title }}</strong><p>{{ item.detail }}</p><small>建议：{{ item.suggestion }}</small></div>
            <v-btn size="small" variant="text" @click="$router.push('/matrix')">定位</v-btn>
          </article>
          <div v-if="store.validations.length === 0" class="empty-validation"><v-icon icon="mdi-check-decagram" size="34" color="success" /><strong>矩阵校验通过</strong><span>未发现遗漏、重复、矛盾或跨区冲突。</span></div>
        </div>
      </section>

      <!-- 审计 -->
      <aside class="side-col">
        <section class="panel">
          <div class="panel-head"><h3>批次审计（幂等）</h3><span class="muted">{{ store.audits.length }} 条</span></div>
          <div class="audit-list">
            <div v-for="entry in recentAudits" :key="entry.id" class="audit-row">
              <v-icon :icon="entry.actor === '现场' ? 'mdi-hardhat' : entry.actor === '值班室' ? 'mdi-monitor-cellphone' : 'mdi-cog-outline'" size="16" :color="entry.action.includes('失败') ? 'error' : entry.action.includes('冲突') ? 'warning' : 'success'" />
              <div>
                <strong>{{ entry.action }}</strong>
                <p>{{ entry.detail }}</p>
                <small>{{ entry.actor }} · {{ new Date(entry.at).toLocaleString() }}</small>
              </div>
            </div>
          </div>
        </section>
      </aside>
    </div>

    <!-- 专业变更（保留原流程） -->
    <section class="panel change-panel mt-3">
      <div class="panel-head"><h3>专业提交版本差异</h3><span class="muted">可逐项接受</span></div>
      <v-table>
        <thead><tr><th>变更</th><th>来源</th><th>原始值</th><th>提交值</th><th>风险</th><th>决定</th></tr></thead>
        <tbody>
          <tr v-for="change in changes" :key="change.id">
            <td><strong>{{ change.id }}</strong><br />{{ change.title }}</td>
            <td>{{ change.source }}</td>
            <td class="old">{{ change.oldValue }}</td>
            <td class="new">{{ change.newValue }}</td>
            <td><v-chip size="small" :color="change.risk === '高' ? 'error' : change.risk === '中' ? 'warning' : 'success'" variant="tonal">{{ change.risk }}</v-chip></td>
            <td><v-chip v-if="store.acceptedChanges.includes(change.id)" color="success" variant="tonal" prepend-icon="mdi-check">已接受</v-chip><span v-else class="muted">待审阅</span></td>
          </tr>
        </tbody>
      </v-table>
    </section>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.mono { font-family: ui-monospace,monospace; }
.mt-3 { margin-top: 14px; }
.mb-3 { margin-bottom: 14px; }
.sync-panel .sync-body { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; flex-wrap: wrap; }
.sync-state { display: flex; gap: 12px; align-items: flex-start; }
.sync-state p { margin: 4px 0; font-size: 12px; color: #59676d; max-width: 620px; }
.sync-state small { color: #93a0a6; }
.blocker-list { margin: 4px 0 0; padding-left: 16px; }
.blocker-list li { margin: 2px 0; font-size: 12px; }
.review-grid { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 14px; }
.conflict-list { padding: 12px 16px 16px; display: grid; gap: 10px; }
.conflict-card { padding: 12px; border-radius: 9px; border: 1px solid #eccf9f; background: #fffaf0; }
.conflict-card.resolved { border-color: #bfe0d2; background: #f5fbf8; }
.conflict-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.conflict-title strong { font-size: 13px; }
.conflict-values { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.conflict-values .value { flex: 1; padding: 8px 10px; border-radius: 7px; }
.conflict-values .value.field { background: #eef6f2; border: 1px solid #c5e0d4; }
.conflict-values .value.duty { background: #f6f0ea; border: 1px solid #e2d2c4; }
.conflict-values small, .conflict-values strong { display: block; }
.conflict-values small { color: #8a969b; font-size: 10px; }
.conflict-values strong { margin-top: 2px; font-size: 14px; color: #2c3f46; }
.conflict-actions { display: flex; gap: 8px; align-items: center; }
.empty-line { display: flex; align-items: center; gap: 8px; color: #6d7c82; font-size: 12px; padding: 14px 0; }
.path-list, .acceptance-list, .audit-list { padding: 8px 14px 14px; max-height: 320px; overflow-y: auto; }
.path-row, .acc-row, .audit-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid #eef1f1; }
.path-row strong, .acc-row strong, .audit-row strong { display: block; font-size: 12px; }
.path-row small, .acc-row small, .audit-row small { display: block; color: #7d8a90; font-size: 10px; margin-top: 2px; }
.path-row.stale { background: #fdf1ef; margin: 0 -8px; padding: 9px 8px; border-radius: 7px; }
.path-row .reason, .acc-row .reason { color: #b13d2c; }
.acc-row .ok { color: #2f7a5e; }
.acc-row.失效 { background: #fdf1ef; margin: 0 -8px; padding: 9px 8px; border-radius: 7px; }
.validation-list { padding: 8px 16px 16px; }
.validation-list article { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; padding: 13px 0; border-bottom: 1px solid #edf0f0; }
.validation-list article.error { color: #b13d2c; }
.validation-list article.warning { color: #b87b22; }
.validation-list strong { font-size: 13px; }
.validation-list p { margin: 5px 0; color: #59676d; font-size: 12px; line-height: 1.5; }
.validation-list small { color: #7f8b90; }
.empty-validation { display: grid; justify-items: center; gap: 7px; padding: 36px; color: #3d7b63; }
.empty-validation span { color: #748086; font-size: 12px; }
.audit-row { align-items: flex-start; justify-content: flex-start; }
.audit-row p { margin: 3px 0; font-size: 11px; color: #59676d; line-height: 1.5; }
.change-panel { overflow-x: auto; }
.change-panel :deep(table) { min-width: 850px; }
.old { color: #a54b35; }
.new { color: #2e755e; font-weight: 700; }
@media (max-width: 1100px) { .review-grid { grid-template-columns: 1fr; } }
</style>
