'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

export default function HubHome() {
  const router = useRouter()
  React.useEffect(() => { router.replace('/hub/receive') }, [router])
  return null
}
