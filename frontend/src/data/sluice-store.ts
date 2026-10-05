import { buildSluiceSeed } from './sluice-seed'
import { CURRENT_RULE_VERSION, evaluateSluice } from './sluice-rules'
import type { GateState, RecalcReport, SluiceRecord, SluiceStats } from './sluice-types'

// 拍门检修数据独立存放，不再和其它模块共用一份通用台账，避免旧的错误口径数据混进来。
const STORAGE_KEY = 'drainage-pump:sluice:v2'
const META_KEY = 'drainage-pump:sluice:meta'

const OPEN_STATUSES: ReadonlyArray<SluiceRecord['status']> = ['待检修', '检修中']

export type SluiceSnapshot = {
  records: SluiceRecord[]
  ruleVersion: number
  recalcReport: RecalcReport | null
  reportDismissedAt: string | null
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function isOpen(record: Pick<SluiceRecord, 'status'>): boolean {
  return OPEN_STATUSES.includes(record.status)
}

function timeRank(record: SluiceRecord): number {
  const stamp = record.judgedAt ?? record.updatedAt
  const ms = Date.parse(stamp)
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * 扇拍门当前结论（全仓库唯一推导方式）。
 * 取时间上最新的一条记录：开放工单的实时结论优先；没有开放工单时用最近一次完工冻结结论。
 * 超期按当前口径实时算（超期不是失效，也不进待更换）。
 *
 * verdictVersion:
 * - 'current'（默认）：开放工单一律按当前口径实时算，完工记录读各自冻结判定 —— 列表/看板/详情用。
 * - 'stored'：全部读记录里缓存/冻结的结论，不实时重算 —— 口径重算前的快照用。
 */
export function deriveGateStates(
  records: SluiceRecord[],
  todayIso?: string,
  verdictVersion: 'current' | 'stored' = 'current',
): GateState[] {
  const today = todayIso ?? new Date().toISOString().slice(0, 10)
  const byGate = new Map<string, SluiceRecord[]>()
  for (const record of records) {
    const key = `${record.station}@@${record.gateNo}`
    const list = byGate.get(key) ?? []
    list.push(record)
    byGate.set(key, list)
  }

  const gates: GateState[] = []
  for (const list of byGate.values()) {
    const chronological = [...list].sort((a, b) => timeRank(a) - timeRank(b) || a.id - b.id)
    const latest = chronological[chronological.length - 1]
    const open = [...chronological].reverse().find((record) => isOpen(record))
    const decisive = open ?? latest

    // 超期只看这扇门最近一次检修日期，按当前生效口径实时算。
    const lastDated = [...chronological].reverse().find((record) => record.inspectDate !== null)
    const overdueEval = evaluateSluice(
      { seal: latest.seal || '密封良好', lastInspectDate: lastDated?.inspectDate ?? null, today },
      CURRENT_RULE_VERSION,
    )
    // 开放工单的结论不冻结：一律按当前口径实时算；完工记录才用当时冻结的判定。
    const liveVerdict =
      open && verdictVersion === 'current'
        ? evaluateSluice({ seal: open.seal, lastInspectDate: lastDated?.inspectDate ?? null, today }, CURRENT_RULE_VERSION)
        : null

    gates.push({
      station: latest.station,
      gateNo: latest.gateNo,
      verdict: open && verdictVersion === 'current' && liveVerdict ? liveVerdict.verdict : decisive.verdict,
      overdue: overdueEval.overdue,
      seal: decisive.seal,
      lastInspectDate: lastDated?.inspectDate ?? null,
      lastInspector: latest.inspector,
      latestRecordId: latest.id,
      latestStatus: latest.status,
      openTicketId: open?.id ?? null,
      replaced: !isOpen(latest) && latest.status === '状态正常' && chronological.some((r) => r.status === '需更换'),
    })
  }
  return gates.sort((a, b) => a.station.localeCompare(b.station, 'zh') || a.gateNo.localeCompare(b.gateNo))
}

export function sluiceStats(
  records: SluiceRecord[],
  todayIso?: string,
  verdictVersion: 'current' | 'stored' = 'current',
): SluiceStats {
  const gates = deriveGateStates(records, todayIso, verdictVersion)
  return {
    totalGates: gates.length,
    // 待更换只认「密封判失效」这一份结论；状态正常的、未判定的一律不进。
    pendingReplacement: gates.filter((gate) => gate.verdict === '失效').length,
    normal: gates.filter((gate) => gate.verdict === '正常').length,
    overdue: gates.filter((gate) => gate.overdue).length,
    openTickets: gates.filter((gate) => gate.openTicketId !== null).length,
    totalRecords: records.length,
  }
}

function applyCurrentRule(record: SluiceRecord, today: string) {
  return evaluateSluice({ seal: record.seal, lastInspectDate: record.inspectDate, today }, CURRENT_RULE_VERSION)
}

/**
 * 口径升级重算：只动「正在挂着」（待检修/检修中）且缓存版本落后的工单。
 * 已完工记录的历史判定原样保留，不按新口径追溯改写。
 */
function recalcOpenRecords(freshSeed: SluiceRecord[], today: string): SluiceSnapshot {
  // 重算前快照：读记录里缓存的旧口径结论（不实时重算），这样「前后差异」才真实。
  const beforeStats = sluiceStats(freshSeed, today, 'stored')
  const stale = freshSeed.filter((record) => isOpen(record) && record.ruleVersion < CURRENT_RULE_VERSION)
  const fromVersion = stale.reduce((max, record) => Math.max(max, record.ruleVersion), 0) || CURRENT_RULE_VERSION

  const items = stale.map((record) => {
    const after = applyCurrentRule(record, today)
    return {
      recordId: record.id,
      inspectNo: record.inspectNo,
      station: record.station,
      gateNo: record.gateNo,
      seal: record.seal,
      before: {
        verdict: record.verdict,
        sealFailed: record.sealFailed,
        overdue: record.overdue,
        ruleVersion: record.ruleVersion,
      },
      after: {
        verdict: after.verdict,
        sealFailed: after.sealFailed,
        overdue: after.overdue,
        ruleVersion: after.ruleVersion,
      },
      changed:
        record.verdict !== after.verdict || record.sealFailed !== after.sealFailed || record.overdue !== after.overdue,
      beforeReasons: record.reasons,
      afterReasons: after.reasons,
    }
  })

  const records = freshSeed.map((record) => {
    if (!isOpen(record) || record.ruleVersion >= CURRENT_RULE_VERSION) {
      return record
    }
    const after = applyCurrentRule(record, today)
    return {
      ...record,
      ruleVersion: CURRENT_RULE_VERSION,
      verdict: after.verdict,
      sealFailed: after.sealFailed,
      overdue: after.overdue,
      reasons: after.reasons,
    }
  })

  const afterStats = sluiceStats(records, today)
  const report: RecalcReport = {
    fromVersion,
    toVersion: CURRENT_RULE_VERSION,
    ranAt: new Date().toISOString(),
    recalculated: stale.length,
    changed: items.filter((item) => item.changed).length,
    pendingReplacementBefore: beforeStats.pendingReplacement,
    pendingReplacementAfter: afterStats.pendingReplacement,
    items,
  }
  return { records, ruleVersion: CURRENT_RULE_VERSION, recalcReport: report, reportDismissedAt: null }
}

function writeSnapshot(snapshot: SluiceSnapshot): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

function seedSnapshot(): SluiceSnapshot {
  const seed = buildSluiceSeed()
  // 示例数据的挂结工单停留在旧口径当天（2026-10-05），按这一天重算差异，与业务时间线一致。
  return recalcOpenRecords(seed, '2026-10-05')
}

function readSnapshot(): SluiceSnapshot {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedSnapshot()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const snapshot = seedSnapshot()
    writeSnapshot(snapshot)
    return snapshot
  }
  try {
    const parsed = JSON.parse(raw) as SluiceSnapshot
    if (!Array.isArray(parsed.records)) {
      throw new Error('bad snapshot')
    }
    // 代码里的当前口径再次升级时，存量挂结工单再重算一次，历史完工记录不动。
    if (parsed.ruleVersion < CURRENT_RULE_VERSION) {
      const today = new Date().toISOString().slice(0, 10)
      const next = recalcOpenRecords(clone(parsed.records), today)
      writeSnapshot(next)
      return next
    }
    return {
      records: parsed.records,
      ruleVersion: parsed.ruleVersion,
      recalcReport: parsed.recalcReport ?? null,
      reportDismissedAt: parsed.reportDismissedAt ?? null,
    }
  } catch {
    const snapshot = seedSnapshot()
    writeSnapshot(snapshot)
    return snapshot
  }
}

let cache: SluiceSnapshot | null = null

export function loadSluice(): SluiceSnapshot {
  if (cache === null) {
    cache = readSnapshot()
  }
  return cache
}

export function persistSluice(records: SluiceRecord[]): SluiceSnapshot {
  const current = loadSluice()
  const snapshot: SluiceSnapshot = {
    records,
    ruleVersion: CURRENT_RULE_VERSION,
    recalcReport: current.recalcReport,
    reportDismissedAt: current.reportDismissedAt,
  }
  cache = snapshot
  writeSnapshot(snapshot)
  return snapshot
}

export function dismissRecalcReport(): void {
  const current = loadSluice()
  const snapshot = { ...current, reportDismissedAt: new Date().toISOString() }
  cache = snapshot
  writeSnapshot(snapshot)
}

export function resetSluice(): SluiceSnapshot {
  const snapshot = seedSnapshot()
  cache = snapshot
  writeSnapshot(snapshot)
  return snapshot
}

// META_KEY 预留给未来扩展（如按泵站配置），先记录键位避免各处散落硬编码。
export { META_KEY }
