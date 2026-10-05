/**
 * 拍门检修判定口径（全仓库唯一一份）。
 *
 * 列表、概览看板、检修详情都只能从这份规则读结论，不允许在页面或服务里再各写一套判断。
 * - 密封状况达到什么程度算失效：见 RULES[*].failedSeals
 * - 多久没检修算超期：见 RULES[*].overdueDays
 *
 * 规则带版本号。旧版本只用于解释/还原历史记录当时的判定，不追溯改写历史；
 * CURRENT_RULE_VERSION 是当前生效口径，正在挂着的记录按它重算。
 */

export type SluiceSeal = '密封良好' | '轻微渗漏' | '明显渗漏' | '严重泄漏'
export type SluiceVerdict = '正常' | '失效'
export type SluiceStatus = '待检修' | '检修中' | '状态正常' | '需更换'

export type RuleBook = {
  version: number
  effectiveDate: string
  sealRuleLabel: string
  overdueRuleLabel: string
  /** 落在这个集合里的密封状况一律判失效；其余（含轻微渗漏）判正常。 */
  failedSeals: SluiceSeal[]
  /** 距最近一次检修日期超过该天数即算超期未检修。 */
  overdueDays: number
}

export const SLUICE_SEAL_OPTIONS: SluiceSeal[] = ['密封良好', '轻微渗漏', '明显渗漏', '严重泄漏']

/**
 * 口径演进历史，按版本升序。v1 是此前各处各判各的时期最终统一下来的旧口径，
 * v2 收紧：轻微渗漏不再直接判失效。
 */
export const RULES: RuleBook[] = [
  {
    version: 1,
    effectiveDate: '2025-01-01',
    sealRuleLabel: '密封状况为「明显渗漏」「严重泄漏」或「轻微渗漏」即判失效',
    overdueRuleLabel: '距最近一次检修超过 180 天（含）判超期',
    failedSeals: ['轻微渗漏', '明显渗漏', '严重泄漏'],
    overdueDays: 180,
  },
  {
    version: 2,
    effectiveDate: '2026-10-01',
    sealRuleLabel: '密封状况为「明显渗漏」或「严重泄漏」判失效；轻微渗漏、密封良好判正常',
    overdueRuleLabel: '距最近一次检修超过 180 天（含）判超期',
    failedSeals: ['明显渗漏', '严重泄漏'],
    overdueDays: 180,
  },
]

export const CURRENT_RULE_VERSION = RULES[RULES.length - 1].version

export function ruleBook(version: number = CURRENT_RULE_VERSION): RuleBook {
  const found = RULES.find((rule) => rule.version === version)
  if (!found) {
    throw new Error(`没有版本号为 ${version} 的拍门判定口径`)
  }
  return found
}

export function currentRule(): RuleBook {
  return ruleBook(CURRENT_RULE_VERSION)
}

/** 入参只取判定真正依赖的字段，避免页面传入整行记录后再偷偷加别的判断。 */
export type SluiceFacts = {
  seal: string
  /** 最近一次检修日期，YYYY-MM-DD；没有检修记录传 null。 */
  lastInspectDate: string | null
  /** 评估基准日，默认取当天，测试/重算时可显式传入。 */
  today?: string
}

export type SluiceEvaluation = {
  /** 密封状况尚未登记（待检修工单）时为 null，表示「待判定」，不允许猜成正常。 */
  verdict: SluiceVerdict | null
  assessed: boolean
  sealFailed: boolean
  overdue: boolean
  reasons: string[]
  ruleVersion: number
}

export const KNOWN_SEALS: string[] = ['密封良好', '轻微渗漏', '明显渗漏', '严重泄漏']

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime()
  const to = new Date(`${toIso}T00:00:00Z`).getTime()
  return Math.floor((to - from) / 86400000)
}

/** 统一判定入口：密封失效 + 检修超期，全部由这里算，列表/看板/详情共用。 */
export function evaluateSluice(facts: SluiceFacts, version: number = CURRENT_RULE_VERSION): SluiceEvaluation {
  const rule = ruleBook(version)
  const today = facts.today ?? new Date().toISOString().slice(0, 10)
  const assessed = KNOWN_SEALS.includes(facts.seal)
  const sealFailed = assessed && rule.failedSeals.includes(facts.seal as SluiceSeal)
  const elapsedDays = facts.lastInspectDate === null ? null : daysBetween(facts.lastInspectDate, today)
  const overdue = facts.lastInspectDate === null ? true : (elapsedDays ?? 0) >= rule.overdueDays

  const reasons: string[] = []
  if (!assessed) {
    reasons.push('密封状况尚未登记，结论待判定')
  } else if (sealFailed) {
    reasons.push(`密封状况「${facts.seal}」按口径 v${rule.version} 判失效`)
  } else {
    reasons.push(`密封状况「${facts.seal}」未达到失效线，按口径 v${rule.version} 判正常`)
  }
  if (overdue) {
    reasons.push(
      facts.lastInspectDate === null
        ? `从无检修记录，按口径 v${rule.version} 判超期`
        : `最近检修 ${facts.lastInspectDate}，距今 ${elapsedDays} 天 ≥ ${rule.overdueDays} 天，判超期`,
    )
  }
  return {
    verdict: assessed ? (sealFailed ? '失效' : '正常') : null,
    assessed,
    sealFailed,
    overdue,
    reasons,
    ruleVersion: rule.version,
  }
}

/** 判定冻结成哪个台账状态：只有密封判失效才进「需更换」，超期本身不进。 */
export function verdictToStatus(verdict: SluiceVerdict): SluiceStatus {
  return verdict === '失效' ? '需更换' : '状态正常'
}
