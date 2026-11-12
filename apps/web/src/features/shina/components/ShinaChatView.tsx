'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import { useReducedMotion } from 'motion/react';
import { Icon } from '@/components/ui/icon';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/hooks/useCart';
import { getProductDetail } from '@/features/catalog/api/discovery';
import { getProducts, type ProductView } from '@/features/catalog/api/products';
import { ApiError } from '@/lib/api-client';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { buildStarterSuggestions, classifyShinaIntent } from '../lib/catalog-chat';
import {
  createGuidanceSession,
  getCustomerCareProfile,
  sendGuidanceMessage,
  retryGuidanceMessage,
} from '../lib/shina-api';
import {
  buildContextProductMessage,
  createMessageId,
  formatTimeLabel,
  mapGuidanceDtoToMessage,
  runCatalogCompareWorkflow,
  runCatalogRoutineWorkflow,
  runCatalogSearchWorkflow,
} from '../lib/shina-workflows';
import type { ShinaActivityState, ShinaMessage, ShinaProduct } from '../lib/shina-types';
import { ShinaActivityCapsule } from './ShinaActivityCapsule';
import { ShinaMascot } from './ShinaMascot';
import {
  ShinaComparisonCard,
  ShinaProductCarousel,
  ShinaRoutineCard,
} from './ShinaProductCards';

