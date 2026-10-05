<template>
  <section class="page" data-module="sluice">
    <header class="page-head">
      <div>
        <h2>拍门检修管理</h2>
        <p class="page-desc">
          维护拍门检修记录，围绕检修编号、所属泵站、拍门编号、密封状况做登记、筛选与状态流转。判定口径全系统统一，列表、看板与详情读同一份结论。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记拍门检修记录</button>
        <button class="btn" type="button" @click="openPolicy">判定口径</button>
        <button class="btn" type="button" @click="exportRows">导出拍门检修清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card emphasis">
        <span class="stat-label">待更换拍门（统一判定）</span>
        <strong class="stat-value">{{ summary.replacing }}</strong>
      </article>
      <article v-for="item in statusStats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="policy-banner">
      判定口径 v{{ policy.version }}：密封状况含「{{ policy.failedSeals.join('、') }}」判失效；距上次检修超
      {{ policy.overdueDays }} 天判超期；失效或超期即进入待更换。
      <span class="policy-updated">最近调整：{{ policy.updatedAt }}</span>
    </p>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>判定结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr>
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>
              <span class="verdict-tag" :class="row.replacing ? 'danger' : 'ok'">
                {{ row.replacing ? '待更换' : '正常' }}
              </span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="toggleDetail(row)">详情</button>
              <button v-if="isOpen(row)" class="link" type="button" @click="openEdit(row)">编辑</button>
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="detail && Number(detail.row.id) === Number(row.id)" class="detail-row">
            <td :colspan="columns.length + 3">
              <div class="detail-panel">
                <h3>检修详情 · {{ detail.row['检修编号'] }}</h3>
                <dl>
                  <div>
                    <dt>判定结论</dt>
                    <dd>
                      <span class="verdict-tag" :class="detail.row.replacing ? 'danger' : 'ok'">
                        {{ detail.row.replacing ? '待更换' : '正常' }}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>判定理由</dt>
                    <dd>{{ detail.reasons.join('；') || '—' }}</dd>
                  </div>
                  <div>
                    <dt>判定口径</dt>
                    <dd>v{{ detail.policyVersion }}（当前口径 v{{ detail.policy.version }}）</dd>
                  </div>
                  <div>
                    <dt>记录版本</dt>
                    <dd>v{{ detail.row.revision ?? 1 }}</dd>
                  </div>
                </dl>
                <p v-if="!isOpen(detail.row)" class="detail-note">
                  该记录已结案，判定快照保留结案时的口径，不随后续口径调整改写。
                </p>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无拍门检修数据，可先登记拍门检修记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条拍门检修记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>

    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal">
        <h3>{{ editing.id === null ? '登记拍门检修记录' : `编辑 ${editing.检修编号}` }}</h3>
        <form class="modal-form" @submit.prevent="submitEdit">
          <label class="form-item">
            <span>所属泵站</span>
            <input v-model="editing.form.所属泵站" placeholder="如：城东泵站" />
          </label>
          <label class="form-item">
            <span>拍门编号</span>
            <input v-model="editing.form.拍门编号" placeholder="如：PM-03" />
          </label>
          <label class="form-item">
            <span>密封状况</span>
            <select v-model="editing.form.密封状况">
              <option v-for="option in sealOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>检修方式</span>
            <input v-model="editing.form.检修方式" placeholder="如：日常保养" />
          </label>
          <label class="form-item">
            <span>检修人</span>
            <input v-model="editing.form.检修人" placeholder="检修人姓名" />
          </label>
          <label class="form-item">
            <span>检修日期</span>
            <input v-model="editing.form.检修日期" type="date" />
          </label>
          <p v-if="editing.id !== null" class="form-note">
            手里拿的是版本 v{{ editing.revision }}；若提交时这条记录已被他人改动，本次提交会被挡回，只落先到的那一版。
          </p>
          <p v-if="editError" class="error-text">{{ editError }}</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="editing = null">取消</button>
            <button class="btn primary" type="submit">提交</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="policyEditing" class="modal-mask" @click.self="policyEditing = false">
      <div class="modal">
        <h3>判定口径（当前 v{{ policy.version }}）</h3>
        <form class="modal-form" @submit.prevent="submitPolicy">
          <label class="form-item">
            <span>失效密封状况（顿号或逗号分隔）</span>
            <input v-model="policyForm.failedSeals" placeholder="如：老化、破损、失效" />
          </label>
          <label class="form-item">
            <span>超期天数（距上次检修超过即判超期）</span>
            <input v-model="policyForm.overdueDays" type="number" min="1" />
          </label>
          <p class="form-note">
            保存后正在挂着的记录立即按新口径重算并列出差异；已结案记录保留当时的判定，不追溯改写。
          </p>
          <p v-if="policyError" class="error-text">{{ policyError }}</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="policyEditing = false">取消</button>
            <button class="btn primary" type="submit">保存口径并重算</button>
          </div>
        </form>
        <div v-if="policyResult" class="recalc-result">
          <p>{{ policyResult.message }}</p>
          <table v-if="policyResult.diffs.length" class="data-table">
            <thead>
              <tr>
                <th>检修编号</th>
                <th>所属泵站</th>
                <th>拍门编号</th>
                <th>重算前</th>
                <th>重算后</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="diff in policyResult.diffs" :key="diff.检修编号">
                <td>{{ diff.检修编号 }}</td>
                <td>{{ diff.所属泵站 }}</td>
                <td>{{ diff.拍门编号 }}</td>
                <td>{{ diff.before ? '待更换' : '正常' }}</td>
                <td :class="diff.after ? 'diff-danger' : 'diff-ok'">{{ diff.after ? '待更换' : '正常' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else>在挂记录的判定结论都没有变化。</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  SEAL_OPTIONS,
  createSluice,
  downloadSluice,
  getSluiceDetail,
  listSluice,
  runSluiceAction,
  sluiceSummary,
  updateSluice,
  updateSluicePolicy,
  type PolicyRecalcDiff,
  type SluiceDetail,
  type SluiceInput,
} from '@/api/sluice-service'
import { formatDate, getSluicePolicy, type SluicePolicy } from '@/data/sluice-policy'
import type { EntryRow } from '@/data/types'

const columns = ['检修编号', '所属泵站', '拍门编号', '密封状况', '检修方式', '检修人', '检修日期', '拍门状态']
const filterFields = columns.slice(0, 3)
const statuses = ['待检修', '检修中', '状态正常', '需更换']
const sealOptions = SEAL_OPTIONS

// 各状态下可执行的动作；结案（状态正常）后没有动作
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  待检修: ['提交检修', '判定正常', '提出更换'],
  检修中: ['判定正常', '提出更换'],
  需更换: ['判定正常'],
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const policy = ref<SluicePolicy>(getSluicePolicy())
const summary = ref<{ total: number; replacing: number; byStatus: Record<string, number> }>({
  total: 0,
  replacing: 0,
  byStatus: {},
})
const detail = ref<SluiceDetail | null>(null)

const statusStats = computed(() => [
  { label: '待检修拍门', value: summary.value.byStatus['待检修'] ?? 0 },
  { label: '状态正常拍门', value: summary.value.byStatus['状态正常'] ?? 0 },
  { label: '需更换拍门', value: summary.value.byStatus['需更换'] ?? 0 },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: summary.value.byStatus[status] ?? 0 })),
)

