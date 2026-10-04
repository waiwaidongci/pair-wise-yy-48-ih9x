<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLinkageStore } from '../stores/linkage'

const store = useLinkageStore()
const selectedRule = ref<string | null>(null)
const triggers = computed(() => store.devices.filter((device) => store.rules.some((rule) => rule.triggerId === device.id)))
const actions = computed(() => store.devices.filter((device) => store.rules.some((rule) => rule.actionId === device.id)))
const staleCount = computed(() => store.paths.filter((path) => path.stale).length)

function triggerY(index: number) { return 70 + index * 88 }
function actionY(index: number) { return 70 + index * 105 }
function sourceY(id: string) { return triggerY(triggers.value.findIndex((item) => item.id === id)) }
function targetY(id: string) { return actionY(actions.value.findIndex((item) => item.id === id)) }
function pathOf(ruleId: string) { return store.paths.find((path) => path.ruleId === ruleId) }
function acceptanceOf(ruleId: string) { return store.acceptances.find((item) => item.ruleId === ruleId) }

const selectedPath = computed(() => (selectedRule.value ? pathOf(selectedRule.value) : undefined))
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">DEPENDENCY GRAPH / 条件依赖</p><h1>触发、互锁与动作路径</h1><p class="muted">设备分区、规则优先级或互锁变化后，受影响路径自动升版失效；重算确认前旧验收结论不放行。</p></div>
      <div class="head-actions">
        <v-chip variant="tonal" :color="staleCount ? 'warning' : 'success'" prepend-icon="mdi-alert-outline">{{ staleCount ? `${staleCount} 条路径失效待确认` : '全部路径为最新版本' }}</v-chip>
        <v-btn v-if="staleCount" color="primary" variant="tonal" prepend-icon="mdi-refresh-check" :disabled="store.locked || !!store.pendingWrite" @click="store.confirmAllPaths">全部重算确认</v-btn>
      </div>
    </div>

    <v-alert v-if="staleCount" type="warning" variant="tonal" density="compact" class="mb-3">
      {{ staleCount }} 条依赖路径因分区 / 优先级 / 互锁 / 延时变化已升版失效（红色虚线），关联验收项已作废；请逐条或批量确认重算结果。
    </v-alert>

    <div class="graph-wrap panel">
      <svg viewBox="0 0 1100 620" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#60777e" /></marker>
          <marker id="arrow-warn" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#bd6f2a" /></marker>
          <marker id="arrow-stale" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#c53b2a" /></marker>
        </defs>
        <text x="80" y="26" class="column-title">触发点位</text>
        <text x="790" y="26" class="column-title">动作设备</text>
        <g v-for="(device, index) in triggers" :key="device.id">
          <rect x="40" :y="triggerY(index) - 26" width="230" height="52" rx="8" class="node trigger" />
          <text x="60" :y="triggerY(index) - 4" class="node-title">{{ device.name }}</text>
          <text x="60" :y="triggerY(index) + 13" class="node-sub">{{ device.id }} · {{ device.zone }}</text>
        </g>
        <g v-for="(device, index) in actions" :key="device.id">
          <rect x="760" :y="actionY(index) - 28" width="260" height="56" rx="8" class="node action" />
          <text x="782" :y="actionY(index) - 5" class="node-title">{{ device.name }}</text>
          <text x="782" :y="actionY(index) + 14" class="node-sub">{{ device.id }} · {{ device.zone }}</text>
        </g>
        <g v-for="rule in store.rules" :key="rule.id" @click="selectedRule = rule.id" class="edge-group">
          <path
            :d="`M 270 ${sourceY(rule.triggerId)} C 500 ${sourceY(rule.triggerId)}, 530 ${targetY(rule.actionId)}, 760 ${targetY(rule.actionId)}`"
            fill="none"
            :class="['edge', {
              disabled: !rule.enabled,
              selected: selectedRule === rule.id,
              warning: !pathOf(rule.id)?.stale && store.validations.some((item) => item.ruleIds.includes(rule.id)),
              stale: pathOf(rule.id)?.stale,
            }]"
            :marker-end="pathOf(rule.id)?.stale ? 'url(#arrow-stale)' : store.validations.some((item) => item.ruleIds.includes(rule.id)) ? 'url(#arrow-warn)' : 'url(#arrow)'"
          />
          <circle :cx="515" :cy="(sourceY(rule.triggerId) + targetY(rule.actionId)) / 2" r="13" :class="['rule-node', { stale: pathOf(rule.id)?.stale }]" />
          <text :x="515" :y="(sourceY(rule.triggerId) + targetY(rule.actionId)) / 2 + 3" text-anchor="middle" class="rule-id">{{ rule.id.slice(-3) }}</text>
          <text v-if="pathOf(rule.id)?.stale" :x="515" :y="(sourceY(rule.triggerId) + targetY(rule.actionId)) / 2 - 19" text-anchor="middle" class="stale-tag">v{{ pathOf(rule.id)?.version }} 失效</text>
        </g>
      </svg>
      <div class="graph-side" v-if="selectedRule && selectedPath">
        <div class="side-head">
          <strong>{{ selectedRule }}</strong>
          <v-btn icon="mdi-close" size="small" variant="text" @click="selectedRule = null" />
        </div>
        <v-chip size="small" :color="selectedPath.stale ? 'error' : 'success'" variant="tonal" class="mb-2">
          路径 v{{ selectedPath.version }} · {{ selectedPath.stale ? '已失效' : '已确认' }}
        </v-chip>
        <p v-if="selectedPath.stale" class="stale-reason">失效原因：{{ selectedPath.invalidReason }}</p>
        <p class="path-line"><span>互锁：</span>{{ selectedPath.interlock }}　<span>优先级：</span>{{ selectedPath.priority }}</p>
        <p class="path-line"><span>跨区：</span>{{ selectedPath.crossZone ? selectedPath.viaZones.join(' → ') : '同区' }}</p>
        <p class="path-line"><span>验收：</span>
          <v-chip size="x-small" :color="acceptanceOf(selectedRule)?.status === '通过' ? 'success' : acceptanceOf(selectedRule)?.status === '失效' ? 'error' : 'warning'" variant="tonal">
            {{ acceptanceOf(selectedRule)?.status ?? '未建账' }}
          </v-chip>
          <small v-if="acceptanceOf(selectedRule)?.status === '通过'">（基于 v{{ acceptanceOf(selectedRule)?.basedOnPathVersion }}）</small>
        </p>
        <v-switch :model-value="store.rules.find((rule) => rule.id === selectedRule)?.enabled" label="规则启用" color="primary" hide-details density="compact" :disabled="store.locked || !!store.pendingWrite" @update:model-value="store.updateRule(selectedRule!, { enabled: Boolean($event) }, '现场')" />
        <v-btn v-if="selectedPath.stale" block size="small" color="primary" variant="tonal" prepend-icon="mdi-refresh-check" class="mt-2" :disabled="store.locked || !!store.pendingWrite" @click="store.confirmPath(selectedPath.id)">重算确认路径</v-btn>
      </div>
    </div>
  </section>
