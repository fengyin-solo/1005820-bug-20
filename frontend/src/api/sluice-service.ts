import { listRows, listRowsFresh, saveRows } from '@/data/local-store'
import {
  formatDate,
  getSluicePolicy,
  judgeSluice,
  saveSluicePolicy,
  type SluicePolicy,
  type SluiceVerdict,
} from '@/data/sluice-policy'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'
import { filterRows } from './local-service'

// 拍门检修专用服务：统一判定、重号校验、并发控制、口径重算都收口在这里，
// 页面只负责渲染。判定口径本身在 src/data/sluice-policy.ts，全系统一份。

const KEY = 'sluice'
const CLOSED_STATUS = '状态正常'
const REPLACE_STATUS = '需更换'

// 状态机：结案（状态正常）后不再接受任何动作，历史判定保留；
// 需更换 → 判定正常 就是「更换完成」的结案路径，换过的拍门由此退出待更换
const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  提交检修: { from: ['待检修'], to: '检修中' },
  判定正常: { from: ['待检修', '检修中', REPLACE_STATUS], to: CLOSED_STATUS },
  提出更换: { from: ['待检修', '检修中'], to: REPLACE_STATUS },
}

export const SEAL_OPTIONS = ['良好', '磨损', '老化', '破损', '失效']

export type SluiceInput = {
  所属泵站: string
  拍门编号: string
  密封状况: string
  检修方式: string
  检修人: string
  检修日期: string
}

export type SluiceDetail = {
  row: EntryRow
  reasons: string[]
  policyVersion: number
  policy: SluicePolicy
}

export type PolicyRecalcDiff = {
  检修编号: string
  所属泵站: string
  拍门编号: string
  before: boolean
  after: boolean
}

// 待更换标记的唯一出口：结案（状态正常）的一律排除，已经换过的不得残留；
// 人工提出更换（需更换）的一律在列；其余在挂记录按统一口径判。
function deriveReplacing(row: EntryRow, judged: Pick<SluiceVerdict, 'needReplace'>): boolean {
  if (String(row.status) === CLOSED_STATUS) {
    return false
  }
  if (String(row.status) === REPLACE_STATUS) {
    return true
  }
  return judged.needReplace
}

// 老数据没有 revision / replacing 等字段，读取时按当前口径补齐，
// 保证老记录也落在同一份判定上。
function normalizeRows(
  rows: EntryRow[],
  policy: SluicePolicy,
  today: Date,
): { rows: EntryRow[]; changed: boolean } {
  let changed = false
  const next = rows.map((row) => {
    if (typeof row.revision === 'number' && typeof row.replacing === 'boolean') {
      return row
    }
    changed = true
    const judged = judgeSluice(row, policy, today)
    const replacing = deriveReplacing(row, judged)
    return {
      ...row,
      revision: Number(row.revision ?? 1),
      replacing,
      pending: replacing,
      verdictReasons: String(row.verdictReasons ?? judged.reasons.join('；')),
      policyVersion: Number(row.policyVersion ?? judged.policyVersion),
      拍门状态: replacing ? '待更换' : '正常',
    }
  })
  return { rows: next, changed }
}

function loadNormalized(): EntryRow[] {
  const { rows, changed } = normalizeRows(listRows(KEY), getSluicePolicy(), new Date())
  if (changed) {
    saveRows(KEY, rows)
  }
  return rows
}

// 写操作专用：绕开内存缓存读最新版本，两位检修工同时提交时才能看出谁先谁后
function loadNormalizedFresh(): EntryRow[] {
  const { rows } = normalizeRows(listRowsFresh(KEY), getSluicePolicy(), new Date())
  return rows
}

