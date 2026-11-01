/**
 * Test-only RBAC bypass. Honoured exclusively when NODE_ENV is 'test', so a stray
 * TEST_BYPASS_AUTH=true in any other environment can never disable role checks.
 */
export function isAuthBypassEnabled(): boolean {
  return process.env.TEST_BYPASS_AUTH === 'true' && process.env.NODE_ENV === 'test';
}
