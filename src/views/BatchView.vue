<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLinkageStore, type EditSource, type Rule } from '../stores/linkage'

const store = useLinkageStore()

// 两源提交
const selectedRuleId = ref(store.rules[0]?.id ?? '')
const draft = ref<Pick<Rule, 'delay' | 'interlock' | 'priority'>>({ delay: 0, interlock: '无', priority: 2 })

const selectedRule = computed(() => store.rules.find((r) => r.id === selectedRuleId.value))

function loadRule() {
  const rule = selectedRule.value
  if (!rule) return
  draft.value = { delay: rule.delay, interlock: rule.interlock, priority: rule.priority }
}

function submit(source: EditSource) {
  if (!selectedRuleId.value) return
  store.submitRule(selectedRuleId.value, { ...draft.value }, source)
}

// 失效项
const invalidPaths = computed(() => store.paths.filter((p) => !p.valid))
const invalidAcceptances = computed(() => store.acceptances.filter((a) => !a.valid))
const failedWrites = computed(() => store.writeJournal.filter((w) => w.status === 'failed'))

const sourceColor = (source: EditSource) => (source === '现场' ? 'primary' : 'secondary')
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">COMMISSIONING BATCH / 调试批次</p>
        <h1>{{ store.batchMeta.name }}</h1>
        <p class="muted">
          批次单号 <span class="mono">{{ store.batchMeta.orderNo }}</span>
          · 把设备、因果规则、依赖路径与验收签字接成同一调试批次
        </p>
      </div>
      <div class="actions">
        <v-chip v-if="store.batchMeta.migratedFrom" color="info" variant="tonal" prepend-icon="mdi-database-import">
          旧稿 {{ store.batchMeta.migratedFrom }} 已按首版迁移
        </v-chip>
        <v-chip :color="store.locked ? 'warning' : 'success'" variant="tonal" prepend-icon="mdi-source-branch">
          {{ store.locked ? '已签字锁定' : '协同编辑中' }} · R{{ store.revision }}
        </v-chip>
      </div>
    </div>

    <div class="metric-grid">
      <article><span>未处理冲突</span><strong :class="{ bad: store.conflictCount }">{{ store.conflictCount }}</strong><small>现场与值班室同改一规则</small></article>
      <article><span>失效依赖路径</span><strong :class="{ bad: store.invalidPathCount }">{{ store.invalidPathCount }}</strong><small>分区或规则变更后需重算</small></article>
      <article><span>失效验收项</span><strong :class="{ bad: store.invalidAcceptanceCount }">{{ store.invalidAcceptanceCount }}</strong><small>依赖路径失效连带</small></article>
      <article><span>写入失败</span><strong :class="{ bad: store.failedWriteCount }">{{ store.failedWriteCount }}</strong><small>按现场单号恢复</small></article>
    </div>

    <v-alert v-if="store.locked" type="success" variant="tonal" class="mb-3">
      本批次已签字锁定，配置为只读基线。解锁后可继续修订。
    </v-alert>

    <div class="batch-grid">
      <!-- 两源提交 -->
      <section class="panel">
        <div class="panel-head"><h3>两源提交规则</h3><span class="muted">现场 / 值班室</span></div>
        <div class="submit-form">
          <v-select
            v-model="selectedRuleId"
            :items="store.rules.map((r) => ({ value: r.id, title: `${r.id} · ${store.devices.find((d) => d.id === r.triggerId)?.name} → ${store.devices.find((d) => d.id === r.actionId)?.name}` }))"
            label="选择规则"
            density="compact"
            hide-details
            @update:model-value="loadRule"
          />
          <v-text-field v-model.number="draft.delay" type="number" label="延时(s)" density="compact" hide-details />
          <v-select v-model="draft.priority" :items="[1, 2, 3]" label="优先级" density="compact" hide-details />
          <v-text-field v-model="draft.interlock" label="互锁条件" density="compact" hide-details />
          <div class="submit-actions">
            <v-btn color="primary" prepend-icon="mdi-account-hard-hat" :disabled="store.locked" @click="submit('现场')">现场提交</v-btn>
            <v-btn color="secondary" prepend-icon="mdi-office-building" :disabled="store.locked" @click="submit('值班室')">值班室提交</v-btn>
            <v-btn variant="tonal" color="warning" prepend-icon="mdi-alert-octagon-outline" :disabled="store.locked" @click="store.armNextFailure = true">模拟下次写入失败</v-btn>
          </div>
          <p class="muted hint">两边都改同一规则时保留现场值，值班室版进冲突；冲突未处理不能签字。</p>
        </div>
      </section>

      <!-- 冲突 -->
      <section class="panel">
        <div class="panel-head"><h3>并发冲突</h3><v-chip size="small" :color="store.conflictCount ? 'error' : 'success'" variant="tonal">{{ store.conflictCount }}</v-chip></div>
        <div class="conflict-list">
          <div v-for="c in store.conflicts" :key="c.ruleId" class="conflict-item">
            <div class="conflict-head">
              <strong>{{ c.ruleId }}</strong>
              <v-chip size="x-small" color="primary" variant="tonal">现场值保留</v-chip>
            </div>
            <div class="conflict-versions">
              <div class="version">
                <v-chip size="x-small" :color="sourceColor('现场')" variant="tonal">现场</v-chip>
                <span>延时 {{ c.field.patch.delay ?? '—' }}s · 优先级 {{ c.field.patch.priority ?? '—' }} · 互锁 {{ c.field.patch.interlock ?? '—' }}</span>
              </div>
              <div class="version">
                <v-chip size="x-small" :color="sourceColor('值班室')" variant="tonal">值班室</v-chip>
                <span>延时 {{ c.duty.patch.delay ?? '—' }}s · 优先级 {{ c.duty.patch.priority ?? '—' }} · 互锁 {{ c.duty.patch.interlock ?? '—' }}</span>
              </div>
            </div>
            <div class="conflict-actions">
              <v-btn size="small" color="primary" variant="tonal" @click="store.resolveConflict(c.ruleId, '现场')">保留现场值</v-btn>
              <v-btn size="small" variant="text" @click="store.resolveConflict(c.ruleId, '值班室')">改用值班室版</v-btn>
            </div>
          </div>
          <div v-if="store.conflictCount === 0" class="empty"><v-icon icon="mdi-check-decagram" color="success" />无并发冲突</div>
        </div>
      </section>

      <!-- 失效重算 -->
      <section class="panel">
        <div class="panel-head">
          <h3>失效依赖路径 / 验收项</h3>
          <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-cached" :disabled="store.locked" @click="store.recalculateAll()">全部重算</v-btn>
        </div>
        <div class="invalid-list">
          <div v-for="p in invalidPaths" :key="p.id" class="invalid-item">
            <v-icon icon="mdi-link-variant-off" color="warning" />
            <div><strong>{{ p.id }}</strong><small>{{ store.devices.find((d) => d.id === p.from)?.name }} → {{ store.devices.find((d) => d.id === p.to)?.name }}</small><small class="reason">{{ p.reason }}</small></div>
          </div>
          <div v-for="a in invalidAcceptances" :key="a.id" class="invalid-item">
            <v-icon icon="mdi-clipboard-alert-outline" color="warning" />
            <div><strong>{{ a.title }}</strong><small>{{ a.id }} · {{ a.reason }}</small></div>
          </div>
          <div v-if="invalidPaths.length === 0 && invalidAcceptances.length === 0" class="empty"><v-icon icon="mdi-check-decagram" color="success" />依赖路径与验收项均有效</div>
        </div>
      </section>

      <!-- 写入日志 -->
      <section class="panel">
        <div class="panel-head"><h3>写入日志（现场单号）</h3><span class="muted">失败按单号恢复，不重复追加审计</span></div>
        <div class="journal">
          <div v-for="w in store.writeJournal.slice(0, 12)" :key="w.orderNo" class="journal-item" :class="{ failed: w.status === 'failed' }">
            <div class="journal-main">
              <span class="mono">{{ w.orderNo }}</span>
              <span>{{ w.summary }}</span>
            </div>
            <div class="journal-meta">
              <v-chip size="x-small" :color="w.status === 'committed' ? 'success' : 'error'" variant="tonal">
                {{ w.status === 'committed' ? '已提交' : '失败' }} · 第 {{ w.attempts }} 次
              </v-chip>
              <v-btn v-if="w.status === 'failed'" size="x-small" color="warning" variant="tonal" prepend-icon="mdi-refresh" @click="store.recoverWrite(w.orderNo)">按单号恢复</v-btn>
            </div>
          </div>
          <div v-if="store.writeJournal.length === 0" class="empty"><v-icon icon="mdi-check-decagram" color="success" />暂无写入记录</div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.batch-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.batch-grid > section:nth-child(1) { grid-column: 1 / -1; }
