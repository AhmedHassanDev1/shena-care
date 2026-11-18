'use client'

import * as React from 'react'
import { Camera, X } from 'lucide-react'
import { Button } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'

/** The browser's built-in barcode detector (Chrome/Edge/Android); not in the TypeScript DOM lib. */
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']
const POLL_MS = 250
/** Empty frames needed before the same code may count again: the pack must leave the view between two units. */
const EMPTY_FRAMES_TO_REARM = 3

type Status = 'starting' | 'scanning' | 'unsupported' | 'denied' | 'failed'

/**
 * Mobile / webcam barcode scanning for the Hub desk. Every code it reads goes through exactly the same path as a hardware scanner
 * (`onCode`), so the server's wrong / duplicate / excess checks apply unchanged. The same code is reported once until it leaves the
 * frame, so a pack held in view is never counted twice by the camera. Needs a secure page (https or localhost) and a supporting browser;
 * otherwise it says so and the desk keeps working with the scanner or typing.
 */
export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = React.useRef<HTMLVideoElement>(null)
  const [status, setStatus] = React.useState<Status>('starting')
  const onCodeRef = React.useRef(onCode)
  onCodeRef.current = onCode

  React.useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (!Detector) { setStatus('unsupported'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('unsupported'); return }
    let stopped = false
    let stream: MediaStream | null = null
    let timer: number | undefined
    const detector = new Detector({ formats: FORMATS })
    let lastCode: string | null = null
    let emptyFrames = EMPTY_FRAMES_TO_REARM
    let busy = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return }
        const element = video.current
        if (!element) return
        element.srcObject = stream
        await element.play()
        setStatus('scanning')
        timer = window.setInterval(async () => {
          if (busy || !video.current || video.current.readyState < 2) return
          busy = true
          try {
            const found = await detector.detect(video.current)
            const code = found[0]?.rawValue?.trim() || null
            if (!code) { emptyFrames += 1; if (emptyFrames >= EMPTY_FRAMES_TO_REARM) lastCode = null; return }
            emptyFrames = 0
            if (code === lastCode) return
            lastCode = code
            onCodeRef.current(code)
          } catch { /* a frame that cannot be read is simply skipped */ } finally { busy = false }
        }, POLL_MS)
      } catch (error) {
        setStatus((error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'failed')
      }
    })()
    return () => {
      stopped = true
      if (timer) window.clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return (
    <div className="space-y-3 rounded-bw-field border border-bw-line p-3" aria-label="ماسح الكاميرا">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-bw-small font-semibold text-bw-ink"><Camera className="size-4" aria-hidden />ماسح الكاميرا</p>
        <Button variant="secondary" size="sm" onClick={onClose}><X className="size-4" aria-hidden />إغلاق الكاميرا</Button>
      </div>
      {status === 'unsupported' ? <Flash tone="warn">المتصفح ده مابيدعمش قراءة الباركود بالكاميرا. استعمل الماسح أو اكتب الرقم، أو افتح الصفحة من كروم على الموبايل.</Flash> : null}
      {status === 'denied' ? <Flash tone="danger">الكاميرا متقفلة للصفحة دي. اسمح بالكاميرا من إعدادات المتصفح وجرّب تاني.</Flash> : null}
      {status === 'failed' ? <Flash tone="danger">الكاميرا ماشتغلتش (لازم الصفحة تتفتح بـ https أو من نفس الجهاز، وماتكونش الكاميرا مستخدمة في برنامج تاني).</Flash> : null}
      {status === 'starting' ? <p className="text-bw-small text-bw-ink-soft" role="status">بتشغّل الكاميرا…</p> : null}
      {status === 'scanning' ? <p className="text-bw-small text-bw-ink-soft" role="status">وجّه الباركود ناحية الكاميرا. كل قطعة بتتقرا مرة، شيلها من قدام الكاميرا قبل اللي بعدها.</p> : null}
      {status === 'unsupported' || status === 'denied' || status === 'failed' ? null : (
        <video ref={video} playsInline muted className="aspect-video w-full rounded-bw-field bg-bw-veil-1 object-cover" aria-label="معاينة الكاميرا" />
      )}
    </div>
  )
}
