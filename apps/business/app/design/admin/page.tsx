import { LabBar } from '@/components/bw/lab'
import { pickState, screens } from '../states'
import { AdminAttentionCenter } from './attention-center'

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = pickState((await searchParams).state, screens.admin.ids)
  return (
    <>
      <LabBar base="/design/admin" states={screens.admin.options} current={state} />
      <AdminAttentionCenter key={state} state={state} />
    </>
  )
}
