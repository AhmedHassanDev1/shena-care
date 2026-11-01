'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCart } from '@/features/cart/hooks/useCart';
import { saveCustomerRoutine, type CustomerSavedRoutine } from '../lib/routineStorage';
import { getCuratedRoutineBySlug } from '../data/curatedRoutines';

type FocusArea = 'skin' | 'hair';
type SkinType = 'oily' | 'combination' | 'dry' | 'normal';
type BudgetTier = 'economic' | 'balanced' | 'premium';

interface ProposalItem {
  id: string;
  num: string;
  period: 'morning' | 'evening';
  stepName: string;
  productName: string;
  brand: string;
  actives: string;
  usage: string;
  price: number;
  skuId: string;
  productSlug: string;
  isEssential: boolean;
  selected: boolean;
}

export function RoutineBuilderView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateSlug = searchParams.get('template');
  const initialProductSlug = searchParams.get('product');

  const initialTemplate = templateSlug ? getCuratedRoutineBySlug(templateSlug) : null;

  const { addItem } = useCart();

  // Wizard Steps: 1: Focus, 2: Concerns, 3: Preferences & Budget, 4: Proposal Review
  const [currentStep, setCurrentStep] = useState<number>(initialTemplate ? 4 : 1);
  const [focusArea, setFocusArea] = useState<FocusArea>(() => {
    if (initialTemplate) return initialTemplate.category;
    if (initialProductSlug) {
      if (initialProductSlug.includes('frizz') || initialProductSlug.includes('lovebond') || initialProductSlug.includes('bless')) {
        return 'hair';
      }
    }
    return 'skin';
  });
  const [selectedConcerns, setSelectedConcerns] = useState<string[]>(
    initialTemplate ? [initialTemplate.concernSlug] : ['acne']
  );
  const [skinType, setSkinType] = useState<SkinType>('oily');
  const [budgetTier, setBudgetTier] = useState<BudgetTier>('balanced');
  const [fragranceFree, setFragranceFree] = useState<boolean>(false);

  // Proposal State
  const [proposalItems, setProposalItems] = useState<ProposalItem[]>(() => {
    if (initialTemplate) {
      return initialTemplate.steps.map((st) => ({
        id: st.id,
        num: st.num,
        period: (st.period === 'evening' ? 'evening' : 'morning') as 'morning' | 'evening',
        stepName: st.roleAr,
        productName: st.productName,
        brand: st.brand,
        actives: st.actives,
        usage: st.usageAr,
        price: st.price,
        skuId: st.skuId,
        productSlug: st.productSlug,
        isEssential: true,
        selected: true,
      }));
    }
    return [];
  });
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [isAddingToCart, setIsAddingToCart] = useState<boolean>(false);
  const [cartSuccess, setCartSuccess] = useState<boolean>(false);

  // Pre-populate if template or product changes
  useEffect(() => {
    if (templateSlug) {
      const template = getCuratedRoutineBySlug(templateSlug);
      if (template) {
        setFocusArea(template.category);
        setSelectedConcerns([template.concernSlug]);
        const items: ProposalItem[] = template.steps.map((st) => ({
          id: st.id,
          num: st.num,
          period: (st.period === 'evening' ? 'evening' : 'morning') as 'morning' | 'evening',
          stepName: st.roleAr,
          productName: st.productName,
          brand: st.brand,
          actives: st.actives,
          usage: st.usageAr,
          price: st.price,
          skuId: st.skuId,
          productSlug: st.productSlug,
          isEssential: true,
          selected: true,
        }));
        setProposalItems(items);
        setCurrentStep(4);
      }
    } else if (initialProductSlug) {
      if (initialProductSlug.includes('frizz') || initialProductSlug.includes('lovebond') || initialProductSlug.includes('bless')) {
        setFocusArea('hair');
      } else {
        setFocusArea('skin');
      }
    }
  }, [templateSlug, initialProductSlug]);

  const toggleConcern = (concern: string) => {
    setSelectedConcerns((prev) =>
      prev.includes(concern) ? prev.filter((c) => c !== concern) : [...prev, concern]
    );
  };

  const generateProposal = () => {
    // Generate grounded proposal based on user selection from real catalog products
    if (focusArea === 'skin') {
      const isAcne = selectedConcerns.includes('acne');
      const isDry = selectedConcerns.includes('dryness');
      const isAging = selectedConcerns.includes('aging');

      const items: ProposalItem[] = [
        {
          id: 'b-am1',
          num: '٠١',
          period: 'morning',
          stepName: 'تنظيف لطيف وموازنة الإفرازات',
          productName: isAcne
            ? 'StarVille Acne Prone Skin Facial Cleanser'
            : isAging
            ? 'Eva Skin Clinic Anti-Ageing Collagen Facial Wash'
            : 'Eva Skin Clinic Vitamin C Facial Wash And Exfoliator',
          brand: isAcne ? 'StarVille' : 'Eva Cosmetics',
          actives: isAcne ? 'شجرة الشاي + ساليسيليك' : isAging ? 'كولاجين طبيعي' : 'فيتامين سي نقي',
          usage: 'رغوة خفيفة لمدة ٦٠ ثانية مع ماء فاتر صباحاً ومساءً.',
          price: isAcne ? 175 : isAging ? 135 : 130,
          skuId: isAcne
            ? '936dec18-8dc4-47bc-aecc-e92bdf8859d7'
            : isAging
            ? '55ed24d7-e51d-4ed3-a729-365763daf7be'
            : 'cfbd1bf8-b745-4a0c-be8b-168ce0ee5268',
          productSlug: isAcne ? 'sv-acne-cleanser-200' : isAging ? 'eva-collagen-wash-150' : 'eva-vitc-wash-150',
          isEssential: true,
          selected: true,
        },
        {
          id: 'b-am2',
          num: '٠٢',
          period: 'morning',
          stepName: 'سيروم علاجي مستهدف',
          productName: isDry
            ? 'Eva Skin Clinic Hyaluronic Acid Facial Serum'
            : 'Eva Skin Clinic Vitamin C Facial Serum',
          brand: 'Eva Cosmetics',
          actives: isDry ? 'حمض الهيالورونيك النقي' : 'فيتامين سي المركز',
          usage: '٣ قطرات توزع بالطبطبة الخفيفة على بشرة نظيفة.',
          price: isDry ? 220 : 195,
          skuId: isDry
            ? '512e9b2f-6eb7-4464-9df0-375577e0c10a'
            : '4c171cf0-7431-4559-b0fa-ce531522423e',
          productSlug: isDry ? 'eva-ha-serum-30' : 'eva-vitc-serum-20',
          isEssential: true,
          selected: true,
        },
        {
          id: 'b-am3',
          num: '٠٣',
          period: 'morning',
          stepName: 'ترطيب وحماية حاجز البشرة',
          productName: isAcne
            ? 'StarVille Acne Prone Skin Cream'
            : isAging
            ? 'Eva Skin Clinic Anti-Ageing Collagen Fine Lines Filler (+30)'
            : 'Eva Skin Clinic Hyaluronic Acid Day Gel',
          brand: isAcne ? 'StarVille' : 'Eva Cosmetics',
          actives: isAcne ? 'زنك وبابونج مهدئ' : isAging ? 'كولاجين وحمض هيالورونيك' : 'جل مائي خفيف',
          usage: 'توزيع كمية متساوية على كامل الوجه والرقبة.',
          price: isAcne ? 120 : isAging ? 210 : 165,
          skuId: isAcne
            ? 'b5c7f752-0659-40da-a5e7-142872d37afc'
            : isAging
            ? '44b8d0b7-4aee-4f34-bc1d-d561d2bd93f9'
            : '62cded96-6550-4003-9147-d2a7fad6bfbf',
          productSlug: isAcne ? 'sv-acne-cream-60' : isAging ? 'eva-collagen-filler-50' : 'eva-ha-day-gel-45',
          isEssential: true,
          selected: true,
        },
        {
          id: 'b-am4',
          num: '٠٤',
          period: 'morning',
          stepName: 'وقاية شمسية واسعة SPF 50+',
          productName: 'Eva Skin Clinic Acne-Prone Skin Sunscreen SPF 50+',
          brand: 'Eva Cosmetics',
          actives: 'فلاتر شمسية حديثة سريعة الامتصاص',
          usage: 'مقدار إصبعين قبل التعرض للشمس بـ ١٥ دقيقة.',
          price: 180,
          skuId: 'ca6773ec-2a62-4682-9c15-ac1e019d2349',
          productSlug: 'eva-acne-sunscreen-40',
          isEssential: true,
          selected: true,
        },
      ];
      setProposalItems(items);
    } else {
      // Hair Care Proposal
      const isDamage = selectedConcerns.includes('breakage');
      const items: ProposalItem[] = [
        {
          id: 'b-h1',
          num: '٠١',
          period: 'morning',
          stepName: 'شامبو تنقية وترميم ألياف الشعر',
          productName: isDamage
            ? 'LoveBond Shampoo'
            : 'Frizz Off Shampoo',
          brand: 'The Hair Addict',
          actives: isDamage ? 'مركبات ترميم الروابط' : 'بابايا ومكاديميا خالٍ من السلفات',
          usage: 'تدليك لطيف للفروة المبللة حتى تتكون رغوة خفيفة.',
          price: isDamage ? 290 : 250,
          skuId: isDamage
            ? '407aea24-1111-4d6a-8eea-2d30a88ec56a'
            : '3e49a6f7-6fad-4998-ae6a-b216722f8081',
          productSlug: isDamage ? 'ha-lovebond-shampoo-250' : 'ha-frizz-off-shampoo-250',
          isEssential: true,
          selected: true,
        },
        {
          id: 'b-h2',
          num: '٠٢',
          period: 'morning',
          stepName: 'بلسم فك التشابك والترطيب المكثف',
          productName: isDamage
            ? 'LoveBond Conditioner'
            : 'Frizz Off Conditioner',
          brand: 'The Hair Addict',
          actives: isDamage ? 'أحماض أمينية مدعمة' : 'زبدة الشيا وزيت المورينجا',
          usage: 'يترك ٤ دقائق على أطوال الشعر ثم يفك التشابك ويشطف.',
          price: isDamage ? 290 : 250,
          skuId: isDamage
            ? 'c74485b2-90e9-4b59-9139-3b4413a92829'
            : '9b08f110-6811-4196-a9bc-b1dcb3927e8c',
          productSlug: isDamage ? 'ha-lovebond-cond-250' : 'ha-frizz-off-cond-250',
          isEssential: true,
          selected: true,
        },
        {
          id: 'b-h3',
          num: '٠٣',
          period: 'morning',
          stepName: 'كريم التصفيف والتغذية وحبس الرطوبة',
          productName: isDamage
            ? 'Activator Defining Cream'
            : 'Frizz Off Leave-In Conditioner',
          brand: isDamage ? 'BLESS' : 'The Hair Addict',
          actives: isDamage ? 'زبدة شيا وأرجان' : 'أحماض أمينية وفيتامين E',
          usage: 'توزيع على الخصلات الرطبة لتحديد التموجات ومنع التطاير.',
          price: isDamage ? 185 : 280,
          skuId: isDamage
            ? 'b643b485-fe1d-480d-b74c-4e5115147949'
            : 'd9d79753-7de6-4daf-9bb2-2b9d0d20dba4',
          productSlug: isDamage ? 'bless-activator-cream-250' : 'ha-frizz-off-leavein-250',
          isEssential: true,
          selected: true,
        },
      ];
      setProposalItems(items);
    }

    setCurrentStep(4);
  };

  const toggleProposalItem = (id: string) => {
    setProposalItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item))
    );
  };

  const selectedItems = proposalItems.filter((it) => it.selected);
  const totalPrice = selectedItems.reduce((sum, it) => sum + it.price, 0);

  const handleSaveRoutine = () => {
    const routineTitle = focusArea === 'skin' ? 'روتيني المخصص للعناية بالبشرة' : 'روتيني المخصص للعناية بالشعر';
    const savedObj: CustomerSavedRoutine = {
      id: `cr-${Date.now()}`,
      title: routineTitle,
      category: focusArea,
      concern: selectedConcerns.join(', '),
      savedAt: new Date().toISOString(),
      morningSteps: selectedItems.filter((i) => i.period === 'morning'),
      eveningSteps: selectedItems.filter((i) => i.period === 'evening'),
    };
    saveCustomerRoutine(savedObj);
    setIsSaved(true);
  };

  const handleAddToCart = async () => {
    try {
      setIsAddingToCart(true);
      for (const item of selectedItems) {
        if (item.skuId) {
          await addItem({ skuId: item.skuId, quantity: 1 });
        }
      }
      setCartSuccess(true);
      setTimeout(() => {
        router.push(routes.cart);
      }, 700);
    } catch {
      // Error handled by cart context
    } finally {
      setIsAddingToCart(false);
    }
  };

  return (
    <div
      data-route="/routines/build"
      className="flex flex-col gap-8 pb-28 pt-4 lg:gap-12 lg:pt-6"
    >
      <PageContainer className="flex max-w-narrow flex-col gap-8">
        {/* Navigation Breadcrumb */}
        <nav aria-label="مسار التنقل" className="flex items-center gap-2 text-12 text-stone">
          <Link href={routes.home} className="hover:text-ink transition-colors">الرئيسية</Link>
          <span aria-hidden="true">/</span>
          <Link href={routes.routines} className="hover:text-ink transition-colors">دليل الروتينات</Link>
          <span aria-hidden="true">/</span>
          <span className="font-semibold text-ink">أداة بناء الروتين المخصص</span>
        </nav>

        {/* Wizard Step Progress Tracker */}
        <div className="flex flex-col gap-3 rounded-card border border-line bg-linen p-5 shadow-elevation-1 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="text-12 font-bold text-cobalt">
              الخطوة {currentStep} من ٤
            </span>
            <span className="text-12 text-stone">
              {currentStep === 1
                ? 'مجال العناية'
                : currentStep === 2
                ? 'الأهداف والاهتمامات'
                : currentStep === 3
                ? 'التفضيلات والميزانية'
                : 'مراجعة واعتماد المقترح'}
            </span>
          </div>

          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-chalk">
            <div
              className="h-full rounded-full bg-cobalt transition-all duration-300"
              style={{ width: `${(currentStep / 4) * 100}%` }}
            />
          </div>
        </div>

        {/* STEP 1: Focus Area (Skin or Hair) */}
        {currentStep === 1 ? (
          <section aria-labelledby="step1-title" className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <h1 id="step1-title" className="m-0 font-display text-24 font-black text-ink sm:text-28">
                ما هو مجال العناية الذي تودين بناء روتين له؟
              </h1>
              <p className="m-0 text-14 text-stone">
                نعتمد في ShinaCare على بروتوكولات مخصصة إما للعناية بالبشرة أو الشعر لضمان أعلى درجات التناغم.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setFocusArea('skin')}
                className={cn(
                  'flex flex-col gap-3 rounded-card border p-6 text-start transition-all duration-base hover:shadow-elevation-1',
                  focusArea === 'skin'
                    ? 'border-cobalt bg-cobalt/5 ring-2 ring-cobalt'
                    : 'border-line bg-linen'
                )}
              >
                <span className="text-28">🧴</span>
                <div className="flex flex-col">
                  <h2 className="m-0 font-display text-18 font-bold text-ink">العناية بالبشرة</h2>
                  <p className="m-0 text-13 text-stone">
                    تنظيف، ترطيب، علاج الحبوب والبهتان، ووقاية يومية من الشمس.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFocusArea('hair')}
                className={cn(
                  'flex flex-col gap-3 rounded-card border p-6 text-start transition-all duration-base hover:shadow-elevation-1',
                  focusArea === 'hair'
                    ? 'border-cobalt bg-cobalt/5 ring-2 ring-cobalt'
                    : 'border-line bg-linen'
                )}
              >
                <span className="text-28">✨</span>
                <div className="flex flex-col">
                  <h2 className="m-0 font-display text-18 font-bold text-ink">العناية بالشعر</h2>
                  <p className="m-0 text-13 text-stone">
                    ترويض النفشة، تحديد الكيرلز، ترميم الروابط، وتغذية الفروة.
                  </p>
                </div>
              </button>
            </div>

            <div className="flex justify-end pt-4">
              <Button
                variant="cobalt"
                size="l"
                onClick={() => setCurrentStep(2)}
                className="font-bold shadow-action"
              >
                <span>المتابعة لاختيار الأهداف</span>
                <Icon name="arrow-forward" size={16} />
              </Button>
            </div>
          </section>
        ) : null}

        {/* STEP 2: Goals & Concerns */}
        {currentStep === 2 ? (
          <section aria-labelledby="step2-title" className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <h1 id="step2-title" className="m-0 font-display text-24 font-black text-ink sm:text-28">
                ما هي الأهداف أو التحديات الأساسية؟
              </h1>
              <p className="m-0 text-14 text-stone">
                يمكنك اختيار أكثر من هدف لتخصيص المكونات الفعالة المناسبة.
              </p>
            </div>

            {focusArea === 'skin' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { id: 'acne', label: 'الحبوب وتوازن الزهم', desc: 'تقليل المسام والشوائب وإفرازات الدهون' },
                  { id: 'dryness', label: 'الجفاف ولدونة البشرة', desc: 'استعادة الترطيب المائي ولدونة الجلد' },
                  { id: 'radiance', label: 'البهتان وتوحيد المظهر', desc: 'تنشيط النضارة ومكافحة الأكسدة السطحية' },
                  { id: 'aging', label: 'الخطوط الدقيقة والامتلاء', desc: 'دعم ألياف الكولاجين ومقاومة علامات التقدم' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleConcern(item.id)}
                    className={cn(
                      'flex items-start gap-3 rounded-card border p-4 text-start transition-all',
                      selectedConcerns.includes(item.id)
                        ? 'border-cobalt bg-cobalt/5 ring-1 ring-cobalt'
                        : 'border-line bg-linen hover:bg-sand/40'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-5 flex-none items-center justify-center rounded-full border',
                        selectedConcerns.includes(item.id)
                          ? 'border-cobalt bg-cobalt text-linen'
                          : 'border-line bg-chalk'
                      )}
                    >
                      {selectedConcerns.includes(item.id) ? <Icon name="check" size={12} /> : null}
                    </span>
                    <div className="flex flex-col">
                      <span className="font-display text-14 font-bold text-ink">{item.label}</span>
                      <span className="text-12 text-stone">{item.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { id: 'frizz', label: 'النفشة وتطاير الخصلات', desc: 'تنعيم الشعر وحبس الرطوبة وتحديد الكيرلز' },
                  { id: 'breakage', label: 'التقصف وتلف الروابط', desc: 'ترميم الشعر المتأثر بالحرارة أو الصبغات' },
                  { id: 'dry-scalp', label: 'جفاف الفروة وضعف البصيلات', desc: 'تنظيف خفيف دون تجريد الزيوت الطبيعية' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleConcern(item.id)}
                    className={cn(
                      'flex items-start gap-3 rounded-card border p-4 text-start transition-all',
                      selectedConcerns.includes(item.id)
                        ? 'border-cobalt bg-cobalt/5 ring-1 ring-cobalt'
                        : 'border-line bg-linen hover:bg-sand/40'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-5 flex-none items-center justify-center rounded-full border',
                        selectedConcerns.includes(item.id)
                          ? 'border-cobalt bg-cobalt text-linen'
                          : 'border-line bg-chalk'
                      )}
                    >
                      {selectedConcerns.includes(item.id) ? <Icon name="check" size={12} /> : null}
                    </span>
                    <div className="flex flex-col">
                      <span className="font-display text-14 font-bold text-ink">{item.label}</span>
                      <span className="text-12 text-stone">{item.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-4">
              <Button
                variant="light"
                size="m"
                onClick={() => setCurrentStep(1)}
              >
                السابق
              </Button>
              <Button
                variant="cobalt"
                size="l"
                onClick={() => setCurrentStep(3)}
                disabled={selectedConcerns.length === 0}
                className="font-bold shadow-action"
              >
                <span>المتابعة للميزانية والتفضيلات</span>
                <Icon name="arrow-forward" size={16} />
              </Button>
            </div>
          </section>
        ) : null}

        {/* STEP 3: Preferences & Budget */}
        {currentStep === 3 ? (
          <section aria-labelledby="step3-title" className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <h1 id="step3-title" className="m-0 font-display text-24 font-black text-ink sm:text-28">
                التفضيلات ونطاق الميزانية
              </h1>
              <p className="m-0 text-14 text-stone">
                نراعي ميزانيتك لنقترح منتجات حقيقية متوفرة في مصر بأفضل قيمة.
              </p>
            </div>

            {/* Budget Tiers */}
            <div className="flex flex-col gap-3">
              <span className="text-13 font-bold text-ink">نطاق الميزانية المرغوب:</span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { id: 'economic', label: 'اقتصادي', range: 'أقل من ٥٠٠ ج.م', desc: 'أفضل قيمة صيدلانية فعالة' },
                  { id: 'balanced', label: 'متوازن', range: '٥٠٠ - ٨٠٠ ج.م', desc: 'تركيبة مثالية بين الكفاءة والسعر' },
                  { id: 'premium', label: 'متخصص', range: 'أكثر من ٨٠٠ ج.م', desc: 'عناية متقدمة بمكونات مكثفة' },
                ].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBudgetTier(b.id as BudgetTier)}
                    className={cn(
                      'flex flex-col gap-1.5 rounded-card border p-4 text-start transition-all',
                      budgetTier === b.id
                        ? 'border-cobalt bg-cobalt/5 ring-1 ring-cobalt'
                        : 'border-line bg-linen hover:bg-sand/40'
                    )}
                  >
                    <span className="font-display text-15 font-bold text-ink">{b.label}</span>
                    <span className="font-display text-12.5 font-bold text-cobalt">{b.range}</span>
                    <span className="text-11.5 text-stone">{b.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Skin Type (if Skin focus) */}
            {focusArea === 'skin' ? (
              <div className="flex flex-col gap-3 pt-2">
                <span className="text-13 font-bold text-ink">نوع البشرة:</span>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {[
                    { id: 'oily', label: 'دهنية' },
                    { id: 'combination', label: 'مختلطة' },
                    { id: 'dry', label: 'جافة' },
                    { id: 'normal', label: 'عادية' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setSkinType(st.id as SkinType)}
                      className={cn(
                        'rounded-pill border py-2.5 text-center text-13 font-bold transition-all',
                        skinType === st.id
                          ? 'border-cobalt bg-cobalt text-linen'
                          : 'border-line bg-linen text-stone hover:border-ink/40 hover:text-ink'
                      )}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Fragrance Preference */}
            <div className="flex items-center justify-between rounded-card border border-line bg-linen p-4">
              <div className="flex flex-col">
                <span className="text-13 font-bold text-ink">تفضيل تركيبات خالية من العطور؟</span>
                <span className="text-12 text-stone">مفضل للبشرة الحساسة المعرضة للتهيج السريع.</span>
              </div>
              <input
                type="checkbox"
                checked={fragranceFree}
                onChange={(e) => setFragranceFree(e.target.checked)}
                className="size-5 rounded border-line text-cobalt accent-cobalt"
              />
            </div>

            <div className="flex items-center justify-between pt-4">
              <Button
                variant="light"
                size="m"
                onClick={() => setCurrentStep(2)}
              >
                السابق
              </Button>
              <Button
                variant="cobalt"
                size="l"
                onClick={generateProposal}
                className="font-bold shadow-action"
              >
                <span>توليد مقترح الروتين ←</span>
              </Button>
            </div>
          </section>
        ) : null}

        {/* STEP 4: Routine Proposal (Draft Review & Editable State) */}
        {currentStep === 4 ? (
          <section aria-labelledby="step4-proposal-title" className="flex flex-col gap-6">
            {/* Proposal Notification Header: Explicitly tells customer this is a draft proposal */}
            <header className="flex flex-col gap-3 rounded-card border border-line bg-sand/60 p-6 shadow-outline-hairline">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-full bg-sand text-ink font-bold">
                    ✓
                  </span>
                  <span className="rounded-full bg-sand px-3 py-0.5 text-12 font-bold text-ink">
                    مقترح استرشادي قيد المراجعة
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="text-12 font-semibold text-stone hover:text-ink underline"
                >
                  إعادة ضبط الخيارات
                </button>
              </div>

              <h1 id="step4-proposal-title" className="m-0 font-display text-24 font-black text-ink sm:text-30">
                مقترح الروتين المخصص
              </h1>
              <p className="m-0 text-13.5 leading-22 text-stone">
                هذا مقترح أولي يمكنك مراجعته وتعديل أو حذف خطواته بحرية. لن يتم تفعيل أو حفظ الروتين تلقائياً دون موافقتك.
              </p>

              <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3 text-12 text-stone">
                <span className="rounded-full bg-linen px-2.5 py-1 font-semibold text-ink shadow-elevation-1">
                  المجال: {focusArea === 'skin' ? 'بشرة' : 'شعر'}
                </span>
                <span className="rounded-full bg-linen px-2.5 py-1 font-semibold text-ink shadow-elevation-1">
                  الأهداف: {selectedConcerns.join(' + ')}
                </span>
                <span className="rounded-full bg-linen px-2.5 py-1 font-semibold text-ink shadow-elevation-1">
                  الميزانية: {budgetTier === 'economic' ? 'اقتصادي' : budgetTier === 'balanced' ? 'متوازن' : 'متخصص'}
                </span>
              </div>
            </header>

            {/* Saved Toast Banner if customer clicked save */}
            {isSaved ? (
              <div className="flex items-center justify-between gap-3 rounded-card bg-ok-tint p-4 shadow-outline-ok">
                <div className="flex items-center gap-2.5 text-ok">
                  <Icon name="check" size={20} />
                  <span className="font-display text-14 font-bold">
                    تم حفظ الروتين بنجاح في روتيناتي!
                  </span>
                </div>
                <Link
                  href={routes.myRoutine}
                  className={cn(buttonVariants({ variant: 'cobalt', size: 's' }), 'font-bold shadow-action')}
                >
                  الذهاب لمتابعة الروتين ←
                </Link>
              </div>
            ) : null}

            {/* Proposal Steps Checklist */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-13 font-bold text-ink">
                  الخطوات والمستحضرات المقترحة ({selectedItems.length} محددة من {proposalItems.length}):
                </span>
                <span className="text-12 text-stone">
                  انقري على أي خطوة لإلغاء تحديدها أو إعادتها
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {proposalItems.map((item) => (
                  <article
                    key={item.id}
                    onClick={() => toggleProposalItem(item.id)}
                    className={cn(
                      'flex cursor-pointer flex-col justify-between gap-4 rounded-card border p-4 shadow-elevation-1 transition-all duration-base hover:shadow-elevation-2 sm:flex-row sm:items-center sm:p-5',
                      item.selected
                        ? 'border-line bg-linen'
                        : 'border-line/60 bg-sand/30 opacity-60'
                    )}
                  >
                    <div className="flex items-start gap-3.5">
                      <span
                        className={cn(
                          'mt-1 flex size-5 flex-none items-center justify-center rounded-full border transition-colors',
                          item.selected
                            ? 'border-cobalt bg-cobalt text-linen'
                            : 'border-line bg-chalk'
                        )}
                      >
                        {item.selected ? <Icon name="check" size={12} /> : null}
                      </span>

                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex size-5 items-center justify-center rounded-full bg-sand font-display text-10.5 font-bold text-ink">
                            {item.num}
                          </span>
                          <span className="text-12 font-bold text-stone">{item.stepName}</span>
                          <span className="rounded-full bg-sand px-2 py-0.5 text-10.5 font-bold text-ink">
                            {item.actives}
                          </span>
                        </div>

                        <div className="flex flex-col">
                          <span className="text-11 font-bold text-stone">{item.brand}</span>
                          <span className="font-display text-15 font-bold text-ink">{item.productName}</span>
                        </div>

                        <p className="m-0 text-12 text-stone">
                          {item.usage}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-2 sm:border-t-0 sm:pt-0 sm:flex-col sm:items-end">
                      <span className="font-display text-15 font-bold text-ink whitespace-nowrap">
                        {item.price} ج.م
                      </span>

                      <Link
                        href={routes.product(item.productSlug)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-11.5 font-semibold text-cobalt hover:underline"
                      >
                        فحص المنتج
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            {/* Floating Review & Action Bar */}
            <div className="sticky bottom-6 z-sticky flex flex-col gap-3 rounded-card border border-line bg-linen/95 p-4 shadow-elevation-3 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col">
                <span className="text-11.5 text-stone">إجمالي المقترح المحدد ({selectedItems.length} مستحضرات)</span>
                <span className="font-display text-20 font-black text-ink">{totalPrice} ج.م</span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  variant="light"
                  size="m"
                  onClick={handleSaveRoutine}
                  disabled={selectedItems.length === 0}
                  className="font-bold"
                >
                  {isSaved ? 'تم الحفظ في روتيناتي ✓' : 'حفظ في روتيناتي'}
                </Button>

                <Button
                  variant="cobalt"
                  size="l"
                  onClick={handleAddToCart}
                  disabled={isAddingToCart || selectedItems.length === 0}
                  className="font-bold shadow-action"
                >
                  {cartSuccess ? 'جاري الانتقال للسلة ✓' : isAddingToCart ? 'جاري الإضافة...' : 'إضافة المنتجات المحددة للسلة'}
                </Button>
              </div>
            </div>
          </section>
        ) : null}
      </PageContainer>
    </div>
  );
}
