'use client'

import * as React from 'react'
import { MoreHorizontal, Plus, Search, ShieldCheck } from 'lucide-react'
import { Button, Code, DataTable, Field, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page, Select } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useApi, useCommand } from '@/lib/use-api'

type Role = 'ADMIN' | 'HUB_OPERATOR' | 'DRIVER' | 'SUPPLIER'
type Staff = { id: string; name: string; email: string; roles: Role[]; isActive: boolean; supplierId: string | null; supplier: { id: string; name: string } | null; locations: Array<{ id: string; name: string }>; activeSessions: number }
const roleLabel: Record<Role, string> = { ADMIN: 'Admin', HUB_OPERATOR: 'Hub', DRIVER: 'التوصيل', SUPPLIER: 'Supplier' }

export default function TeamPage() {
  return <RoleShell role="admin" active="team" mode="desktop"><TeamContent /></RoleShell>
}

function TeamContent() {
  const me = useMe()
  const { data, error, loading, reload } = useApi<Staff[]>('/operations/staff')
  const [query, setQuery] = React.useState('')
  const [role, setRole] = React.useState('')
  const [active, setActive] = React.useState('')
  const [selected, setSelected] = React.useState<Staff | null | undefined>(undefined)
  const needle = query.normalize('NFKC').trim().toLocaleLowerCase()
  const visible = (data ?? []).filter(person => (!role || person.roles.includes(role as Role)) && (active === '' || String(person.isActive) === active) && `${person.name} ${person.email}`.normalize('NFKC').toLocaleLowerCase().includes(needle))
  const selectedStaff = selected as (Staff & { __reset?: boolean }) | null | undefined
  const modalKey = selectedStaff ? `${selectedStaff.id ?? 'new'}-${selectedStaff.__reset ? 'reset' : 'edit'}` : 'new'
  const command = useCommand(async (id: string, action: 'status' | 'revoke', isActive?: boolean) => action === 'status'
    ? api(`/operations/staff/${id}/status`, { method: 'PATCH', body: { isActive } })
    : api(`/operations/staff/${id}/revoke-sessions`, { method: 'POST' }))
  return <Page>
    <PageHeader title="الفريق" meta="حسابات الموظفين والصلاحيات التشغيلية" actions={<Button onClick={() => setSelected(null)}><Plus className="size-4" /> موظف جديد</Button>} />
    <Section>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem_12rem]">
        <label className="relative"><span className="sr-only">ابحث بالاسم أو البريد</span><Search className="absolute start-3 top-3 size-4 text-bw-ink-subtle" aria-hidden /><input type="search" placeholder="ابحث بالاسم أو البريد" value={query} onChange={e => setQuery(e.target.value)} className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface ps-9 pe-3 text-bw-small text-bw-ink" /></label>
        <Select label="مساحة العمل" value={role} onChange={setRole} options={[['','كل المساحات'], ...Object.entries(roleLabel).map(([v,l])=>[v,l] as [string,string])]} />
        <Select label="حالة الحساب" value={active} onChange={setActive} options={[['','الكل'],['true','نشط'],['false','متوقف']]} />
      </div>
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-44 w-full" /> : null}
      {data && visible.length === 0 ? <StateBlock kind="empty" title={data.length ? 'لا يوجد موظفون مطابقون' : 'قائمة الفريق فارغة'} body={data.length ? 'غيّر البحث أو المرشحات.' : 'أضف حساب موظف للبدء.'} /> : null}
      {visible.length ? <div className="overflow-x-auto"><DataTable caption="حسابات الفريق" head={['الموظف', 'المساحة والدور', 'الحالة', 'الجلسات', '']}>
        {visible.map(person => <tr key={person.id}>
          <td><span className="font-semibold">{person.name}</span><span className="block text-[11px] text-bw-ink-soft" dir="ltr">{person.email}</span></td>
          <td><div className="flex flex-wrap gap-1">{person.roles.filter(r => r !== ('CUSTOMER' as Role)).map(r => <StatusLabel key={r} tone="neutral">{roleLabel[r]}{r === 'HUB_OPERATOR' && person.locations.length ? ` · ${person.locations.map(l => l.name).join('، ')}` : ''}</StatusLabel>)}{person.supplier ? <span className="text-[11px] text-bw-ink-soft">{person.supplier.name}</span> : null}</div></td>
          <td><StatusLabel tone={person.isActive ? 'ok' : 'warn'}>{person.isActive ? 'نشط' : 'متوقف'}</StatusLabel></td><td><Code>{person.activeSessions}</Code></td>
          <td><details className="relative"><summary className="flex size-bw-control cursor-pointer list-none items-center justify-center rounded-bw-field border border-bw-line text-bw-ink-soft hover:bg-bw-sunken" aria-label={`إجراءات ${person.name}`}><MoreHorizontal className="size-4" /></summary><div className="absolute end-0 z-20 mt-1 grid min-w-44 gap-1 rounded-bw-card border border-bw-line bg-bw-surface p-1 shadow-bw-overlay"><button className="rounded px-3 py-2 text-start text-bw-small hover:bg-bw-sunken" onClick={() => setSelected(person)}>تعديل الموظف والصلاحية</button><button className="rounded px-3 py-2 text-start text-bw-small hover:bg-bw-sunken" onClick={async e => { e.currentTarget.closest('details')?.removeAttribute('open'); if (await command.execute(person.id,'status',!person.isActive)) reload() }}>{person.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'}</button><button className="rounded px-3 py-2 text-start text-bw-small hover:bg-bw-sunken" onClick={() => setSelected({ ...person, __reset: true } as Staff)}>إعادة تعيين كلمة المرور</button><button className="rounded px-3 py-2 text-start text-bw-small hover:bg-bw-sunken" onClick={async e => { e.currentTarget.closest('details')?.removeAttribute('open'); if (person.activeSessions && window.confirm(`إنهاء ${person.activeSessions} جلسة نشطة لهذا الحساب؟`)) { if (await command.execute(person.id,'revoke')) reload() } }}>إنهاء الجلسات النشطة</button></div></details></td>
        </tr>)}
      </DataTable></div> : null}
      <CommandError error={command.error} />
    </Section>
    {selected !== undefined ? <StaffDialog key={modalKey} item={selectedStaff} locations={me.hubLocations} onClose={() => setSelected(undefined)} onSaved={() => { setSelected(undefined); reload() }} /> : null}
  </Page>
}