function isOpen(row: EntryRow): boolean {
  return String(row.status) !== '状态正常'
}

function actionsFor(row: EntryRow): string[] {
  return ACTIONS_BY_STATUS[String(row.status)] ?? []
}

function toggleDetail(row: EntryRow) {
  if (detail.value && Number(detail.value.row.id) === Number(row.id)) {
    detail.value = null
    return
  }
  detail.value = getSluiceDetail(Number(row.id))
}

type Editing = {
  id: number | null
  检修编号: string
  revision: number
  form: SluiceInput
}

const editing = ref<Editing | null>(null)
const editError = ref('')

function blankForm(): SluiceInput {
  return {
    所属泵站: '',
    拍门编号: '',
    密封状况: '良好',
    检修方式: '',
    检修人: '',
    检修日期: formatDate(new Date()),
  }
}

function openCreate() {
  editError.value = ''
  editing.value = { id: null, 检修编号: '', revision: 0, form: blankForm() }
}

function openEdit(row: EntryRow) {
  editError.value = ''
  editing.value = {
    id: Number(row.id),
    检修编号: String(row['检修编号'] ?? ''),
    revision: Number(row.revision ?? 1),
    form: {
      所属泵站: String(row['所属泵站'] ?? ''),
      拍门编号: String(row['拍门编号'] ?? ''),
      密封状况: String(row['密封状况'] ?? '良好'),
      检修方式: String(row['检修方式'] ?? ''),
      检修人: String(row['检修人'] ?? ''),
      检修日期: String(row['检修日期'] ?? ''),
    },
  }
}

function submitEdit() {
  const current = editing.value
  if (!current) {
    return
  }
  editError.value = ''
  const result =
    current.id === null
      ? createSluice(current.form)
      : updateSluice(current.id, current.form, current.revision)
  if (!result.ok) {
    // 重号、并发冲突都挡在这里；刷新列表让人看到别人先落的那版
    editError.value = result.message
    reload()
    return
  }
  noticeMessage.value = result.message
  editing.value = null
  reload()
}

const policyEditing = ref(false)
const policyForm = ref({ failedSeals: '', overdueDays: 180 })
const policyError = ref('')
const policyResult = ref<{ message: string; diffs: PolicyRecalcDiff[] } | null>(null)

function openPolicy() {
  const current = getSluicePolicy()
  policyForm.value = { failedSeals: current.failedSeals.join('、'), overdueDays: current.overdueDays }
  policyError.value = ''
  policyResult.value = null
  policyEditing.value = true
}

function submitPolicy() {
  policyError.value = ''
  const failedSeals = policyForm.value.failedSeals
    .split(/[、,，\s]+/)
    .map((word) => word.trim())
    .filter(Boolean)
  const result = updateSluicePolicy({ failedSeals, overdueDays: Number(policyForm.value.overdueDays) })
  if (!result.ok) {
    policyError.value = result.message
    return
  }
  policy.value = getSluicePolicy()
  policyResult.value = { message: result.message, diffs: result.diffs ?? [] }
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadSluice()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = runSluiceAction(Number(row.id), action, Number(row.revision ?? 1))
  if (!result.ok) {
    errorMessage.value = result.message
    reload()
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listSluice(filters.value)
    rows.value = payload.items
    total.value = payload.total
    summary.value = sluiceSummary()
    policy.value = getSluicePolicy()
    if (detail.value) {
      detail.value = getSluiceDetail(Number(detail.value.row.id))
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '拍门检修列表读取失败'
  }
}

onMounted(reload)
</script>
