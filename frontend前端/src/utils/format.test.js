import { describe, expect, it } from 'vitest'
import {
  fmtMoney,
  fmtRate,
  fmtDate,
  fmtDateTime,
  maskPhone,
  maskIdCard,
  maskCardNo,
  statusLabel,
  repayTypeLabel,
  planStatusLabel,
  countdownText
} from '@/utils/format'

describe('金额格式化（详细设计 6.5）', () => {
  it('按 ¥12,000.00 格式输出', () => {
    expect(fmtMoney('12000')).toBe('¥12,000.00')
    expect(fmtMoney('12000.5')).toBe('¥12,000.50')
    expect(fmtMoney('1066.19')).toBe('¥1,066.19')
  })
  it('支持负数与零', () => {
    expect(fmtMoney('-1500.00')).toBe('-¥1,500.00')
    expect(fmtMoney('0.00')).toBe('¥0.00')
  })
  it('非法值返回占位符而不是 NaN', () => {
    expect(fmtMoney('')).toBe('—')
    expect(fmtMoney(null)).toBe('—')
    expect(fmtMoney('abc')).toBe('—')
    expect(fmtMoney(undefined)).toBe('—')
  })
})

describe('费率格式化', () => {
  it('12.0000 显示为 12.00%', () => {
    expect(fmtRate('12.0000')).toBe('12.00%')
    expect(fmtRate('0.0500', { digits: 4 })).toBe('0.0500%')
    expect(fmtRate('9.5')).toBe('9.50%')
  })
})

describe('脱敏规则', () => {
  it('手机号 138****8888', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
    expect(maskPhone('13812345678')).toBe('138****5678')
  })
  it('证件号前3后4', () => {
    const masked = maskIdCard('110101199001011234')
    expect(masked.startsWith('110')).toBe(true)
    expect(masked.endsWith('1234')).toBe(true)
    expect(masked).toHaveLength(18)
    expect(masked.slice(3, 14)).toBe('***********')
  })
  it('卡号仅后4', () => {
    expect(maskCardNo('6222021234561234')).toBe('**** **** **** 1234')
  })
})

describe('状态与方式名称', () => {
  it('申请状态按状态机映射', () => {
    expect(statusLabel(0)).toBe('待审核')
    expect(statusLabel(1)).toBe('待签约')
    expect(statusLabel(2)).toBe('待放款')
    expect(statusLabel(3)).toBe('已放款')
    expect(statusLabel(4)).toBe('已结清')
    expect(statusLabel(5)).toBe('已拒绝')
    expect(statusLabel(6)).toBe('已撤销')
    expect(statusLabel(7)).toBe('已失效')
  })
  it('三种还款方式', () => {
    expect(repayTypeLabel(1)).toBe('等额本息')
    expect(repayTypeLabel(2)).toBe('等额本金')
    expect(repayTypeLabel(3)).toBe('先息后本')
  })
  it('还款计划状态', () => {
    expect(planStatusLabel(0)).toBe('未还')
    expect(planStatusLabel(1)).toBe('已还')
    expect(planStatusLabel(2)).toBe('逾期')
  })
})

describe('日期与时刻（北京时间）', () => {
  it('日期 YYYY-MM-DD', () => {
    expect(fmtDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
  it('时刻 YYYY-MM-DD HH:mm', () => {
    expect(fmtDateTime(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05 09:07')
  })
})

describe('签约倒计时', () => {
  const deadline = '2026-01-05T12:00:00+08:00'
  it('未到期显示剩余时间', () => {
    const now = new Date('2026-01-05T10:30:00+08:00')
    const r = countdownText(deadline, now)
    expect(r.expired).toBe(false)
    expect(r.text).toContain('1 小时')
  })
  it('到期后标记已超时', () => {
    const now = new Date('2026-01-05T12:00:01+08:00')
    expect(countdownText(deadline, now).expired).toBe(true)
  })
})
