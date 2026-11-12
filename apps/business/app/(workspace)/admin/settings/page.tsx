'use client'

import * as React from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { Button, Field, Notice, PageHeader, Section, Skeleton, Tabs } from '@/components/bw/primitives'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useApi, useCommand } from '@/lib/use-api'

type Setting = { key:string; group:string; kind:string; min?:number; max?:number; nullable:boolean; value:unknown; defaultValue:unknown; source:'ADMIN'|'DEFAULT'; updatedAt:string|null }
type DeliveryPolicy = { bands:Array<{maxKm:number|null;fee:number}>; discountTiers:Array<{minSubtotal:number;discount:number}>; freeFrom:number }
const keys = {
  phone:'business.phone', whatsapp:'business.whatsapp.number', whatsappEnabled:'business.whatsapp.enabled',
  facebook:'business.facebook.url', facebookEnabled:'business.facebook.enabled',
  delivery:'commerce.delivery.policy', deliveryCost:'commerce.delivery.internal_cost', carton:'commerce.packaging.carton_cost', label:'commerce.packaging.label_cost',
  cod:'commerce.cod.enabled', checkout:'storefront.checkout.enabled', areas:'commerce.delivery.areas',
}

export default function SettingsPage() {
  const {data,error,loading,reload} = useApi<Setting[]>('/operations/settings')
  const [tab,setTab] = React.useState('general')
  const [draft,setDraft] = React.useState<Record<string,unknown>>({})
  const [areas,setAreas] = React.useState<string[]>([])
  const [delivery,setDelivery] = React.useState<DeliveryPolicy|null>(null)
  React.useEffect(()=>{
    if(!data)return
    const values=Object.fromEntries(data.map(s=>[s.key,s.value]))
    setDraft(values)
    setAreas(Array.isArray(values[keys.areas])?values[keys.areas] as string[]:[])
    setDelivery(values[keys.delivery] as DeliveryPolicy)
  },[data])
  const save=useCommand((changes:Record<string,unknown>)=>api('/operations/settings',{method:'PATCH',body:{changes}}))
  const reset=useCommand((key:string)=>api(`/operations/settings/${encodeURIComponent(key)}/reset`,{method:'POST'}))
  const update=(key:string,value:unknown)=>setDraft(current=>({...current,[key]:value}))
  const changed=(group:string)=>data?.filter(s=>group==='general'?s.group==='business':s.group==='commerce').some(s=>JSON.stringify(draft[s.key]??null)!==JSON.stringify(s.value??null)) ?? false
  const saveGroup=async(group:string)=>{
    if(!data)return
    const allowed=new Set(data.filter(s=>group==='general'?s.group==='business':s.group==='commerce').map(s=>s.key))
    const changes=Object.fromEntries(Object.entries(draft).filter(([k,v])=>allowed.has(k)&&JSON.stringify(v??null)!==JSON.stringify(data.find(s=>s.key===k)?.value??null)))
    if(group==='operations'&&delivery)changes[keys.delivery]=delivery
    if(group==='operations'&&areas.length)changes[keys.areas]=areas
    if(Object.keys(changes).length&&await save.execute(changes))reload()
  }
  const restore=async(key:string)=>{if(await reset.execute(key))reload()}
  const setting=(key:string)=>data?.find(s=>s.key===key)
  const operationsChanged=changed('operations')||JSON.stringify(delivery)!==JSON.stringify(setting(keys.delivery)?.value)||JSON.stringify(areas)!==JSON.stringify(setting(keys.areas)?.value)
  return <RoleShell role="admin" active="settings" mode="desktop"><Page>
    <PageHeader title="الإعدادات" meta="تغييرات الأعمال تُحفظ وتدخل في تأثيرها على الطلبات الجديدة" actions={<Button variant="secondary" onClick={reload}><RefreshCw className="size-4"/> تحديث</Button>} />
    <Tabs label="إعدادات النشاط" id="admin-settings" value={tab} onChange={setTab} items={[{value:'general',label:'عام'},{value:'operations',label:'العمليات'}]} />
    {error?<LoadError message={error.message} onRetry={reload}/>:null}{!data&&loading?<Skeleton className="h-64 w-full"/>:null}
    {data&&tab==='general'?<section role="tabpanel" id="admin-settings-panel" aria-labelledby="admin-settings-general" className="space-y-4">
      <Section title="التواصل مع العملاء"><div className="grid gap-4 sm:grid-cols-2">
        <SettingInput title="هاتف التواصل" item={setting(keys.phone)} value={draft[keys.phone]} onChange={v=>update(keys.phone,v||null)} />
        <div className="space-y-2"><SettingInput title="رقم واتساب" item={setting(keys.whatsapp)} value={draft[keys.whatsapp]} onChange={v=>update(keys.whatsapp,v||null)} /><Toggle label="إظهار واتساب للعميل" checked={!!draft[keys.whatsappEnabled]} onChange={v=>update(keys.whatsappEnabled,v)} /></div>
        <div className="space-y-2 sm:col-span-2"><SettingInput title="رابط Facebook" item={setting(keys.facebook)} value={draft[keys.facebook]} onChange={v=>update(keys.facebook,v||null)} /><Toggle label="إظهار رابط Facebook" checked={!!draft[keys.facebookEnabled]} onChange={v=>update(keys.facebookEnabled,v)} /></div>
      </div></Section>
      <Notice tone="info" title="الحقول المتاحة من الخادم">Instagram، البريد الإلكتروني، وإعلان المتجر غير موجودة في واجهة الإعدادات الخلفية الحالية، لذلك لم أضف لها حقول حفظ وهمية.</Notice>
      <SaveRow pending={save.pending} error={save.error} dirty={changed('general')} onSave={()=>saveGroup('general')}/>
    </section>:null}
    {data&&tab==='operations'?<section role="tabpanel" id="admin-settings-panel" aria-labelledby="admin-settings-operations" className="space-y-4">
      <Section title="التغليف والتوصيل"><div className="grid gap-4 sm:grid-cols-3">
        <SettingInput title="تكلفة التوصيل الداخلية / طلب" item={setting(keys.deliveryCost)} value={draft[keys.deliveryCost]} onChange={v=>update(keys.deliveryCost,v===''?null:Number(v))} number />
        <SettingInput title="تكلفة العبوة / طلب" item={setting(keys.carton)} value={draft[keys.carton]} onChange={v=>update(keys.carton,v===''?null:Number(v))} number />
        <SettingInput title="تكلفة الملصق / طلب" item={setting(keys.label)} value={draft[keys.label]} onChange={v=>update(keys.label,v===''?null:Number(v))} number />
      </div>
      {delivery?<div className="mt-5 space-y-4 border-t border-bw-line pt-4">
        <div><h3 className="text-bw-small font-bold">رسوم العميل حسب المسافة</h3><div className="mt-2 grid gap-3 sm:grid-cols-3">{delivery.bands.map((band,i)=><div key={i} className="grid grid-cols-2 gap-2"><Field label={i===delivery.bands.length-1?'آخر نطاق مفتوح · كم':'حتى كم'} type="number" min="1" step="1" value={band.maxKm??''} disabled={band.maxKm===null} onChange={e=>setDelivery({...delivery,bands:delivery.bands.map((b,j)=>j===i?{...b,maxKm:e.target.value===''?null:Number(e.target.value)}:b)})}/><Field label="الرسوم · ج.م" type="number" min="0" step="0.01" value={band.fee} onChange={e=>setDelivery({...delivery,bands:delivery.bands.map((b,j)=>j===i?{...b,fee:Number(e.target.value)}:b)})}/></div>)}</div></div>
        <div><h3 className="text-bw-small font-bold">خصم الرسوم حسب قيمة الطلب</h3><div className="mt-2 grid gap-3 sm:grid-cols-2">{delivery.discountTiers.map((tier,i)=><div key={i} className="grid grid-cols-2 gap-2"><Field label="قيمة الطلب من · ج.م" type="number" min="0" step="0.01" value={tier.minSubtotal} onChange={e=>setDelivery({...delivery,discountTiers:delivery.discountTiers.map((t,j)=>j===i?{...t,minSubtotal:Number(e.target.value)}:t)})}/><Field label="خصم التوصيل · ج.م" type="number" min="0" step="0.01" value={tier.discount} onChange={e=>setDelivery({...delivery,discountTiers:delivery.discountTiers.map((t,j)=>j===i?{...t,discount:Number(e.target.value)}:t)})}/></div>)}</div></div>
        <Field label="توصيل مجاني ابتداءً من · ج.م" type="number" min="0.01" step="0.01" value={delivery.freeFrom} onChange={e=>setDelivery({...delivery,freeFrom:Number(e.target.value)})}/>
      </div>:null}</Section>
      <Section title="تشغيل المتجر"><div className="space-y-3"><Toggle label="السماح بالدفع عند الاستلام" checked={!!draft[keys.cod]} onChange={v=>update(keys.cod,v)}/><Toggle label="فتح استقبال الطلبات" checked={!!draft[keys.checkout]} onChange={v=>update(keys.checkout,v)}/></div></Section>
      <Section title="نطاق التوصيل"><p className="mb-3 text-bw-small text-bw-ink-soft">المحافظات التي تظهر للعملاء عند تحديد العنوان.</p><div className="grid gap-2 sm:grid-cols-3">{(setting(keys.areas)?.defaultValue as string[]??[]).map(area=><label key={area} className="flex min-h-9 items-center gap-2 text-bw-small"><input type="checkbox" className="size-4 accent-bw-action" checked={areas.includes(area)} disabled={areas.length===1&&areas.includes(area)} onChange={e=>setAreas(e.target.checked?[...areas,area]:areas.filter(v=>v!==area))}/>{area}</label>)}</div></Section>
      <Notice tone="info" title="تأثير التغييرات">الأسعار وتكاليف التوصيل الجديدة تنطبق على الطلبات الجديدة. يحتفظ كل طلب قديم برسومه وتكاليفه المسجلة.</Notice>
      <SaveRow pending={save.pending} error={save.error} dirty={operationsChanged} onSave={()=>saveGroup('operations')}/>
    </section>:null}
    {data?<Section title="مصدر القيم"><div className="divide-y divide-bw-line">{data.filter(s=>s.group===(tab==='general'?'business':'commerce')).map(s=><div key={s.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-bw-small"><span className="text-bw-ink-soft">{s.key}</span><span>{s.source==='ADMIN'?'قيمة محفوظة':'افتراضي'}</span>{s.source==='ADMIN'?<Button variant="ghost" onClick={()=>restore(s.key)} loading={reset.pending}><RotateCcw className="size-3.5"/> استعادة الافتراضي</Button>:null}</div>)}</div><CommandError error={reset.error}/></Section>:null}
  </Page></RoleShell>
}

function SettingInput({title,item,value,onChange,number=false}:{title:string;item?:Setting;value:unknown;onChange:(v:string)=>void;number?:boolean}){
  return <Field label={title} type={number?'number':item?.kind==='phone'?'tel':item?.kind==='url'?'url':'text'} min={number?String(item?.min??0):undefined} max={number?String(item?.max??1000):undefined} step={number?'0.01':undefined} value={value==null?'':String(value)} onChange={e=>onChange(e.target.value)} ltr={item?.kind==='phone'||item?.kind==='url'} hint={item?.source==='ADMIN'?'قيمة محفوظة':'تُستخدم القيمة الافتراضية حتى الحفظ'}/>
}
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}){return <label className="flex min-h-10 items-center gap-3 text-bw-small"><input type="checkbox" role="switch" className="size-4 accent-bw-action" checked={checked} onChange={e=>onChange(e.target.checked)}/>{label}</label>}
function SaveRow({pending,error,dirty,onSave}:{pending:boolean;error:import('@/lib/api').ApiError|null;dirty:boolean;onSave:()=>void}){return <div className="flex flex-wrap items-center justify-between gap-3"><CommandError error={error}/><Button onClick={onSave} loading={pending} disabled={!dirty}>حفظ التغييرات</Button></div>}