function StaffDialog({ item, locations, onClose, onSaved }: { item: Staff | null | undefined | (Staff & { __reset?: boolean }); locations: Array<{id:string;name:string}>; onClose:()=>void; onSaved:()=>void }) {
  const dialogRef=React.useRef<HTMLDialogElement>(null)
  React.useEffect(()=>{const node=dialogRef.current;if(!node)return;if(!node.open)node.showModal();return()=>{if(node.open)node.close()}},[])
  const resetOnly = !!(item as Staff & {__reset?:boolean} | null)?.__reset
  const [name,setName] = React.useState(item?.name ?? '')
  const [email,setEmail] = React.useState(item?.email ?? '')
  const [password,setPassword] = React.useState('')
  const [roles,setRoles] = React.useState<Role[]>(item?.roles ?? ['HUB_OPERATOR'])
  const [locationIds,setLocationIds] = React.useState(item?.locations.map(l=>l.id) ?? [])
  const saving = useCommand(async () => {
    if (!item) return api('/operations/staff',{body:{name:name.trim(),email:email.trim(),password,roles,...(roles.includes('HUB_OPERATOR')?{locationIds}:{})}})
    if (resetOnly) return api(`/operations/staff/${item.id}/reset-password`,{body:{password}})
    await api(`/operations/staff/${item.id}`,{method:'PATCH',body:{name:name.trim(),...(roles.includes('HUB_OPERATOR')?{locationIds}:{locationIds:[]})}})
    return api(`/operations/staff/${item.id}/roles`,{method:'PATCH',body:{roles}})
  })
  const toggleRole=(value:Role)=>setRoles(current=>current.includes(value)?current.filter(r=>r!==value):[...current,value])
  const exclusive = roles.includes('DRIVER') || roles.includes('SUPPLIER')
  const selectableRoles: Role[] = item ? ['ADMIN','HUB_OPERATOR','DRIVER', ...(item.roles.includes('SUPPLIER')?['SUPPLIER' as Role]:[])] : ['ADMIN','HUB_OPERATOR','DRIVER']
  return <dialog ref={dialogRef} onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="staff-title" className="fixed inset-0 z-50 m-auto max-h-[90dvh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-bw-card border border-bw-line bg-bw-surface p-0 text-bw-ink shadow-bw-overlay backdrop:bg-bw-kohl/70"><form className="space-y-4 p-5" onSubmit={async e=>{e.preventDefault(); if(await saving.execute())onSaved()}}>
    <div className="flex items-center justify-between"><h2 id="staff-title" className="text-bw-heading font-bold">{resetOnly?'تعيين كلمة مرور':item?'تعديل الموظف':'إضافة موظف'}</h2><button type="button" onClick={onClose} className="min-h-bw-control px-3" aria-label="إغلاق">×</button></div>
    {!resetOnly ? <><Field label="الاسم" value={name} onChange={e=>setName(e.target.value)} /><Field label="البريد الإلكتروني" type="email" value={email} disabled={!!item} onChange={e=>setEmail(e.target.value)} ltr />
      <fieldset className="space-y-2"><legend className="text-bw-small font-semibold">مساحة العمل والدور</legend>{selectableRoles.map(r=><label key={r} className="flex min-h-9 items-center gap-2 text-bw-small"><input type="checkbox" checked={roles.includes(r)} onChange={()=>toggleRole(r)} disabled={exclusive && !roles.includes(r)} className="size-4 accent-bw-action" />{roleLabel[r]}</label>)}</fieldset>
      {roles.includes('HUB_OPERATOR') ? <fieldset className="space-y-2"><legend className="text-bw-small font-semibold">مواقع Hub</legend>{locations.length?locations.map(location=><label key={location.id} className="flex items-center gap-2 text-bw-small"><input type="checkbox" checked={locationIds.includes(location.id)} onChange={e=>setLocationIds(e.target.checked?[...locationIds,location.id]:locationIds.filter(id=>id!==location.id))} className="size-4 accent-bw-action" />{location.name}</label>):<p className="text-bw-small text-bw-ink-soft">لا توجد مواقع متاحة لحسابك.</p>}</fieldset>:null}
    </> : null}
    {!item || resetOnly ? <Field label={resetOnly?'كلمة المرور الجديدة':'كلمة المرور الابتدائية'} type="password" autoComplete="new-password" minLength={10} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} hint="10 أحرف على الأقل" ltr /> : null}
    <CommandError error={saving.error} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" loading={saving.pending} disabled={!resetOnly && (!name.trim() || !roles.length) || ((!item || resetOnly) && password.length<10)}><ShieldCheck className="size-4" />{resetOnly?'تحديث كلمة المرور':'حفظ'}</Button></div>
  </form></dialog>
}
