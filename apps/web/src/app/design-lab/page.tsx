import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Info, Search, ShoppingBag, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Steps, type StepItem } from '@/components/ui/steps';
import { formatCurrency, formatNumber } from '@/lib/i18n/format';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

import { ContrastTable } from './contrast-table';
import { FONT_CANDIDATES } from './fonts';
import {
  ORDER_STAGES,
  SAMPLE_CURRENT_STAGE,
  SPECIMEN,
  SPECIMEN_ORDER_NUMBER,
  SPECIMEN_PRICE,
} from './specimen-content';

export const metadata: Metadata = {
  title: 'Design lab — Shena Care (development only)',
  robots: { index: false, follow: false },
};

/** Development-only route. In production it 404s unless DESIGN_LAB=enabled is set explicitly. */
function labEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.DESIGN_LAB === 'enabled';
}

const PRIMITIVE_SCALES = [
  { name: 'neutral', steps: [0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
  { name: 'olive', steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
  { name: 'blush', steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
] as const;
const STATUS_PRIMITIVES = ['green-50', 'green-700', 'amber-50', 'amber-800', 'red-50', 'red-700', 'blue-50', 'blue-700'];
const SEMANTIC_SURFACES = [
  ['background', 'foreground'],
  ['card', 'card-foreground'],
  ['muted', 'muted-foreground'],
  ['secondary', 'secondary-foreground'],
  ['primary', 'primary-foreground'],
  ['primary-subtle', 'primary'],
  ['accent', 'accent-foreground'],
  ['destructive-subtle', 'destructive'],
  ['success-subtle', 'success'],
  ['warning-subtle', 'warning'],
  ['info-subtle', 'info'],
  ['disabled', 'disabled-foreground'],
] as const;
const TYPE_SCALE = [
  { token: 'display', className: 'text-display', size: 'clamp 32–48px' },
  { token: 'h1', className: 'text-h1', size: 'clamp 28–36px' },
  { token: 'h2', className: 'text-h2', size: 'clamp 24–28px' },
  { token: 'h3', className: 'text-h3', size: '20px' },
  { token: 'body-lg', className: 'text-body-lg', size: '18px' },
  { token: 'body', className: 'text-body', size: '16px' },
  { token: 'support', className: 'text-support', size: '14px' },
  { token: 'caption', className: 'text-caption', size: '13px (minimum)' },
] as const;

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 border-t border-border pt-8">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-h2 text-foreground">
          {title}
        </h2>
        {description ? <p className="max-w-3xl text-support text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function orderSteps(locale: Locale): StepItem[] {
  const currentIndex = ORDER_STAGES.findIndex((stage) => stage.id === SAMPLE_CURRENT_STAGE);
  return ORDER_STAGES.map((stage, index) => ({
    id: stage.id,
    label: stage[locale],
    status: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

/** Same composition rendered in an explicit direction, to compare RTL and LTR side by side. */
function DirectionPanel({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const s = SPECIMEN[locale];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const errorId = `phone-error-${locale}`;

  return (
    <div lang={locale} dir={dir} className="flex flex-col gap-5 rounded-md border border-border bg-card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Badge variant="secondary">{dir.toUpperCase()} · {locale}</Badge>
        <Button variant="link" size="sm">
          {locale === 'ar' ? 'كل المنتجات' : 'All products'}
          {/* Directional icons are mirrored in RTL; symmetric icons are not. */}
          <ArrowRight aria-hidden="true" className="rtl-mirror" />
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-caption text-muted-foreground">{s.productLabel}</p>
        {/* Latin product names inside Arabic text are isolated so punctuation does not jump sides. */}
        <p className="text-body font-medium text-foreground">
          <bdi>{s.product}</bdi>
        </p>
        <p className="text-h3 text-foreground">{formatCurrency(SPECIMEN_PRICE.amount, SPECIMEN_PRICE.currency, locale)}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`phone-${locale}`}>{locale === 'ar' ? 'رقم الموبايل' : 'Mobile number'}</Label>
        {/* Phone numbers stay LTR in both locales; alignment follows the field's own direction. */}
        <Input
          id={`phone-${locale}`}
          dir="ltr"
          inputMode="tel"
          defaultValue="010 1234"
          aria-invalid="true"
          aria-describedby={errorId}
          className="text-start"
        />
        <p id={errorId} className="flex items-center gap-1.5 text-support text-destructive">
          <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
          {locale === 'ar' ? 'اكتب رقم موبايل مصري من ١١ رقم.' : 'Enter an 11-digit Egyptian mobile number.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button>
          <ShoppingBag aria-hidden="true" />
          {locale === 'ar' ? 'أضف للسلة' : 'Add to cart'}
        </Button>
        <Button variant="outline">{locale === 'ar' ? 'قارن' : 'Compare'}</Button>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <p className="text-support font-semibold text-foreground">
          {s.orderLabel} <bdi className="font-normal tabular-nums">{SPECIMEN_ORDER_NUMBER}</bdi>
        </p>
        <Steps
          aria-label={locale === 'ar' ? 'حالة الطلب' : 'Order status'}
          items={orderSteps(locale)}
          statusLabels={{ complete: m.stepStatusComplete, current: m.stepStatusCurrent, upcoming: m.stepStatusUpcoming }}
          formatIndex={(n) => formatNumber(n, locale)}
        />
      </div>
    </div>
  );
}

export default function DesignLabPage() {
  if (!labEnabled()) notFound();

  const locale = getLocale();
  const m = getMessages(locale);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <Badge variant="warning" className="self-start">
          <TriangleAlert aria-hidden="true" />
          Development only · nothing on this page is approved
        </Badge>
        <h1 className="text-h1 text-foreground">Design System Foundation v0.1 — lab</h1>
        <p className="max-w-3xl text-body text-muted-foreground">
          Tokens, typography candidates and shared components as they render in this app. “Olive Blush” is a temporary
          development theme, the fonts are candidates, and “Guided Clarity” is a proposed direction. Switch the site
          language in the header to see overlays and page-level direction change.
        </p>
      </header>

      <Section
        id="typography"
        title="Arabic typography candidates"
        description="Identical strings in each shortlisted family, at real sizes. Look at Arabic body text at 16px, Latin product names inside Arabic, digits, and weight contrast — not only the headline."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {FONT_CANDIDATES.map((font) => (
            <Card key={font.id} className={font.className}>
              <CardHeader>
                <CardTitle lang="en">{font.name}</CardTitle>
                <CardDescription lang="en">{font.facts}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4" lang="ar" dir="rtl">
                <p className="text-display text-foreground">{SPECIMEN.ar.display}</p>
                <p className="text-h3 text-foreground">{SPECIMEN.ar.heading}</p>
                <p className="text-body text-foreground">{SPECIMEN.ar.body}</p>
                <p className="text-support text-muted-foreground">{SPECIMEN.ar.microcopy}</p>
                <p className="text-support text-foreground">
                  {SPECIMEN.ar.productLabel}: <bdi className="font-medium">{SPECIMEN.ar.product}</bdi>
                </p>
                <p className="text-caption text-muted-foreground">
                  {SPECIMEN.ar.inciLabel}: <bdi>{SPECIMEN.ar.inci}</bdi>
                </p>
                <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-foreground">
                  <span className="text-h3">{formatCurrency(SPECIMEN_PRICE.amount, SPECIMEN_PRICE.currency, 'ar')}</span>
                  {SPECIMEN.ar.units.map((unit) => (
                    <span key={unit} className="text-support text-muted-foreground">
                      <bdi>{unit}</bdi>
                    </span>
                  ))}
                </p>
                <p className="flex flex-wrap gap-x-3 text-body text-foreground">
                  <span className="font-normal">عادي ٤٠٠</span>
                  <span className="font-medium">متوسط ٥٠٠</span>
                  <span className="font-semibold">نصف عريض ٦٠٠</span>
                  <span className="font-bold">عريض ٧٠٠</span>
                </p>
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-2 border-t border-border pt-4 sm:pt-4" lang="en" dir="ltr">
                <p className="text-h3 text-foreground">{SPECIMEN.en.display}</p>
                <p className="text-support text-foreground">{SPECIMEN.en.body}</p>
              </CardFooter>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        id="type-scale"
        title="Type scale (provisional font)"
        description="Semantic size tokens. Line height is a token too: Arabic gets more leading (1.4 headings / 1.8 body) than Latin (1.25 / 1.6). Nothing below 13px."
      >
        <div className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
          {TYPE_SCALE.map((step) => (
            <div key={step.token} className="grid gap-2 p-4 sm:grid-cols-[9rem_1fr_1fr] sm:items-baseline">
              <p className="text-caption text-muted-foreground" lang="en" dir="ltr">
                <code>text-{step.token}</code> · {step.size}
              </p>
              <p lang="ar" dir="rtl" className={cn(step.className, 'text-foreground')}>
                {SPECIMEN.ar.heading}
              </p>
              <p lang="en" dir="ltr" className={cn(step.className, 'text-foreground')}>
                {SPECIMEN.en.heading}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="numerals"
        title="Digits, prices and mixed direction"
        description="Open decision: Arabic-Indic digits (current ar-EG default) or Latin digits inside Arabic UI. Both shown with the real formatter."
      >
        <div className="grid gap-4 sm:grid-cols-3" lang="ar" dir="rtl">
          <Card>
            <CardHeader>
              <CardDescription>أرقام هندية (الافتراضي الحالي)</CardDescription>
              <CardTitle>{formatCurrency(SPECIMEN_PRICE.amount, SPECIMEN_PRICE.currency, 'ar')}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>أرقام لاتينية</CardDescription>
              <CardTitle>
                {new Intl.NumberFormat('ar-EG-u-nu-latn', { style: 'currency', currency: SPECIMEN_PRICE.currency }).format(
                  SPECIMEN_PRICE.amount
                )}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription lang="en" dir="ltr">
                English (en-EG)
              </CardDescription>
              <CardTitle lang="en" dir="ltr">
                {formatCurrency(SPECIMEN_PRICE.amount, SPECIMEN_PRICE.currency, 'en')}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      </Section>

      <Section
        id="color"
        title="Color tokens — temporary Olive Blush theme"
        description="Primitives describe values; feature code only uses the semantic roles below. Neutrals are low-chroma warm grey rather than beige so multi-brand packaging carries the color."
      >
        <div className="flex flex-col gap-4">
          {PRIMITIVE_SCALES.map((scale) => (
            <div key={scale.name} className="flex flex-col gap-2">
              <p className="text-support font-medium text-foreground" lang="en">
                {scale.name}
              </p>
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-7 lg:grid-cols-[repeat(13,minmax(0,1fr))]">
                {scale.steps.map((step) => (
                  <div key={step} className="flex flex-col gap-1">
                    <div
                      className="h-10 rounded-sm border border-border"
                      style={{ backgroundColor: `rgb(var(--${scale.name}-${step}))` }}
                    />
                    <span className="text-caption text-muted-foreground tabular-nums" lang="en" dir="ltr">
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <p className="text-support font-medium text-foreground" lang="en">
              status
            </p>
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
              {STATUS_PRIMITIVES.map((name) => (
                <div key={name} className="flex flex-col gap-1">
                  <div className="h-10 rounded-sm border border-border" style={{ backgroundColor: `rgb(var(--${name}))` }} />
                  <span className="text-caption text-muted-foreground" lang="en" dir="ltr">
                    {name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {SEMANTIC_SURFACES.map(([bg, fg]) => (
            <div
              key={bg}
              className="flex min-h-20 flex-col justify-between rounded-md border border-border p-3"
              style={{ backgroundColor: `rgb(var(--${bg}))`, color: `rgb(var(--${fg}))` }}
            >
              <span className="text-support font-semibold">Aa نص</span>
              <span className="text-caption" lang="en" dir="ltr">
                {bg} / {fg}
              </span>
            </div>
          ))}
        </div>

        <ContrastTable />
      </Section>

      <Section
        id="shape"
        title="Shape and elevation"
        description="Three radii. Circles are reserved for step markers and avatars, so a circle always means progress or a person. Borders separate; shadows are only for things that float."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['rounded-sm', '4px · inputs, badges'],
            ['rounded-md', '8px · buttons, cards, media'],
            ['rounded-lg', '12px · dialogs, sheets'],
            ['rounded-full', 'step markers only'],
          ].map(([radius, use]) => (
            <div key={radius} className="flex flex-col items-start gap-2">
              <div className={cn('size-16 border-2 border-primary bg-primary-subtle', radius)} />
              <p className="text-caption text-muted-foreground" lang="en" dir="ltr">
                <code>{radius}</code> — {use}
              </p>
            </div>
          ))}
          <div className="flex flex-col items-start gap-2">
            <div className="size-16 rounded-md border border-border bg-card shadow-raised" />
            <p className="text-caption text-muted-foreground" lang="en" dir="ltr">
              <code>shadow-raised</code>
            </p>
          </div>
          <div className="flex flex-col items-start gap-2">
            <div className="size-16 rounded-lg border border-border bg-popover shadow-overlay" />
            <p className="text-caption text-muted-foreground" lang="en" dir="ltr">
              <code>shadow-overlay</code>
            </p>
          </div>
          <div className="flex flex-col items-start gap-2">
            <div className="h-16 w-full rounded-sm border border-border bg-card" />
            <p className="text-caption text-muted-foreground" lang="en" dir="ltr">
              <code>border</code> — decorative divider
            </p>
          </div>
          <div className="flex flex-col items-start gap-2">
            <div className="h-16 w-full rounded-sm border border-input bg-card" />
            <p className="text-caption text-muted-foreground" lang="en" dir="ltr">
              <code>input</code> — control boundary ≥ 3:1
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="components"
        title="Core components"
        description="Shared primitives restored from the previous frontend and refitted to the tokens. Tab through this section to check focus indicators."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Button</CardTitle>
              <CardDescription>Variants, sizes, disabled (no opacity-only), loading (stays focusable).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Small</Button>
                <Button>Default 44px</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" aria-label="Search">
                  <Search aria-hidden="true" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled>Disabled</Button>
                <Button variant="outline" disabled>
                  Disabled outline
                </Button>
                <Button loading>Saving</Button>
                <Button variant="secondary" loading>
                  Loading
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Input and label</CardTitle>
              <CardDescription>Error state is driven by aria-invalid and linked to its message.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="lab-name">Full name</Label>
                <Input id="lab-name" placeholder="As it should appear on the delivery" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="lab-area">Area</Label>
                <Input id="lab-area" defaultValue="Zamalek?" aria-invalid="true" aria-describedby="lab-area-error" />
                <p id="lab-area-error" className="flex items-center gap-1.5 text-support text-destructive">
                  <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                  Choose an area from the list.
                </p>
              </div>
              {/* Input precedes its label in the DOM so `peer-disabled` can restyle the label; shown label-first. */}
              <div className="flex flex-col-reverse gap-2">
                <Input id="lab-disabled" disabled defaultValue="Cairo" className="peer" />
                <Label htmlFor="lab-disabled">Governorate (disabled)</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Badge</CardTitle>
              <CardDescription>Label text always states the meaning; tone is a second cue.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge>Primary</Badge>
              <Badge variant="secondary">Neutral</Badge>
              <Badge variant="accent">Accent</Badge>
              <Badge variant="success">
                <CheckCircle2 aria-hidden="true" />
                Available
              </Badge>
              <Badge variant="warning">Low stock</Badge>
              <Badge variant="destructive">Unavailable</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="outline">Outline</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Loading placeholders</CardTitle>
              <CardDescription>Skeletons are decorative; the region announces loading.</CardDescription>
            </CardHeader>
            <CardContent aria-busy="true" className="flex gap-4">
              <Skeleton className="size-20 shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-6 w-1/3" />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 lg:col-span-2">
            <Alert variant="info">
              <Info aria-hidden="true" />
              <div>
                <AlertTitle>Availability is confirmed after ordering</AlertTitle>
                <AlertDescription>You will be notified if anything changes before delivery.</AlertDescription>
              </div>
            </Alert>
            <Alert variant="success">
              <CheckCircle2 aria-hidden="true" />
              <div>
                <AlertTitle>Added to cart</AlertTitle>
              </div>
            </Alert>
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <div>
                <AlertTitle>One item needs your decision</AlertTitle>
                <AlertDescription>Choose a replacement or remove it to continue.</AlertDescription>
              </div>
            </Alert>
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <div>
                <AlertTitle>We could not place your order</AlertTitle>
                <AlertDescription>Nothing was charged. Please try again.</AlertDescription>
              </div>
            </Alert>
          </div>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Overlays</CardTitle>
              <CardDescription>
                Dialog and Sheet follow the page direction: a sheet on the “end” side opens from the left in Arabic and
                from the right in English. Close labels come from the locale messages.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Open dialog</Button>
                </DialogTrigger>
                <DialogContent closeLabel={m.close}>
                  <DialogHeader>
                    <DialogTitle>Remove this item?</DialogTitle>
                    <DialogDescription>You can add it again from the product page.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Keep</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="destructive">Remove</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              {(['end', 'start', 'bottom'] as const).map((side) => (
                <Sheet key={side}>
                  <SheetTrigger asChild>
                    <Button variant="outline">Sheet · {side}</Button>
                  </SheetTrigger>
                  <SheetContent side={side} closeLabel={m.close}>
                    <SheetHeader>
                      <SheetTitle>Filters</SheetTitle>
                      <SheetDescription>Sheet opened on the logical “{side}” side.</SheetDescription>
                    </SheetHeader>
                  </SheetContent>
                </Sheet>
              ))}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        id="direction"
        title="RTL and LTR"
        description="The same markup with only lang/dir changed. Logical properties flip spacing, the step connector and the error icon; the arrow is mirrored on purpose; phone numbers and Latin product names stay LTR."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <DirectionPanel locale="ar" />
          <DirectionPanel locale="en" />
        </div>
      </Section>

      <Section
        id="guidance"
        title="Guidance visuals — what is real and what is deferred"
        description="Guidance visuals may only render real data. The step sequence above uses the backend's customer order stages (CUSTOMER_STAGES) with a fixed sample state for layout review."
      >
        <Alert variant="neutral">
          <Info aria-hidden="true" />
          <div>
            <AlertTitle>Deferred until backend contracts exist</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-5">
                <li>Reason note (“why this suits you”) — no explainable-reason field in the catalog/care API.</li>
                <li>Routine role and step position on products — routine roles are not in the product contract (GLO-183).</li>
                <li>Product fit indicators — no verified fit data; must never be inferred in the UI.</li>
              </ul>
            </AlertDescription>
          </div>
        </Alert>
      </Section>
    </div>
  );
}
