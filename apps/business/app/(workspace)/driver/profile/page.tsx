'use client'

import { Notice, PageHeader, Section } from '@/components/bw/primitives'
import { KeyValues } from '@/components/workspace/kit'
import { RoleShell, useMe } from '@/components/workspace/role-shell'

export default function DriverProfile() {
  return (
    <RoleShell role="driver" active="account" mode="mobile">
      <ProfileBody />
    </RoleShell>
  )
}

function ProfileBody() {
  const me = useMe()
  return (
    <div className="space-y-4 p-4">
      <PageHeader title="حسابي" />
      <Section><KeyValues rows={[['الاسم', me.name], ['البريد', <bdi key="e" className="bw-code">{me.email}</bdi>]]} /></Section>
      <Notice tone="neutral" title="العهدة غير التسوية">الفلوس اللي بتعلن إنك استلمتها من العميل بتفضل في عهدتك لحد ما كاشير المخزن يعدّها ويسجّل التسوية. إنت مش بتقفل التسوية بنفسك.</Notice>
    </div>
  )
}
