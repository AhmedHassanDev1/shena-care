'use client'

import { PageHeader, Section } from '@/components/bw/primitives'
import { KeyValues } from '@/components/workspace/kit'
import { RoleShell, useMe } from '@/components/workspace/role-shell'

export default function SupplierAccount() {
  return (
    <RoleShell role="supplier" active="account" mode="mobile">
      <AccountBody />
    </RoleShell>
  )
}

function AccountBody() {
  const me = useMe()
  return (
    <div className="space-y-4 p-4">
      <PageHeader title="حسابي" />
      <Section>
        <KeyValues rows={[['الاسم', me.name], ['البريد', <bdi key="e" className="bw-code">{me.email}</bdi>], ['المورد', me.supplierName ?? '—']]} />
      </Section>
      <p className="text-bw-small text-bw-ink-soft">بتشوف أوامر الشراء الخاصة بالمورد بتاعك بس، من غير بيانات العملاء أو أسعار البيع أو موردين تانيين.</p>
    </div>
  )
}
