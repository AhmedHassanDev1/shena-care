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
      <div className="min-h-screen bg-background flex flex-col items-center justify-center pb-24">
        <BrandLogo />
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mt-8"></div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-background pt-12 text-center pb-24 px-4">
        <BrandLogo />
        <div className="mt-12 p-6 bg-destructive-subtle text-destructive rounded-xl inline-block max-w-md mx-auto">
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
    if (isCancelled) return { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive-subtle', title: 'Order Cancelled' };
    if (isActionRequired) return { icon: AlertCircle, color: 'text-warning', bg: 'bg-warning-subtle', title: 'Action Required' };
    if (isConfirmed) return { icon: CheckCircle2, color: 'text-success', bg: 'bg-success-subtle', title: 'Availability Confirmed' };
    return { icon: Clock, color: 'text-info', bg: 'bg-info-subtle', title: isRtl ? 'استلمنا طلبك' : 'Order Received' };
  };

  const headerUi = getHeaderUi();
  const HeaderIcon = headerUi.icon;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="flex justify-between items-center py-4 px-4 bg-card shadow-sm border-b border-black/5" dir="ltr">
        <BrandLogo />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-8">
        
        {/* Status Header */}
        <div className={`flex items-start gap-4 p-5 rounded-2xl mb-6 ${headerUi.bg}`}>
          <HeaderIcon className={`w-8 h-8 shrink-0 ${headerUi.color} mt-1`} />
          <div>
            <h1 className={`text-xl font-bold mb-1 ${headerUi.color}`}>{headerUi.title}</h1>
            <p className="text-sm text-foreground leading-relaxed">
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
          <div className="bg-warning-subtle border border-warning/30 p-5 rounded-2xl mb-6">
            <h2 className="font-bold text-warning mb-2">{order.actionRequired.headline}</h2>
            <div className="flex gap-3 flex-wrap mt-4">
              {order.actionRequired.decisions.map((decision: any) => (
                <div key={decision.id} className="flex gap-2 w-full">
                  {order.actionRequired.allowedActions.map((action: string) => (
                    <button
                      key={action}
                      disabled={respondMutation.isPending}
                      onClick={() => respondMutation.mutate({ decisionId: decision.id, action, version: decision.version })}
                      className="flex-1 bg-card border border-warning/30 text-warning font-medium py-2 px-4 rounded-xl hover:bg-warning-subtle disabled:opacity-50 transition-colors"
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

        <div className="bg-card p-5 rounded-2xl shadow-sm border border-black/5 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-lg text-foreground">Order #{order.orderNumber}</h2>
            <span className="text-sm text-muted-foreground">
              {new Date(order.createdAt).toLocaleDateString()}
            </span>
          </div>

          {/* Timeline */}
          {order.timeline && order.timeline.length > 0 && (
            <div className="mb-6 relative pt-4 pl-2 pr-2">
              <div className="absolute top-6 bottom-6 ltr:left-4 rtl:right-4 w-0.5 bg-secondary" />
              <div className="flex flex-col gap-6">
                {order.timeline.map((event: any, i: number) => {
                  const isLast = i === order.timeline.length - 1;
                  return (
                    <div key={i} className="flex gap-4 relative z-10">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isLast ? 'bg-primary' : 'bg-success'} border-4 border-card shadow-sm`}>
                      </div>
                      <div className="pt-0.5">
                        <div className={`font-bold text-sm ${isLast ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {event.status === 'RECEIVED' ? 'Order Received'
                           : event.status === 'CONFIRMED' ? 'Confirmed'
                           : event.status === 'PREPARING' ? 'Preparing'
                           : event.status === 'OUT_FOR_DELIVERY' ? 'Out for Delivery'
                           : event.status === 'DELIVERED' ? 'Delivered'
                           : event.status}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
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
        <div className="bg-card p-5 rounded-2xl shadow-sm border border-black/5 mb-6">
          <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Delivery Information
          </h3>
          <div className="text-sm text-foreground bg-muted p-3 rounded-xl border border-secondary">
            <div className="font-medium mb-1">{order.customerName}</div>
            <div>{order.deliveryAddress.address}, {order.deliveryAddress.area}, {order.deliveryAddress.governorate}</div>
            {order.delivery?.estimatedDate && (
              <div className="mt-3 pt-3 border-t border-border text-success font-medium flex gap-2">
                <Truck className="w-4 h-4" /> 
                ETA: {new Date(order.delivery.estimatedDate).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="bg-card p-5 rounded-2xl shadow-sm border border-black/5 mb-6">
          <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
            <Package className="w-4 h-4" /> Ordered Items
          </h3>
          <div className="flex flex-col gap-4">
            {order.items.map((item: any) => (
              <div key={item.id} className={`flex justify-between items-center py-2 ${item.lineState !== 'active' ? 'opacity-50 line-through' : ''}`}>
                <div className="flex-1">
                  <div className="font-medium text-sm text-foreground">{item.productName}</div>
                  <div className="text-xs text-muted-foreground">Qty: {item.quantity} | {item.status}</div>
                </div>
                <div className="font-bold text-sm text-foreground">
                  {item.lineTotal.toFixed(0)} {item.currency}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-dashed border-border text-sm">
            <div className="flex justify-between mb-2 text-muted-foreground">
              <span>Subtotal</span>
              <span>{order.amounts.subtotal.toFixed(0)} {order.amounts.currency}</span>
            </div>
            <div className="flex justify-between mb-4 text-muted-foreground">
              <span>Delivery</span>
              <span>{order.amounts.shippingFee === 0 ? 'Free' : `${order.amounts.shippingFee.toFixed(0)} ${order.amounts.currency}`}</span>
            </div>
            <div className="flex justify-between font-bold text-lg text-foreground">
              <span>Total</span>
              <span>{order.amounts.originalCodAmount.toFixed(0)} {order.amounts.currency}</span>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
