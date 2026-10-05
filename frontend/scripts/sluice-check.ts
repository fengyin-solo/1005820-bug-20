// 拍门口径统一的验收脚本：先垫片浏览器环境，再动态加载业务模块，保证单文件可被 esbuild 打包直跑。
import assert from 'node:assert'

const TODAY = '2026-10-05'

const storage = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
}
;(globalThis as any).window = { localStorage: localStorageStub }
;(globalThis as any).localStorage = localStorageStub

const RealDate = Date
class FixedDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date>) {
    if (args.length === 0) {
      super(`${TODAY}T08:00:00.000Z`)
    } else {
      super(...args)
    }
  }
  static now() {
    return new RealDate(`${TODAY}T08:00:00.000Z`).getTime()
  }
}
;(globalThis as any).Date = FixedDate

const [serviceMod, rulesMod, storeMod] = await Promise.all([
  import('../src/api/sluice-service.ts'),
  import('../src/data/sluice-rules.ts'),
  import('../src/data/sluice-store.ts'),
])
const service = serviceMod
const currentRule = rulesMod.currentRule

function reset() {
  storage.clear()
  storeMod.resetSluice()
}

// 1. 首次播种后，挂结工单按 v2 重算，产出差异报告；历史完工记录保留 v1 判定。
reset()
const report = service.getRecalcReport()
assert.ok(report, '应当生成口径重算报告')
assert.strictEqual(report.fromVersion, 1)
assert.strictEqual(report.toVersion, 2)
assert.strictEqual(report.recalculated, 5, '5 条挂结工单参与重算')
assert.strictEqual(report.changed, 2, '轻微渗漏的两条结论变化')
assert.strictEqual(report.pendingReplacementBefore, 4, '旧口径待更换 4 扇')
assert.strictEqual(report.pendingReplacementAfter, 2, '新口径待更换 2 扇')
const changedGates = report.items.filter((i: any) => i.changed).map((i: any) => `${i.station}${i.gateNo}`).sort()
assert.deepStrictEqual(changedGates, ['东湖泵站PM-02', '西河泵站PM-02'])

// 历史完工记录不追溯改写
const frozen = service.getSluiceRecord(3)
assert.strictEqual(frozen.ruleVersion, 1)
assert.strictEqual(frozen.verdict, '失效')
assert.strictEqual(frozen.status, '需更换')
const frozenNormal = service.getSluiceRecord(4)
assert.strictEqual(frozenNormal.ruleVersion, 2)
assert.strictEqual(frozenNormal.verdict, '正常')

// 2. 列表/看板/详情同源：待更换只剩东湖 PM-03（历史失效仍是当前结论）与南湖 PM-02（挂结严重泄漏）
const stats = service.getSluiceStats()
assert.strictEqual(stats.pendingReplacement, 2)
assert.deepStrictEqual(
  service.listPendingReplacementGates().map((g: any) => `${g.station}/${g.gateNo}`).sort(),
  ['东湖泵站/PM-03', '南湖泵站/PM-02'],
)
// 已更换的拍门不再残留在待更换
const replacedGate = service.getGate('南湖泵站', 'PM-01')
assert.strictEqual(replacedGate.verdict, '正常')
assert.strictEqual(replacedGate.replaced, true)
assert.ok(!service.listPendingReplacementGates().some((g: any) => g.station === '南湖泵站' && g.gateNo === 'PM-01'))
// 待更换名单里不允许混入正常/未判定
assert.ok(service.listPendingReplacementGates().every((g: any) => g.verdict === '失效'))

// 3. 超期单列，不因超期进待更换
const overdue = service.listOverdueGates().map((g: any) => `${g.station}/${g.gateNo}`).sort()
assert.deepStrictEqual(overdue, ['北港泵站/PM-07', '西河泵站/PM-01', '西河泵站/PM-02'])
const xh2 = service.getGate('西河泵站', 'PM-02')
assert.strictEqual(xh2.verdict, '正常')
assert.strictEqual(xh2.overdue, true)

// 4. 列表「只看待更换」与名单一致
assert.strictEqual(service.listSluiceRecords({ pendingReplacement: true }).total, 2)

// 5. 同泵站重号直接挡回并指出撞了谁
const dup = service.createSluiceRecord({ station: '北港泵站', gateNo: 'PM-07', inspector: '钱七' })
assert.strictEqual(dup.ok, false)
assert.match(dup.message, /撞号/)
assert.match(dup.message, /SLUI-0009/)
assert.match(dup.message, /周工/)
// 不同泵站同号放行；给已完工的门登记复检放行
assert.strictEqual(service.createSluiceRecord({ station: '西河泵站', gateNo: 'PM-07', inspector: '钱七' }).ok, true)
assert.strictEqual(service.createSluiceRecord({ station: '东湖泵站', gateNo: 'PM-01', inspector: '王强' }).ok, true)

