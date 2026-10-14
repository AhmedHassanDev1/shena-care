import { LabBar } from '@/components/bw/lab'
import { pickState, screens } from '../states'
import { HubPickStation } from './pick-station'

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = pickState((await searchParams).state, screens.hub.ids)
  return (
    <>
      <LabBar base="/design/hub" states={screens.hub.options} current={state} />
      <HubPickStation key={state} state={state} />
    </>
  )
}
