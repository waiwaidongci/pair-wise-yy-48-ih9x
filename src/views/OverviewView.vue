<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { LINKAGE_QUERY } from '../api/apollo'
import { useLinkageStore } from '../stores/linkage'

const store = useLinkageStore()
const { result } = useQuery(LINKAGE_QUERY)
const errorCount = computed(() => store.validations.filter((item) => item.severity === '错误').length)
const warningCount = computed(() => store.validations.filter((item) => item.severity === '警告').length)
const staleCount = computed(() => store.paths.filter((path) => path.stale).length)
const acceptancePassed = computed(() => store.acceptances.filter((item) => item.status === '通过').length)
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">FIRE LINKAGE / 消防联动</p>
        <h1>{{ result?.project?.name ?? '消防联动配置项目' }}</h1>
        <p class="muted">{{ result?.project?.building ?? '1号楼 / 2号楼' }} · 设计依据 {{ result?.project?.standard ?? 'GB 50116-2013' }} · 现场单号 <strong class="mono">{{ store.ticketId }}</strong></p>
      </div>
      <div class="actions">
        <v-btn variant="outlined" prepend-icon="mdi-call-merge" color="warning" :disabled="store.locked || !!store.pendingWrite" @click="store.simulateDutyLateSync()">模拟值班室晚回</v-btn>
        <v-btn color="primary" prepend-icon="mdi-check-decagram-outline" @click="$router.push('/review')">进入审阅签字</v-btn>
      </div>
    </div>

    <v-alert v-if="store.pendingWrite" type="error" variant="tonal" class="mb-3">写入失败：现场单号 {{ store.pendingWrite.ticketId }} 的快照已挂起，编辑冻结；恢复写入后继续，审计不会重复追加。</v-alert>

    <div class="metric-grid">
      <article><span>点位总数</span><strong>{{ store.devices.length }}</strong><small>覆盖 {{ new Set(store.devices.map((device) => device.zone)).size }} 个防火分区</small></article>
      <article><span>启用规则</span><strong>{{ store.rules.filter((rule) => rule.enabled).length }}</strong><small>{{ store.rules.length }} 条矩阵关系</small></article>
      <article><span>待处理冲突</span><strong :class="store.openConflictList.length ? 'warning' : 'ok'">{{ store.openConflictList.length }}</strong><small>未处理冲突阻断签字</small></article>
      <article><span>失效路径</span><strong :class="staleCount ? 'error' : 'ok'">{{ staleCount }}</strong><small>分区/优先级/互锁变化后待重算</small></article>
      <article><span>验收通过</span><strong :class="acceptancePassed === store.acceptances.length ? 'ok' : 'warning'">{{ acceptancePassed }}/{{ store.acceptances.length }}</strong><small>旧结论随路径升版作废</small></article>
      <article><span>阻断错误</span><strong class="error">{{ errorCount }}</strong><small>签字前必须处理</small></article>
      <article><span>审阅警告</span><strong class="warning">{{ warningCount }}</strong><small>跨区和重复关系</small></article>
      <article><span>写入状态</span><strong :class="store.pendingWrite ? 'error' : 'ok'">{{ store.pendingWrite ? '挂起' : '已落库' }}</strong><small>按现场单号幂等恢复</small></article>
    </div>

    <div class="overview-grid">
      <section class="panel">
        <div class="panel-head"><h3>批次门禁（签字条件）</h3><v-chip size="small" :color="store.canSign ? 'success' : 'error'" variant="tonal">{{ store.canSign ? '满足' : `${store.blockers.length} 项阻断` }}</v-chip></div>
        <div class="gate-list">
          <div v-for="blocker in store.blockers" :key="blocker.code" class="gate-item blocked">
            <v-icon icon="mdi-block-helper" color="error" size="18" /><span>{{ blocker.message }}</span>
          </div>
          <div v-if="store.canSign" class="gate-item ok"><v-icon icon="mdi-check-circle" color="success" size="18" /><span>冲突清零、路径最新、验收全部通过、写入已确认。</span></div>
          <v-btn variant="tonal" class="mt-2" @click="$router.push('/review')">前往冲突 · 验收 · 签字页</v-btn>
        </div>
      </section>
      <aside class="panel">
        <div class="panel-head"><h3>最近审计</h3><span class="muted">R{{ store.revision }}</span></div>
        <div class="audit-mini">
          <div v-for="entry in [...store.audits].reverse().slice(0, 6)" :key="entry.id">
            <v-icon icon="mdi-circle-small" :color="entry.action.includes('失败') ? 'error' : entry.action.includes('冲突') ? 'warning' : 'success'" size="14" />
            <div><strong>{{ entry.action }}</strong><small>{{ entry.detail }}</small><small class="time">{{ entry.actor }} · {{ new Date(entry.at).toLocaleTimeString() }}</small></div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.mono { font-family: ui-monospace,monospace; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.mb-3 { margin-bottom: 14px; }
.metric-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
.metric-grid article { padding: 16px; border: 1px solid #dde3e3; border-radius: 10px; background: white; }
.metric-grid span, .metric-grid small { display: block; color: #758187; font-size: 12px; }
.metric-grid strong { display: block; margin: 7px 0; color: #293e45; font-size: 26px; }
.metric-grid .error { color: #b23e2a; }
.metric-grid .warning { color: #bd7928; }
.metric-grid .ok { color: #2f7a5e; }
.overview-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; }
.gate-list { padding: 14px 16px 16px; display: grid; gap: 8px; }
.gate-item { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: #46565c; }
.gate-item.blocked span { color: #b13d2c; }
.audit-mini { padding: 8px 14px 14px; display: grid; gap: 8px; }
.audit-mini > div { display: flex; gap: 4px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid #f0f3f3; }
.audit-mini strong, .audit-mini small { display: block; }
.audit-mini strong { font-size: 11px; }
.audit-mini small { color: #7b878c; font-size: 10px; margin-top: 2px; line-height: 1.4; }
.audit-mini .time { color: #9aa6ab; }
@media (max-width: 1000px) { .overview-grid { grid-template-columns: 1fr; } }
@media (max-width: 680px) { .metric-grid { grid-template-columns: 1fr 1fr; } }
</style>
