import { LabBar } from '@/components/bw/lab'
import { pickState, screens } from '../states'
import { SupplierPoConfirmation } from './po-confirmation'

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = pickState((await searchParams).state, screens.supplier.ids)
  return (
    <>
      <LabBar base="/design/supplier" states={screens.supplier.options} current={state} />
      <SupplierPoConfirmation key={state} state={state} />
    </>
  )
}
