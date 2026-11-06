import type { Viewport } from 'next'

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0a0a0b',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
