<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLinkageStore } from './stores/linkage'

const route = useRoute()
const store = useLinkageStore()
const drawer = ref(true)
const title = computed(() => String(route.meta.title ?? '消防联动'))

const items = [
  { to: '/', title: '项目总览', icon: 'mdi-view-dashboard-outline' },
  { to: '/devices', title: '设备与分区', icon: 'mdi-access-point' },
  { to: '/matrix', title: '因果矩阵', icon: 'mdi-grid-large' },
  { to: '/dependency', title: '依赖路径', icon: 'mdi-graph-outline' },
  { to: '/review', title: '冲突·验收·签字', icon: 'mdi-file-compare' },
]
</script>

<template>
  <v-app>
    <v-navigation-drawer v-model="drawer" :permanent="$vuetify.display.mdAndUp" color="#25363C" width="244">
      <div class="brand">
        <div class="brand-mark"><v-icon icon="mdi-fire-alert" /></div>
        <div><strong>联动逻辑台</strong><small>滨江研发中心 · 消防专业</small></div>
      </div>
      <v-list nav class="nav-list">
        <v-list-item v-for="item in items" :key="item.to" :to="item.to" :prepend-icon="item.icon" :title="item.title" rounded="lg" />
      </v-list>
      <template #append>
        <div class="side-status">
          <div class="ticket"><v-icon icon="mdi-clipboard-text-clock-outline" size="14" /><span class="mono">{{ store.ticketId }}</span></div>
          <div><span class="status-dot" :class="{ locked: store.locked, fault: !!store.pendingWrite }" />{{ store.pendingWrite ? '写入挂起待恢复' : store.locked ? '基线已签字锁定' : '现场/值班室协同中' }}</div>
          <small>版本 R{{ store.revision }} · {{ store.validations.length }} 项校验 · {{ store.openConflictList.length }} 条待处理冲突</small>
        </div>
      </template>
    </v-navigation-drawer>

    <v-app-bar flat class="app-bar" height="52">
      <v-app-bar-nav-icon class="d-md-none" @click="drawer = !drawer" />
      <v-app-bar-title>{{ title }}</v-app-bar-title>
      <v-spacer />
      <v-chip v-if="store.pendingWrite" size="small" color="error" variant="tonal" prepend-icon="mdi-sync-alert">写入失败 · 按单号恢复</v-chip>
      <v-chip v-else-if="store.openConflictList.length" size="small" color="warning" variant="tonal" prepend-icon="mdi-call-merge">{{ store.openConflictList.length }} 条冲突待处理</v-chip>
      <v-chip v-else size="small" variant="tonal" color="success" prepend-icon="mdi-cloud-check-outline">草稿已保存</v-chip>
    </v-app-bar>

    <v-main>
      <RouterView />
    </v-main>
  </v-app>
</template>

<style scoped>
.brand { display: flex; align-items: center; gap: 11px; padding: 20px 16px; color: #eef3f4; border-bottom: 1px solid rgba(255,255,255,.1); }
.brand-mark { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid #d36b55; border-radius: 9px; color: #f0a391; }
.brand strong, .brand small { display: block; }
.brand strong { font-size: 14px; }
.brand small { margin-top: 4px; color: #9eb0b5; font-size: 10px; }
.nav-list { padding: 15px 10px; }
.nav-list :deep(.v-list-item--active) { color: white; background: #38525a; box-shadow: inset 3px 0 #cf634d; }
.side-status { margin: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; color: #dce6e9; background: rgba(255,255,255,.04); }
.side-status div { font-size: 11px; font-weight: 700; }
.side-status small { display: block; margin-top: 6px; color: #93a7ad; font-size: 9px; }
.status-dot { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: #59b58a; }
.status-dot.locked { background: #d79a45; }
.status-dot.fault { background: #e0604a; }
.ticket { display: flex; align-items: center; gap: 5px; margin-bottom: 8px; font-size: 11px; color: #f0a391; }
.ticket .mono { letter-spacing: .03em; }
.app-bar { border-bottom: 1px solid #e0e5e5; background: white; }
</style>
