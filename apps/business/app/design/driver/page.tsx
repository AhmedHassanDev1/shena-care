import { LabBar } from '@/components/bw/lab'
import { pickState, screens } from '../states'
import { DriverDeliveryStop } from './delivery-stop'

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = pickState((await searchParams).state, screens.driver.ids)
  return (
    <>
      <LabBar base="/design/driver" states={screens.driver.options} current={state} />
      <DriverDeliveryStop key={state} state={state} />
    </>
  )
}
