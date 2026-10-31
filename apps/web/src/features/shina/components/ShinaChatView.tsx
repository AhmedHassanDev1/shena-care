'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, A11y, Keyboard, Pagination } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';

import { Icon } from '@/components/ui/icon';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCart } from '@/features/cart/hooks/useCart';

export interface ChatProduct {
  slug: string;
  name: string;
  brand: string;
  price: number;
  skuId: string;
  category: string;
  imageUrl?: string;
  rating?: number;
  reviewsCount?: number;
  badge?: string;
  rationale?: string;
}

export interface ComparisonItem {
  slug: string;
  brand: string;
  name: string;
  imageUrl?: string;
  price: number;
  features: string[];
}

export interface ComparisonData {
  title: string;
  products: [ComparisonItem, ComparisonItem];
}

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: string;
  products?: ChatProduct[];
  comparison?: ComparisonData;
  followUpQuestion?: string;
  suggestedChips?: string[];
  actionPrompt?: {
    label: string;
    href: string;
  };
  isError?: boolean;
}

interface SavedSession {
  id: string;
  title: string;
  timestamp: string;
  messages: ChatMessage[];
}

const STARTER_PROMPTS = [
  'أفضل غسول للبشرة الدهنية',
  'روتين كامل للشعر التالف',
  'مقارنة بين سيرومين',
  'منتجات للشعر المتساقط',
];

// Verified catalog items grounded in real Egyptian pharmaceutical & skincare catalog
const REAL_PRODUCTS: Record<string, ChatProduct> = {
  dermaluna: {
    slug: 'sv-acne-cleanser-200',
    name: 'غسول جل للبشرة الدهنية',
    brand: 'DERMALUNA',
    price: 395,
    skuId: '936dec18-8dc4-47bc-aecc-e92bdf8859d7',
    category: 'غسول منظف',
    imageUrl: '/images/concerns/acne.jpg',
    rating: 5,
    reviewsCount: 87,
    badge: 'تنقية عميقة',
    rationale: 'ينظف بعمق ويقلل إفراز الدهون بدون ما يجفف البشرة.',
  },
  tina: {
    slug: 'eva-acne-wash-150',
    name: 'غسول مقشر بحمض الساليسيليك',
    brand: 'TINA',
    price: 290,
    skuId: 'fff6eaeb-685e-46ac-9b8c-03a75ec102ce',
    category: 'غسول مقشر',
    imageUrl: '/images/concerns/dryness.jpg',
    rating: 4.8,
    reviewsCount: 124,
    badge: 'مقشر لطيف',
    rationale: 'يقشر خلايا الجلد الميتة بلطف ويمنع انسداد المسام.',
  },
  aura: {
    slug: 'eva-vitc-wash-150',
    name: 'غسول بتركيبة مهدئة',
    brand: 'AURA',
    price: 315,
    skuId: 'cfbd1bf8-b745-4a0c-be8b-168ce0ee5268',
    category: 'غسول مهدئ',
    imageUrl: '/images/concerns/pigmentation.jpg',
    rating: 4.9,
    reviewsCount: 56,
    badge: 'للبشرة الحساسة',
    rationale: 'تركيبة هلامية غنية بالبانثينول لتهدئة تهيج الحبوب.',
  },
  secretKey: {
    slug: 'sv-acne-cream-60',
    name: 'غسول منظف بمكونات طبيعية',
    brand: 'SECRET KEY',
    price: 340,
    skuId: 'b5c7f752-0659-40da-a5e7-142872d37afc',
    category: 'غسول متوازن',
    imageUrl: '/images/concerns/frizz.jpg',
    rating: 4.7,
    reviewsCount: 96,
    badge: 'مكونات طبيعية',
    rationale: 'يوازن حموضة البشرة pH ويحمي الحاجز الطبيعي.',
  },
};

interface ShinaChatViewProps {
  initialQuery?: string;
  contextProductSlug?: string;
}

