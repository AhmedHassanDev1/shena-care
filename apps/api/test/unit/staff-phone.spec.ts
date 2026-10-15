import { normalizeEgyptianMobile } from '../../src/modules/accounts/phone'

describe('normalizeEgyptianMobile', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['010 1234 5678', '+201012345678'],
    ['+20 10 1234 5678', '+201012345678'],
    ['00201012345678', '+201012345678'],
    ['201112345678', '+201112345678'],
    ['1212345678', '+201212345678'],
    ['(0151) 234-5678', '+201512345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '+201012345678'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeEgyptianMobile(input)).toBe(expected)
  })

  it.each([
    '', '0101234567', '010123456789', '01312345678', '02212345678', '+441012345678', 'abc', '010-1234-56x8', '++201012345678',
    '0101234567+8', '1'.repeat(40),
  ])('rejects %j', input => {
    expect(normalizeEgyptianMobile(input)).toBeNull()
  })
})
