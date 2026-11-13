'use client'

import * as React from 'react'
import { Check, ChevronDown, RefreshCw, RotateCcw } from 'lucide-react'
import { Button, Field, PageHeader, Select, Skeleton, Switch } from '@/components/bw/primitives'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Setting = { key:string; group:string; kind:string; min?:number; max?:number; nullable:boolean; value:unknown; defaultValue:unknown; source:'ADMIN'|'DEFAULT'; updatedAt:string|null }
type DeliveryPolicy = { bands:Array<{maxKm:number|null;fee:number}>; discountTiers:Array<{minSubtotal:number;discount:number}>; freeFrom:number }
const keys = {
  phone:'business.phone', whatsapp:'business.whatsapp.number', whatsappEnabled:'business.whatsapp.enabled',
  facebook:'business.facebook.url', facebookEnabled:'business.facebook.enabled',
  delivery:'commerce.delivery.policy', deliveryCost:'commerce.delivery.internal_cost', bag:'commerce.packaging.bag_cost', box:'commerce.packaging.box_cost', share:'finance.profit_share_percent',
  cod:'commerce.cod.enabled', checkout:'storefront.checkout.enabled', areas:'commerce.delivery.areas',
  sourcingMode:'operations.sourcing.mode',
}
const SOURCING_MODES:Array<{value:string;label:string}> = [
  {value:'INTERNAL_BUY_LIST',label:'قائمة مشتريات داخلية — الشراء بيتم برّه النظام (الإصدار الأول)'},
  {value:'BROADCAST_ON_DEMAND',label:'طلبات عروض للموردين (غير مفعّل في الإصدار الأول)'},
  {value:'OFFER_BASED',label:'عروض الموردين القديمة (غير مفعّل)'},
]
const json = (value:unknown) => JSON.stringify(value ?? null)