// 6. 并发改动只落先到的一版（乐观锁）
const target = service.listSluiceRecords({ station: '南湖泵站', gateNo: 'PM-02' }).items[0]
const base = target.version
const first = service.updateSluiceRecord({ id: target.id, baseVersion: base, operator: '检修工甲', method: '甲的方案' })
assert.strictEqual(first.ok, true)
const second = service.updateSluiceRecord({ id: target.id, baseVersion: base, operator: '检修工乙', method: '乙的方案' })
assert.strictEqual(second.ok, false)
assert.match(second.message, /提交冲突/)
assert.match(second.message, /检修工甲/)
const after = service.getSluiceRecord(target.id)
assert.strictEqual(after.method, '甲的方案')
assert.strictEqual(after.version, base + 1)
// 判定提交同样受乐观锁保护
assert.strictEqual(
  service.judgeSluiceRecord({ id: target.id, baseVersion: base, operator: '检修工乙', seal: '密封良好', inspectDate: TODAY }).ok,
  false,
)
// 结论由口径计算：明显渗漏 → 失效/需更换，页面无法手工指定
const judgeFresh = service.judgeSluiceRecord({ id: target.id, baseVersion: base + 1, operator: '检修工甲', seal: '明显渗漏', inspectDate: TODAY })
assert.strictEqual(judgeFresh.ok, true)
assert.strictEqual(judgeFresh.data.status, '需更换')
assert.strictEqual(judgeFresh.data.verdict, '失效')
assert.strictEqual(judgeFresh.data.ruleVersion, 2)
assert.ok(judgeFresh.data.judgedAt !== null)
// 完工后历史冻结，改不动
const editFrozen = service.updateSluiceRecord({ id: target.id, baseVersion: base + 2, operator: '检修工乙', method: '想改历史' })
assert.strictEqual(editFrozen.ok, false)
assert.match(editFrozen.message, /冻结/)

// 7. 失效拍门更换完成：登记新工单并复检判良好后，从待更换名单移出
const followup = service.createSluiceRecord({ station: '南湖泵站', gateNo: 'PM-02', inspector: '甲', inspectDate: TODAY })
assert.strictEqual(followup.ok, true)
service.startSluiceInspection(followup.data.id, '甲')
const fRec = service.getSluiceRecord(followup.data.id)
const recheck = service.judgeSluiceRecord({ id: fRec.id, baseVersion: fRec.version, operator: '甲', seal: '密封良好', inspectDate: TODAY })
assert.strictEqual(recheck.data.status, '状态正常')
assert.ok(!service.listPendingReplacementGates().some((g: any) => g.station === '南湖泵站' && g.gateNo === 'PM-02'))

// 8. 开工流转
const pending = service.listSluiceRecords({ station: '北港泵站', gateNo: 'PM-07' }).items[0]
assert.strictEqual(pending.status, '待检修')
assert.strictEqual(service.startSluiceInspection(pending.id, '周工').data.status, '检修中')

// 9. 规则只有一份来源
assert.strictEqual(currentRule().failedSeals.join(','), '明显渗漏,严重泄漏')
assert.strictEqual(currentRule().overdueDays, 180)

// 10. 重置可复现：仍然播种 v1 挂结工单并自动重算到 v2
reset()
assert.strictEqual(service.getSluiceStats().pendingReplacement, 2)
assert.strictEqual(service.getRecalcReport().changed, 2)

// 11. 新登记工单按当前口径 v2 初始化，轻微渗漏不判失效
reset()
const created = service.createSluiceRecord({ station: '新泵站', gateNo: 'G-1', inspector: '新人', inspectDate: TODAY })
assert.strictEqual(created.ok, true)
service.startSluiceInspection(created.data.id, '新人')
let rec = service.getSluiceRecord(created.data.id)
const light = service.judgeSluiceRecord({ id: rec.id, baseVersion: rec.version, operator: '新人', seal: '轻微渗漏', inspectDate: TODAY })
assert.strictEqual(light.data.status, '状态正常')
const serious = service.judgeSluiceRecord({ id: rec.id, baseVersion: rec.version, operator: '新人', seal: '严重泄漏', inspectDate: TODAY })
assert.strictEqual(serious.ok, false, '已冻结的判定不能重复提交')

void RealDate
console.log('全部拍门检修口径验收通过 ✔')
