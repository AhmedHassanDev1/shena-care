'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, Notice } from '@/components/bw/primitives'
import { ApiError } from '@/lib/api'
import { homeFor, useSession } from '@/lib/session'

/** Staff sign-in. Accounts and roles are provisioned by the owner (`npm run staff:provision`), never here. */
export default function LoginPage() {
  const { state, login } = useSession()
  const router = useRouter()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (state.status === 'ready') router.replace(homeFor(state.me))
  }, [state, router])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const me = await login(email.trim(), password)
      if (homeFor(me) === '/login') setError('الحساب ده مالوش صلاحية على مساحة الأعمال.')
      else router.replace(homeFor(me))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'البريد أو كلمة السر غلط.'
          : err instanceof ApiError && err.status === 429
            ? 'محاولات كتير. استنى دقايق وجرّب تاني.'
            : err instanceof ApiError ? err.message : 'حصلت مشكلة، حاول تاني.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-bw-card border border-bw-line bg-bw-surface p-6" noValidate>
        <div className="space-y-1">
          <h1 className="font-bw-display text-bw-title font-semibold">شينا كير أعمال</h1>
          <p className="text-bw-small text-bw-ink-soft">دخول الإدارة والمخزن والموردين والمندوبين</p>
        </div>
        {error ? <Notice tone="danger" title={error} /> : null}
        <Field label="البريد الإلكتروني" type="email" autoComplete="username" ltr required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="كلمة السر" type="password" autoComplete="current-password" ltr required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" size="touch" className="w-full" loading={pending} disabled={!email || !password}>
          دخول
        </Button>
      </form>
    </main>
  )
}
