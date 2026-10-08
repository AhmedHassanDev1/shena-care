'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orders } from '@/lib/orders';
import { useMessages, useLocale } from '@/lib/i18n/LocaleProvider';
import { CheckCircle2, Clock, Truck, Package, XCircle, AlertCircle, RefreshCcw, MapPin } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';

export default function OrderPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const m = useMessages();
  const locale = useLocale();
  const isRtl = locale === 'ar';
  const queryClient = useQueryClient();
  const guestToken = searchParams.get('token') || undefined;

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['orderTracking', params.id, guestToken],
    queryFn: () => orders.getOrder(params.id, guestToken),
    retry: false,
  });

  const respondMutation = useMutation({
    mutationFn: ({ decisionId, action, version }: { decisionId: string, action: string, version: number }) => 
      orders.respondToAvailability(params.id, decisionId, action, version, guestToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderTracking', params.id] });
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FFFDF9] flex flex-col items-center justify-center pb-24">
        <BrandLogo />
        <div className="w-10 h-10 border-4 border-[#E57A73] border-t-transparent rounded-full animate-spin mt-8"></div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-[#FFFDF9] pt-12 text-center pb-24 px-4">
        <BrandLogo />
        <div className="mt-12 p-6 bg-red-50 text-red-700 rounded-xl inline-block max-w-md mx-auto">
          <p className="font-bold mb-2">Order Not Found</p>
          <p className="text-sm">We couldn't load your order details. It may require logging in.</p>
        </div>
      </div>
    );
  }

  // Determine primary display state
  const isActionRequired = !!order.actionRequired;
  const isCancelled = order.status === 'CANCELLED';
  const isConfirmed = order.availabilityConfirmed;
  
  // Basic icon/color mapping for states
  const getHeaderUi = () => {
    if (isCancelled) return { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', title: 'Order Cancelled' };
    if (isActionRequired) return { icon: AlertCircle, color: 'text-amber-600', bg: 'bg-amber-50', title: 'Action Required' };
    if (isConfirmed) return { icon: CheckCircle2, color: 'text-[#2E7D32]', bg: 'bg-[#F0FBEC]', title: 'Availability Confirmed' };
    return { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', title: isRtl ? 'استلمنا طلبك' : 'Order Received' };
  };

  const headerUi = getHeaderUi();
  const HeaderIcon = headerUi.icon;

  return (
    <div className="min-h-screen bg-[#FFFDF9] pb-24">
      {/* Header */}
      <header className="flex justify-between items-center py-4 px-4 bg-white shadow-sm border-b border-black/5" dir="ltr">
        <BrandLogo />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-8">
        
        {/* Status Header */}
        <div className={`flex items-start gap-4 p-5 rounded-2xl mb-6 ${headerUi.bg}`}>
          <HeaderIcon className={`w-8 h-8 shrink-0 ${headerUi.color} mt-1`} />
          <div>
            <h1 className={`text-xl font-bold mb-1 ${headerUi.color}`}>{headerUi.title}</h1>
            <p className="text-sm text-norya-stone-700 leading-relaxed">
              {isCancelled 
                ? 'Your order has been cancelled.'
                : isActionRequired 
                ? order.actionRequired.message
                : isConfirmed 
                ? 'All items are secured and your order is being prepared for delivery.'
                : (isRtl ? 'هنأكد توفر المنتجات ونبدأ التجهيز.' : 'We will confirm item availability and begin preparation.')}
            </p>
          </div>
        </div>

        {/* Action Required Block */}
        {isActionRequired && (
          <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl mb-6">
            <h2 className="font-bold text-amber-900 mb-2">{order.actionRequired.headline}</h2>
            <div className="flex gap-3 flex-wrap mt-4">
              {order.actionRequired.decisions.map((decision: any) => (
                <div key={decision.id} className="flex gap-2 w-full">
                  {order.actionRequired.allowedActions.map((action: string) => (
                    <button
                      key={action}
                      disabled={respondMutation.isPending}
                      onClick={() => respondMutation.mutate({ decisionId: decision.id, action, version: decision.version })}
                      className="flex-1 bg-white border border-amber-300 text-amber-900 font-medium py-2 px-4 rounded-xl hover:bg-amber-100 disabled:opacity-50 transition-colors"
                    >
                      {action === 'accept_alternative' ? 'Accept Alternative' 
                        : action === 'remove_item' ? 'Remove Item'
                        : action === 'cancel_order' ? 'Cancel Order'
                        : action}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-black/5 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-lg text-norya-stone-900">Order #{order.orderNumber}</h2>
            <span className="text-sm text-norya-stone-500">
              {new Date(order.createdAt).toLocaleDateString()}
            </span>
          </div>

          {/* Timeline */}
          {order.timeline && order.timeline.length > 0 && (
            <div className="mb-6 relative pt-4 pl-2 pr-2">
              <div className="absolute top-6 bottom-6 ltr:left-4 rtl:right-4 w-0.5 bg-norya-stone-100" />
              <div className="flex flex-col gap-6">
                {order.timeline.map((event: any, i: number) => {
                  const isLast = i === order.timeline.length - 1;
                  return (
                    <div key={i} className="flex gap-4 relative z-10">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isLast ? 'bg-[#E57A73]' : 'bg-[#4CAF50]'} border-4 border-white shadow-sm`}>
                      </div>
                      <div className="pt-0.5">
                        <div className={`font-bold text-sm ${isLast ? 'text-norya-stone-900' : 'text-norya-stone-500'}`}>
                          {event.status === 'RECEIVED' ? 'Order Received'
                           : event.status === 'CONFIRMED' ? 'Confirmed'
                           : event.status === 'PREPARING' ? 'Preparing'
                           : event.status === 'OUT_FOR_DELIVERY' ? 'Out for Delivery'
                           : event.status === 'DELIVERED' ? 'Delivered'
                           : event.status}
                        </div>
                        <div className="text-xs text-norya-stone-400 mt-1">
                          {new Date(event.occurredAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Delivery Details */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-black/5 mb-6">
          <h3 className="font-bold text-norya-stone-900 mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Delivery Information
          </h3>
          <div className="text-sm text-norya-stone-700 bg-norya-stone-50 p-3 rounded-xl border border-norya-stone-100">
            <div className="font-medium mb-1">{order.customerName}</div>
            <div>{order.deliveryAddress.address}, {order.deliveryAddress.area}, {order.deliveryAddress.governorate}</div>
            {order.delivery?.estimatedDate && (
              <div className="mt-3 pt-3 border-t border-norya-stone-200 text-[#2E7D32] font-medium flex gap-2">
                <Truck className="w-4 h-4" /> 
                ETA: {new Date(order.delivery.estimatedDate).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-black/5 mb-6">
          <h3 className="font-bold text-norya-stone-900 mb-4 flex items-center gap-2">
            <Package className="w-4 h-4" /> Ordered Items
          </h3>
          <div className="flex flex-col gap-4">
            {order.items.map((item: any) => (
              <div key={item.id} className={`flex justify-between items-center py-2 ${item.lineState !== 'active' ? 'opacity-50 line-through' : ''}`}>
                <div className="flex-1">
                  <div className="font-medium text-sm text-norya-stone-900">{item.productName}</div>
                  <div className="text-xs text-norya-stone-500">Qty: {item.quantity} | {item.status}</div>
                </div>
                <div className="font-bold text-sm text-norya-stone-900">
                  {item.lineTotal.toFixed(0)} {item.currency}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-dashed border-norya-stone-200 text-sm">
            <div className="flex justify-between mb-2 text-norya-stone-600">
              <span>Subtotal</span>
              <span>{order.amounts.subtotal.toFixed(0)} {order.amounts.currency}</span>
            </div>
            <div className="flex justify-between mb-4 text-norya-stone-600">
              <span>Delivery</span>
              <span>{order.amounts.shippingFee === 0 ? 'Free' : `${order.amounts.shippingFee.toFixed(0)} ${order.amounts.currency}`}</span>
            </div>
            <div className="flex justify-between font-bold text-lg text-norya-stone-900">
              <span>Total</span>
              <span>{order.amounts.originalCodAmount.toFixed(0)} {order.amounts.currency}</span>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
