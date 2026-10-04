<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLinkageStore } from '../stores/linkage'
import { conflictsForRule } from '../domain/merge'

const store = useLinkageStore()
const query = ref('')
const showOnlyEnabled = ref(false)
const batchDelay = ref(0)
const batchPriority = ref<1 | 2 | 3>(2)
const batchInterlock = ref('无')
const selectedIds = computed({
  get: () => store.selectedRuleIds,
  set: (value) => (store.selectedRuleIds = value),
})
const rows = computed(() => store.rules.filter((rule) => {
  const trigger = store.devices.find((device) => device.id === rule.triggerId)
  const action = store.devices.find((device) => device.id === rule.actionId)
  return (!showOnlyEnabled.value || rule.enabled) && (!query.value || `${rule.id}${trigger?.name}${action?.name}${rule.interlock}`.includes(query.value))
}))

function rowConflicts(ruleId: string) {
  return conflictsForRule(store.conflicts, ruleId).filter((item) => item.status === '待处理')
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">CAUSE & EFFECT / 因果矩阵</p><h1>触发条件到动作结果</h1><p class="muted">现场值为权威主值；值班室晚回同改时保留现场值、另一版进冲突，冲突未清不能签字。</p></div>
      <div class="actions">
        <v-btn variant="outlined" prepend-icon="mdi-call-merge" color="warning" :disabled="store.locked || !!store.pendingWrite" @click="store.simulateDutyLateSync">模拟值班室晚回记录</v-btn>
        <v-btn variant="outlined" prepend-icon="mdi-check-all" @click="$router.push('/review')">校验 {{ store.validations.length }} 项</v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" :disabled="store.locked || !!store.pendingWrite" @click="store.addRule">新增规则</v-btn>
      </div>
    </div>

    <v-alert v-if="store.pendingWrite" type="error" variant="tonal" density="compact" class="mb-3">
      现场单号 {{ store.pendingWrite.ticketId }} 写入失败，编辑已冻结；请到「冲突·验收·签字」页按原单号恢复，恢复不会重复追加审计。
    </v-alert>
    <v-alert v-else-if="store.openConflictList.length" type="warning" variant="tonal" density="compact" class="mb-3">
      值班室晚回与现场同改 {{ store.openConflictList.length }} 项，已保留现场值；请前往冲突队列逐项处置，未处理不能签字。
    </v-alert>
    <v-alert v-else-if="store.validations.length" type="info" variant="tonal" density="compact" class="mb-3">
      发现 {{ store.validations.filter((item) => item.severity === '错误').length }} 个错误和 {{ store.validations.filter((item) => item.severity === '警告').length }} 个警告。
    </v-alert>

    <div class="toolbar panel">
      <v-text-field v-model="query" density="compact" hide-details prepend-inner-icon="mdi-magnify" label="搜索规则或设备" style="max-width:320px" />
      <v-switch v-model="showOnlyEnabled" label="只看启用" color="primary" hide-details density="compact" />
      <v-divider vertical class="mx-3" />
      <span class="batch-label">现场批量编辑 {{ selectedIds.length }} 条</span>
      <v-text-field v-model.number="batchDelay" type="number" label="延时(s)" density="compact" hide-details style="max-width:92px" />
      <v-select v-model="batchPriority" :items="[1,2,3]" label="优先级" density="compact" hide-details style="max-width:100px" />
      <v-text-field v-model="batchInterlock" label="互锁" density="compact" hide-details style="max-width:160px" />
      <v-btn size="small" variant="tonal" :disabled="store.locked || !!store.pendingWrite" @click="store.batchUpdate({ delay: batchDelay, priority: batchPriority, interlock: batchInterlock })">应用</v-btn>
      <v-btn size="small" variant="tonal" color="success" :disabled="store.locked || !!store.pendingWrite" @click="store.toggleSelected(true)">启用</v-btn>
      <v-btn size="small" variant="tonal" color="warning" :disabled="store.locked || !!store.pendingWrite" @click="store.toggleSelected(false)">停用</v-btn>
    </div>

    <div class="panel table-wrap">
      <table class="matrix-table">
        <thead>
          <tr><th style="width:36px"></th><th>规则</th><th>触发点位</th><th>动作点位</th><th>延时(s)</th><th>互锁条件</th><th>优先级</th><th>抑制条件</th><th>启用</th><th>冲突 / 校验</th></tr>
        </thead>
        <tbody>
          <tr v-for="rule in rows" :key="rule.id" :class="{ 'row-error': store.validations.some((item) => item.severity === '错误' && item.ruleIds.includes(rule.id)), 'row-conflict': rowConflicts(rule.id).length > 0 }">
            <td><v-checkbox-btn :model-value="selectedIds.includes(rule.id)" @update:model-value="(value) => selectedIds = value ? [...selectedIds, rule.id] : selectedIds.filter((id) => id !== rule.id)" /></td>
            <td><strong>{{ rule.id }}</strong></td>
            <td>{{ store.devices.find((device) => device.id === rule.triggerId)?.name }}</td>
            <td>{{ store.devices.find((device) => device.id === rule.actionId)?.name }}</td>
            <td><v-text-field :model-value="rule.delay" type="number" density="compact" hide-details style="width:80px" :disabled="store.locked || !!store.pendingWrite" @update:model-value="store.updateRule(rule.id, { delay: Number($event) }, '现场')" /></td>
            <td><v-text-field :model-value="rule.interlock" density="compact" hide-details style="min-width:160px" :disabled="store.locked || !!store.pendingWrite" @update:model-value="store.updateRule(rule.id, { interlock: String($event) }, '现场')" /></td>
            <td><v-select :model-value="rule.priority" :items="[1,2,3]" density="compact" hide-details style="width:82px" :disabled="store.locked || !!store.pendingWrite" @update:model-value="store.updateRule(rule.id, { priority: Number($event) as 1|2|3 }, '现场')" /></td>
            <td>{{ rule.suppression }}</td>
            <td><v-switch :model-value="rule.enabled" color="primary" hide-details density="compact" :disabled="store.locked || !!store.pendingWrite" @update:model-value="store.updateRule(rule.id, { enabled: Boolean($event) }, '现场')" /></td>
            <td>
              <div v-if="rowConflicts(rule.id).length" class="conflict-cell">
                <v-chip v-for="conflict in rowConflicts(rule.id)" :key="conflict.id" size="x-small" color="warning" variant="tonal" class="conflict-chip">
                  {{ conflict.label }}：现场 {{ String(conflict.fieldValue) }} / 值班 {{ String(conflict.dutyValue) }}
                </v-chip>
                <v-btn size="x-small" variant="text" @click="$router.push('/review')">去处理</v-btn>
              </div>
              <v-chip v-else-if="store.validations.some((item) => item.ruleIds.includes(rule.id))" size="x-small" color="error" variant="tonal">需处理</v-chip>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.toolbar { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 12px; padding: 12px; }
.batch-label { color: #68767d; font-size: 12px; }
.table-wrap { overflow-x: auto; }
.matrix-table { width: 100%; border-collapse: collapse; min-width: 1280px; }
.matrix-table th { padding: 11px 10px; text-align: left; font-size: 12px; color: #5a686e; border-bottom: 1px solid #e4e9e9; white-space: nowrap; }
.matrix-table td { padding: 8px 10px; border-bottom: 1px solid #eef1f1; font-size: 13px; vertical-align: middle; }
.row-error { background: #fff5f0; }
.row-conflict { background: #fff9ee; box-shadow: inset 3px 0 #d28a2d; }
.muted { color: #849096; }
.conflict-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.conflict-chip { white-space: normal; }
</style>