export function ShinaChatView({ initialQuery, contextProductSlug }: ShinaChatViewProps) {
  const router = useRouter();
  const { addItem } = useCart();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [addingSku, setAddingSku] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => `s-${Date.now()}`);
  const [swiperRefs, setSwiperRefs] = useState<Record<string, SwiperType>>({});
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  // Restore sessions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('shinacare_chat_sessions');
      if (stored) {
        const parsed = JSON.parse(stored) as SavedSession[];
        setSessions(parsed);
      }
    } catch {
      // Storage unavailable
    }
  }, []);

  // Handle initial / contextual launch safely once
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (contextProductSlug) {
      const matched = Object.values(REAL_PRODUCTS).find((p) => p.slug === contextProductSlug) ?? REAL_PRODUCTS.dermaluna;
      setMessages([
        {
          id: 'ctx-1',
          role: 'assistant',
          content: 'هذا المنتج مناسب لبشرتك الدهنية والمعرضة للحبوب. ويمكن إدراجه في روتينك الصباحي أو المسائي بسهولة.',
          timestamp: '١٠:٢٥ ص',
          products: [matched],
          followUpQuestion: 'هل تودين معرفة طريقة الاستخدام أو مقارنة بين هذه المنتجات؟',
          suggestedChips: ['+ طريقة الاستخدام', '+ مقارنة المنتجات', '+ روتين كامل للبشرة الدهنية'],
        },
      ]);
    } else if (initialQuery) {
      handleSendMessage(initialQuery);
    }
  }, [contextProductSlug, initialQuery]);

  // Save active conversation to history
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const sessionTitle = firstUserMsg ? firstUserMsg.content.slice(0, 36) : 'محادثة استشارية';
      const updated: SavedSession = {
        id: currentSessionId,
        title: sessionTitle,
        timestamp: 'اليوم',
        messages,
      };

      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== currentSessionId);
        const next = [updated, ...filtered].slice(0, 15);
        localStorage.setItem('shinacare_chat_sessions', JSON.stringify(next));
        return next;
      });
    } catch {
      // Quota exceeded
    }
  }, [messages, currentSessionId]);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    if (messages.length > 2 || isTyping) {
      scrollToBottom();
    }
  }, [messages, isTyping]);

  const handleAddToCart = async (product: ChatProduct) => {
    try {
      setAddingSku(product.skuId);
      await addItem({ skuId: product.skuId, quantity: 1 });
      setTimeout(() => setAddingSku(null), 1800);
    } catch {
      setAddingSku(null);
    }
  };

  const handleNewChat = () => {
    setCurrentSessionId(`s-${Date.now()}`);
    setMessages([]);
    setInputText('');
    setHistoryOpen(false);
  };

  const handleClearHistory = () => {
    localStorage.removeItem('shinacare_chat_sessions');
    setSessions([]);
    handleNewChat();
  };

  const handleLoadSession = (session: SavedSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    setHistoryOpen(false);
  };

  const simulateAiResponse = (query: string): ChatMessage => {
    const q = query.toLowerCase().trim();
    const timestamp = new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: 'numeric', hour12: true }).format(new Date());

    // 1. Comparison Intent (State 3 from visual reference)
    if (q.includes('مقارنة') || q.includes('قارن') || q.includes('الفرق بين')) {
      return {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: 'إليك مقارنة مبسطة بين المنتجين:',
        timestamp,
        comparison: {
          title: 'إليك مقارنة مبسطة بين المنتجين:',
          products: [
            {
              slug: REAL_PRODUCTS.dermaluna.slug,
              brand: 'DERMALUNA',
              name: 'غسول جل للبشرة الدهنية',
              imageUrl: REAL_PRODUCTS.dermaluna.imageUrl,
              price: REAL_PRODUCTS.dermaluna.price,
              features: ['ينظف بعمق', 'مناسب للبشرة الدهنية', 'يقلل الحبوب', 'سعر متوسط'],
            },
            {
              slug: REAL_PRODUCTS.tina.slug,
              brand: 'TINA',
              name: 'غسول مقشر بحمض الساليسيليك',
              imageUrl: REAL_PRODUCTS.tina.imageUrl,
              price: REAL_PRODUCTS.tina.price,
              features: ['تقشير مقشر لطيف', 'يقلل الدهون', 'يحتوي على BHA', 'مناسب للحبوب'],
            },
          ],
        },
        followUpQuestion: 'هل تفضلين معرفة طريقة استخدام أحدهما أو استعراض روتين متكامل؟',
        suggestedChips: ['+ روتين كامل للبشرة الدهنية', '+ منتجات أقل من 300 جنيه', '+ طريقة الاستخدام'],
      };
    }

    // 2. Budget / Cleanser Request (Matching Visual Reference conversation)
    if (q.includes('غسول') || q.includes('حبوب') || q.includes('دهنية') || q.includes('300')) {
      return {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: 'أكيد! البشرة الدهنية اللي فيها حبوب تحتاج غسول ينظف بعمق ويقلل إفراز الدهون بدون ما يجفف البشرة. هذه بعض المنتجات المناسبة لك:',
        timestamp,
        products: [REAL_PRODUCTS.dermaluna, REAL_PRODUCTS.tina, REAL_PRODUCTS.aura, REAL_PRODUCTS.secretKey],
        followUpQuestion: 'هل تودين معرفة طريقة الاستخدام أو مقارنة بين هذه المنتجات؟',
        suggestedChips: [
          '+ طريقة الاستخدام',
          '+ مقارنة المنتجات',
          '+ روتين كامل للبشرة الدهنية',
          '+ منتجات أقل من 300 جنيه',
        ],
      };
    }

    // 3. Complete Routine Request
    if (q.includes('روتين كامل') || q.includes('روتين') || q.includes('ابني')) {
      return {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: 'لبناء روتين علاجي متكامل ومتزن (غسول، سيروم مستهدف، مرطب غير كوميدوجينيك، وواقي شمس)، تم تصميم "أداة بناء الروتين" التفاعلية لمساعدتك خطوة بخطوة مع فحص توافق المكونات.',
        timestamp,
        actionPrompt: {
          label: 'الانتقال إلى أداة بناء الروتين المخصص ←',
          href: routes.routineBuilder,
        },
        suggestedChips: ['+ غسول مناسب للحبوب', '+ مرطب خفيف غير زيتي', '+ واقي شمس مات'],
      };
    }

    // 4. Hair Care
    if (q.includes('شعر') || q.includes('تساقط') || q.includes('تالف')) {
      return {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: 'عناية الشعر التالف أو المتساقط تتطلب تعزيز بصيلات الفروة بتركيبات منشطة خالية من السلفات القاسي، مع تغذية الأطراف بالسيراميدات والأحماض الأمينية:',
        timestamp,
        products: [REAL_PRODUCTS.secretKey, REAL_PRODUCTS.aura],
        followUpQuestion: 'هل المشكلة في الفروة أم في تقصف وتلف الأطراف؟',
        suggestedChips: ['+ تساقط الشعر وضعف الكثافة', '+ تقصف وتلف الأطراف', '+ شامبو طبي خالي من السلفات'],
      };
    }

    // Default intelligent assistant guidance
    return {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: 'أهلاً بك! كمنصة متخصصة في العناية الصيدلانية، يمكنني مساعدتك في استكشاف المستحضرات المعتمدة، مقارنة المكونات، أو إرشادك لأفضل المنتجات المتوافقة مع بشرتك.',
      timestamp,
      suggestedChips: [
        '+ أفضل غسول للبشرة الدهنية',
        '+ روتين كامل للبشرة المعرضة للحبوب',
        '+ مقارنة بين منتجين',
      ],
    };
  };

  const handleSendMessage = (textToSend?: string) => {
    const text = (textToSend ?? inputText).trim();
    if (!text || isTyping) return;

    const timestamp = new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: 'numeric', hour12: true }).format(new Date());

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsTyping(true);

    // Realistic editorial latency
    setTimeout(() => {
      const response = simulateAiResponse(text);
      setMessages((prev) => [...prev, response]);
      setIsTyping(false);
    }, 600);
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      setMessages((prev) => prev.filter((m) => !m.isError));
      setIsTyping(true);
      setTimeout(() => {
        const response = simulateAiResponse(lastUserMsg.content);
        setMessages((prev) => [...prev, response]);
        setIsTyping(false);
      }, 550);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-chalk overflow-hidden p-0 sm:p-4 lg:p-6">
      {/* ELEVATED LUXURY CHAT WORKSPACE CARD (Matching Visual Reference) */}
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden bg-chalk sm:rounded-3xl sm:border sm:border-line/70 sm:shadow-e2">
        {/* 1. COMPACT ASSISTANT TOP BAR */}
        <div className="flex h-14 sm:h-16 w-full flex-none items-center justify-between border-b border-line/60 bg-chalk/95 px-4 sm:px-6 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            {/* Mobile Back Button */}
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="رجوع"
              className="flex size-9 items-center justify-center rounded-full text-ink hover:bg-sand/40 transition-colors sm:hidden"
            >
              <Icon name="chevron-back" size={20} />
            </button>

            {/* Citron Sahel Sun Presence Avatar */}
            <div className="relative flex items-center justify-center flex-none">
              <span className={cn('sun sm', isTyping && 'think')} />
            </div>

            <div className="flex flex-col">
              <h1 className="m-0 font-display text-16 sm:text-17 font-black leading-tight text-ink">
                شينا
              </h1>
              <p className="m-0 text-11.5 text-stone leading-tight">
                مساعدتك في اختيار منتجات العناية
              </p>
            </div>
          </div>

          {/* Action Buttons: History Clock & Options Menu */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label="سجل المحادثات"
              title="سجل المحادثات"
              className="flex size-9 items-center justify-center rounded-full text-stone hover:bg-sand/50 hover:text-ink transition-colors"
            >
              <Icon name="history" size={19} />
            </button>

            <button
              type="button"
              onClick={handleNewChat}
              aria-label="محادثة جديدة"
              title="محادثة جديدة"
              className="flex size-9 items-center justify-center rounded-full text-stone hover:bg-sand/50 hover:text-ink transition-colors"
            >
              <Icon name="more-vertical" size={19} />
            </button>
          </div>
        </div>

        {/* 2. CHAT CONVERSATION STREAM */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-6">
            {/* STATE 1: EMPTY STATE (بداية المحادثة) */}
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 sm:py-14 text-center animate-fade-in">
                <div className="relative mb-5 flex size-20 items-center justify-center rounded-full bg-linen shadow-e1">
                  <span className="sun" style={{ width: 44, height: 44 }} />
                  <span className="absolute -top-1 -end-1 flex size-7 items-center justify-center rounded-full bg-chalk text-cobalt shadow-sm">
                    <Icon name="sparkles" size={16} />
                  </span>
                </div>

                <h2 className="m-0 font-display text-24 sm:text-28 font-black tracking-tight text-ink">
                  اسأل شينا
                </h2>
                <p className="m-0 mt-2 max-w-md text-13.5 sm:text-14.5 leading-24 text-stone">
                  مساعدتك الشخصية لاختيار كل ما يناسبك من منتجات وروتينات العناية الصيدلانية المعتمدة.
                </p>

                {/* 4 Starter Chips */}
                <div className="mt-8 grid w-full max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleSendMessage(prompt)}
                      className="group flex items-center justify-between rounded-card border border-line bg-linen/70 p-3.5 text-start font-display text-13 font-semibold text-ink shadow-outline-hairline transition-all hover:bg-linen hover:shadow-e1 active:scale-[0.99]"
                    >
                      <span>{prompt}</span>
                      <Icon
                        name="arrow-forward"
                        size={14}
                        className="text-stone transition-transform group-hover:translate-x-[-3px] rtl:group-hover:translate-x-[3px]"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* MESSAGES FEED */}
            {messages.map((msg) => {
              const isUser = msg.role === 'user';

              return (
                <div
                  key={msg.id}
                  className={cn(
                    'flex flex-col gap-1 transition-all',
                    isUser ? 'items-end' : 'items-start'
                  )}
                >
                  {/* Message Bubble Row */}
                  <div
                    className={cn(
                      'flex items-start gap-2.5 max-w-[92%] sm:max-w-[80%]',
                      isUser ? 'flex-row-reverse ms-auto' : 'flex-row me-auto'
                    )}
                  >
                    {/* User / Assistant Avatar */}
                    {!isUser ? (
                      <div className="flex-none pt-1">
                        <span className="sun sm" style={{ width: 28, height: 28 }} />
                      </div>
                    ) : (
                      <div className="flex size-8 flex-none items-center justify-center rounded-full bg-sand/60 text-ink pt-0.5">
                        <Icon name="user" size={17} />
                      </div>
                    )}

                    {/* Bubble */}
                    <div
                      className={cn(
                        'px-4.5 py-3.5 text-14.5 leading-24 shadow-sm',
                        isUser
                          ? 'rounded-2xl rounded-tr-xs bg-cobalt font-medium text-chalk'
                          : 'rounded-2xl rounded-tl-xs border border-line/60 bg-linen text-ink'
                      )}
                    >
                      <p className="m-0 whitespace-pre-wrap">{msg.content}</p>

                      {/* Transition link to Routine Builder */}
                      {msg.actionPrompt ? (
                        <div className="mt-3.5 border-t border-line/70 pt-2.5">
                          <Link
                            href={msg.actionPrompt.href}
                            className="inline-flex items-center gap-2 rounded-pill bg-chalk px-4 py-1.5 font-display text-12.5 font-bold text-cobalt shadow-sm transition-all hover:bg-ink hover:text-chalk active:scale-95"
                          >
                            <span>{msg.actionPrompt.label}</span>
                            <Icon name="arrow-forward" size={13} />
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Timestamp */}
                  <span className={cn('text-11 text-stone/80 px-11', isUser ? 'text-end' : 'text-start')}>
                    {msg.timestamp}
                  </span>

                  {/* STATE 3: PRODUCT COMPARISON TABLE (مقارنة منتجات) */}
                  {msg.comparison ? (
                    <div className="mt-2 w-full max-w-xl overflow-hidden rounded-card border border-line bg-linen/90 p-4 shadow-e1 ms-10">
                      <div className="mb-3 flex items-center justify-between border-b border-line/60 pb-2">
                        <span className="font-display text-13.5 font-bold text-ink">
                          {msg.comparison.title}
                        </span>
                        <span className="rounded-full bg-citron px-2.5 py-0.5 font-display text-11 font-bold text-ink">
                          مقارنة معتمدة
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 sm:gap-5">
                        {msg.comparison.products.map((item) => (
                          <div
                            key={item.brand}
                            className="flex flex-col gap-2.5 rounded-card bg-chalk p-3 shadow-sm border border-line/40"
                          >
                            <div className="flex items-center gap-2">
                              {item.imageUrl ? (
                                <div className="relative size-10 overflow-hidden rounded-md bg-sand/30 flex-none">
                                  <Image
                                    src={item.imageUrl}
                                    alt={item.name}
                                    fill
                                    sizes="40px"
                                    className="object-cover"
                                  />
                                </div>
                              ) : null}
                              <div className="flex flex-col">
                                <span className="font-serif italic text-11 font-bold text-stone">
                                  {item.brand}
                                </span>
                                <span className="font-display text-11.5 font-bold text-ink line-clamp-1">
                                  {item.name}
                                </span>
                              </div>
                            </div>

                            {/* Checklist Features */}
                            <ul className="m-0 flex flex-col gap-1.5 p-0 list-none text-11 text-ink">
                              {item.features.map((feat) => (
                                <li key={feat} className="flex items-center justify-between gap-1">
                                  <span className="text-stone">{feat}</span>
                                  <span className="flex size-4 items-center justify-center rounded-full bg-citron/40 text-ink">
                                    <Icon name="check" size={11} strokeWidth={2.5} />
                                  </span>
                                </li>
                              ))}
                            </ul>

                            {/* Price & Action */}
                            <div className="mt-auto border-t border-line/50 pt-2 flex flex-col gap-1.5">
                              <span className="font-display text-13 font-bold text-ink">
                                {item.price} ج.م
                              </span>
                              <Link
                                href={routes.product(item.slug)}
                                className="inline-flex h-7.5 w-full items-center justify-center rounded-pill bg-linen text-11 font-bold text-ink hover:bg-sand transition-colors"
                              >
                                عرض المنتج
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* HORIZONTAL PRODUCT CAROUSEL (SWIPER) */}
                  {msg.products && msg.products.length > 0 ? (
                    <div className="relative mt-2 w-full max-w-2xl overflow-visible ms-10">
                      <div className="relative">
                        <Swiper
                          modules={[Navigation, A11y, Keyboard, Pagination]}
                          onSwiper={(swiper) => {
                            setSwiperRefs((prev) => ({ ...prev, [msg.id]: swiper }));
                          }}
                          dir="rtl"
                          grabCursor={true}
                          watchOverflow={true}
                          keyboard={{ enabled: true }}
                          className="w-full !overflow-visible sm:!overflow-hidden"
                          breakpoints={{
                            320: { slidesPerView: 1.35, spaceBetween: 12 },
                            480: { slidesPerView: 2.1, spaceBetween: 14 },
                            768: { slidesPerView: 3.1, spaceBetween: 14 },
                          }}
                        >
                          {msg.products.map((prod) => (
                            <SwiperSlide key={prod.slug} className="!h-auto">
                              <div className="group/pcard flex h-full flex-col overflow-hidden rounded-card border border-line/70 bg-chalk shadow-sm transition-all hover:shadow-e1">
                                {/* Square Image Frame */}
                                <div className="relative aspect-square w-full overflow-hidden bg-sand/20">
                                  {prod.imageUrl ? (
                                    <Image
                                      src={prod.imageUrl}
                                      alt={prod.name}
                                      fill
                                      sizes="200px"
                                      className="object-cover transition-transform duration-base group-hover/pcard:scale-105"
                                    />
                                  ) : (
                                    <div className="flex size-full items-center justify-center text-stone">
                                      <Icon name="bag" size={30} />
                                    </div>
                                  )}

                                  {/* Wishlist Heart Icon */}
                                  <button
                                    type="button"
                                    aria-label="إضافة للمفضلة"
                                    className="absolute top-2 start-2 z-10 flex size-7 items-center justify-center rounded-full bg-chalk/85 text-ink shadow-sm transition-transform hover:scale-110 active:scale-95"
                                  >
                                    <Icon name="heart" size={13} />
                                  </button>
                                </div>

                                {/* Information & Cart Action */}
                                <div className="flex flex-1 flex-col p-3">
                                  <Link
                                    href={routes.product(prod.slug)}
                                    className="font-display text-12.5 font-bold leading-tight text-ink hover:text-cobalt line-clamp-2"
                                  >
                                    {prod.name}
                                  </Link>

                                  <div className="mt-1 flex items-center justify-between">
                                    <span className="font-serif italic text-11 text-stone">
                                      {prod.brand}
                                    </span>
                                    {prod.reviewsCount ? (
                                      <span className="flex items-center gap-0.5 text-10.5 text-stone">
                                        <span className="text-amber-500">★</span>
                                        <span>({prod.reviewsCount})</span>
                                      </span>
                                    ) : null}
                                  </div>

                                  <div className="mt-2 flex items-baseline">
                                    <span className="font-display text-13.5 font-extrabold text-ink">
                                      {prod.price} ج.م
                                    </span>
                                  </div>

                                  {/* Add to Cart button */}
                                  <button
                                    type="button"
                                    onClick={() => handleAddToCart(prod)}
                                    disabled={addingSku === prod.skuId}
                                    className={cn(
                                      'mt-2.5 flex h-8.5 w-full items-center justify-center gap-1.5 rounded-pill text-11.5 font-bold text-chalk shadow-sm transition-all',
                                      addingSku === prod.skuId
                                        ? 'bg-citron text-ink'
                                        : 'bg-ink hover:bg-cobalt active:scale-95'
                                    )}
                                  >
                                    <Icon name="bag" size={13} />
                                    <span>
                                      {addingSku === prod.skuId ? 'تمت الإضافة ✓' : 'أضف للسلة'}
                                    </span>
                                  </button>
                                </div>
                              </div>
                            </SwiperSlide>
                          ))}
                        </Swiper>

                        {/* Desktop Navigation Arrows */}
                        <div className="hidden sm:flex items-center gap-1.5 absolute -top-8 end-0">
                          <button
                            type="button"
                            onClick={() => swiperRefs[msg.id]?.slidePrev()}
                            aria-label="السابق"
                            className="flex size-7 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-sm hover:border-cobalt hover:text-cobalt active:scale-95 transition-all"
                          >
                            <Icon name="chevron-back" size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => swiperRefs[msg.id]?.slideNext()}
                            aria-label="التالي"
                            className="flex size-7 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-sm hover:border-cobalt hover:text-cobalt active:scale-95 transition-all"
                          >
                            <Icon name="chevron-forward" size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Follow-up question bubble & Suggested Action Chips */}
                  {msg.followUpQuestion ? (
                    <div className="mt-3 flex flex-col gap-2.5 ms-10">
                      <span className="inline-block self-start rounded-pill bg-linen/80 border border-line/40 px-3.5 py-1.5 font-display text-12 text-stone">
                        {msg.followUpQuestion}
                      </span>

                      {msg.suggestedChips && msg.suggestedChips.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {msg.suggestedChips.map((chip) => (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => handleSendMessage(chip.replace(/^\+\s*/, ''))}
                              className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-linen/70 px-3.5 py-1.5 text-12 font-medium text-ink shadow-outline-hairline hover:bg-linen hover:border-line transition-all active:scale-95"
                            >
                              <span>{chip}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : msg.suggestedChips && msg.suggestedChips.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap gap-2 ms-10">
                      {msg.suggestedChips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => handleSendMessage(chip.replace(/^\+\s*/, ''))}
                          className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-linen/70 px-3.5 py-1.5 text-12 font-medium text-ink shadow-outline-hairline hover:bg-linen hover:border-line transition-all active:scale-95"
                        >
                          <span>{chip}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {/* STATE 4: ERROR / RETRY STATE */}
                  {msg.isError ? (
                    <div className="mt-2 flex w-full max-w-md items-center justify-between rounded-card border border-tomato/30 bg-conflict/20 p-3 ms-10">
                      <div className="flex items-center gap-2 text-tomato-ink text-12 font-medium">
                        <Icon name="alert" size={17} />
                        <span>حدث خطأ مؤقت أثناء الاتصال. يمكنك إعادة المحاولة.</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="flex items-center gap-1 rounded-pill bg-chalk px-3 py-1 font-display text-11.5 font-bold text-ink shadow-sm hover:bg-sand"
                      >
                        <Icon name="retry" size={13} />
                        <span>إعادة المحاولة</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* STATE 2: TYPING STATE (جاري الكتابة) */}
            {isTyping ? (
              <div className="flex items-start gap-2.5 self-start animate-fade-in">
                <span className="sun sm think flex-none mt-1" style={{ width: 28, height: 28 }} />
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3 rounded-2xl rounded-tl-xs border border-line/60 bg-linen px-4 py-3 shadow-sm">
                    <span className="font-display text-13 font-bold text-ink">شينا</span>
                    <div className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-stone/70 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="size-1.5 rounded-full bg-stone/70 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="size-1.5 rounded-full bg-stone/70 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                  <span className="text-10.5 text-stone/80 px-2">الآن</span>
                </div>
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 3. BOTTOM-ANCHORED MESSAGE COMPOSER */}
        <div className="flex-none border-t border-line/60 bg-chalk/95 p-3 sm:p-4 backdrop-blur-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2 rounded-pill border border-line bg-linen px-2.5 sm:px-3 py-1.5 shadow-sm transition-all focus-within:border-ink/30 focus-within:shadow-e1"
          >
            {/* Attachment Button */}
            <button
              type="button"
              aria-label="إرفاق صورة أو منتج"
              title="إرفاق صورة أو منتج"
              onClick={() => {
                setInputText((prev) => (prev ? prev : 'عايز استشارة بخصوص منتج معين'));
                inputRef.current?.focus();
              }}
              className="flex size-9 flex-none items-center justify-center rounded-full text-stone hover:bg-sand/40 hover:text-ink transition-colors"
            >
              <Icon name="attach" size={19} />
            </button>

            {/* Input field */}
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="اسأل شينا عن منتج أو مكون أو روتين..."
              className="h-10 flex-1 border-0 bg-transparent px-2 font-display text-14 text-ink placeholder:text-stone/70 focus:outline-none"
            />

            {/* Black Circular Send Button */}
            <button
              type="submit"
              disabled={!inputText.trim() || isTyping}
              aria-label="إرسال"
              className="flex size-10 flex-none items-center justify-center rounded-full bg-ink text-chalk shadow-sm transition-all hover:bg-cobalt active:scale-95 disabled:opacity-25 disabled:pointer-events-none"
            >
              <Icon name="arrow-up" size={18} strokeWidth={2.2} />
            </button>
          </form>
        </div>
      </div>

      {/* 4. TEMPORARY CONVERSATION HISTORY DRAWER (Sheet) */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="end" closeLabel="إغلاق" className="w-[88%] max-w-[380px] bg-linen">
          <SheetHeader className="border-b border-line pb-3">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center gap-2 font-display text-17 font-bold text-ink">
                <Icon name="history" size={20} />
                <span>سجل المحادثات</span>
              </SheetTitle>
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex items-center gap-1 rounded-pill bg-chalk px-3 py-1 font-display text-11.5 font-bold text-ink shadow-sm hover:bg-sand transition-colors"
              >
                <Icon name="plus" size={13} />
                <span>محادثة جديدة</span>
              </button>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-stone">
                <span className="flex size-12 items-center justify-center rounded-full bg-sand/40 mb-3">
                  <Icon name="history" size={22} />
                </span>
                <p className="m-0 text-13">لا توجد محادثات سابقة حتى الآن.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {sessions.map((sess) => (
                  <button
                    key={sess.id}
                    type="button"
                    onClick={() => handleLoadSession(sess)}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-card border p-3 text-start transition-all',
                      sess.id === currentSessionId
                        ? 'border-cobalt bg-chalk shadow-sm'
                        : 'border-line bg-chalk/60 hover:bg-chalk'
                    )}
                  >
                    <span className="font-display text-13 font-bold text-ink line-clamp-1">
                      {sess.title}
                    </span>
                    <span className="text-11 text-stone">
                      {sess.timestamp} · {sess.messages.length} رسالة
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {sessions.length > 0 ? (
            <div className="border-t border-line p-4">
              <button
                type="button"
                onClick={handleClearHistory}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-pill bg-linen py-2 text-12 font-semibold text-stone hover:text-tomato-ink transition-colors"
              >
                <Icon name="trash" size={14} />
                <span>مسح كل السجل</span>
              </button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
