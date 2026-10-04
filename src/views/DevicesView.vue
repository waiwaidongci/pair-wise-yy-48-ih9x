<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLinkageStore, type Device, type DeviceType } from '../stores/linkage'

const store = useLinkageStore()
const query = ref('')
const floor = ref('全部')
const dialog = ref(false)
const form = ref<Device>({ id: '', name: '', type: '感烟探测器', floor: '1F', zone: 'A 区', address: '' })
const types: DeviceType[] = ['感烟探测器', '感温探测器', '手动报警按钮', '输入模块', '输出模块', '排烟风机', '防火卷帘', '消防广播', '电梯']
const floors = ['1F', '2F', '3F']
const zones = ['A 区', 'B 区', '中庭']

const filtered = computed(() => store.devices.filter((item) => (floor.value === '全部' || item.floor === floor.value) && `${item.id}${item.name}${item.address}${item.zone}`.includes(query.value)))

function addDevice() {
  if (!form.value.id || !form.value.name || !form.value.address) return
  store.addDevice({ ...form.value })
  dialog.value = false
  form.value = { id: '', name: '', type: '感烟探测器', floor: '1F', zone: 'A 区', address: '' }
}

function affectedRules(deviceId: string) {
  return store.rules.filter((rule) => rule.triggerId === deviceId || rule.actionId === deviceId)
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">DEVICE REGISTER / 设备台账</p><h1>探测器、模块与消防设备</h1><p class="muted">调整设备楼层/分区后，挂接的依赖路径与验收项立即失效重算，旧验收结论不再放行。</p></div>
      <v-btn color="primary" prepend-icon="mdi-plus" :disabled="store.locked || !!store.pendingWrite" @click="dialog = true">新增点位</v-btn>
    </div>

    <v-alert v-if="store.pendingWrite" type="error" variant="tonal" density="compact" class="mb-3">写入挂起（现场单号 {{ store.pendingWrite.ticketId }}），设备编辑已冻结，恢复后才能继续。</v-alert>

    <div class="toolbar panel">
      <v-text-field v-model="query" label="搜索编号、名称、地址或分区" prepend-inner-icon="mdi-magnify" density="compact" hide-details style="max-width:330px" />
      <v-select v-model="floor" :items="['全部', ...floors]" label="楼层" density="compact" hide-details style="max-width:130px" />
      <v-spacer />
      <v-chip variant="tonal">共 {{ filtered.length }} 个点位</v-chip>
    </div>

    <div class="panel table-wrap">
      <table class="device-table">
        <thead><tr><th>点位编号</th><th>设备名称</th><th>类型</th><th>楼层</th><th>防火分区（改动触发重算）</th><th>回路地址</th><th>联动关系 / 路径状态</th></tr></thead>
        <tbody>
          <tr v-for="device in filtered" :key="device.id">
            <td class="mono">{{ device.id }}</td>
            <td><strong>{{ device.name }}</strong></td>
            <td><v-chip size="small" variant="outlined">{{ device.type }}</v-chip></td>
            <td>
              <v-select :model-value="device.floor" :items="floors" density="compact" hide-details style="width:96px" :disabled="store.locked || !!store.pendingWrite" @update:model-value="store.updateDevice(device.id, { floor: String($event) })" />
            </td>
            <td>
              <div class="zone-cell">
                <v-select :model-value="device.zone" :items="zones" density="compact" hide-details style="width:130px" :disabled="store.locked || !!store.pendingWrite" @update:model-value="store.updateDevice(device.id, { zone: String($event) })" />
                <v-chip v-if="store.paths.some((path) => (path.triggerId === device.id || path.actionId === device.id) && path.stale)" size="x-small" color="error" variant="tonal">路径已失效</v-chip>
              </div>
            </td>
            <td class="mono">{{ device.address }}</td>
            <td>
              <span>{{ affectedRules(device.id).length }} 条规则</span>
              <small v-for="rule in affectedRules(device.id)" :key="rule.id">
                <v-chip size="x-small" :color="store.paths.find((path) => path.ruleId === rule.id)?.stale ? 'error' : 'success'" variant="tonal">
                  {{ rule.id }} v{{ store.paths.find((path) => path.ruleId === rule.id)?.version ?? 1 }}
                </v-chip>
              </small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <v-dialog v-model="dialog" max-width="620">
      <v-card>
        <v-card-title>新增消防点位</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6"><v-text-field v-model="form.id" label="点位编号" /></v-col>
            <v-col cols="12" md="6"><v-select v-model="form.type" :items="types" label="设备类型" /></v-col>
            <v-col cols="12"><v-text-field v-model="form.name" label="设备名称" /></v-col>
            <v-col cols="6"><v-select v-model="form.floor" :items="floors" label="楼层" /></v-col>
            <v-col cols="6"><v-select v-model="form.zone" :items="zones" label="防火分区" /></v-col>
            <v-col cols="12"><v-text-field v-model="form.address" label="回路地址" placeholder="例如 2-B-01-03" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn @click="dialog=false">取消</v-btn><v-btn color="primary" @click="addDevice">保存点位</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 12px; }
.mono { color: #267078; font-family: ui-monospace,monospace; font-weight: 700; }
.table-wrap { overflow-x: auto; }
.device-table { width: 100%; border-collapse: collapse; min-width: 1000px; }
.device-table th { padding: 11px 10px; text-align: left; font-size: 12px; color: #5a686e; border-bottom: 1px solid #e4e9e9; white-space: nowrap; }
.device-table td { padding: 8px 10px; border-bottom: 1px solid #eef1f1; font-size: 13px; vertical-align: middle; }
td strong { font-size: 13px; }
.zone-cell { display: flex; align-items: center; gap: 8px; }
td small { display: inline-flex; gap: 4px; margin-left: 6px; }
</style>