.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
.metric-grid article { padding: 16px; border: 1px solid #dde3e3; border-radius: 10px; background: white; }
.metric-grid span, .metric-grid small { display: block; color: #758187; font-size: 12px; }
.metric-grid strong { display: block; margin: 7px 0; color: #293e45; font-size: 28px; }
.metric-grid .bad { color: #b23e2a; }
.mono { font-family: ui-monospace, monospace; font-weight: 700; color: #267078; }
.submit-form { display: grid; grid-template-columns: 2fr 1fr 1fr 2fr; gap: 10px; padding: 14px; }
.submit-actions { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; }
.hint { grid-column: 1 / -1; margin: 0; }
.conflict-list, .invalid-list, .journal { padding: 10px 14px 14px; }
.conflict-item { padding: 12px 0; border-bottom: 1px solid #edf0f0; }
.conflict-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.conflict-versions { display: grid; gap: 6px; margin-bottom: 8px; }
.version { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #59676d; }
.conflict-actions { display: flex; gap: 8px; }
.invalid-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid #edf0f0; }
.invalid-item strong { display: block; font-size: 13px; }
.invalid-item small { display: block; color: #7f8b90; font-size: 11px; }
.invalid-item .reason { color: #b87b22; }
.journal-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid #edf0f0; }
.journal-item.failed { background: #fff5f0; }
.journal-main { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.journal-meta { display: flex; align-items: center; gap: 8px; }
.empty { display: grid; justify-items: center; gap: 6px; padding: 28px; color: #3d7b63; font-size: 12px; }
@media (max-width: 1000px) { .batch-grid { grid-template-columns: 1fr; } .submit-form { grid-template-columns: 1fr; } }
@media (max-width: 680px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
