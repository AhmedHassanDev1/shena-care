'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCart } from '@/features/cart/hooks/useCart';
import { useCheckoutQuote } from '@/features/checkout/hooks/useCheckoutQuote';
import { orders } from '@/lib/orders';
import { auth } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { useMessages, useLocale } from '@/lib/i18n/LocaleProvider';
import { MapPin, CreditCard, ShoppingCart, ShieldCheck, ChevronRight, ChevronLeft, Check, Plus } from 'lucide-react';
import Link from 'next/link';

export default function CheckoutPage() {
  const router = useRouter();
  const m = useMessages();
  const locale = useLocale();
  const isRtl = locale === 'ar';
  const BackIcon = isRtl ? ChevronRight : ChevronLeft;
  const ArrowIcon = isRtl ? ChevronLeft : ChevronRight;

  const { cart, isLoading: cartLoading } = useCart();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // Basic address form state for MVP
  const [isEditingAddress, setIsEditingAddress] = useState(true);
  const [formData, setFormData] = useState({
    customerName: '',
    customerPhone: '',
    governorate: 'cairo',
    area: '',
    address: '',
    landmark: '',
  });

  const [idempotencyKey] = useState(() => uuidv4());

  // Quote covers pricing and availability revalidation
  const { 
    data: quote, 
    isLoading: quoteLoading, 
    error: quoteError 
  } = useCheckoutQuote({
    governorate: formData.governorate,
    area: formData.area || 'default',
  });

  if (cartLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-10 h-10 border-4 border-[#E57A73] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    router.push('/cart');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!quote) {
      setError('Please wait for shipping quote to calculate.');
      return;
    }

    setSubmitting(true);

    try {
      const fullAddress = `${formData.address}${formData.landmark ? `, Landmark: ${formData.landmark}` : ''}`;
      
      const order = await orders.checkout({
        customerName: formData.customerName,
        customerPhone: formData.customerPhone,
        governorate: formData.governorate,
        area: formData.area,
        shippingAddress: fullAddress,
        idempotencyKey,
        quoteVersion: quote.quoteVersion,
        cartRevision: cart.revision || 0,
      });
      
      const url = order.guestToken ? `/orders/${order.id}?token=${order.guestToken}` : `/orders/${order.id}`;
      router.push(url);
    } catch (err: any) {
      if (err?.type === 'CONFLICT') {
        setError('Checkout details changed (e.g. price or availability). Please review the updated totals and try again.');
        queryClient.invalidateQueries({ queryKey: ['checkoutQuote'] });
        queryClient.invalidateQueries({ queryKey: ['cart'] });
      } else {
        setError(err instanceof Error ? err.message : 'Checkout failed');
      }
      setSubmitting(false);
    }
  };

  const hasUnavailableItems = quote?.items.some((i: any) => !i.sellable);

  const getGovernorateLabel = (val: string) => {
    if (val === 'cairo') return m.cairo;
    if (val === 'giza') return m.giza;
    return m.otherGovernorates;
  };

  return (
    <div className="min-h-screen bg-[#FFFDF9] pb-32">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-white sticky top-0 z-40 shadow-sm border-b border-black/5">
        <button onClick={() => router.back()} className="p-2 -mx-2 text-norya-stone-900" aria-label="Go back">
          <BackIcon className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-bold text-norya-stone-900">{m.checkoutTitle}</h1>
        <div className="w-6" /> {/* Balance spacer */}
      </header>

      <form onSubmit={handleSubmit} className="max-w-xl mx-auto px-4 pt-6 flex flex-col gap-8">
        
        {/* Errors */}
        {(error || quoteError) && (
          <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm font-medium">
            {error || (quoteError as Error)?.message || 'An error occurred'}
          </div>
        )}
        {hasUnavailableItems && (
          <div className="bg-amber-50 text-amber-700 p-4 rounded-xl text-sm font-medium">
            Some items are no longer available. Please update your cart.
          </div>
        )}

        {/* Section 1: Delivery */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-5 h-5 text-norya-stone-900" />
            <h2 className="text-base font-bold text-norya-stone-900">{m.deliveryDetails}</h2>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-black/5">
            {/* Governorate Radio Group */}
            <div className="flex gap-2 mb-5 overflow-x-auto pb-2 scrollbar-hide">
              {['cairo', 'giza', 'other'].map(gov => (
                <label 
                  key={gov} 
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    formData.governorate === gov 
                    ? 'border-[#E57A73] bg-[#FEF2F2] text-[#E57A73]' 
                    : 'border-norya-stone-200 text-norya-stone-600 bg-white'
                  }`}
                >
                  <input 
                    type="radio" 
                    name="governorate" 
                    value={gov} 
                    checked={formData.governorate === gov}
                    onChange={(e) => setFormData({ ...formData, governorate: e.target.value })}
                    className="sr-only" 
                  />
                  <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${formData.governorate === gov ? 'border-[#E57A73]' : 'border-norya-stone-300'}`}>
                    {formData.governorate === gov && <div className="w-2 h-2 rounded-full bg-[#E57A73]" />}
                  </div>
                  {getGovernorateLabel(gov)}
                </label>
              ))}
            </div>

            {isEditingAddress ? (
              <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-2">
                <input
                  type="text" required placeholder="Full Name *"
                  value={formData.customerName} onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                  className="w-full px-4 py-3 bg-norya-stone-50 border border-norya-stone-200 rounded-xl focus:outline-none focus:border-[#E57A73] text-sm"
                />
                <input
                  type="tel" required placeholder="Phone Number (e.g. 010...) *"
                  value={formData.customerPhone} onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                  className="w-full px-4 py-3 bg-norya-stone-50 border border-norya-stone-200 rounded-xl focus:outline-none focus:border-[#E57A73] text-sm text-left" dir="ltr"
                />
                <input
                  type="text" required placeholder="Area / Neighborhood *"
                  value={formData.area} onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                  className="w-full px-4 py-3 bg-norya-stone-50 border border-norya-stone-200 rounded-xl focus:outline-none focus:border-[#E57A73] text-sm"
                />
                <textarea
                  required rows={2} placeholder="Street, Building, Floor, Apt *"
                  value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-3 bg-norya-stone-50 border border-norya-stone-200 rounded-xl focus:outline-none focus:border-[#E57A73] text-sm"
                />
                <input
                  type="text" placeholder="Landmark (Optional)"
                  value={formData.landmark} onChange={(e) => setFormData({ ...formData, landmark: e.target.value })}
                  className="w-full px-4 py-3 bg-norya-stone-50 border border-norya-stone-200 rounded-xl focus:outline-none focus:border-[#E57A73] text-sm"
                />
                
                <div className="flex justify-end gap-2 mt-2">
                  <button type="button" onClick={() => setIsEditingAddress(false)} className="px-4 py-2 text-sm font-medium text-norya-stone-600 bg-norya-stone-100 rounded-lg">Done</button>
                </div>
              </div>
            ) : (
              <div className="border border-norya-stone-200 rounded-xl p-4 mb-4 bg-norya-stone-50">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-norya-stone-900 text-sm mb-1">{formData.customerName || 'Name missing'} - {getGovernorateLabel(formData.governorate)}</div>
                    <div className="text-xs text-norya-stone-600 leading-relaxed max-w-[80%]">
                      {formData.address}, {formData.area}
                      {formData.customerPhone && <div className="mt-1" dir="ltr">{formData.customerPhone}</div>}
                    </div>
                  </div>
                  <button type="button" onClick={() => setIsEditingAddress(true)} className="text-[#E57A73] text-xs font-bold p-1">
                    {m.edit}
                  </button>
                </div>
              </div>
            )}

            {!isEditingAddress && (
              <button type="button" onClick={() => setIsEditingAddress(true)} className="w-full py-3 flex items-center justify-center gap-2 text-[#E57A73] text-sm font-bold border border-dashed border-[#E57A73] rounded-xl bg-[#FEF2F2]/50">
                <Plus className="w-4 h-4" />
                {m.addNewAddress}
              </button>
            )}
          </div>
        </section>

        {/* Section 2: Payment */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-norya-stone-900" />
            <h2 className="text-base font-bold text-norya-stone-900">{m.paymentMethod}</h2>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-black/5 flex flex-col gap-3">
            {/* COD Option */}
            <label className="flex items-start gap-3 p-4 rounded-xl border border-[#E57A73] bg-[#FEF2F2]/50 cursor-pointer">
              <div className="w-4 h-4 rounded-full bg-[#E57A73] text-white flex items-center justify-center mt-0.5 shrink-0">
                <Check className="w-3 h-3" />
              </div>
              <div>
                <div className="font-bold text-norya-stone-900 text-sm">{m.cod}</div>
                <div className="text-xs text-norya-stone-600 mt-1">{m.codDesc}</div>
              </div>
            </label>

            {/* Vodafone Cash (Disabled) */}
            <label className="flex items-start gap-3 p-4 rounded-xl border border-norya-stone-200 bg-norya-stone-50 cursor-not-allowed opacity-60">
              <div className="w-4 h-4 rounded-full border border-norya-stone-300 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold text-norya-stone-900 text-sm">{m.vodafoneCash}</div>
                <div className="text-xs text-norya-stone-600 mt-1">{m.vodafoneCashDesc}</div>
              </div>
            </label>
          </div>
        </section>

        {/* Section 3: Summary */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-norya-stone-900" />
              <h2 className="text-base font-bold text-norya-stone-900">{m.orderSummary}</h2>
            </div>
            <Link href="/cart" className="text-[#E57A73] text-xs font-bold hover:underline">
              {m.viewAndEditCart}
            </Link>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-black/5">
            {/* Horizontal Product List */}
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide mb-4 border-b border-norya-stone-100">
              {cart.items.map((item) => (
                <div key={item.skuId} className="relative shrink-0">
                  <div className="w-16 h-16 bg-[#F5F5F5] rounded-lg border border-black/5 flex items-center justify-center text-xl">
                    <span className="opacity-30">📦</span>
                  </div>
                  <div className="absolute -top-2 -right-2 bg-norya-stone-900 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">
                    {item.quantity}
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between text-norya-stone-600">
                <span>{m.productsTotal.replace('{count}', cart.itemCount.toString())}</span>
                <span className="font-bold text-norya-stone-900">{quote ? quote.totals.subtotal.toFixed(0) : cart.total.toFixed(0)} ج.م</span>
              </div>
              <div className="flex justify-between text-norya-stone-600">
                <span>{m.shippingFees}</span>
                <span className="font-bold text-[#2E7D32]">
                  {quoteLoading ? (
                    <div className="w-3 h-3 border-2 border-[#2E7D32] border-t-transparent rounded-full animate-spin"></div>
                  ) : quote && quote.totals.shipping === 0 ? (
                    m.freeShipping
                  ) : quote ? (
                    `${quote.totals.shipping.toFixed(0)} ج.م`
                  ) : (
                    '---'
                  )}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center mt-5 pt-4 border-t border-dashed border-norya-stone-200">
              <span className="font-bold text-lg text-norya-stone-900">{m.total}</span>
              <span className="font-bold text-2xl text-norya-stone-900">{quote ? quote.totals.total.toFixed(0) : '---'} ج.م</span>
            </div>
          </div>
        </section>

      </form>

      {/* Mobile Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur border-t border-norya-stone-200 z-40 pb-safe">
        <button 
          onClick={handleSubmit}
          disabled={submitting || quoteLoading || hasUnavailableItems || !quote || isEditingAddress}
          className="w-full bg-[#E57A73] hover:bg-[#d66962] disabled:bg-[#f3b5b1] text-white font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          {submitting ? 'جارٍ التأكيد...' : m.placeOrder}
          {!submitting && <ArrowIcon className="w-5 h-5" />}
        </button>
        <div className="flex justify-center items-center gap-1.5 mt-2.5 text-[11px] text-norya-stone-500">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{m.securePaymentDesc}</span>
        </div>
      </div>
    </div>
  );
}
