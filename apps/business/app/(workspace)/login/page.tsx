import * as React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import type { Metadata } from 'next'
import { LoginExperience } from '@/components/auth/login-experience'

export const metadata: Metadata = { title: 'تسجيل الدخول | شيناكير أعمال' }

/**
 * The approved logistics photograph is supplied as `public/auth/logistics.(webp|jpg|png)` (see
 * public/auth/README.md). Until it exists the screen shows a neutral amber atmosphere: no stand-in
 * photo, and never a crop of an existing screen.
 */
function heroAsset(): string | null {
  for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
    if (fs.existsSync(path.join(process.cwd(), 'public', 'auth', `logistics.${ext}`))) return `/auth/logistics.${ext}`
  }
  return null
}

export const dynamic = 'force-dynamic'

/** Staff sign-in. Accounts, roles and phone numbers are provisioned by the owner (`npm run staff:provision`), never here. */
export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginExperience heroSrc={heroAsset()} />
    </React.Suspense>
  )
}