export default function SettingsPage() {
  const {data,error,loading,reload} = useApi<Setting[]>('/operations/settings')
  const [draft,setDraft] = React.useState<Record<string,unknown>>({})
  const [areas,setAreas] = React.useState<string[]>([])
  const [delivery,setDelivery] = React.useState<DeliveryPolicy|null>(null)
  const [saved,setSaved] = React.useState(false)
  const hydrate = React.useCallback((settings:Setting[])=>{
    const values=Object.fromEntries(settings.map(s=>[s.key,s.value]))
    setDraft(values)
    setAreas(Array.isArray(values[keys.areas])?values[keys.areas] as string[]:[])
    setDelivery(values[keys.delivery] as DeliveryPolicy)
  },[])
  React.useEffect(()=>{ if(data) hydrate(data) },[data,hydrate])
  React.useEffect(()=>{ if(!saved) return; const id=window.setTimeout(()=>setSaved(false),3500); return ()=>window.clearTimeout(id) },[saved])

  const save=useCommand((changes:Record<string,unknown>)=>api('/operations/settings',{method:'PATCH',body:{changes}}))
  const reset=useCommand((key:string)=>api(`/operations/settings/${encodeURIComponent(key)}/reset`,{method:'POST'}))
  const update=(key:string,value:unknown)=>setDraft(current=>({...current,[key]:value}))
  const setting=(key:string)=>data?.find(s=>s.key===key)

  // Everything the person edited, across all groups, as one change set. Sourcing mode saves on its own below.
  const changes = React.useMemo(()=>{
    if(!data) return {} as Record<string,unknown>
    const editable=data.filter(s=>(s.group==='business'||s.group==='commerce')&&s.key!==keys.delivery&&s.key!==keys.areas)
    const out:Record<string,unknown>={}
    for(const s of editable) if(json(draft[s.key])!==json(s.value)) out[s.key]=draft[s.key]??null
    if(delivery&&json(delivery)!==json(setting(keys.delivery)?.value)) out[keys.delivery]=delivery
    if(areas.length&&json(areas)!==json(setting(keys.areas)?.value)) out[keys.areas]=areas
    return out
  },[data,draft,delivery,areas])
  const dirty=Object.keys(changes).length>0
  const saveAll=async()=>{ if(dirty&&await save.execute(changes)){ setSaved(true); reload() } }
  const restore=async(key:string)=>{if(await reset.execute(key)){reload()}}

  return <RoleShell role="admin" active="settings" mode="desktop"><Page>
    <PageHeader title="الإعدادات" meta="التغييرات بتنطبق على الطلبات الجديدة بس؛ كل طلب قديم بيحتفظ برسومه وتكاليفه." actions={<Button variant="secondary" size="sm" onClick={reload} loading={loading&&!!data}>{!(loading&&!!data)?<RefreshCw className="size-4" aria-hidden/>:null}تحديث</Button>} />
    {error?<LoadError message={error.message} onRetry={reload}/>:null}
    {!data&&loading?<div className="space-y-3"><Skeleton className="h-44 w-full"/><Skeleton className="h-44 w-full"/></div>:null}

    {data?<div className="bw-panel bw-arrive divide-y divide-bw-line">
      <Group title="التواصل مع العملاء" hint="بيظهر في المتجر وفي رسائل الطلبات.">
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <SettingInput title="هاتف التواصل" item={setting(keys.phone)} value={draft[keys.phone]} onChange={v=>update(keys.phone,v||null)} />
          <div className="space-y-1">
            <SettingInput title="رقم واتساب" item={setting(keys.whatsapp)} value={draft[keys.whatsapp]} onChange={v=>update(keys.whatsapp,v||null)} />
            <Switch label="إظهار واتساب للعميل" checked={!!draft[keys.whatsappEnabled]} onChange={e=>update(keys.whatsappEnabled,e.target.checked)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <SettingInput title="رابط Facebook" item={setting(keys.facebook)} value={draft[keys.facebook]} onChange={v=>update(keys.facebook,v||null)} />
            <Switch label="إظهار رابط Facebook" checked={!!draft[keys.facebookEnabled]} onChange={e=>update(keys.facebookEnabled,e.target.checked)} />
          </div>
        </div>
      </Group>

      <Group title="تكلفة التغليف والتوصيل" hint="التكلفة المعتادة لكل طلب. بتتسجّل على كل طلب وقت التغليف، وتغيير السعر بعد كده مابيغيّرش الطلبات القديمة.">
        <div className="grid gap-4 sm:grid-cols-3">
          <SettingInput title="تكلفة الشنطة · ج.م" item={setting(keys.bag)} value={draft[keys.bag]} onChange={v=>update(keys.bag,v===''?null:Number(v))} number />
          <SettingInput title="تكلفة الكرتونة · ج.م" item={setting(keys.box)} value={draft[keys.box]} onChange={v=>update(keys.box,v===''?null:Number(v))} number />
          <SettingInput title="توصيل داخلي معتاد · ج.م / طلب" item={setting(keys.deliveryCost)} value={draft[keys.deliveryCost]} onChange={v=>update(keys.deliveryCost,v===''?null:Number(v))} number />
        </div>
        <p className="mt-2 text-[12px] text-bw-ink-subtle">تكلفة التوصيل المعتادة بتظهر كاقتراح بس؛ المسجّل على الطلب هو تكلفة المندوب الفعلية.</p>
      </Group>

      <Group title="توزيع الأرباح" hint="نسبة من صافي الربح الشهري بعد كل التكاليف الفعلية. الشهر المُغلق بيحتفظ بالنسبة اللي اتقفل بيها.">
        <div className="max-w-xs"><SettingInput title="نسبة حصة الأرباح · %" item={setting(keys.share)} value={draft[keys.share]} onChange={v=>update(keys.share,v===''?null:Number(v))} number /></div>
      </Group>

      {delivery?<Group title="رسوم التوصيل على العميل" hint="حسب المسافة، مع خصم أو توصيل مجاني لما قيمة الطلب تكبر.">
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-bw-small font-semibold text-bw-ink-soft">حسب المسافة</h3>
            <div className="grid gap-3 sm:grid-cols-3">{delivery.bands.map((band,i)=><div key={i} className="grid grid-cols-2 gap-2"><Field label={i===delivery.bands.length-1?'أي مسافة أكبر':'حتى كم'} type="number" min="1" step="1" value={band.maxKm??''} disabled={band.maxKm===null} onChange={e=>setDelivery({...delivery,bands:delivery.bands.map((b,j)=>j===i?{...b,maxKm:e.target.value===''?null:Number(e.target.value)}:b)})}/><Field label="الرسوم · ج.م" type="number" min="0" step="0.01" value={band.fee} onChange={e=>setDelivery({...delivery,bands:delivery.bands.map((b,j)=>j===i?{...b,fee:Number(e.target.value)}:b)})}/></div>)}</div>
          </div>
          <div>
            <h3 className="mb-2 text-bw-small font-semibold text-bw-ink-soft">خصم الرسوم حسب قيمة الطلب</h3>
            <div className="grid gap-3 sm:grid-cols-2">{delivery.discountTiers.map((tier,i)=><div key={i} className="grid grid-cols-2 gap-2"><Field label="قيمة الطلب من · ج.م" type="number" min="0" step="0.01" value={tier.minSubtotal} onChange={e=>setDelivery({...delivery,discountTiers:delivery.discountTiers.map((t,j)=>j===i?{...t,minSubtotal:Number(e.target.value)}:t)})}/><Field label="خصم التوصيل · ج.م" type="number" min="0" step="0.01" value={tier.discount} onChange={e=>setDelivery({...delivery,discountTiers:delivery.discountTiers.map((t,j)=>j===i?{...t,discount:Number(e.target.value)}:t)})}/></div>)}</div>
          </div>
          <Field className="max-w-xs" label="توصيل مجاني ابتداءً من · ج.م" type="number" min="0.01" step="0.01" value={delivery.freeFrom} onChange={e=>setDelivery({...delivery,freeFrom:Number(e.target.value)})}/>
        </div>
      </Group>:null}

      <Group title="تشغيل المتجر" hint="تحكّم في استقبال الطلبات وطريقة الدفع.">
        <div className="space-y-1">
          <Switch label="السماح بالدفع عند الاستلام" checked={!!draft[keys.cod]} onChange={e=>update(keys.cod,e.target.checked)}/>
          <Switch label="فتح استقبال الطلبات" checked={!!draft[keys.checkout]} onChange={e=>update(keys.checkout,e.target.checked)}/>
        </div>
      </Group>

      <Group title="نطاق التوصيل" hint="المحافظات اللي بتظهر للعميل لما يحدد عنوانه.">
        <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-3">{(setting(keys.areas)?.defaultValue as string[]??[]).map(area=>{
          const on=areas.includes(area); const last=areas.length===1&&on
          return <label key={area} className={cn('flex min-h-10 items-center gap-2.5 rounded-bw-field px-2 text-bw-small transition-colors',last?'opacity-60':'cursor-pointer hover:bg-bw-veil-2')}>
            <input type="checkbox" className="size-4 accent-bw-action" checked={on} disabled={last} onChange={e=>setAreas(e.target.checked?[...areas,area]:areas.filter(v=>v!==area))}/>{area}
          </label>})}
        </div>
      </Group>

      <SourcingMode item={setting(keys.sourcingMode)} onSaved={reload}/>
    </div>:null}

    {data?<details className="group bw-panel">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-bw-small font-semibold text-bw-ink-soft hover:text-bw-ink [&::-webkit-details-marker]:hidden">
        متقدّم: مصدر القيم المحفوظة
        <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-bw-line">
        <p className="px-4 py-3 text-[12px] text-bw-ink-subtle">للمراجعة التقنية فقط: كل إعداد وهل قيمته محفوظة أو افتراضية. «استعادة الافتراضي» بيمسح التعديل المحفوظ.</p>
        <ul className="divide-y divide-bw-line">{data.filter(s=>s.group==='business'||s.group==='commerce').map(s=><li key={s.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-bw-small">
          <span className="bw-code text-bw-ink-soft">{s.key}</span>
          <span className="flex items-center gap-2"><span className={s.source==='ADMIN'?'text-bw-ink':'text-bw-ink-subtle'}>{s.source==='ADMIN'?'قيمة محفوظة':'افتراضي'}</span>{s.source==='ADMIN'?<Button variant="ghost" size="sm" onClick={()=>restore(s.key)} loading={reset.pending}><RotateCcw className="size-3.5" aria-hidden/>استعادة الافتراضي</Button>:null}</span>
        </li>)}</ul>
        <div className="px-4 pb-3"><CommandError error={reset.error}/></div>
      </div>
    </details>:null}

    {/* One save bar for everything edited above; it only exists while there is something to save. */}
    {(dirty||saved||save.error)?<div role="region" aria-label="حفظ الإعدادات" className="bw-glass-raised bw-arrive sticky bottom-20 z-20 mx-auto flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-bw-card px-4 py-3 lg:bottom-4">
      {save.error?<div className="min-w-0 flex-1"><CommandError error={save.error}/></div>
        :saved&&!dirty?<p className="flex flex-1 items-center gap-2 text-bw-small text-bw-ink"><Check className="size-4 text-bw-emerald" aria-hidden/>اتحفظت التغييرات</p>
        :<p className="flex-1 text-bw-small text-bw-ink"><bdi className="bw-code">{Object.keys(changes).length}</bdi> تغيير مستني الحفظ</p>}
      {dirty?<Button variant="ghost" size="sm" onClick={()=>data&&hydrate(data)} disabled={save.pending}>تجاهل</Button>:null}
      {dirty?<Button size="sm" onClick={saveAll} loading={save.pending}>حفظ التغييرات</Button>:null}
    </div>:null}
  </Page></RoleShell>
}

