<template>
  <section class="page" data-module="sluice">
    <header class="page-head">
      <div>
        <h2>拍门检修管理</h2>
        <p class="page-desc">
          列表、概览看板与检修详情共用同一份判定口径（v{{ rule.version }}，{{ rule.effectiveDate }} 生效）：
          {{ rule.sealRuleLabel }}；{{ rule.overdueRuleLabel }}。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记拍门检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出拍门检修清单</button>
      </div>
    </header>

    <div v-if="report && !reportDismissed" class="recalc-banner">
      <div class="recalc-head">
        <strong>判定口径已从 v{{ report.fromVersion }} 升级到 v{{ report.toVersion }}，挂着的 {{ report.recalculated }} 条工单已按新口径重算</strong>
        <button class="link" type="button" @click="dismissReport">知道了，收起</button>
      </div>
      <p class="recalc-summary">
        其中 <strong>{{ report.changed }}</strong> 条结论发生变化；待更换拍门数
        <strong :class="report.pendingReplacementAfter < report.pendingReplacementBefore ? 'diff-down' : 'diff-up'">
          {{ report.pendingReplacementBefore }} → {{ report.pendingReplacementAfter }}
        </strong>
      </p>
      <table class="data-table recalc-table">
        <thead>
          <tr><th>检修编号</th><th>泵站/拍门</th><th>密封状况</th><th>重算前（v{{ report.fromVersion }}）</th><th>重算后（v{{ report.toVersion }}）</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in report.items" :key="item.recordId" :class="{ 'row-changed': item.changed }">
            <td>{{ item.inspectNo }}</td>
            <td>{{ item.station }} {{ item.gateNo }}</td>
            <td>{{ item.seal || '未登记' }}</td>
            <td :class="item.before.verdict === '失效' ? 'verdict-fail' : ''">
              {{ item.before.verdict ?? '待判定' }}<span v-if="item.before.overdue" class="tag tag-overdue">超期</span>
            </td>
            <td :class="item.after.verdict === '失效' ? 'verdict-fail' : item.after.verdict === null ? 'verdict-pending' : 'verdict-ok'">
              {{ item.after.verdict ?? '待判定' }}<span v-if="item.after.overdue" class="tag tag-overdue">超期</span>
              <span v-if="item.changed" class="tag tag-changed">结论变更</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="recalc-note">已完工记录保留当时冻结的判定，未按新口径追溯改写。</p>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在档拍门（扇）</span>
        <strong class="stat-value">{{ stats.totalGates }}</strong>
      </article>
      <article class="stat-card" :class="{ 'stat-alert': stats.pendingReplacement > 0 }">
        <span class="stat-label">待更换（密封判失效）</span>
        <strong class="stat-value">{{ stats.pendingReplacement }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">状态正常</span>
        <strong class="stat-value">{{ stats.normal }}</strong>
      </article>
      <article class="stat-card" :class="{ 'stat-alert': stats.overdue > 0 }">
        <span class="stat-label">超期未检修（≥{{ rule.overdueDays }}天）</span>
        <strong class="stat-value">{{ stats.overdue }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">挂结工单</span>
        <strong class="stat-value">{{ stats.openTickets }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所属泵站</span>
        <input v-model="filters.station" placeholder="按泵站检索" />
      </label>
      <label class="filter-item">
        <span>拍门编号</span>
        <input v-model="filters.gateNo" placeholder="按拍门编号检索" />
      </label>
      <label class="filter-item">
        <span>检修人</span>
        <input v-model="filters.inspector" placeholder="按检修人检索" />
      </label>
      <label class="filter-item">
        <span>台账状态</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-check">
        <input v-model="filters.pendingReplacement" type="checkbox" />
        只看待更换
      </label>
      <label class="filter-check">
        <input v-model="filters.overdueOnly" type="checkbox" />
        只看超期
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>统一口径结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.inspectNo }}</td>
          <td>{{ row.station }}</td>
          <td>{{ row.gateNo }}</td>
          <td>
            {{ row.seal || '未登记' }}
            <span v-if="row.overdue" class="tag tag-overdue">超期</span>
          </td>
          <td>{{ row.method || '—' }}</td>
          <td>{{ row.inspector }}</td>
          <td>{{ row.inspectDate ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="!isOpenStatus(row.status)" class="tag tag-frozen">判定冻结 v{{ row.ruleVersion }}</span>
          </td>
          <td>
            <span v-if="isOpenStatus(row.status)">
              <span v-if="row.verdict === null" class="verdict-pending">待判定</span>
              <span v-else :class="row.verdict === '失效' ? 'verdict-fail' : 'verdict-ok'">
                {{ row.verdict === '失效' ? '失效·待更换' : '正常' }}
              </span>
            </span>
            <span v-else :class="row.verdict === '失效' ? 'verdict-fail' : 'verdict-ok'">
              {{ row.verdict === '失效' ? '失效·待更换' : '正常' }}
            </span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">检修详情</button>
            <button v-if="row.status === '待检修'" class="link" type="button" @click="startWork(row)">提交检修</button>
            <button v-if="isOpenStatus(row.status)" class="link" type="button" @click="openJudge(row)">提交判定</button>
            <button v-if="isOpenStatus(row.status)" class="link" type="button" @click="openEdit(row)">修改工单</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无拍门检修数据，可先登记拍门检修记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条工单 · 待更换名单由统一口径实时计算，与概览看板、检修详情同源</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记工单 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记拍门检修记录</h3>
        <form class="modal-form" @submit.prevent="submitCreate">
          <label>
            <span>所属泵站 *</span>
            <input v-model="createForm.station" placeholder="如：东湖泵站" />
          </label>
          <label>
            <span>拍门编号 *</span>
            <input v-model="createForm.gateNo" placeholder="同一泵站内不可重号" />
          </label>
          <label>
            <span>检修人 *</span>
            <input v-model="createForm.inspector" />
          </label>
          <label>
            <span>检修方式</span>
            <input v-model="createForm.method" placeholder="如：常规检查 / 密封检修" />
          </label>
          <label>
            <span>计划检修日期</span>
            <input v-model="createForm.inspectDate" type="date" />
          </label>
          <p v-if="createError" class="error-text">{{ createError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
            <button class="btn primary" type="submit">提交登记</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 修改挂结工单 -->
    <div v-if="editTarget" class="modal-mask" @click.self="editTarget = null">
      <div class="modal">
        <h3>修改工单 {{ editTarget.inspectNo }}</h3>
        <p class="modal-tip">
          正在改的是 v{{ editForm.baseVersion }} 版本；若 {{ editTarget.lastEditor }} 或其他人已先提交，
          后到的这一版会被挡回，只落先到的那一版。
        </p>
        <form class="modal-form" @submit.prevent="submitEdit">
          <label class="readonly-line">
            <span>所属泵站 / 拍门编号</span>
            <b>{{ editTarget.station }} {{ editTarget.gateNo }}（不可改，避免借编辑绕开重号校验）</b>
          </label>
          <label>
            <span>检修方式</span>
            <input v-model="editForm.method" />
          </label>
          <label>
            <span>检修人</span>
            <input v-model="editForm.inspector" />
          </label>
          <label>
            <span>检修日期</span>
            <input v-model="editForm.inspectDate" type="date" />
          </label>
          <p v-if="editError" class="error-text">{{ editError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="editTarget = null">取消</button>
            <button class="btn primary" type="submit">保存（版本 v{{ editForm.baseVersion }}）</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 提交判定 -->
    <div v-if="judgeTarget" class="modal-mask" @click.self="judgeTarget = null">
      <div class="modal">
        <h3>提交检修判定 · {{ judgeTarget.inspectNo }}</h3>
        <p class="modal-tip">
          {{ judgeTarget.station }} {{ judgeTarget.gateNo }} · 当前记录版本 v{{ judgeForm.baseVersion }}。
          结论不由人工填写，密封状况一登记就按统一口径 v{{ rule.version }} 计算并冻结。
        </p>
        <form class="modal-form" @submit.prevent="submitJudge">
          <label>
            <span>密封状况 *</span>
            <select v-model="judgeForm.seal">
              <option value="" disabled>请选择</option>
              <option v-for="seal in sealOptions" :key="seal" :value="seal">{{ seal }}</option>
            </select>
          </label>
          <label>
            <span>检修方式</span>
            <input v-model="judgeForm.method" />
          </label>
          <label>
            <span>检修日期 *</span>
            <input v-model="judgeForm.inspectDate" type="date" />
          </label>
          <div class="verdict-preview" v-if="judgeForm.seal">
            <span>按当前口径试算：</span>
            <strong :class="preview.verdict === '失效' ? 'verdict-fail' : 'verdict-ok'">
              {{ preview.verdict === '失效' ? '失效 → 进入待更换（需更换）' : '正常 → 状态正常' }}
            </strong>
            <span v-if="preview.overdue" class="tag tag-overdue">同时超期</span>
            <ul class="reason-list">
              <li v-for="reason in preview.reasons" :key="reason">{{ reason }}</li>
            </ul>
          </div>
          <p v-if="judgeError" class="error-text">{{ judgeError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="judgeTarget = null">取消</button>
            <button class="btn primary" type="submit">提交并冻结判定</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  acknowledgeRecalcReport,
  createSluiceRecord,
  downloadSluiceCsv,
  getRecalcReport,
  getSluiceRecord,
  getSluiceStats,
  isRecalcReportDismissed,
  judgeSluiceRecord,
  listSluiceRecords,
  previewSluiceVerdict,
  startSluiceInspection,
  updateSluiceRecord,
} from '@/api/sluice-service'
import { SLUICE_SEAL_OPTIONS, currentRule } from '@/data/sluice-rules'
import type { RecalcReport, SluiceRecord, SluiceStats } from '@/data/sluice-types'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const route = useRoute()
const router = useRouter()
const rule = currentRule()
const sealOptions = SLUICE_SEAL_OPTIONS
const columns = ['检修编号', '所属泵站', '拍门编号', '密封状况', '检修方式', '检修人', '检修日期', '拍门状态']
const statuses = ['待检修', '检修中', '状态正常', '需更换']

const rows = ref<SluiceRecord[]>([])
const total = ref(0)
const errorMessage = ref('')
const stats = ref<SluiceStats>({ totalGates: 0, pendingReplacement: 0, normal: 0, overdue: 0, openTickets: 0, totalRecords: 0 })
const filters = reactive({
  station: '',
  gateNo: '',
  inspector: '',
  status: '',
  pendingReplacement: false,
  overdueOnly: false,
})

const report = ref<RecalcReport | null>(null)
const reportDismissed = ref(false)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

function isOpenStatus(status: string): boolean {
  return status === '待检修' || status === '检修中'
}

function reload() {
  errorMessage.value = ''
  const payload = listSluiceRecords({
    station: filters.station,
    gateNo: filters.gateNo,
    inspector: filters.inspector,
    status: filters.status,
    pendingReplacement: filters.pendingReplacement,
    overdueOnly: filters.overdueOnly,
  })
  rows.value = payload.items
  total.value = payload.total
  stats.value = getSluiceStats()
}

function resetFilters() {
  filters.station = ''
  filters.gateNo = ''
  filters.inspector = ''
  filters.status = ''
  filters.pendingReplacement = false
  filters.overdueOnly = false
  reload()
}

function exportRows() {
  downloadSluiceCsv()
}

function dismissReport() {
  acknowledgeRecalcReport()
  reportDismissed.value = true
}

function openDetail(row: SluiceRecord) {
  router.push({ name: 'sluice-detail', params: { id: String(row.id) } })
}

function startWork(row: SluiceRecord) {
  const result = startSluiceInspection(row.id, session.operator || row.inspector)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// ---- 登记 ----
const createOpen = ref(false)
const createError = ref('')
const createForm = reactive({ station: '', gateNo: '', inspector: '', method: '', inspectDate: '' })

function openCreate() {
  createError.value = ''
  createForm.station = ''
  createForm.gateNo = ''
  createForm.inspector = ''
  createForm.method = ''
  createForm.inspectDate = ''
  createOpen.value = true
}

function submitCreate() {
  const result = createSluiceRecord({
    station: createForm.station,
    gateNo: createForm.gateNo,
    inspector: createForm.inspector,
    method: createForm.method,
    inspectDate: createForm.inspectDate || null,
  })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  reload()
}

// ---- 修改 ----
const editTarget = ref<SluiceRecord | null>(null)
const editError = ref('')
const editForm = reactive({ baseVersion: 0, method: '', inspector: '', inspectDate: '' })

function openEdit(row: SluiceRecord) {
  editError.value = ''
  editTarget.value = row
  editForm.baseVersion = row.version
  editForm.method = row.method
  editForm.inspector = row.inspector
  editForm.inspectDate = row.inspectDate ?? ''
}

function submitEdit() {
  if (!editTarget.value) {
    return
  }
  const result = updateSluiceRecord({
    id: editTarget.value.id,
    baseVersion: editForm.baseVersion,
    operator: editForm.inspector,
    method: editForm.method,
    inspectDate: editForm.inspectDate || null,
  })
  if (!result.ok) {
    editError.value = result.message
    return
  }
  editTarget.value = null
  reload()
}

// ---- 判定 ----
const judgeTarget = ref<SluiceRecord | null>(null)
const judgeError = ref('')
const judgeForm = reactive({ baseVersion: 0, seal: '', method: '', inspectDate: '' })

function openJudge(row: SluiceRecord) {
  judgeError.value = ''
  judgeTarget.value = row
  judgeForm.baseVersion = row.version
  judgeForm.seal = row.seal
  judgeForm.method = row.method
  judgeForm.inspectDate = row.inspectDate ?? new Date().toISOString().slice(0, 10)
}

const preview = computed(() =>
  previewSluiceVerdict(judgeForm.seal, judgeForm.inspectDate || null),
)

function submitJudge() {
  if (!judgeTarget.value) {
    return
  }
  const result = judgeSluiceRecord({
    id: judgeTarget.value.id,
    baseVersion: judgeForm.baseVersion,
    operator: judgeTarget.value.inspector,
    seal: judgeForm.seal,
    method: judgeForm.method,
    inspectDate: judgeForm.inspectDate,
  })
  if (!result.ok) {
    judgeError.value = result.message
    return
  }
  judgeTarget.value = null
  reload()
}

function handleRouteAction() {
  const action = route.query.action
  const id = Number(route.query.id)
  if (!action || !id) {
    return
  }
  const row = getSluiceRecord(id)
  if (!row) {
    return
  }
  if (action === 'judge' && isOpenStatus(row.status)) {
    openJudge(row)
  } else if (action === 'edit' && isOpenStatus(row.status)) {
    openEdit(row)
  }
  router.replace({ name: 'sluice' })
}

onMounted(() => {
  report.value = getRecalcReport()
  reportDismissed.value = isRecalcReportDismissed()
  reload()
  handleRouteAction()
})
</script>
