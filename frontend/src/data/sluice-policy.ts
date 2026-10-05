import type { EntryRow } from './types'

// 拍门检修的判定口径：全系统只有这一份。
// 列表、概览看板、检修详情读到的「是否待更换」都由这里的 judgeSluice 算出，
// 任何页面不允许自己另写一套。口径可以调整，每次调整版本号 +1；
// 已结案（状态正常）的记录保留结案当时的判定快照，不按新口径追溯改写。

export type SluicePolicy = {
  version: number
  failedSeals: string[] // 密封状况含这些词即判失效
  overdueDays: number // 距上次检修超过这么多天判超期
  updatedAt: string
}

export const DEFAULT_SLUICE_POLICY: SluicePolicy = {
  version: 1,
  failedSeals: ['老化', '破损', '失效'],
  overdueDays: 180,
  updatedAt: '2026-10-01',
}

export type SluiceVerdict = {
  failed: boolean // 密封失效
  overdue: boolean // 超期未检
  needReplace: boolean // 失效或超期 → 待更换
  reasons: string[]
  policyVersion: number
}

const POLICY_STORAGE_KEY = 'drainage-pump:sluice-policy'

export function getSluicePolicy(): SluicePolicy {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_SLUICE_POLICY }
  }
  const raw = window.localStorage.getItem(POLICY_STORAGE_KEY)
  if (!raw) {
    return { ...DEFAULT_SLUICE_POLICY }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SluicePolicy>
    return {
      version: Number(parsed.version ?? DEFAULT_SLUICE_POLICY.version),
      failedSeals:
        Array.isArray(parsed.failedSeals) && parsed.failedSeals.length > 0
          ? parsed.failedSeals.map(String)
          : [...DEFAULT_SLUICE_POLICY.failedSeals],
      overdueDays: Number(parsed.overdueDays ?? DEFAULT_SLUICE_POLICY.overdueDays),
      updatedAt: String(parsed.updatedAt ?? DEFAULT_SLUICE_POLICY.updatedAt),
    }
  } catch {
    return { ...DEFAULT_SLUICE_POLICY }
  }
}

export function saveSluicePolicy(policy: SluicePolicy): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(policy))
  }
}

export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 距上次检修的天数；日期缺失或认不出来返回 null
export function daysSinceInspection(dateStr: string, today: Date): number | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateStr.trim())
  if (!match) {
    return null
  }
  const then = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((now.getTime() - then.getTime()) / 86400000)
}

// 统一判定：密封失效或检修超期，命中任一即进入待更换。
export function judgeSluice(
  row: EntryRow,
  policy: SluicePolicy,
  today: Date = new Date(),
): SluiceVerdict {
  const reasons: string[] = []
  const seal = String(row['密封状况'] ?? '').trim()
  const failed = seal !== '' && policy.failedSeals.some((word) => seal.includes(word))
  if (failed) {
    reasons.push(`密封状况「${seal}」达到失效标准（${policy.failedSeals.join('、')}）`)
  }
  const days = daysSinceInspection(String(row['检修日期'] ?? ''), today)
  let overdue = false
  if (days === null) {
    overdue = true
    reasons.push('检修日期缺失或无法识别，按超期处理')
  } else if (days > policy.overdueDays) {
    overdue = true
    reasons.push(`距上次检修 ${days} 天，超过 ${policy.overdueDays} 天上限`)
  }
  if (reasons.length === 0) {
    reasons.push('密封状况与检修周期均在标准内')
  }
  return {
    failed,
    overdue,
    needReplace: failed || overdue,
    reasons,
    policyVersion: policy.version,
  }
}
