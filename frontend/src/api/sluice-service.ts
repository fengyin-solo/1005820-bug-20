import {
  deriveGateStates,
  dismissRecalcReport,
  isOpen,
  loadSluice,
  persistSluice,
  resetSluice,
  sluiceStats,
} from '@/data/sluice-store'
import {
  CURRENT_RULE_VERSION,
  KNOWN_SEALS,
  SLUICE_SEAL_OPTIONS,
  currentRule,
  evaluateSluice,
  ruleBook,
  verdictToStatus,
} from '@/data/sluice-rules'
import type { GateState, RecalcReport, SluiceRecord, SluiceStats } from '@/data/sluice-types'

export type ServiceResult<T = SluiceRecord> = { ok: true; data: T; message: string } | { ok: false; message: string }

export type SluiceFilters = {
  station?: string
  gateNo?: string
  inspector?: string
  status?: string
  /** 只看待更换（密封判失效）的拍门。 */
  pendingReplacement?: boolean
  /** 只看超期未检修的拍门。 */
  overdueOnly?: boolean
}

export type NewSluiceInput = {
  station: string
  gateNo: string
  method?: string
  inspector: string
  inspectDate?: string | null
}

export type EditSluiceInput = {
  id: number
  /** 调用方读取记录时的版本号；与库内不一致说明已有别人的改动先落库了。 */
  baseVersion: number
  operator: string
  method?: string
  inspector?: string
  inspectDate?: string | null
}

