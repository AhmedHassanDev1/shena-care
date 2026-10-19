export interface AutoAttempt {
  time: string
  action: string
  outcome: string
  reason: string
}

export interface AllowedOutcome {
  id: string
  label: string
  description: string
}

export interface OperationalException {
  id: string
  title: string
  failureReason: string
  detail: string
  severity: 'critical' | 'urgent' | 'warning'
  category: 'supply' | 'delivery' | 'hub' | 'cash'
  affectedCount: number
  affectedOrders: string[]
  assignedRole: string
  waitingTime: string
  slaStatus: 'over' | 'soon' | 'ok'
  slaLabel: string
  primaryAction: string
  linkHref: string
  autoAttempts: AutoAttempt[]
  allowedOutcomes: AllowedOutcome[]
}

export interface AuditRecord {
  id: string
  exceptionId: string
  title: string
  resolvedAt: string
  resolvedBy: string
  outcomeLabel: string
  justification: string
  affectedOrders: string[]
}

export const INITIAL_EXCEPTIONS: OperationalException[] = [
  {
    id: 'exc-1',
    title: 'استنفاد التوريد التلقائي لمنتج حرج (أمر شراء #PO-1042)',
    failureReason: 'تم استنفاد جميع بدائل الموردين المؤهلين آلياً (3 صيدليات رفضت لعدم توفر المخزون). النظام يتطلب تفويضاً إدارياً لاختيار مسار بديل.',
    detail: 'صيدلية الأمل، صيدلية العزبي، مستودع الأهرام · سيروم بانادول إكسترا 50 مل · المطلوب 50 عبوة والمؤكد 12 فقط',
    severity: 'critical',
    category: 'supply',
    affectedCount: 3,
    affectedOrders: ['#1192', '#1195', '#1201'],
    assignedRole: 'مدير التوريد والعمليات (Supply Ops Lead)',
    waitingTime: 'منذ ساعتين و 15 دقيقة',
    slaStatus: 'over',
    slaLabel: 'تجاوز SLA بـ 45 دقيقة',
    primaryAction: 'مراجعة وحل الاستثناء',
    linkHref: '/admin/sourcing',
    autoAttempts: [
      {
        time: '10:15 ص',
        action: 'توجيه آلي أولي لصيدلية الأمل (المورد الأساسي)',
        outcome: 'رفض تلقائي جزئي',
        reason: 'تأكيد 12 عبوة فقط من أصل 50 مع إشارة نفاد الرصيد',
      },
      {
        time: '10:22 ص',
        action: 'تحويل آلي فوري للمورد البديل: صيدلية العزبي (المعادي)',
        outcome: 'رفض تلقائي',
        reason: 'الرصيد المتاح صفر في كتالوج التوريد اللحظي',
      },
      {
        time: '10:35 ص',
        action: 'توجيه آلي للمورد الاحتياطي: مستودع الأهرام (الجيزة)',
        outcome: 'انتهاء مهلة SLA',
        reason: 'لم يتم استلام تأكيد في مهلة 30 دقيقة المحددة بنظام التوريد',
      },
      {
        time: '10:45 ص',
        action: 'استنفاد كافة الموردين المؤهلين آلياً في القاهرة والجيزة',
        outcome: 'تحويل إلزامي لطابور التدخل البشري',
        reason: 'حظر التبديل اليدوي العشوائي لحين إقرار خيار إداري معتمد',
      },
    ],
    allowedOutcomes: [
      {
        id: 'APPROVE_SUBSTITUTE',
        label: 'اعتماد صنف بديل معتمد وإشعار العملاء',
        description: 'استبدال الصنف ببديل مكافئ مسجل بالكتالوج وإرسال إشعار موافقة للعميل آلياً.',
      },
      {
        id: 'SPLIT_AND_REFUND',
        label: 'تجزئة الشحنة وإلغاء الكمية العاجزة مع رد المبلغ',
        description: 'شحن الـ 12 عبوة المتوفرة ورد قيمة الكمية المتبقية فوراً لمحفظة العميل.',
      },
      {
        id: 'EMERGENCY_DIRECT_PO',
        label: 'إصدار أمر شراء طارئ مباشر من الوكيل المعتمد',
        description: 'إصدار أمر شراء خاص عاجل خارج دورة التوريد الدورية.',
      },
    ],
  },
  {
    id: 'exc-2',
    title: 'تعارض إحداثيات الخريطة وتكرار تعذر الوصول للعميل (مدينة نصر)',
    failureReason: 'السائق حاول التسليم مرتين ميدانياً؛ إحداثيات GPS على الخريطة تبعد 1.8 كم عن العنوان المكتوب، وتكرر تعذر التواصل هاتفياً.',
    detail: 'الطلب #1189 · العميل: أحمد إبراهيم · العنوان: الحي السابع - مدينة نصر',
    severity: 'urgent',
    category: 'delivery',
    affectedCount: 1,
    affectedOrders: ['#1189'],
    assignedRole: 'مسؤول دعم التوصيل (Dispatch Lead)',
    waitingTime: 'منذ 45 دقيقة',
    slaStatus: 'soon',
    slaLabel: 'محاولة ثانية فاشلة قبل تعليق الشحنة',
    primaryAction: 'مراجعة وحل الاستثناء',
    linkHref: '/admin/delivery',
    autoAttempts: [
      {
        time: '09:15 ص',
        action: 'إرسال رسالة SMS آلية برابط تدقيق موقع التسليم (GPS Pin)',
        outcome: 'تم الإرسال',
        reason: 'لم يتم النقر أو تحديث الموقع من قبل العميل',
      },
      {
        time: '09:40 ص',
        action: 'محاولة اتصال آلي مسجل لتأكيد الحضور',
        outcome: 'لا يوجد رد',
        reason: 'الهاتف مغلق أو غير متاح',
      },
      {
        time: '10:10 ص',
        action: 'تسجيل فشل محاولة ثانية من قبل مندوب التوصيل',
        outcome: 'تجميد الشحنة تلقائياً',
        reason: 'منع الإرجاع العشوائي لحين قرار إدارة العمليات',
      },
    ],
    allowedOutcomes: [
      {
        id: 'UPDATE_COORDINATES_CALL',
        label: 'تحديث إحداثيات الموقع بعد التواصل المباشر مع العميل',
        description: 'تدقيق الموقع وتعديل نقطة التسليم بالخريطة وإعادة إسنادها للمندوب.',
      },
      {
        id: 'RESCHEDULE_NEXT_DAY',
        label: 'إعادة جدولة الشحنة على مسار الغد الصباحي',
        description: 'إبقاء الطرد بأمان في عهدة المخزن المركزي وجدولته ليوم العمل التالي.',
      },
      {
        id: 'RETURN_PARCEL_TO_HUB',
        label: 'إقرار تعذر التسليم وإعادة الطرد لمخزن المعادي',
        description: 'إغلاق أمر التوصيل وإعادة المنتجات لعهدة المخزن المركزي.',
      },
    ],
  },
  {
    id: 'exc-3',
    title: 'تكدس شحنات جاهزة للتوزيع بمحطة المعادي (خط سير الدقي)',
    failureReason: '4 شحنات مجهزة ومختومة تجاوزت نافذة الخروج المحددة بـ 40 دقيقة لتشبع سعة مناديب مسار الدقي، مع عدم توفر مناديب متاحين آلياً.',
    detail: 'المخزن المركزي (المعادي) · خط سير الدقي والمهندسين · 4 شحنات معبأة',
    severity: 'urgent',
    category: 'hub',
    affectedCount: 4,
    affectedOrders: ['#1184', '#1186', '#1187', '#1190'],
    assignedRole: 'مشرف الحركة والتوزيع (Central Hub Dispatch Lead)',
    waitingTime: 'منذ ساعة و 10 دقائق',
    slaStatus: 'over',
    slaLabel: 'تأخير 40 دقيقة عن موعد خروج الركبة',
    primaryAction: 'مراجعة وحل الاستثناء',
    linkHref: '/admin/hub',
    autoAttempts: [
      {
        time: '10:00 ص',
        action: 'خوارزمية التجميع التلقائي حاولت ضم الشحنات للمسار #RUN-0219',
        outcome: 'تم الرفض آلياً',
        reason: 'اكتمال السعة القصوى لحقيبة المندوب (12/12 طرد)',
      },
      {
        time: '10:15 ص',
        action: 'فحص مصفوفة المناديب النشطين في نطاق المعادي والدقي',
        outcome: 'لا يوجد مندوب شاغر',
        reason: 'كافة المناديب في مسارات تسليم ميدانية نشطة',
      },
      {
        time: '10:30 ص',
        action: 'تصعيد آلي لغرفة العمليات لتكليف مندوب احتياطي',
        outcome: 'بانتظار تفويض إداري',
        reason: 'تعيين المناديب الاحتياطيين يتطلب موافقة إدارية',
      },
    ],
    allowedOutcomes: [
      {
        id: 'DISPATCH_OVERFLOW_DRIVER',
        label: 'تكليف كابتن احتياطي بمسار طوارئ خاص',
        description: 'فتح مسار توصيل إضافي استثنائي وتكليف مندوب طوارئ لتسليم الشحنات.',
      },
      {
        id: 'SPLIT_AND_MERGE_RETURN',
        label: 'توزيع الشحنات على المناديب العائدين للمخزن المركزي',
        description: 'إعادة جدولة توزيع الشحنات فور وصول أول كابتن عائد في منتصف اليوم.',
      },
    ],
  },
]