</template>

<style scoped>
.head-actions { display: flex; gap: 8px; align-items: center; }
.graph-wrap { position: relative; overflow: auto; }
svg { display: block; min-width: 900px; width: 100%; background: radial-gradient(circle, #d9dfe0 1px, transparent 1px); background-size: 22px 22px; }
.column-title { fill: #64757c; font-size: 13px; font-weight: 800; letter-spacing: .12em; }
.node { fill: white; stroke-width: 1.6; }
.node.trigger { stroke: #397a82; }
.node.action { stroke: #a64c35; }
.node-title { fill: #253a42; font-size: 12px; font-weight: 700; }
.node-sub { fill: #718188; font-size: 10px; }
.edge { stroke: #60777e; stroke-width: 2; opacity: .75; cursor: pointer; }
.edge.selected { stroke: #1e6772; stroke-width: 4; opacity: 1; }
.edge.warning { stroke: #bd6f2a; stroke-dasharray: 7 5; opacity: 1; }
.edge.stale { stroke: #c53b2a; stroke-width: 3; stroke-dasharray: 3 4; opacity: 1; }
.edge.disabled { stroke: #aeb8bb; opacity: .35; }
.rule-node { fill: white; stroke: #597177; stroke-width: 1.5; }
.rule-node.stale { fill: #fde8e3; stroke: #c53b2a; }
.rule-id { fill: #4f666d; font-size: 8px; font-weight: 800; }
.stale-tag { fill: #c53b2a; font-size: 9px; font-weight: 800; }
.edge-group { cursor: pointer; }
.graph-side { position: absolute; top: 18px; right: 18px; width: 280px; padding: 14px; border: 1px solid #dbe2e3; border-radius: 9px; background: rgba(255,255,255,.97); box-shadow: 0 8px 25px rgba(31,54,62,.12); }
.side-head { display: flex; align-items: center; justify-content: space-between; }
.side-head strong { display: block; margin: 2px 0 8px; }
.stale-reason { margin: 6px 0; color: #b13d2c; font-size: 12px; }
.path-line { margin: 5px 0; font-size: 12px; color: #46565c; }
.path-line span { color: #8a969b; }
</style>
