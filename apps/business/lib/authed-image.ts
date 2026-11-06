'use client'

import * as React from 'react'
import { getToken } from '@/lib/api'

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/** Private images need the session token, which an <img> cannot send, so the bytes are fetched and shown through a temporary local URL. */
export function useAuthedImage(path: string | null): string | null {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!path) { setUrl(null); return }
    let revoked: string | null = null
    const controller = new AbortController()
    const token = getToken()
    fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return
        revoked = URL.createObjectURL(await response.blob())
        setUrl(revoked)
      })
      .catch(() => undefined)
    return () => { controller.abort(); if (revoked) URL.revokeObjectURL(revoked) }
  }, [path])
  return url
}
