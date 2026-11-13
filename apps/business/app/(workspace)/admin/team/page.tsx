'use client'

import * as React from 'react'
import { KeyRound, LogOut, Pencil, Plus, Power, ShieldCheck, X } from 'lucide-react'
import { Button, Field, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { FilterSelect, RowMenu, SearchField, Toolbar } from '@/components/bw/ops'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { staffAccess } from '@/lib/staff-access'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Role = 'ADMIN' | 'HUB_OPERATOR' | 'DRIVER' | 'SUPPLIER'
type Staff = { id: string; name: string; email: string; roles: Role[]; isActive: boolean; supplierId: string | null; supplier: { id: string; name: string } | null; locations?: Array<{ id: string; name: string }> | null; activeSessions?: number | null }
const roleLabel: Record<Role, string> = { ADMIN: 'الإدارة', HUB_OPERATOR: 'المخزن', DRIVER: 'التوصيل', SUPPLIER: 'مورد' }
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

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
  const presentRoles = (Object.keys(roleLabel) as Role[]).filter((value) => value !== 'SUPPLIER' || (data ?? []).some((person) => person.roles.includes('SUPPLIER')))
  return <Page>
    <PageHeader title="الفريق" meta={data ? <><bdi className="bw-code">{data.length}</bdi> حساب · <bdi className="bw-code">{data.filter((person) => person.isActive).length}</bdi> نشط</> : 'حسابات الموظفين والصلاحيات'} actions={<Button size="sm" onClick={() => setSelected(null)}><Plus className="size-4" aria-hidden />موظف جديد</Button>} />
    <Toolbar sticky={false}>
      <SearchField value={query} onChange={setQuery} label="بحث في الفريق" placeholder="الاسم أو البريد" />
      <FilterSelect label="مساحة العمل" value={role} onChange={setRole} options={[{ value: '', label: 'كل المساحات' }, ...presentRoles.map((value) => ({ value, label: roleLabel[value] }))]} />
      <FilterSelect label="حالة الحساب" value={active} onChange={setActive} options={[{ value: '', label: 'كل الحالات' }, { value: 'true', label: 'نشط' }, { value: 'false', label: 'متوقف' }]} />
    </Toolbar>
    {data?.some(person => staffAccess(person).locations === null) ? <p role="status" className="text-bw-small text-bw-ink-soft">تفاصيل مواقع بعض الموظفين غير متاحة. حدّث الخادم قبل تعديل صلاحياتهم لحماية التعيينات الحالية.</p> : null}
    {error ? <LoadError message={error.message} onRetry={reload} /> : null}
    {!data && loading ? <div className="space-y-px overflow-hidden rounded-bw-card"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : null}
    {data && visible.length === 0 ? <div className="bw-panel"><StateBlock kind="empty" title={data.length ? 'مفيش موظفين مطابقين' : 'قائمة الفريق فاضية'} body={data.length ? 'غيّر البحث أو الفلاتر.' : 'ضيف حساب موظف عشان تبدأ.'} /></div> : null}
    {visible.length ? <ul className="bw-panel bw-arrive divide-y divide-bw-line [&>li:first-child]:rounded-t-bw-card [&>li:last-child]:rounded-b-bw-card">
      {visible.map(person => { const access = staffAccess(person); return <li key={person.id} className="bw-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 md:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1.2fr)_7rem_auto]">
        <span aria-hidden className={cn('grid size-9 place-items-center rounded-full border text-[12px] font-semibold', person.isActive ? 'border-bw-line bg-bw-sunken text-bw-ink' : 'border-dashed border-bw-line-field/60 text-bw-ink-subtle')}>{initials(person.name)}</span>
        <span className="min-w-0">
          <span className={cn('block truncate text-bw-small font-semibold', person.isActive ? 'text-bw-ink' : 'text-bw-ink-soft')}>{person.name}</span>
          <span className="block truncate text-[12px] text-bw-ink-subtle" dir="ltr">{person.email}</span>
        </span>
        <span className="col-span-3 col-start-1 row-start-2 flex flex-wrap items-center gap-1.5 md:col-span-1 md:col-start-auto md:row-start-auto">
          {person.roles.filter(r => r !== ('CUSTOMER' as Role)).map(r => <span key={r} className="inline-flex items-center rounded-full border border-bw-line bg-bw-veil-1 px-2.5 py-0.5 text-[11px] font-semibold text-bw-ink-soft">{roleLabel[r]}{r === 'HUB_OPERATOR' ? (access.locations ? (access.locations.length ? ` · ${access.locations.map(l => l.name).join('، ')}` : '') : ' · المواقع غير متاحة') : ''}</span>)}
          {person.supplier ? <span className="text-[11px] text-bw-ink-subtle">{person.supplier.name}</span> : null}
          {!person.isActive ? <span className="inline-flex items-center gap-1.5 text-[11px] text-bw-amber md:hidden"><span aria-hidden className="size-1.5 rounded-full bg-bw-amber" />متوقف</span> : null}
        </span>
        <span className="hidden items-center gap-2 text-bw-small md:flex">
          <span aria-hidden className={cn('size-1.5 rounded-full', person.isActive ? 'bg-bw-emerald' : 'bg-bw-amber')} />
          <span className={person.isActive ? 'text-bw-ink-soft' : 'text-bw-amber'}>{person.isActive ? 'نشط' : 'متوقف'}</span>
          {access.activeSessions ? <span className="text-[11px] text-bw-ink-subtle">· <bdi className="bw-code">{access.activeSessions}</bdi> جلسة</span> : null}
        </span>
        <span className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
          <RowMenu label={`إجراءات ${person.name}`} actions={[
            { label: 'تعديل الموظف والصلاحية', icon: Pencil, disabled: access.locations === null, onSelect: () => setSelected(person) },
            { label: person.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب', icon: Power, onSelect: async () => { if (await command.execute(person.id, 'status', !person.isActive)) reload() } },
            { label: 'إعادة تعيين كلمة المرور', icon: KeyRound, onSelect: () => setSelected({ ...person, __reset: true } as Staff) },
            { label: 'إنهاء الجلسات النشطة', icon: LogOut, tone: 'danger', disabled: !access.activeSessions, onSelect: async () => { if (access.activeSessions && window.confirm(`إنهاء ${access.activeSessions} جلسة نشطة لهذا الحساب؟`)) { if (await command.execute(person.id, 'revoke')) reload() } } },
          ]} />
        </span>
      </li>})}
    </ul> : null}
    <CommandError error={command.error} />
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
  const [locationIds,setLocationIds] = React.useState(item?.locations?.map(l=>l.id) ?? [])
  const saving = useCommand(async () => {
    if (!item) return api('/operations/staff',{body:{name:name.trim(),email:email.trim(),password,roles,...(roles.includes('HUB_OPERATOR')?{locationIds}:{})}})
    if (resetOnly) return api(`/operations/staff/${item.id}/reset-password`,{body:{password}})
    await api(`/operations/staff/${item.id}`,{method:'PATCH',body:{name:name.trim(),...(roles.includes('HUB_OPERATOR')?{locationIds}:{locationIds:[]})}})
    return api(`/operations/staff/${item.id}/roles`,{method:'PATCH',body:{roles}})
  })
  const toggleRole=(value:Role)=>setRoles(current=>current.includes(value)?current.filter(r=>r!==value):[...current,value])
  const exclusive = roles.includes('DRIVER') || roles.includes('SUPPLIER')
  const selectableRoles: Role[] = item ? ['ADMIN','HUB_OPERATOR','DRIVER', ...(item.roles.includes('SUPPLIER')?['SUPPLIER' as Role]:[])] : ['ADMIN','HUB_OPERATOR','DRIVER']
  return <dialog ref={dialogRef} onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="staff-title" className="bw-glass-raised fixed inset-0 z-50 m-auto max-h-[90dvh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-bw-card p-0 text-bw-ink backdrop:bg-bw-kohl/60"><form className="space-y-4 p-5" onSubmit={async e=>{e.preventDefault(); if(await saving.execute())onSaved()}}>
    <div className="flex items-center justify-between"><h2 id="staff-title" className="text-bw-heading font-bold">{resetOnly?'تعيين كلمة مرور':item?'تعديل الموظف':'إضافة موظف'}</h2><button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-bw-ink-soft transition-colors hover:bg-bw-veil-4 hover:text-bw-ink" aria-label="إغلاق"><X className="size-4" aria-hidden /></button></div>
    {!resetOnly ? <><Field label="الاسم" value={name} onChange={e=>setName(e.target.value)} /><Field label="البريد الإلكتروني" type="email" value={email} disabled={!!item} onChange={e=>setEmail(e.target.value)} ltr />
      <fieldset className="space-y-2"><legend className="text-bw-small font-semibold">مساحة العمل والدور</legend>{selectableRoles.map(r=><label key={r} className="flex min-h-9 items-center gap-2 text-bw-small"><input type="checkbox" checked={roles.includes(r)} onChange={()=>toggleRole(r)} disabled={exclusive && !roles.includes(r)} className="size-4 accent-bw-action" />{roleLabel[r]}</label>)}</fieldset>
      {roles.includes('HUB_OPERATOR') ? <fieldset className="space-y-2"><legend className="text-bw-small font-semibold">مواقع Hub</legend>{locations.length?locations.map(location=><label key={location.id} className="flex items-center gap-2 text-bw-small"><input type="checkbox" checked={locationIds.includes(location.id)} onChange={e=>setLocationIds(e.target.checked?[...locationIds,location.id]:locationIds.filter(id=>id!==location.id))} className="size-4 accent-bw-action" />{location.name}</label>):<p className="text-bw-small text-bw-ink-soft">لا توجد مواقع متاحة لحسابك.</p>}</fieldset>:null}
    </> : null}
    {!item || resetOnly ? <Field label={resetOnly?'كلمة المرور الجديدة':'كلمة المرور الابتدائية'} type="password" autoComplete="new-password" minLength={10} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} hint="10 أحرف على الأقل" ltr /> : null}
    <CommandError error={saving.error} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" loading={saving.pending} disabled={!resetOnly && (!name.trim() || !roles.length) || ((!item || resetOnly) && password.length<10)}><ShieldCheck className="size-4" />{resetOnly?'تحديث كلمة المرور':'حفظ'}</Button></div>
  </form></dialog>
}
