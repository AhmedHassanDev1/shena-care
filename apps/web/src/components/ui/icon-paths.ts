// SAHEL icon set — path markup copied from docs/design/sahel-v18/06-assets/icons (extracted from the V18 boards),
// deduplicated and named. 24px grid, round caps/joins, currentColor. Drawn RTL-native: "forward" points LEFT and
// "back" points RIGHT; DIRECTIONAL icons mirror themselves under dir="ltr".
export const ICON_PATHS = {
  // Navigation and chrome
  home: '<path d="M4.5 10.5 12 4.5l7.5 6v9h-5v-5h-5v5h-5z"/>', // icon-038 / FloatingNav
  shop: '<rect x="4.5" y="4.5" width="6" height="6" rx="1.5"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.5"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.5"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.5"/>', // icon-039
  routine: '<path d="M3.5 17.5h17"/><path d="M7.5 17.5a4.5 4.5 0 0 1 9 0"/><path d="M12 6.5v2.5"/><path d="M6 9.5l1.4 1.4"/><path d="M18 9.5l-1.4 1.4"/>', // icon-034 (sun on the horizon)
  evening: '<path d="M18.5 14.5A7 7 0 0 1 9.5 5.5a7 7 0 1 0 9 9z"/>', // icon-043 (moon)
  user: '<circle cx="12" cy="8.5" r="3.75"/><path d="M4.75 20c1.2-3.6 4-5.25 7.25-5.25S18.05 16.4 19.25 20"/>', // icon-019
  bag: '<path d="M5.5 8.5h13l-1 11.25h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>', // bag.svg
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>', // search-ic.svg
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/>', // zoom.svg
  filter: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', // filter-ic.svg
  sort: '<path d="M8 5v14M4.5 15.5 8 19l3.5-3.5"/><path d="M16 19V5M12.5 8.5 16 5l3.5 3.5"/>', // sort-ic.svg
  list: '<path d="M8 6h11M8 12h11M8 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>', // routine-ic.svg
  close: '<path d="M6 6l12 12M18 6L6 18"/>', // icon-006
  'chevron-back': '<path d="M9 6l6 6-6 6"/>', // back.svg — points right (back in RTL)
  'chevron-forward': '<path d="M15 6l-6 6 6 6"/>', // icon-013 — points left (forward in RTL)
  'chevron-down': '<path d="M6 9.5l6 6 6-6"/>', // chev.svg
  'arrow-forward': '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>', // icon-015 ARROW

  // Actions
  plus: '<path d="M12 5v14M5 12h14"/>', // icon-004
  minus: '<path d="M5 12h14"/>', // minus.svg
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>', // trash.svg
  copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/>', // copy.svg
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/>', // share.svg
  retry: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>', // retry-ic.svg
  gps: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>', // gps.svg

  // Status
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', // ok-ic.svg / check.svg
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5"/><path d="M12 16h.01"/>', // icon-078

  // Commerce
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>', // icon-027
  truck: '<path d="M3.5 7h10v9h-10z"/><path d="M13.5 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.75"/><circle cx="17" cy="17.5" r="1.75"/>', // truck.svg
  cash: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/>', // cash.svg
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 9.5h18M7 15h4"/>', // card.svg
  payment: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M3.5 10h17"/>', // icon-024 (footer «الدفع»)
  returns: '<path d="M15 7l4 4-4 4"/><path d="M19 11h-9a5 5 0 0 0 0 10h2"/>', // icon-025 (footer «الاسترجاع»)
  shield: '<path d="M12 3.5l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9v-5z"/><path d="M9 12l2 2 4-4"/>', // icon-026 (footer «مصدر المنتجات»)
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>', // ph.svg / wallet.svg
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>', // lock.svg
  message: '<path d="M4.5 6.5h15v10h-9l-4 3v-3h-2z"/>', // msg.svg
  camera: '<path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z"/><circle cx="12" cy="13" r="3.25"/>', // icon-049 (image placeholder)
  'image-off': '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 15l4.5-4.5 4 4 2.5-2.5 6 6"/><path d="M4 4l16 16"/>', // icon-071 (img-error)

  // Care concerns and media controls. Path data from Lucide (ISC licence, https://lucide.dev); copied here so the app keeps
  // one icon source and no icon-library dependency. Names say what they mean in the storefront, not the Lucide name.
  acne: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>', // lucide circle-dot
  dryness: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>', // lucide droplet
  pigmentation: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>', // lucide sun
  'hair-loss': '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>', // lucide trending-down
  wrinkles: '<path d="M2 12q2.5 2 5 0t5 0 5 0 5 0"/><path d="M2 19q2.5 2 5 0t5 0 5 0 5 0"/><path d="M2 5q2.5 2 5 0t5 0 5 0 5 0"/>', // lucide waves-horizontal
  frizz: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>', // lucide wind (flows toward the reading end in RTL)
  pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>', // lucide pause
  play: '<path d="M18 3 4 12l14 9z" stroke-linejoin="round"/>', // lucide play, drawn pointing at the reading end (RTL)
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/><path d="M19 3v4M21 5h-4"/>', // lucide sparkles
  science: '<path d="M10 2v7.3M14 2v7.3M8.5 2h7M14 9.3a6.5 6.5 0 1 1-4 0"/>', // lucide flask
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>', // lucide sun
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>', // lucide bookmark
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>', // lucide arrow-left-right
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>', // lucide mic
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>', // lucide send
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>', // lucide heart
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>', // lucide history
  attach: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>', // lucide paperclip
  'more-vertical': '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>', // lucide more-vertical
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', // lucide arrow-up
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Icons whose meaning depends on reading direction; they flip under dir="ltr". */
export const DIRECTIONAL_ICONS: readonly IconName[] = ['chevron-back', 'chevron-forward', 'arrow-forward', 'returns', 'play'];
