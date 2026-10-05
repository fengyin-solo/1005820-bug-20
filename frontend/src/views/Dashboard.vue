<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
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
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.key">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>拍门检修的「待处理」与检修台账、检修详情读同一份统一判定口径</span>
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { sluiceSummary } from '@/api/sluice-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])

function refresh() {
  const payload = loadOverview()
  // 拍门检修的待处理数走统一判定口径（sluiceSummary），
  // 与检修台账列表、检修详情读的是同一份结论，不在这里另算一套。
  const replacing = sluiceSummary().replacing
  const modules = payload.modules.map((item) =>
    item.key === 'sluice' ? { ...item, pending: replacing } : item,
  )
  moduleRows.value = modules
  cards.value = payload.cards.map((card) =>
    card.label === '待处理'
      ? { ...card, value: modules.reduce((sum, item) => sum + item.pending, 0) }
      : card,
  )
}

onMounted(refresh)
</script>