export type JudgeSluiceInput = {
  id: number
  baseVersion: number
  operator: string
  seal: string
  method?: string
  inspectDate?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function nextInspectNo(records: SluiceRecord[]): string {
  const max = records.reduce((maxValue, record) => {
    const matched = /^SLUI-(\d+)$/.exec(record.inspectNo)
    return matched ? Math.max(maxValue, Number(matched[1])) : maxValue
  }, 0)
  return `SLUI-${String(max + 1).padStart(4, '0')}`
}

function findOpenCollision(
  records: SluiceRecord[],
  station: string,
  gateNo: string,
  excludeId?: number,
): SluiceRecord | undefined {
  return records.find(
    (record) =>
      record.id !== excludeId &&
      record.station === station.trim() &&
      record.gateNo === gateNo.trim() &&
      isOpen(record),
  )
}

function decorateLive(record: SluiceRecord): SluiceRecord {
  // 开放工单展示时按当前口径实时算一遍，保证页面看到的就是统一口径的结论；
  // 完工记录直接读当时冻结的判定，不重算、不改写。
  if (!isOpen(record)) {
    return record
  }
  const live = evaluateSluice(
    { seal: record.seal, lastInspectDate: record.inspectDate },
    CURRENT_RULE_VERSION,
  )
  return {
    ...record,
    verdict: live.verdict,
    sealFailed: live.sealFailed,
    overdue: live.overdue,
    reasons: live.reasons,
    ruleVersion: CURRENT_RULE_VERSION,
  }
}

function getRecord(records: SluiceRecord[], id: number): SluiceRecord | undefined {
  return records.find((record) => record.id === id)
}

export function listSluiceRecords(filters: SluiceFilters = {}): { items: SluiceRecord[]; total: number } {
  const { records } = loadSluice()
  const gates = deriveGateStates(records)
  const gateByRecord = new Map<number, GateState>()
  for (const gate of gates) {
    gateByRecord.set(gate.latestRecordId, gate)
  }

  let items = records.map(decorateLive)
  if (filters.station?.trim()) {
    const keyword = filters.station.trim()
    items = items.filter((record) => record.station.includes(keyword))
  }
  if (filters.gateNo?.trim()) {
    const keyword = filters.gateNo.trim()
    items = items.filter((record) => record.gateNo.includes(keyword))
  }
  if (filters.inspector?.trim()) {
    const keyword = filters.inspector.trim()
    items = items.filter((record) => record.inspector.includes(keyword))
  }
  if (filters.status) {
    items = items.filter((record) => record.status === filters.status)
  }
  if (filters.pendingReplacement) {
    // 待更换只按「扇拍门的当前统一结论」过滤，避免历史失效工单混入、已更换的残留。
    items = items.filter((record) => gateByRecord.get(record.id)?.verdict === '失效')
  }
  if (filters.overdueOnly) {
    items = items.filter((record) => gateByRecord.get(record.id)?.overdue)
  }
  items = items.sort((a, b) => b.id - a.id)
  return { items, total: items.length }
}

export function getSluiceRecord(id: number): SluiceRecord | null {
  const { records } = loadSluice()
  const record = getRecord(records, id)
  return record ? decorateLive(record) : null
}

export function getGate(station: string, gateNo: string): GateState | null {
  const { records } = loadSluice()
  return (
    deriveGateStates(records).find(
      (gate) => gate.station === station.trim() && gate.gateNo === gateNo.trim(),
    ) ?? null
  )
}

export function listGates(): GateState[] {
  return deriveGateStates(loadSluice().records)
}

export function listPendingReplacementGates(): GateState[] {
  // 统一口径：只有当前结论为「失效」的拍门进入待更换，正常/未判定/已更换的一律不混入。
  return listGates().filter((gate) => gate.verdict === '失效')
}

export function listOverdueGates(): GateState[] {
  return listGates().filter((gate) => gate.overdue)
}

export function getSluiceStats(): SluiceStats {
  return sluiceStats(loadSluice().records)
}

/** 登记一张待检修工单。同一泵站下拍门编号重号且旧工单还挂着时，直接挡回并指出撞了谁。 */
export function createSluiceRecord(input: NewSluiceInput): ServiceResult {
  const station = input.station.trim()
  const gateNo = input.gateNo.trim()
  const inspector = input.inspector.trim()
  if (!station || !gateNo || !inspector) {
    return { ok: false, message: '所属泵站、拍门编号、检修人为必填项' }
  }
  const { records } = loadSluice()
  const collision = findOpenCollision(records, station, gateNo)
  if (collision) {
    return {
      ok: false,
      message: `拍门编号撞号：${station} 下「${gateNo}」已有挂着的检修工单 ${collision.inspectNo}（${collision.status}，检修人 ${collision.inspector}），请先处理该工单，不能重复登记`,
    }
  }

  const record: SluiceRecord = {
    id: records.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    inspectNo: nextInspectNo(records),
    station,
    gateNo,
    seal: '',
    method: input.method?.trim() ?? '',
    inspector,
    inspectDate: input.inspectDate ?? null,
    status: '待检修',
    version: 1,
    ruleVersion: CURRENT_RULE_VERSION,
    verdict: null,
    sealFailed: false,
    overdue: false,
    reasons: ['密封状况尚未登记，结论待判定'],
    judgedAt: null,
    lastEditor: inspector,
    updatedAt: nowIso(),
  }
  const live = evaluateSluice({ seal: '', lastInspectDate: record.inspectDate }, CURRENT_RULE_VERSION)
  record.overdue = live.overdue
  record.reasons = live.reasons
  persistSluice([...records, record])
  return { ok: true, data: record, message: `已登记待检修工单 ${record.inspectNo}` }
}

export function startSluiceInspection(id: number, operator: string): ServiceResult {
  const { records } = loadSluice()
  const index = records.findIndex((record) => record.id === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的检修工单` }
  }
  const record = records[index]
  if (record.status !== '待检修') {
    return { ok: false, message: `工单 ${record.inspectNo} 当前是「${record.status}」，不能开工` }
  }
  const updated: SluiceRecord = {
    ...record,
    status: '检修中',
    version: record.version + 1,
    lastEditor: operator.trim() || record.lastEditor,
    updatedAt: nowIso(),
  }
  const next = [...records]
  next[index] = updated
  persistSluice(next)
  return { ok: true, data: updated, message: `工单 ${updated.inspectNo} 已开工` }
}

/**
 * 提交检修判定：密封状况一登记，结论完全由统一口径算（明显渗漏/严重泄漏判失效→需更换），
 * 页面不能手工指定结论。完工判定当场冻结，之后口径再改也不追溯这条记录。
 */
export function judgeSluiceRecord(input: JudgeSluiceInput): ServiceResult {
  if (!KNOWN_SEALS.includes(input.seal)) {
    return { ok: false, message: `密封状况必须是：${SLUICE_SEAL_OPTIONS.join('、')}` }
  }
  const { records } = loadSluice()
  const index = records.findIndex((record) => record.id === input.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${input.id} 的检修工单` }
  }
  const record = records[index]
  if (record.version !== input.baseVersion) {
    return {
      ok: false,
      message: `提交冲突：工单 ${record.inspectNo} 已被 ${record.lastEditor} 先提交了一版（当前版本 v${record.version}，你基于的是 v${input.baseVersion}），请刷新后在最新版本上重新提交`,
    }
  }
  if (!isOpen(record)) {
    return { ok: false, message: `工单 ${record.inspectNo} 已是「${record.status}」，判定已冻结，不能重复提交` }
  }

  const inspectDate = input.inspectDate ?? record.inspectDate ?? new Date().toISOString().slice(0, 10)
  const evaluation = evaluateSluice(
    { seal: input.seal, lastInspectDate: inspectDate },
    CURRENT_RULE_VERSION,
  )
  const stamp = nowIso()
  const updated: SluiceRecord = {
    ...record,
    seal: input.seal,
    method: input.method?.trim() ?? record.method,
    inspector: input.operator.trim() || record.inspector,
    inspectDate,
    status: verdictToStatus(evaluation.verdict ?? '正常'),
    version: record.version + 1,
    ruleVersion: CURRENT_RULE_VERSION,
    verdict: evaluation.verdict,
    sealFailed: evaluation.sealFailed,
    overdue: evaluation.overdue,
    reasons: evaluation.reasons,
    judgedAt: stamp,
    lastEditor: input.operator.trim() || record.lastEditor,
    updatedAt: stamp,
  }
  const next = [...records]
  next[index] = updated
  persistSluice(next)
  return {
    ok: true,
    data: updated,
    message: `工单 ${updated.inspectNo} 判定完成：${evaluation.verdict === '失效' ? '失效，进入待更换' : '状态正常'}（口径 v${CURRENT_RULE_VERSION}）`,
  }
}

