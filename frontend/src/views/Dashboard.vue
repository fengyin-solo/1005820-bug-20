<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。拍门检修指标与列表、检修详情同读一份判定口径。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="sluice-board">
      <div class="board-head">
        <h3>拍门检修 · 统一口径结论（v{{ sluice.ruleVersion }}，{{ rule.effectiveDate }} 生效）</h3>
        <RouterLink class="link" :to="{ name: 'sluice' }">进入拍门检修 →</RouterLink>
      </div>
      <p class="rule-text">{{ rule.sealRuleLabel }}；{{ rule.overdueRuleLabel }}。</p>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">在档拍门（扇）</span>
          <strong class="stat-value">{{ sluice.totalGates }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-alert': sluice.pendingReplacement > 0 }">
          <span class="stat-label">待更换（密封判失效）</span>
          <strong class="stat-value">{{ sluice.pendingReplacement }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">状态正常</span>
          <strong class="stat-value">{{ sluice.normal }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-alert': sluice.overdue > 0 }">
          <span class="stat-label">超期未检修</span>
          <strong class="stat-value">{{ sluice.overdue }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">挂结工单</span>
          <strong class="stat-value">{{ sluice.openTickets }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>所属泵站</th><th>拍门编号</th><th>当前结论</th><th>密封状况</th><th>最近检修</th><th>检修人</th></tr>
        </thead>
        <tbody>
          <tr v-for="gate in pendingGates" :key="`${gate.station}-${gate.gateNo}`">
            <td>{{ gate.station }}</td>
            <td>{{ gate.gateNo }}</td>
            <td><span class="verdict-fail">失效 · 待更换</span></td>
            <td>{{ gate.seal || '未登记' }}</td>
            <td>{{ gate.lastInspectDate ?? '从无检修记录' }}<span v-if="gate.overdue" class="tag tag-overdue">超期</span></td>
            <td>{{ gate.lastInspector }}</td>
          </tr>
          <tr v-if="!pendingGates.length">
            <td colspan="6" class="empty-state">当前没有密封判失效的拍门，待更换名单为空</td>
          </tr>
        </tbody>
      </table>
    </section>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { currentRule, loadOverview } from '@/api/local-service'
import { listPendingReplacementGates } from '@/api/sluice-service'
import type { OverviewResult } from '@/data/types'
import type { GateState } from '@/data/sluice-types'

const rule = currentRule()
const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const sluice = ref<OverviewResult['sluice']>({
  totalGates: 0,
  pendingReplacement: 0,
  normal: 0,
  overdue: 0,
  openTickets: 0,
  ruleVersion: 0,
})
const pendingGates = ref<GateState[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  sluice.value = payload.sluice
  pendingGates.value = listPendingReplacementGates()
}

onMounted(refresh)
</script>
