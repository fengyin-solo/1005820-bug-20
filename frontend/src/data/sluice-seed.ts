import { evaluateSluice } from './sluice-rules'
import type { SluiceRecord } from './sluice-types'

// 拍门检修示例数据的基准日：与「今天」固定对齐，保证超期示例在当前环境下可复现。
const SEED_TODAY = '2026-10-05'

type SeedInput = {
  id: number
  inspectNo: string
  station: string
  gateNo: string
  seal: string
  method: string
  inspector: string
  inspectDate: string | null
  status: SluiceRecord['status']
  ruleVersion: number
  judgedAt: string | null
}

const INPUTS: SeedInput[] = [
  // 东湖泵站
  { id: 1, inspectNo: 'SLUI-0001', station: '东湖泵站', gateNo: 'PM-01', seal: '密封良好', method: '常规检查', inspector: '王强', inspectDate: '2026-09-20', status: '状态正常', ruleVersion: 1, judgedAt: '2026-09-20T10:00:00+08:00' },
  // 挂着的工单：旧口径下轻微渗漏判失效，新口径改为正常——重算差异的典型。
  { id: 2, inspectNo: 'SLUI-0002', station: '东湖泵站', gateNo: 'PM-02', seal: '轻微渗漏', method: '密封检修', inspector: '李敏', inspectDate: '2026-09-28', status: '检修中', ruleVersion: 1, judgedAt: null },
  { id: 6, inspectNo: 'SLUI-0006', station: '东湖泵站', gateNo: 'PM-03', seal: '严重泄漏', method: '密封检修', inspector: '王强', inspectDate: '2026-05-01', status: '需更换', ruleVersion: 1, judgedAt: '2026-05-02T11:00:00+08:00' },
  // 北港泵站：留一扇在修工单，用来演示同泵站重号提交被挡回。
  { id: 9, inspectNo: 'SLUI-0009', station: '北港泵站', gateNo: 'PM-07', seal: '', method: '', inspector: '周工', inspectDate: null, status: '待检修', ruleVersion: 1, judgedAt: null },
  // 南湖泵站
  // PM-01：先判失效需更换（历史冻结），更换完成后又登记了一条状态正常——当前不应再残留在待更换里。
  { id: 3, inspectNo: 'SLUI-0003', station: '南湖泵站', gateNo: 'PM-01', seal: '严重泄漏', method: '密封检修', inspector: '陈涛', inspectDate: '2026-08-10', status: '需更换', ruleVersion: 1, judgedAt: '2026-08-11T09:30:00+08:00' },
  { id: 4, inspectNo: 'SLUI-0004', station: '南湖泵站', gateNo: 'PM-01', seal: '密封良好', method: '更换后复检', inspector: '赵磊', inspectDate: '2026-10-02', status: '状态正常', ruleVersion: 2, judgedAt: '2026-10-02T15:00:00+08:00' },
  // 挂着的工单：严重泄漏，新旧口径都判失效，重算后仍在待更换。
  { id: 5, inspectNo: 'SLUI-0005', station: '南湖泵站', gateNo: 'PM-02', seal: '严重泄漏', method: '密封检修', inspector: '陈涛', inspectDate: '2026-09-15', status: '检修中', ruleVersion: 1, judgedAt: null },
  // 西河泵站
  // 从无检修日期的待检修工单：只判超期，密封未判定，不得进待更换。
  { id: 7, inspectNo: 'SLUI-0007', station: '西河泵站', gateNo: 'PM-01', seal: '', method: '', inspector: '孙琳', inspectDate: null, status: '待检修', ruleVersion: 1, judgedAt: null },
  // 挂着的工单：轻微渗漏 + 检修日期超 180 天。旧口径失效且超期，新口径判正常但仍超期。
  { id: 8, inspectNo: 'SLUI-0008', station: '西河泵站', gateNo: 'PM-02', seal: '轻微渗漏', method: '常规检查', inspector: '孙琳', inspectDate: '2026-03-01', status: '检修中', ruleVersion: 1, judgedAt: null },
]

function buildRecord(input: SeedInput): SluiceRecord {
  const evaluation = evaluateSluice(
    { seal: input.seal, lastInspectDate: input.inspectDate, today: SEED_TODAY },
    input.ruleVersion,
  )
  return {
    id: input.id,
    inspectNo: input.inspectNo,
    station: input.station,
    gateNo: input.gateNo,
    seal: input.seal,
    method: input.method,
    inspector: input.inspector,
    inspectDate: input.inspectDate,
    status: input.status,
    version: 1,
    ruleVersion: input.ruleVersion,
    verdict: evaluation.verdict,
    sealFailed: evaluation.sealFailed,
    overdue: evaluation.overdue,
    reasons: evaluation.reasons,
    judgedAt: input.judgedAt,
    lastEditor: input.inspector,
    updatedAt: input.judgedAt ?? '2026-09-30T09:00:00+08:00',
  }
}

/** 首次播种：开放工单带着旧口径（v1）的缓存结论，首次加载时按当前口径重算并产出差异。 */
export function buildSluiceSeed(): SluiceRecord[] {
  return INPUTS.map(buildRecord).sort((a, b) => a.id - b.id)
}
