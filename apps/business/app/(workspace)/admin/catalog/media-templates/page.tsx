'use client'

import * as React from 'react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page, Select, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useAuthedImage } from '@/lib/authed-image'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

interface Template { id: string; templateKey: string; version: number; name: string; categoryIds: string[]; width: number; height: number; byteSize: number; contentHash: string; isActive: boolean; createdAt: string; derivativeCount: number; rules: unknown }
interface Reprocess { activeVersion: number; remaining: number; results: Array<{ assetId: string; processingStatus: string; processingError: string | null }> }

/** Replaces a scene with an upload, no code change. Existing images keep showing until the new version is reprocessed, reviewed and published. */
export default function MediaTemplatesPage() {
  const { data, error, loading, reload } = useApi<Template[]>('/catalog/media-templates')
  const categories = useApi<Array<{ id: string; name: string }>>('/categories')
  const grouped = React.useMemo(() => {
    const map = new Map<string, Template[]>()
    for (const template of data ?? []) map.set(template.templateKey, [...(map.get(template.templateKey) ?? []), template])
    return [...map.entries()]
  }, [data])
  return (
    <RoleShell role="admin" active="media-templates" mode="desktop">
      <Page>
        <PageHeader title="قوالب صور المنتجات" meta="كل صورة معالجة بتسجل نسخة القالب اللي اتعملت منها. تبديل القالب ماييغيرش اللي منشور غير بعد موافقتك." />
        <Register categories={categories.data ?? []} onDone={reload} />
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
        {data && data.length === 0 ? <StateBlock kind="empty" title="لسه مفيش قوالب" body="ارفع القالب المعتمد من النموذج اللي فوق." /> : null}
        {grouped.map(([key, versions]) => <TemplateGroup key={key} templateKey={key} versions={versions} onChange={reload} />)}
      </Page>
    </RoleShell>
  )
}

function Register({ categories, onDone }: { categories: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [templateKey, setTemplateKey] = React.useState('')
  const [name, setName] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('')
  const [rules, setRules] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const keyOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(templateKey)
  const register = useCommand(async () => {
    const form = new FormData()
    form.append('templateKey', templateKey)
    form.append('name', name.trim())
    if (categoryId) form.append('categoryIds', JSON.stringify([categoryId]))
    if (rules.trim()) form.append('rules', rules.trim())
    form.append('file', file as File)
    return api<Template>('/catalog/media-templates', { body: form })
  })
  return (
    <Section title="قالب جديد أو نسخة جديدة">
      {saved ? <Notice tone="ok" title={saved} /> : null}
      <form className="grid gap-3 md:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault()
        const result = await register.execute()
        if (result) { setSaved(`اتسجل ${result.name} نسخة ${result.version}`); setFile(null); onDone() }
      }}>
        <Field label="مفتاح القالب (نفس المفتاح = نسخة جديدة)" ltr value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} error={templateKey && !keyOk ? 'حروف إنجليزية صغيرة وأرقام وشرطة' : undefined} />
        <Field label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="القسم" value={categoryId} onChange={setCategoryId} options={[['', 'كل الأقسام (الافتراضي)'], ...categories.map((c) => [c.id, c.name] as [string, string])]} />
        <Field label="ملف القالب (مربع، 800 بكسل على الأقل)" type="file" accept="image/webp,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="md:col-span-2"><TextArea label="قواعد الوضع والظل (JSON). فاضي = قواعد النسخة السابقة" value={rules} onChange={setRules} rows={3} /></div>
        <Button type="submit" loading={register.pending} disabled={!keyOk || !name.trim() || !file}>حفظ النسخة</Button>
      </form>
      <CommandError error={register.error} />
    </Section>
  )
}

function TemplateGroup({ templateKey, versions, onChange }: { templateKey: string; versions: Template[]; onChange: () => void }) {
  const [outcome, setOutcome] = React.useState<Reprocess | null>(null)
  const reprocess = useCommand(() => api<Reprocess>('/catalog/media-templates/reprocess', { body: { templateKey } }))
  const active = versions.find((v) => v.isActive)
  return (
    <Section title={<span className="flex flex-wrap items-center gap-2"><Code>{templateKey}</Code> {active ? <StatusLabel tone="ok">النسخة النشطة {active.version}</StatusLabel> : <StatusLabel tone="warn">مفيش نسخة نشطة</StatusLabel>}</span>}
      aside={<Button type="button" variant="secondary" loading={reprocess.pending} disabled={!active} onClick={async () => { const result = await reprocess.execute(); if (result) { setOutcome(result); onChange() } }}>إعادة معالجة الصور على النسخة النشطة</Button>}>
      {outcome ? <Notice tone="ok" title={`اتعالج ${outcome.results.length} صورة، مستنية موافقتك. باقي ${outcome.remaining}.`} /> : null}
      <CommandError error={reprocess.error} />
      <ul className="grid gap-4 md:grid-cols-2">{versions.map((version) => <VersionCard key={version.id} version={version} onChange={onChange} />)}</ul>
    </Section>
  )
}

function VersionCard({ version, onChange }: { version: Template; onChange: () => void }) {
  const src = useAuthedImage(`/catalog/media-templates/${version.id}/file`)
  const toggle = useCommand(() => api(`/catalog/media-templates/${version.id}/state`, { method: 'PATCH', body: { isActive: !version.isActive } }))
  return (
    <li className="space-y-2 rounded-bw-field border border-bw-line p-3 text-bw-small">
      {src ? <img src={src} alt={`${version.name} نسخة ${version.version}`} className="aspect-square w-full rounded-bw-field object-cover" /> : <Skeleton className="aspect-square w-full" />}
      <p className="font-semibold">{version.name} · نسخة <Code>{version.version}</Code> {version.isActive ? <StatusLabel tone="ok">نشطة</StatusLabel> : null}</p>
      <p><Code>{version.width}×{version.height}</Code> · <Code>{Math.round(version.byteSize / 1024)} KB</Code> · صور منها <Code>{version.derivativeCount}</Code> · {formatDateTime(version.createdAt)}</p>
      <p className="break-all text-bw-ink-soft" dir="ltr">sha256 {version.contentHash.slice(0, 16)}…</p>
      <Button type="button" variant="secondary" loading={toggle.pending} onClick={async () => { if (await toggle.execute()) onChange() }}>{version.isActive ? 'إيقاف' : 'تفعيل هذه النسخة'}</Button>
      <CommandError error={toggle.error} />
    </li>
  )
}
