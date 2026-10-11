/**
 * Specimen strings for the design lab only (development route, not user-facing copy).
 *
 * Product names are real seed-catalog names (apps/api seed) because the backend serves them in
 * Latin script only — mixed-direction text inside Arabic UI is the normal case to design for.
 * Nothing here is a product claim, recommendation or guidance result.
 */
export const SPECIMEN = {
  ar: {
    display: 'نساعدك تختار عنايتك بثقة',
    heading: 'روتين عملي تقدر تلتزم بيه',
    body: 'شينا كير بتساعدك تفهم احتياجات بشرتك وشعرك، وتقارن بين المنتجات، وتبني روتين بسيط تقدر تكمّل عليه. تقدر تشتري مباشرة في أي وقت، من غير ما تستخدم المساعد.',
    microcopy: 'التوصيل متاح حاليًا في القاهرة والجيزة.',
    productLabel: 'المنتج',
    product: 'Eva Skin Clinic Hyaluronic Acid Day Gel',
    inciLabel: 'مثال لكتابة المكونات (INCI)',
    inci: 'Aqua, Glycerin, Sodium Hyaluronate, Niacinamide',
    units: ['٥٠ مل', 'SPF 50+', '٢٠٠ جم'],
    orderLabel: 'رقم الطلب',
  },
  en: {
    display: 'Choose your care with confidence',
    heading: 'A practical routine you can keep',
    body: 'Shena Care helps you understand your skin and hair needs, compare products, and build a simple routine you can stick to. You can buy directly at any time, without using the assistant.',
    microcopy: 'Delivery is currently available in Cairo and Giza.',
    productLabel: 'Product',
    product: 'Eva Skin Clinic Hyaluronic Acid Day Gel',
    inciLabel: 'INCI formatting example',
    inci: 'Aqua, Glycerin, Sodium Hyaluronate, Niacinamide',
    units: ['50 ml', 'SPF 50+', '200 g'],
    orderLabel: 'Order number',
  },
} as const;

export const SPECIMEN_PRICE = { amount: 349.5, currency: 'EGP' } as const;
export const SPECIMEN_ORDER_NUMBER = 'ORD-2610-4821';

/**
 * Customer-facing order stages from the backend contract
 * (apps/api/src/modules/ordering/dto/order-tracking.dto.ts — CUSTOMER_STAGES, happy path).
 * The lab renders a fixed sample state for layout review; it is not live order data.
 */
export const ORDER_STAGES = [
  { id: 'RECEIVED', ar: 'استلمنا طلبك', en: 'Order received' },
  { id: 'CONFIRMING_PRODUCTS', ar: 'بنأكد توفر المنتجات', en: 'Confirming products' },
  { id: 'CONFIRMED', ar: 'تم التأكيد', en: 'Confirmed' },
  { id: 'PREPARING', ar: 'بنجهز طلبك', en: 'Preparing' },
  { id: 'OUT_FOR_DELIVERY', ar: 'في الطريق ليك', en: 'Out for delivery' },
  { id: 'DELIVERED', ar: 'تم التوصيل', en: 'Delivered' },
] as const;
export const SAMPLE_CURRENT_STAGE = 'PREPARING';