/** One settings group: what it is on the inline-start side, its controls on the other. No nested cards. */
function Group({title,hint,children}:{title:string;hint?:string;children:React.ReactNode}){
  return <section aria-label={title} className="grid gap-x-8 gap-y-4 px-4 py-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-5">
    <div><h2 className="text-bw-body font-semibold text-bw-ink">{title}</h2>{hint?<p className="mt-1 text-[12px] leading-relaxed text-bw-ink-subtle">{hint}</p>:null}</div>
    <div className="min-w-0">{children}</div>
  </section>
}

function SettingInput({title,item,value,onChange,number=false}:{title:string;item?:Setting;value:unknown;onChange:(v:string)=>void;number?:boolean}){
  return <Field label={title} type={number?'number':item?.kind==='phone'?'tel':item?.kind==='url'?'url':'text'} min={number?String(item?.min??0):undefined} max={number?String(item?.max??1000):undefined} step={number?'0.01':undefined} inputMode={number?'decimal':undefined} value={value==null?'':String(value)} onChange={e=>onChange(e.target.value)} ltr={item?.kind==='phone'||item?.kind==='url'} hint={item?.source==='DEFAULT'?'افتراضي':undefined}/>
}

/** How goods are sourced. Only new orders follow a changed mode; supply plans already created keep their coverage. */
function SourcingMode({item,onSaved}:{item?:Setting;onSaved:()=>void}){
  const [value,setValue]=React.useState('')
  React.useEffect(()=>setValue(typeof item?.value==='string'?item.value:''),[item])
  const save=useCommand((next:string)=>api('/operations/settings',{method:'PATCH',body:{changes:{[keys.sourcingMode]:next}}}))
  if(!item)return null
  const dirty=value!==''&&value!==item.value
  return <Group title="مصدر البضاعة" hint="بيسري على الطلبات الجديدة بس. الأوضاع التانية بتفضل في الكود لكن غير مفعّلة.">
    <div className="space-y-3">
      <Select label="وضع التوريد" value={value} onChange={e=>setValue(e.target.value)} options={SOURCING_MODES}/>
      <p className="text-[12px] text-bw-ink-subtle">قائمة المشتريات الداخلية مفيهاش موردين ولا أوامر شراء.</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><CommandError error={save.error}/><Button size="sm" variant={dirty?'primary':'secondary'} onClick={async()=>{if(await save.execute(value))onSaved()}} loading={save.pending} disabled={!dirty}>حفظ الوضع</Button></div>
    </div>
  </Group>
}