/** 两位检修工同时改同一扇拍门的挂结工单时，只落带着最新版本号先到的那一版。 */
export function updateSluiceRecord(input: EditSluiceInput): ServiceResult {
  const { records } = loadSluice()
  const index = records.findIndex((record) => record.id === input.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${input.id} 的检修工单` }
  }
  const record = records[index]
  if (record.version !== input.baseVersion) {
    return {
      ok: false,
      message: `提交冲突：工单 ${record.inspectNo} 已被 ${record.lastEditor} 改动并先落库（当前版本 v${record.version}，你基于的是 v${input.baseVersion}），请刷新后重试，后到的这一版未落库`,
    }
  }
  if (!isOpen(record)) {
    return { ok: false, message: `工单 ${record.inspectNo} 已完工冻结，历史判定不能修改` }
  }

  const inspectDate = input.inspectDate === undefined ? record.inspectDate : input.inspectDate
  const updated: SluiceRecord = {
    ...record,
    method: input.method === undefined ? record.method : input.method.trim(),
    inspector: input.inspector?.trim() || record.inspector,
    inspectDate,
    version: record.version + 1,
    lastEditor: input.operator.trim() || record.lastEditor,
    updatedAt: nowIso(),
  }
  const live = evaluateSluice({ seal: updated.seal, lastInspectDate: inspectDate }, CURRENT_RULE_VERSION)
  updated.verdict = live.verdict
  updated.sealFailed = live.sealFailed
  updated.overdue = live.overdue
  updated.reasons = live.reasons
  updated.ruleVersion = CURRENT_RULE_VERSION

  const next = [...records]
  next[index] = updated
  persistSluice(next)
  return { ok: true, data: updated, message: `工单 ${updated.inspectNo} 已保存（v${updated.version}）` }
}

export function getRecalcReport(): RecalcReport | null {
  return loadSluice().recalcReport
}

/** 判定表单里的实时试算：让检修工提交前看到按当前口径会落成什么结论，但不能手工改结论。 */
export function previewSluiceVerdict(seal: string, inspectDate: string | null) {
  return evaluateSluice({ seal, lastInspectDate: inspectDate }, CURRENT_RULE_VERSION)
}

export function isRecalcReportDismissed(): boolean {
  const snapshot = loadSluice()
  return snapshot.recalcReport !== null && snapshot.reportDismissedAt !== null && snapshot.reportDismissedAt >= snapshot.recalcReport.ranAt
}

export function acknowledgeRecalcReport(): void {
  dismissRecalcReport()
}

export function exportSluiceCsv(): { filename: string; content: string } {
  const { records } = loadSluice()
  const gates = deriveGateStates(records)
  const gateKey = (station: string, gateNo: string) => `${station}@@${gateNo}`
  const verdictByGate = new Map(gates.map((gate) => [gateKey(gate.station, gate.gateNo), gate]))
  const header = ['检修编号', '所属泵站', '拍门编号', '密封状况', '检修方式', '检修人', '检修日期', '台账状态', '统一口径结论', '是否超期', '判定口径版本']
  const lines = [header.join(',')]
  for (const record of [...records].sort((a, b) => a.id - b.id).map(decorateLive)) {
    const gate = verdictByGate.get(gateKey(record.station, record.gateNo))
    const verdictText = isOpen(record)
      ? record.verdict === null ? '待判定' : record.verdict
      : record.verdict
    lines.push(
      [
        record.inspectNo,
        record.station,
        record.gateNo,
        record.seal || '未登记',
        record.method,
        record.inspector,
        record.inspectDate ?? '',
        record.status,
        verdictText ?? '待判定',
        gate?.overdue ? '超期' : '未超期',
        `v${record.ruleVersion}`,
      ].join(','),
    )
  }
  return { filename: '拍门检修-清单.csv', content: `\uFEFF${lines.join('\n')}` }
}

export function downloadSluiceCsv(): void {
  const { filename, content } = exportSluiceCsv()
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

export function resetSluiceData(): void {
  resetSluice()
}

export { currentRule, ruleBook, CURRENT_RULE_VERSION }
