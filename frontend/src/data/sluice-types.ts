import type { SluiceStatus, SluiceVerdict } from './sluice-rules'

/**
 * 拍门检修台账记录。一条记录 = 一扇拍门的一次检修工单。
 *
 * 结论字段的约定：
 * - finalized（状态正常/需更换）：verdict* 是完工当时按 ruleVersion 口径冻结的历史判定，永不追溯改写。
 * - 未挂结（待检修/检修中）：不冻结结论，verdict* 只缓存最近一次按 ruleVersion 口径算出的结果，
 *   口径升级时会被重算覆盖。
 */
export type SluiceRecord = {
  id: number
  inspectNo: string
  station: string
  gateNo: string
  seal: string
  method: string
  inspector: string
  inspectDate: string | null
  status: SluiceStatus
  /** 乐观锁版本：每次落库改动 +1。两位检修工同时提交时，只接受带着最新版本号的那一版。 */
  version: number
  /** 本次记录判定所依据/缓存的规则版本；完工冻结后不再变。 */
  ruleVersion: number
  verdict: SluiceVerdict | null
  sealFailed: boolean
  overdue: boolean
  reasons: string[]
  /** 完工冻结判定的时间；未挂结为 null。 */
  judgedAt: string | null
  /** 最近一次改动的检修工：并发提交被挡回时用来指出「谁的版本先落了」。 */
  lastEditor: string
  updatedAt: string
}

/** 一扇拍门的当前结论：列表、看板、详情都只能读这个结构。 */
export type GateState = {
  station: string
  gateNo: string
  verdict: SluiceVerdict | null
  overdue: boolean
  seal: string
  lastInspectDate: string | null
  lastInspector: string
  /** 得出当前结论的那条记录（开放工单优先于历史完工记录）。 */
  latestRecordId: number
  latestStatus: SluiceStatus
  openTicketId: number | null
  replaced: boolean
}

export type SluiceStats = {
  totalGates: number
  pendingReplacement: number
  normal: number
  overdue: number
  openTickets: number
  totalRecords: number
}

export type RecalcItem = {
  recordId: number
  inspectNo: string
  station: string
  gateNo: string
  seal: string
  before: { verdict: SluiceVerdict | null; sealFailed: boolean; overdue: boolean; ruleVersion: number }
  after: { verdict: SluiceVerdict | null; sealFailed: boolean; overdue: boolean; ruleVersion: number }
  changed: boolean
  beforeReasons: string[]
  afterReasons: string[]
}

export type RecalcReport = {
  fromVersion: number
  toVersion: number
  ranAt: string
  recalculated: number
  changed: number
  pendingReplacementBefore: number
  pendingReplacementAfter: number
  items: RecalcItem[]
}
