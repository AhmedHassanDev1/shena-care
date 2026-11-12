import { redirect } from 'next/navigation'

/** Suppliers now live on the single Suppliers & Sourcing page; this keeps old links and the sidebar entry working. */
export default function SupplierEnrollmentRedirect() {
  redirect('/admin/sourcing')
}
