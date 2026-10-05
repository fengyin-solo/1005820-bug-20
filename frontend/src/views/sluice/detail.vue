<template>
  <section class="page" data-module="sluice-detail" v-if="record">
    <header class="page-head">
      <div>
        <h2>检修详情 · {{ record.inspectNo }}</h2>
        <p class="page-desc">
          {{ record.station }} {{ record.gateNo }} · 结论与列表、概览看板同源（统一口径 v{{ rule.version }}）。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回拍门检修列表</button>
      </div>
    </header>

    <div class="detail-grid">
      <article class="detail-card">
        <h3>工单信息</h3>
        <dl class="detail-list">
          <dt>检修编号</dt><dd>{{ record.inspectNo }}</dd>
          <dt>所属泵站</dt><dd>{{ record.station }}</dd>
          <dt>拍门编号</dt><dd>{{ record.gateNo }}</dd>
          <dt>检修方式</dt><dd>{{ record.method || '—' }}</dd>
          <dt>检修人</dt><dd>{{ record.inspector }}</dd>
          <dt>检修日期</dt><dd>{{ record.inspectDate ?? '—' }}</dd>
          <dt>台账状态</dt><dd>{{ record.status }}</dd>
          <dt>记录版本</dt><dd>v{{ record.version }}（最近改动：{{ record.lastEditor }}）</dd>
        </dl>
      </article>

      <article class="detail-card">
        <h3>判定结论</h3>
        <p class="verdict-line" v-if="open">
          <span class="muted">开放工单 · 按当前口径 v{{ rule.version }} 实时计算：</span>
          <span v-if="record.verdict === null" class="verdict-pending">待判定（密封状况尚未登记）</span>
          <span v-else :class="record.verdict === '失效' ? 'verdict-fail' : 'verdict-ok'">
            {{ record.verdict === '失效' ? '失效 · 在待更换名单' : '状态正常 · 不在待更换名单' }}
          </span>
          <span v-if="record.overdue" class="tag tag-overdue">超期未检修</span>
        </p>
        <p class="verdict-line" v-else>
          <span class="muted">已完工 · 历史判定（{{ record.judgedAt }} 按口径 v{{ record.ruleVersion }} 冻结）：</span>
          <span :class="record.verdict === '失效' ? 'verdict-fail' : 'verdict-ok'">
            {{ record.verdict === '失效' ? '失效 · 当时进入待更换' : '状态正常' }}
          </span>
        </p>
        <ul class="reason-list">
          <li v-for="reason in record.reasons" :key="reason">{{ reason }}</li>
        </ul>
        <div class="detail-actions" v-if="open">
          <button v-if="record.status === '待检修'" class="btn" type="button" @click="startWork">提交检修（开工）</button>
          <button class="btn primary" type="button" @click="goJudge">提交判定</button>
          <button class="btn" type="button" @click="goEdit">修改工单</button>
        </div>
        <p v-else class="muted small">历史判定不随口径升级追溯改写；如需新结论，请对该拍门登记新的检修工单。</p>
      </article>

      <article class="detail-card">
        <h3>这扇拍门的当前结论</h3>
        <dl class="detail-list" v-if="gate">
          <dt>当前统一结论</dt>
          <dd>
            <span v-if="gate.verdict === null" class="verdict-pending">待判定</span>
            <span v-else :class="gate.verdict === '失效' ? 'verdict-fail' : 'verdict-ok'">
              {{ gate.verdict === '失效' ? '失效 · 在待更换名单' : '正常 · 不在待更换名单' }}
            </span>
            <span v-if="gate.replaced" class="tag tag-replaced">已更换复检</span>
          </dd>
          <dt>是否超期</dt>
          <dd>{{ gate.overdue ? `超期（口径：≥${rule.overdueDays} 天）` : '未超期' }}</dd>
          <dt>最近检修日期</dt><dd>{{ gate.lastInspectDate ?? '从无检修记录' }}</dd>
          <dt>最近检修人</dt><dd>{{ gate.lastInspector }}</dd>
          <dt>挂结工单</dt><dd>{{ gate.openTicketId ? `#${gate.openTicketId}` : '无' }}</dd>
        </dl>
      </article>
    </div>

    <h3 class="history-title">该拍门全部检修记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>检修编号</th><th>密封状况</th><th>检修日期</th><th>检修人</th><th>台账状态</th><th>当时结论</th><th>口径版本</th><th>判定时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in history" :key="item.id" :class="{ 'row-current': item.id === record.id }">
          <td>{{ item.inspectNo }}</td>
          <td>{{ item.seal || '未登记' }}<span v-if="item.overdue" class="tag tag-overdue">超期</span></td>
          <td>{{ item.inspectDate ?? '—' }}</td>
          <td>{{ item.inspector }}</td>
          <td>{{ item.status }}</td>
          <td>
            <span v-if="isOpen(item.status)" :class="item.verdict === '失效' ? 'verdict-fail' : item.verdict === null ? 'verdict-pending' : 'verdict-ok'">
              {{ item.verdict === null ? '待判定（实时口径）' : item.verdict === '失效' ? '失效（实时口径）' : '正常（实时口径）' }}
            </span>
            <span v-else :class="item.verdict === '失效' ? 'verdict-fail' : 'verdict-ok'">
              {{ item.verdict === '失效' ? '失效（历史冻结）' : '正常（历史冻结）' }}
            </span>
          </td>
          <td>v{{ item.ruleVersion }}</td>
          <td>{{ item.judgedAt ? item.judgedAt.slice(0, 16).replace('T', ' ') : '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section v-else class="page">
    <p class="error-text">没有找到这条检修工单。</p>
    <button class="btn" type="button" @click="goBack">返回列表</button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import {
  getGate,
  getSluiceRecord,
  listSluiceRecords,
  startSluiceInspection,
} from '@/api/sluice-service'
import { currentRule } from '@/data/sluice-rules'
import type { GateState, SluiceRecord } from '@/data/sluice-types'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const rule = currentRule()

const record = ref<SluiceRecord | null>(null)
const gate = ref<GateState | null>(null)

const open = computed(() => record.value !== null && (record.value.status === '待检修' || record.value.status === '检修中'))

const history = computed<SluiceRecord[]>(() => {
  if (!record.value) {
    return []
  }
  // 详情页的历史表也走同一份服务读取，确保看到的实时结论与列表、看板一致。
  return getAllForGate(record.value.station, record.value.gateNo)
})

function getAllForGate(station: string, gateNo: string): SluiceRecord[] {
  // 复用列表接口按泵站+编号过滤（开放工单结论在服务内已按当前口径实时装饰）。
  const payload = listSluiceRecords({ station, gateNo })
  return payload.items
    .filter((item) => item.station === station && item.gateNo === gateNo)
    .sort((a, b) => b.id - a.id)
}

function isOpen(status: string): boolean {
  return status === '待检修' || status === '检修中'
}

function load() {
  const id = Number(route.params.id)
  record.value = Number.isFinite(id) ? getSluiceRecord(id) : null
  gate.value = record.value ? getGate(record.value.station, record.value.gateNo) : null
}

function goBack() {
  router.push({ name: 'sluice' })
}

function goJudge() {
  if (!record.value) {
    return
  }
  const target: RouteLocationRaw = { name: 'sluice', query: { action: 'judge', id: String(record.value.id) } }
  router.push(target)
}

function goEdit() {
  if (!record.value) {
    return
  }
  router.push({ name: 'sluice', query: { action: 'edit', id: String(record.value.id) } })
}

function startWork() {
  if (!record.value) {
    return
  }
  const result = startSluiceInspection(record.value.id, session.operator || record.value.inspector)
  if (!result.ok) {
    window.alert(result.message)
    return
  }
  load()
}

onMounted(load)
</script>
