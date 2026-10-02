# Edge States and Recovery Paths Matrix

This matrix defines the standard failure states and recovery paths across all core flows in the application.

## 1. Auth Boundary
**State:** User attempts to access a protected route or action without a valid session.
**Recovery Path:**
- Redirect to `/auth/login` with `?redirect=` parameter.
- Preserve user input where possible (e.g., cart contents in local storage/cookie).
- Provide Guest Checkout fallback for ordering paths.

## 2. Validation Errors
**State:** Form submission fails local or server-side validation.
**Recovery Path:**
- Inline, actionable error messages (e.g., "Phone number requires 10 digits").
- Focus shifts to the first invalid field.
- **Rule:** Never wipe out the user's previously entered valid data.

## 3. Network / Offline Errors
**State:** Request fails due to connectivity loss.
**Recovery Path:**
- Display "You are offline" global toast or banner.
- Actions (like Add to Cart or Checkout) show a retry button or queue locally if non-critical.
- Critical problems do not auto-dismiss.

## 4. Unavailable / Out of Stock (OOS)
**State:** Item in cart or requested in order becomes unavailable before confirmation.
**Recovery Path:**
- Do NOT silently remove or substitute.
- Show `action_required` state.
- Prompt customer to:
  1. Replace with suggested alternative (showing price diff).
  2. Continue without the item.
  3. Cancel order/item.

## 5. Empty States
**State:** No data to display (e.g., Empty Cart, No Orders, No Search Results).
**Recovery Path:**
- Provide clear context ("Your cart is empty").
- Provide primary CTA to exit state ("Continue Shopping", "Browse Categories", "Clear Filters").
- No dead ends.

## 6. Fatal Exceptions (500s / Unrecoverable)
**State:** Server crashes or returns unhandled exception.
**Recovery Path:**
- Catch via Next.js `error.tsx` boundary.
- Display "Something went wrong on our end" message.
- Provide "Try Again" button (re-fetches state).
- Provide contextual Support path ("Contact Support" with correlation ID).