export function listSluice(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(loadNormalized(), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情与列表读同一行记录上的同一份判定结论，不存在两套算法
export function getSluiceDetail(id: number): SluiceDetail | null {
  const row = loadNormalized().find((item) => Number(item.id) === id)
  if (!row) {
    return null
  }
  return {
    row,
    reasons: String(row.verdictReasons ?? '')
      .split('；')
      .filter(Boolean),
    policyVersion: Number(row.policyVersion ?? 1),
    policy: getSluicePolicy(),
  }
}

// 看板统计：待更换数就是 replacing 标记的条数，与列表、详情同源
export function sluiceSummary(): {
  total: number
  replacing: number
  byStatus: Record<string, number>
} {
  const rows = loadNormalized()
  const byStatus: Record<string, number> = {}
  for (const row of rows) {
    const status = String(row.status)
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  return {
    total: rows.length,
    replacing: rows.filter((row) => row.replacing === true).length,
    byStatus,
  }
}

function trimInput(input: SluiceInput): SluiceInput {
  return {
    所属泵站: input.所属泵站.trim(),
    拍门编号: input.拍门编号.trim(),
    密封状况: input.密封状况.trim(),
    检修方式: input.检修方式.trim(),
    检修人: input.检修人.trim(),
    检修日期: input.检修日期.trim(),
  }
}

function validateInput(input: SluiceInput): string | null {
  if (!input.所属泵站) return '所属泵站不能为空'
  if (!input.拍门编号) return '拍门编号不能为空'
  if (!input.密封状况) return '密封状况不能为空'
  if (!input.检修人) return '检修人不能为空'
  if (!input.检修日期) return '检修日期不能为空'
  return null
}

// 同一泵站下拍门编号不能重号；撞了就把撞上的那条指出来
function findClash(rows: EntryRow[], input: SluiceInput, excludeId?: number): EntryRow | undefined {
  return rows.find(
    (row) =>
      Number(row.id) !== excludeId &&
      String(row['所属泵站']) === input.所属泵站 &&
      String(row['拍门编号']) === input.拍门编号,
  )
}

function clashMessage(input: SluiceInput, clash: EntryRow): string {
  return `拍门编号「${input.拍门编号}」在「${input.所属泵站}」已经登记过，撞上检修编号 ${clash['检修编号']}（检修人 ${clash['检修人']}，当前状态 ${clash.status}），同一泵站下拍门编号不能重号`
}

function revisionConflict(current: EntryRow, expectedRevision: number): ActionResult | null {
  const revision = Number(current.revision ?? 1)
  if (revision !== expectedRevision) {
    return {
      ok: false,
      message: `记录 ${current['检修编号']} 已被他人抢先改动（当前版本 v${revision}，你手里是 v${expectedRevision}），先到的那版已生效，请刷新后重试`,
    }
  }
  return null
}

export function createSluice(rawInput: SluiceInput): ActionResult & { id?: number } {
  const input = trimInput(rawInput)
  const invalid = validateInput(input)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  // 读最新数据再校验：两人同时登记同一拍门，先到的落库，后到的在这里被挡
  const rows = loadNormalizedFresh()
  const clash = findClash(rows, input)
  if (clash) {
    return { ok: false, message: clashMessage(input, clash) }
  }
  const policy = getSluicePolicy()
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const maxSeq = rows.reduce((max, row) => {
    const match = /^SLUI-(\d+)$/.exec(String(row['检修编号'] ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const row: EntryRow = {
    id,
    status: '待检修',
    pending: false,
    abnormal: false,
    revision: 1,
    检修编号: `SLUI-${String(maxSeq + 1).padStart(4, '0')}`,
    ...input,
  }
  const judged = judgeSluice(row, policy, new Date())
  row.replacing = judged.needReplace
  row.pending = judged.needReplace
  row.verdictReasons = judged.reasons.join('；')
  row.policyVersion = judged.policyVersion
  row['拍门状态'] = judged.needReplace ? '待更换' : '正常'
  saveRows(KEY, [...rows, row])
  return {
    ok: true,
    message: judged.needReplace
      ? `检修记录 ${row['检修编号']} 已登记，按口径 v${policy.version} 判定为待更换`
      : `检修记录 ${row['检修编号']} 已登记，判定正常`,
    id,
  }
}

export function updateSluice(
  id: number,
  rawInput: SluiceInput,
  expectedRevision: number,
): ActionResult {
  const input = trimInput(rawInput)
  const invalid = validateInput(input)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  const rows = loadNormalizedFresh()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的拍门检修记录` }
  }
  const current = rows[index]
  const conflict = revisionConflict(current, expectedRevision)
  if (conflict) {
    return conflict
  }
  if (String(current.status) === CLOSED_STATUS) {
    return {
      ok: false,
      message: `记录 ${current['检修编号']} 已结案，历史判定保留当时口径，不能再编辑`,
    }
  }
  const clash = findClash(rows, input, id)
  if (clash) {
    return { ok: false, message: clashMessage(input, clash) }
  }
  const policy = getSluicePolicy()
  const next: EntryRow = { ...current, ...input, revision: Number(current.revision ?? 1) + 1 }
  const judged = judgeSluice(next, policy, new Date())
  next.replacing = deriveReplacing(next, judged)
  next.pending = Boolean(next.replacing)
  next.verdictReasons = judged.reasons.join('；')
  next.policyVersion = policy.version
  next['拍门状态'] = next.replacing ? '待更换' : '正常'
  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(KEY, nextRows)
  return { ok: true, message: `检修记录 ${next['检修编号']} 已更新（版本 v${next.revision}）` }
}

export function runSluiceAction(id: number, action: string, expectedRevision: number): ActionResult {
  const transition = TRANSITIONS[action]
  if (!transition) {
    return { ok: false, message: `拍门检修没有登记「${action}」这个动作` }
  }
  const rows = loadNormalizedFresh()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的拍门检修记录` }
  }
  const current = rows[index]
  const conflict = revisionConflict(current, expectedRevision)
  if (conflict) {
    return conflict
  }
  const status = String(current.status)
  if (!transition.from.includes(status)) {
    return { ok: false, message: `记录 ${current['检修编号']} 当前状态「${status}」，不能执行「${action}」` }
  }
  const policy = getSluicePolicy()
  const today = new Date()
  const next: EntryRow = {
    ...current,
    status: transition.to,
    revision: Number(current.revision ?? 1) + 1,
  }
  if (transition.to === CLOSED_STATUS) {
    // 结案：判定快照冻结，之后口径调整不再追溯这条；
    // 结案当天就是最近一次检修（或更换完成）的日子
    const judged = judgeSluice(next, policy, today)
    next.replacing = false
    next.pending = false
    next['拍门状态'] = '正常'
    next['检修日期'] = formatDate(today)
    next.verdictReasons = `${formatDate(today)} 结案（口径 v${policy.version}）：${judged.reasons.join('；')}`
    next.policyVersion = policy.version
  } else if (transition.to === REPLACE_STATUS) {
    next.replacing = true
    next.pending = true
    next['拍门状态'] = '待更换'
    next.verdictReasons = `${formatDate(today)} 人工提出更换（口径 v${policy.version}）`
    next.policyVersion = policy.version
  } else {
    // 在挂流转：按当前口径重算
    const judged = judgeSluice(next, policy, today)
    next.replacing = judged.needReplace
    next.pending = judged.needReplace
    next['拍门状态'] = judged.needReplace ? '待更换' : '正常'
    next.verdictReasons = judged.reasons.join('；')
    next.policyVersion = policy.version
  }
  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(KEY, nextRows)
  return {
    ok: true,
    message: `检修记录 ${next['检修编号']} 已${action}，当前状态「${transition.to}」`,
  }
}

// 调整口径：版本号 +1，正在挂着的记录（待检修/检修中/需更换）按新口径重算一次，
// 重算前后的差异逐条返回；已结案记录保留当时的判定，不追溯改写。
export function updateSluicePolicy(patch: {
  failedSeals: string[]
  overdueDays: number
}): ActionResult & { policy?: SluicePolicy; diffs?: PolicyRecalcDiff[] } {
  const failedSeals = patch.failedSeals.map((word) => word.trim()).filter(Boolean)
  if (failedSeals.length === 0) {
    return { ok: false, message: '失效密封状况至少保留一项' }
  }
  const overdueDays = Math.floor(Number(patch.overdueDays))
  if (!Number.isFinite(overdueDays) || overdueDays <= 0) {
    return { ok: false, message: '超期天数要是大于 0 的整数' }
  }
  const current = getSluicePolicy()
  const next: SluicePolicy = {
    version: current.version + 1,
    failedSeals,
    overdueDays,
    updatedAt: formatDate(new Date()),
  }
  const rows = loadNormalizedFresh()
  const today = new Date()
  const diffs: PolicyRecalcDiff[] = []
  let recalculated = 0
  const nextRows = rows.map((row) => {
    if (String(row.status) === CLOSED_STATUS) {
      return row // 历史记录保留当时的判定
    }
    recalculated += 1
    const before = Boolean(row.replacing)
    const judged = judgeSluice(row, next, today)
    const after = deriveReplacing(row, judged)
    if (before !== after) {
      diffs.push({
        检修编号: String(row['检修编号']),
        所属泵站: String(row['所属泵站']),
        拍门编号: String(row['拍门编号']),
        before,
        after,
      })
    }
    return {
      ...row,
      replacing: after,
      pending: after,
      verdictReasons:
        String(row.status) === REPLACE_STATUS
          ? String(row.verdictReasons ?? '')
          : judged.reasons.join('；'),
      policyVersion: next.version,
      revision: Number(row.revision ?? 1) + 1,
      拍门状态: after ? '待更换' : '正常',
    }
  })
  saveRows(KEY, nextRows)
  saveSluicePolicy(next)
  return {
    ok: true,
    message:
      diffs.length === 0
        ? `口径已更新到 v${next.version}，${recalculated} 条在挂记录按新口径重算，判定结论均无变化`
        : `口径已更新到 v${next.version}，${recalculated} 条在挂记录按新口径重算，其中 ${diffs.length} 条判定发生变化`,
    policy: next,
    diffs,
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportSluice(): { filename: string; content: string } {
  const rows = loadNormalized()
  const header = [
    '编号',
    '检修编号',
    '所属泵站',
    '拍门编号',
    '密封状况',
    '检修方式',
    '检修人',
    '检修日期',
    '拍门状态',
    '当前状态',
    '判定结论',
    '判定理由',
    '判定口径版本',
  ]
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row['检修编号'],
        row['所属泵站'],
        row['拍门编号'],
        row['密封状况'],
        row['检修方式'],
        row['检修人'],
        row['检修日期'],
        row['拍门状态'],
        row.status,
        row.replacing ? '待更换' : '正常',
        row.verdictReasons,
        row.policyVersion,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '拍门检修-清单.csv', content: `\uFEFF${lines.join('\n')}` }
}

export function downloadSluice(): void {
  const { filename, content } = exportSluice()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