export interface ShinaChatViewProps {
  initialQuery?: string;
  contextProductSlug?: string;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

export function ShinaChatView({ initialQuery, contextProductSlug }: ShinaChatViewProps) {
  const m = useMessages();
  const locale = useLocale();
  const prefersReducedMotion = Boolean(useReducedMotion());
  const { isAuthenticated, isLoading: authLoading, withAuth } = useAuth();
  const { addItem } = useCart();

  const [messages, setMessages] = useState<ShinaMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [activityState, setActivityState] = useState<ShinaActivityState>('idle');
  const [activityDetail, setActivityDetail] = useState<string | undefined>(undefined);
  const [addingSkuId, setAddingSkuId] = useState<string | null>(null);
  const [addedSkuIds, setAddedSkuIds] = useState<Set<string>>(() => new Set());
  const [isBatchAdding, setIsBatchAdding] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const hasServerUserTurnRef = useRef(false);
  const catalogCacheRef = useRef<ProductView[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFailedQueryRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);
  const profileLoadedRef = useRef(false);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const voice = useVoiceInput({
    locale,
    onTranscript: (text) => {
      setDraft(text);
    },
  });

  const effectiveState: ShinaActivityState = voice.isListening ? 'listening' : activityState;
  const isBusy =
    activityState === 'thinking' ||
    activityState === 'searching' ||
    activityState === 'comparing' ||
    activityState === 'routine' ||
    activityState === 'recommending' ||
    activityState === 'streaming';

  const scrollToLatest = useCallback(() => {
    bottomAnchorRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [prefersReducedMotion]);

  useEffect(() => {
    scrollToLatest();
  }, [messages, effectiveState, scrollToLatest]);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => {
      if (vv.height < window.innerHeight - 120) {
        scrollToLatest();
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [scrollToLatest]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [draft]);

  const abortActiveRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setActivityState('idle');
    setActivityDetail(undefined);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadCatalog = useCallback(async (signal?: AbortSignal): Promise<ProductView[]> => {
    if (catalogCacheRef.current) return catalogCacheRef.current;
    const list = await getProducts(100);
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    catalogCacheRef.current = list;
    return list;
  }, []);

  const runCatalogFallback = useCallback(
    async (query: string) => {
      abortActiveRequest();
      const controller = new AbortController();
      abortRef.current = controller;
      setActivityState('searching');
      setActivityDetail(query);

      try {
        const catalog = await loadCatalog(controller.signal);
        const intent = classifyShinaIntent(query);
        const outcome =
          intent === 'compare'
            ? await runCatalogCompareWorkflow(query, catalog, locale, isAuthenticated, controller.signal)
            : intent === 'routine'
              ? await runCatalogRoutineWorkflow(query, catalog, locale, isAuthenticated, controller.signal)
              : runCatalogSearchWorkflow(query, catalog, locale, isAuthenticated);

        setMessages((prev) => [...prev, outcome.message]);
        setActivityState(outcome.state);
        setActivityDetail(undefined);
      } catch (err) {
        if (isAbortError(err)) return;
        setActivityState('warning');
        setActivityDetail(undefined);
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId('cat-err'),
            role: 'assistant',
            content:
              locale === 'ar'
                ? 'تعذر الوصول إلى بيانات الكتالوج حاليًا. تحققي من الاتصال وحاولي مجددًا.'
                : 'Could not reach the live catalog right now. Please check your connection and try again.',
            timestamp: formatTimeLabel(locale),
            sourceKind: 'error',
            isError: true,
            retryable: true,
            pendingQuery: query,
          },
        ]);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [abortActiveRequest, isAuthenticated, loadCatalog, locale],
  );

  const sendAiTurn = useCallback(
    async (query: string, signal: AbortSignal): Promise<{ message: ShinaMessage; state: ShinaActivityState }> => {
      if (!profileLoadedRef.current) {
        profileLoadedRef.current = true;
        getCustomerCareProfile(signal).catch(() => null);
      }

      if (!sessionIdRef.current) {
        const session = await createGuidanceSession(signal);
        sessionIdRef.current = session.id;
        hasServerUserTurnRef.current = false;
      }

      const response = await sendGuidanceMessage(sessionIdRef.current, query, signal);
      hasServerUserTurnRef.current = true;
      lastFailedQueryRef.current = null;
      return mapGuidanceDtoToMessage(response, locale, true);
    },
    [locale],
  );

  const submitQuery = useCallback(
    async (rawText: string, options?: { forceAi?: boolean; skipUserEcho?: boolean }) => {
      const text = rawText.trim();
      if (!text) return;

      if (voice.isListening) {
        voice.stopListening();
      }
      voice.clearError();
      abortActiveRequest();

      const controller = new AbortController();
      abortRef.current = controller;

      if (!options?.skipUserEcho) {
        const userMessage: ShinaMessage = {
          id: createMessageId('usr'),
          role: 'user',
          content: text,
          timestamp: formatTimeLabel(locale),
        };
        setMessages((prev) => [...prev, userMessage]);
        setDraft('');
      }

      const intent = classifyShinaIntent(text);
      const authed = options?.forceAi || isAuthenticated;

      setActivityDetail(text);

      try {
        // Explicit comparison executes real dual-product detail lookup for factual specs.
        if (intent === 'compare' && !options?.forceAi) {
          setActivityState('comparing');
          const catalog = await loadCatalog(controller.signal);
          const outcome = await runCatalogCompareWorkflow(
            text,
            catalog,
            locale,
            authed,
            controller.signal,
          );
          setMessages((prev) => [...prev, outcome.message]);
          setActivityState(outcome.state);
          setActivityDetail(undefined);
          return;
        }

        // Signed-in customers use real GuidanceService AI session cleanly.
        if (authed) {
          setActivityState(
            intent === 'routine' ? 'routine' : intent === 'search' ? 'searching' : 'thinking',
          );
          const outcome = await sendAiTurn(text, controller.signal);
          setMessages((prev) => [...prev, outcome.message]);
          setActivityState(outcome.state);
          setActivityDetail(undefined);
          return;
        }

        // Guest visitors get live catalog search & routine sequencing cleanly,
        // or a truthful sign-in gate through the existing AuthModal for personalized AI chat.
        if (intent === 'search') {
          setActivityState('searching');
          const catalog = await loadCatalog(controller.signal);
          const outcome = runCatalogSearchWorkflow(text, catalog, locale, false);
          setMessages((prev) => [...prev, outcome.message]);
          setActivityState(outcome.state);
          setActivityDetail(undefined);
          return;
        }

        if (intent === 'routine') {
          setActivityState('routine');
          const catalog = await loadCatalog(controller.signal);
          const outcome = await runCatalogRoutineWorkflow(
            text,
            catalog,
            locale,
            false,
            controller.signal,
          );
          setMessages((prev) => [...prev, outcome.message]);
          setActivityState(outcome.state);
          setActivityDetail(undefined);
          return;
        }

        setActivityState('clarification');
        setActivityDetail(undefined);
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId('auth-gate'),
            role: 'assistant',
            content:
              locale === 'ar'
                ? 'للمحادثة الذكية المخصصة وحفظ سياق الجلسة، يرجى تسجيل الدخول أولاً. يمكنك أيضًا البحث في الكتالوج أو مقارنة منتجين مباشرة الآن.'
                : 'Sign in to start a personalized AI consultation session with Shina. You can still search the catalog or compare products directly as a guest.',
            timestamp: formatTimeLabel(locale),
            sourceKind: 'ai-guidance',
            requiresAuthPrompt: true,
            pendingQuery: text,
            suggestions: buildStarterSuggestions(locale).slice(0, 3),
          },
        ]);
      } catch (err) {
        if (isAbortError(err)) return;

        lastFailedQueryRef.current = text;
        const isAuthFailure = err instanceof ApiError && err.status === 401;
        if (isAuthFailure) {
          setActivityState('clarification');
          setActivityDetail(undefined);
          setMessages((prev) => [
            ...prev,
            {
              id: createMessageId('auth-expired'),
              role: 'assistant',
              content: m.shinaGuestNotice,
              timestamp: formatTimeLabel(locale),
              sourceKind: 'ai-guidance',
              requiresAuthPrompt: true,
              pendingQuery: text,
            },
          ]);
          return;
        }

        const retryable =
          err instanceof ApiError
            ? Boolean((err.data as { retryable?: boolean } | undefined)?.retryable ?? err.status >= 500)
            : true;

        setActivityState('warning');
        setActivityDetail(undefined);
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId('err'),
            role: 'assistant',
            content:
              err instanceof ApiError && err.message
                ? locale === 'ar'
                  ? 'خدمة المستشارة الذكية غير متاحة مؤقتًا حاليًا. يمكنك إعادة المحاولة أو البحث في الكتالوج مباشرة.'
                  : `${err.message} You can retry or search the live catalog directly.`
                : locale === 'ar'
                  ? 'تعذر إتمام الطلب حاليًا. جربي إعادة المحاولة أو البحث المباشر في الكتالوج.'
                  : 'We could not complete that request right now. Try retrying or searching the live catalog.',
            timestamp: formatTimeLabel(locale),
            sourceKind: 'error',
            isError: true,
            retryable,
            pendingQuery: text,
          },
        ]);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [abortActiveRequest, isAuthenticated, loadCatalog, locale, m.shinaGuestNotice, sendAiTurn, voice],
  );

  const handleRetryLast = useCallback(
    async (fallbackQuery?: string) => {
      const targetQuery = fallbackQuery || lastFailedQueryRef.current;
      if (isAuthenticated && sessionIdRef.current && hasServerUserTurnRef.current) {
        abortActiveRequest();
        const controller = new AbortController();
        abortRef.current = controller;
        setActivityState('thinking');
        setActivityDetail(targetQuery ?? undefined);

        try {
          const retried = await retryGuidanceMessage(sessionIdRef.current, controller.signal);
          const outcome = mapGuidanceDtoToMessage(retried, locale, true);
          lastFailedQueryRef.current = null;
          setMessages((prev) => [...prev, outcome.message]);
          setActivityState(outcome.state);
          setActivityDetail(undefined);
          return;
        } catch (err) {
          if (isAbortError(err)) return;
          setActivityState('warning');
          setActivityDetail(undefined);
          if (targetQuery) {
            await runCatalogFallback(targetQuery);
            return;
          }
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        }
      }

      if (targetQuery) {
        await submitQuery(targetQuery, { skipUserEcho: true });
      }
    },
    [abortActiveRequest, isAuthenticated, locale, runCatalogFallback, submitQuery],
  );

  const handlePromptAuth = useCallback(
    (pendingQuery?: string) => {
      withAuth(
        async () => {
          if (pendingQuery) {
            await submitQuery(pendingQuery, { forceAi: true, skipUserEcho: true });
          } else if (!sessionIdRef.current) {
            const session = await createGuidanceSession();
            sessionIdRef.current = session.id;
          }
        },
        {
          title: m.shinaSignInAction,
          description: m.shinaGuestNotice,
        },
      );
    },
    [m.shinaGuestNotice, m.shinaSignInAction, submitQuery, withAuth],
  );

  const handleAddToBag = useCallback(
    async (product: Pick<ShinaProduct, 'skuId' | 'name' | 'canOrder'>) => {
      if (!product.canOrder || !product.skuId) return;
      setAddingSkuId(product.skuId);
      try {
        await addItem({ skuId: product.skuId, quantity: 1 });
        setAddedSkuIds((prev) => {
          const next = new Set(prev);
          next.add(product.skuId);
          return next;
        });
      } catch {
        setActivityState('warning');
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId('cart-err'),
            role: 'assistant',
            content: m.cardAddFailed,
            timestamp: formatTimeLabel(locale),
            sourceKind: 'error',
            isError: true,
            retryable: false,
          },
        ]);
      } finally {
        setAddingSkuId(null);
      }
    },
    [addItem, locale, m.cardAddFailed],
  );

  const handleAddManyToBag = useCallback(
    async (products: ShinaProduct[]) => {
      const valid = products.filter((item) => item.canOrder && item.skuId);
      if (valid.length === 0) return;
      setIsBatchAdding(true);
      try {
        const added: string[] = [];
        for (const item of valid) {
          await addItem({ skuId: item.skuId, quantity: 1 });
          added.push(item.skuId);
        }
        setAddedSkuIds((prev) => {
          const next = new Set(prev);
          for (const id of added) next.add(id);
          return next;
        });
      } catch {
        setActivityState('warning');
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId('cart-batch-err'),
            role: 'assistant',
            content: m.cardAddFailed,
            timestamp: formatTimeLabel(locale),
            sourceKind: 'error',
            isError: true,
            retryable: false,
          },
        ]);
      } finally {
        setIsBatchAdding(false);
      }
    },
    [addItem, locale, m.cardAddFailed],
  );

  const handleResetSession = useCallback(() => {
    abortActiveRequest();
    if (voice.isListening) voice.stopListening();
    voice.clearError();
    sessionIdRef.current = null;
    hasServerUserTurnRef.current = false;
    lastFailedQueryRef.current = null;
    setMessages([]);
    setDraft('');
    setActivityState('idle');
    setActivityDetail(undefined);
  }, [abortActiveRequest, voice]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (!contextProductSlug && !initialQuery) return;
    bootstrappedRef.current = true;

    if (contextProductSlug) {
      setActivityState('searching');
      getProductDetail(contextProductSlug)
        .then((detail) => {
          setMessages([buildContextProductMessage(detail, locale)]);
          setActivityState('completed');
        })
        .catch(() => {
          setActivityState('warning');
          setMessages([
            {
              id: createMessageId('ctx-err'),
              role: 'assistant',
              content:
                locale === 'ar'
                  ? 'تعذر تحميل تفاصيل هذا المنتج حاليًا من الكتالوج.'
                  : 'Could not load that product detail from the catalog right now.',
              timestamp: formatTimeLabel(locale),
              sourceKind: 'error',
              isError: true,
            },
          ]);
        });
      return;
    }

    if (initialQuery) {
      submitQuery(initialQuery);
    }
  }, [contextProductSlug, initialQuery, locale, submitQuery]);

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim() && !isBusy) {
        submitQuery(draft);
      }
    }
  };

  const starterChips = buildStarterSuggestions(locale);

  return (
    <section
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-label={m.shinaAssistantTitle}
      className="relative flex flex-1 min-h-0 flex-col overflow-hidden bg-sand font-display text-ink"
    >
      {/* Warm sunlit studio plaster backdrop synced with Stitch & SAHEL */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <Image
          src="/images/shina/shina-ambient-bg.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-90 select-none"
        />
        <div className="absolute inset-0 shina-ambient-glow" />
      </div>

      {/* Hidden H1 for accessibility */}
      <h1 className="sr-only">{m.shinaAssistantTitle}</h1>

      {/* Minimal floating controls (ChatGPT-style: compact mascot icon + New Chat icon button) */}
      <div className="pointer-events-none absolute inset-x-0 top-3.5 z-20 px-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between">
          <div
            className="pointer-events-auto flex items-center justify-center rounded-full p-0.5 drop-shadow-sm transition-transform hover:scale-105"
            title={m.shinaAssistantTitle}
            aria-label={m.shinaAssistantTitle}
          >
            <ShinaMascot state={effectiveState} size="sm" decorative />
          </div>

          <button
            type="button"
            onClick={handleResetSession}
            title={m.shinaNewSession}
            aria-label={m.shinaNewSession}
            className="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full border border-linen/85 bg-linen/75 text-ink shadow-elevation-1 backdrop-blur-md transition-colors hover:border-cobalt hover:bg-linen hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>

      {/* Scrollable Message Stream */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-4 pt-14 pb-4 sm:px-6 sm:pt-14 sm:pb-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-1 text-center sm:gap-4 sm:py-8">
              <ShinaMascot
                state={effectiveState === 'idle' ? 'idle' : effectiveState}
                size="hero"
                alt={m.shinaAssistantTitle}
              />

              <div className="space-y-1 sm:space-y-1.5">
                <h2 className="font-display text-24 font-bold text-ink sm:text-30">
                  {m.shinaWelcomeHeading}
                </h2>
                <p className="mx-auto max-w-md text-13 font-medium leading-snug text-ink/85 sm:text-14 sm:leading-relaxed">
                  {m.shinaWelcomeBody}
                </p>
              </div>

              {!authLoading ? (
                isAuthenticated ? (
                  <p className="inline-flex items-center gap-1.5 rounded-pill border border-ok/35 bg-ok-tint/85 px-4 py-1.5 text-12 font-semibold text-ok shadow-elevation-1 backdrop-blur-sm">
                    <Icon name="check" size={14} />
                    <span>{m.shinaAiConnectedNote}</span>
                  </p>
                ) : (
                  <div className="flex w-full max-w-lg flex-col items-center justify-between gap-2 rounded-card border border-linen/80 bg-linen/70 px-3 py-2 text-start shadow-elevation-1 backdrop-blur-md sm:flex-row sm:gap-3 sm:px-4 sm:py-3">
                    <p className="text-11 font-medium leading-snug text-ink/85 sm:text-12 sm:leading-relaxed">{m.shinaGuestNotice}</p>
                    <button
                      type="button"
                      onClick={() => handlePromptAuth()}
                      className="inline-flex min-h-control-s shrink-0 items-center justify-center gap-1.5 rounded-pill bg-cobalt px-3.5 font-display text-12 font-bold text-chalk transition-colors hover:bg-cobalt-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt sm:px-4"
                    >
                      <Icon name="user" size={16} />
                      <span>{m.shinaSignInAction}</span>
                    </button>
                  </div>
                )
              ) : null}

              <div className="grid w-full max-w-xl grid-cols-2 gap-2 pt-0.5 sm:flex sm:max-w-3xl sm:flex-wrap sm:justify-center sm:gap-2.5 sm:pt-1">
                {starterChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={isBusy}
                    onClick={() => submitQuery(chip)}
                    className="inline-flex min-h-control-s items-center justify-center rounded-card border border-linen/85 bg-linen/70 px-3 py-1.5 text-center font-display text-12 font-semibold text-ink shadow-elevation-1 backdrop-blur-md transition-colors hover:border-cobalt/50 hover:bg-linen/90 hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:opacity-50 sm:rounded-pill sm:px-3.5 sm:py-2"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex flex-col items-end gap-1">
                  <div className="max-w-xl rounded-card bg-cobalt px-4 py-2.5 text-14 leading-relaxed text-chalk shadow-action sm:text-15">
                    {msg.content}
                  </div>
                  <span className="px-1 text-11 text-stone">{msg.timestamp}</span>
                </div>
              );
            }

            return (
              <article key={msg.id} className="flex w-full flex-col items-start gap-2.5">
                <div className="flex items-center gap-2 text-11 text-ink/75">
                  <ShinaMascot state="idle" size="xs" decorative />
                  <span className="font-medium text-ink">{m.shinaAssistantTitle}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {msg.sourceKind === 'ai-guidance' ? m.shinaSourceAi : m.shinaSourceCatalog}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{msg.timestamp}</span>
                </div>

                <div
                  className={cn(
                    'w-fit max-w-full rounded-card border px-4 py-3 text-14 leading-relaxed shadow-elevation-1 backdrop-blur-md whitespace-pre-line sm:max-w-3xl sm:text-15',
                    msg.isError
                      ? 'border-tomato/40 bg-tomato/10 text-tomato-ink'
                      : 'border-linen/80 bg-linen/80 text-ink',
                  )}
                >
                  {msg.content}
                </div>

                {msg.requiresAuthPrompt ? (
                  <button
                    type="button"
                    onClick={() => handlePromptAuth(msg.pendingQuery)}
                    className="inline-flex min-h-control-s items-center gap-2 rounded-pill bg-cobalt px-4 font-display text-13 font-bold text-chalk shadow-action transition-colors hover:bg-cobalt-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
                  >
                    <Icon name="user" size={16} />
                    <span>{m.shinaSignInAction}</span>
                  </button>
                ) : null}

                {msg.products && msg.products.length > 0 ? (
                  <ShinaProductCarousel
                    products={msg.products}
                    onAddToBag={handleAddToBag}
                    addingSkuId={addingSkuId}
                    addedSkuIds={addedSkuIds}
                  />
                ) : null}

                {msg.comparison ? (
                  <ShinaComparisonCard
                    comparison={msg.comparison}
                    onAddToBag={handleAddToBag}
                    addingSkuId={addingSkuId}
                    addedSkuIds={addedSkuIds}
                  />
                ) : null}

                {msg.routine ? (
                  <ShinaRoutineCard
                    routine={msg.routine}
                    onAddToBag={handleAddToBag}
                    onAddManyToBag={handleAddManyToBag}
                    addingSkuId={addingSkuId}
                    addedSkuIds={addedSkuIds}
                    isBatchAdding={isBatchAdding}
                  />
                ) : null}

                {msg.isError ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {msg.retryable !== false ? (
                      <button
                        type="button"
                        onClick={() => handleRetryLast(msg.pendingQuery)}
                        className="inline-flex min-h-control-s items-center gap-1.5 rounded-pill border border-tomato/35 bg-chalk px-3.5 font-display text-12 font-bold text-tomato-ink transition-colors hover:bg-tomato/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
                      >
                        <Icon name="retry" size={15} />
                        <span>{m.shinaRetryAction}</span>
                      </button>
                    ) : null}

                    {msg.pendingQuery ? (
                      <button
                        type="button"
                        onClick={() => runCatalogFallback(msg.pendingQuery!)}
                        className="inline-flex min-h-control-s items-center gap-1.5 rounded-pill border border-line bg-linen px-3.5 font-display text-12 font-bold text-ink transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
                      >
                        <Icon name="search" size={15} />
                        <span>{m.shinaSearchCatalogFallback}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {(msg.products?.length || msg.routine || msg.sourceKind === 'ai-guidance') && !msg.isError ? (
                  <p className="text-11 text-ink/75">{m.shinaSafetyNote}</p>
                ) : null}

                {msg.suggestions && msg.suggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {msg.suggestions.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        disabled={isBusy}
                        onClick={() => submitQuery(chip)}
                        className="inline-flex min-h-control-s items-center rounded-pill border border-linen/80 bg-linen/70 px-3 py-1 font-display text-12 font-semibold text-ink shadow-elevation-1 backdrop-blur-md transition-colors hover:border-cobalt/50 hover:bg-linen hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:opacity-50"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}

          {effectiveState !== 'idle' && effectiveState !== 'completed' ? (
            <div className="flex justify-start">
              <ShinaActivityCapsule
                state={effectiveState}
                detail={activityDetail}
                onCancel={isBusy ? abortActiveRequest : undefined}
                onRetry={effectiveState === 'warning' ? () => handleRetryLast() : undefined}
              />
            </div>
          ) : null}

          <div ref={bottomAnchorRef} className="h-4 shrink-0" />
        </div>
      </div>

      {/* Compact Anchored Composer (48-52px height, 650-720px max width) */}
      <footer className="relative z-20 shrink-0 bg-gradient-to-t from-sand/35 via-chalk/10 to-transparent px-4 pb-3 pt-1 sm:px-6 sm:pb-4">
        <div className="mx-auto w-full max-w-2xl space-y-2">
          {voice.errorKind ? (
            <div
              role="status"
              className="flex items-center justify-between gap-2 rounded-card border border-tomato/30 bg-linen/85 px-3 py-2 text-12 text-tomato-ink backdrop-blur-md"
            >
              <span>
                {voice.errorKind === 'unsupported'
                  ? m.shinaVoiceUnsupported
                  : voice.errorKind === 'denied'
                    ? m.shinaVoiceDenied
                    : m.shinaStateWarning}
              </span>
              <button
                type="button"
                onClick={voice.clearError}
                aria-label={m.close}
                className="inline-flex size-7 items-center justify-center rounded-full hover:bg-sand"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim() && !isBusy) {
                submitQuery(draft);
              }
            }}
            className="shina-composer-glass flex min-h-12 items-end gap-1.5 rounded-pill border border-linen/90 bg-linen/50 p-1.5 backdrop-blur-xl transition-all hover:bg-linen/60 focus-within:border-cobalt/80 focus-within:bg-linen/75 focus-within:shadow-focus-field"
          >
            <button
              type="button"
              onClick={voice.isListening ? voice.stopListening : voice.startListening}
              aria-pressed={voice.isListening}
              aria-label={voice.isListening ? m.shinaVoiceStop : m.shinaVoiceStart}
              title={!voice.isSupported ? m.shinaVoiceUnsupported : undefined}
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
                voice.isListening
                  ? 'bg-tomato text-chalk'
                  : 'text-ink/70 hover:bg-linen/60 hover:text-ink',
              )}
            >
              <Icon name={voice.isListening ? 'mic-off' : 'mic'} size={18} />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={m.shinaComposerPlaceholder}
              aria-label={m.shinaComposerAriaLabel}
              className="max-h-24 min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-13.5 leading-snug text-ink placeholder:text-ink/60 focus:outline-none sm:text-14"
            />

            {isBusy ? (
              <button
                type="button"
                onClick={abortActiveRequest}
                aria-label={m.shinaCancelRequest}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-tomato text-chalk shadow-action transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
              >
                <Icon name="stop" size={16} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label={m.shinaSend}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-cobalt text-chalk shadow-action transition-colors hover:bg-cobalt-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:cursor-not-allowed disabled:bg-cobalt/35 disabled:text-linen"
              >
                <Icon name="arrow-up" size={18} />
              </button>
            )}
          </form>
        </div>
      </footer>
    </section>
  );
}
