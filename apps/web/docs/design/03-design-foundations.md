# Shena Care — Design Foundations v0.1

> **Superseded in part:** the palette, typography, radii and component styling described below were replaced by the ShinaCare design system (`apps/web/design-system/`, see CLAUDE.md §4). The principles (guidance-led commerce, Arabic-first, accessibility, no unsupported certainty) still apply; the concrete visual values do not.

**Status:** Foundation specification — partially approved  
**Project:** Shena Care  
**Purpose:** Establish a consistent, scalable design foundation before frontend visual implementation.

## 1. Brand Context

Shena Care is a personal care companion that helps customers understand their needs, discover suitable products, build practical care routines, and purchase products directly.

The experience must communicate guidance, clarity, continuity, and human warmth.

### Approved Decisions
- Brand positioning: Personal Care Companion
- Experience: Guidance-led commerce
- Visual personality: Warm & Modern
- Primary language: Arabic (Egypt), RTL
- Secondary language: English, LTR
- Launch categories: Skincare and Haircare
- Direct shopping must remain accessible without AI interaction
- Personalization must be explainable and never imply unsupported certainty

### Proposed Direction
**The Guided Editorial:** editorial warmth combined with a restrained visual language of guidance and continuity.

### Open Decisions
- Final brand color palette
- Final typography pairing
- Final logo and graphic motif
- Photography art direction
- Exact shape and elevation scales

No proposed direction may be described as approved without explicit review.

---

## 2. Design Principles

1. **Human before technology:** The experience should feel like helpful personal guidance, not a chatbot interface.
2. **Clarity before decoration:** Every visual element must support comprehension, navigation, hierarchy, or brand recognition.
3. **Arabic-first:** Typography, spacing, and directional behavior must be designed for Arabic rather than retrofitted.
4. **Consistency without sameness:** Components share rules but do not all need identical silhouettes.
5. **Product authenticity:** Preserve actual product packaging, brand colors, and verified information.
6. **Flexible identity:** Theme changes must not require rewriting feature components.
7. **Accessible by default:** Contrast, keyboard support, focus indicators, and reduced motion are foundational.

---

## 3. Color Architecture

### Current Decision
Olive Blush is a **temporary development theme only**. It is not the final Shena Care brand palette.

### Token Layers

**Layer A — Primitive Tokens**

Examples:
- `olive-50` through `olive-950`
- `rose-50` through `rose-950`
- `neutral-50` through `neutral-950`

Primitive colors describe values, not their usage. The final scales should be generated and tested rather than inferred from moodboard imagery.

**Layer B — Semantic Tokens**

Required roles:
- `background`
- `foreground`
- `surface`
- `surface-muted`
- `card`
- `card-foreground`
- `primary`
- `primary-foreground`
- `secondary`
- `secondary-foreground`
- `accent`
- `accent-foreground`
- `muted`
- `muted-foreground`
- `border`
- `input`
- `ring`
- `destructive`
- `destructive-foreground`
- `success`
- `warning`
- `info`

Use shadcn/ui-compatible naming or an explicit mapping to existing conventions.

**Layer C — Component Tokens**

Create component-specific tokens only when repeated needs justify them.

Examples:
- `product-card-surface`
- `routine-step-active`
- `assistant-message-surface`
- `guidance-track`
- `image-overlay-start`

Do not create a token for every isolated design property.

### Initial Theme Rules
- Prefer restrained, warm neutral surfaces.
- Use saturated brand color primarily for meaningful emphasis.
- Preserve clear separation between surfaces and interactive controls.
- Do not rely on color alone to indicate status.
- Avoid using beige, olive, or rose indiscriminately across every component.

### Accessibility
- Normal text: at least 4.5:1 contrast under WCAG AA.
- Large text: at least 3:1.
- Relevant non-text UI boundaries and indicators: at least 3:1.
- Validate actual foreground/background combinations computationally.
- Never treat image-generated contrast scores as verified.

---

## 4. Typography System

### Requirements
- Strong Arabic readability
- Clear hierarchy
- Good appearance in Arabic and English
- Support for product names, ingredients, units, prices, and numbers
- Suitable for dense content as well as expressive headings

### Shortlisted Arabic Families
- Alexandria
- Readex Pro
- IBM Plex Sans Arabic

### Shortlisted English Family
- Inter, or another compatible family identified during testing

**No font has been finally approved.**

### Evaluation Process
Test candidates with:
- Short Arabic headlines
- Long Arabic product descriptions
- Egyptian conversational microcopy
- Mixed Arabic/English and INCI ingredient names
- Prices in EGP
- Numerals and unit abbreviations

### Provisional Type Scale
- Display: 36–48px
- Heading 1: 30–36px
- Heading 2: 24–28px
- Heading 3: 20–22px
- Body large: 18px
- Body: 16px
- Supporting text: 14px
- Caption: 12–13px

These are starting ranges, not final tokens. Test actual line height, wrapping, and visual hierarchy across screen sizes.

Do not force small body text to achieve visual elegance.

---

## 5. Spacing & Sizing

### Base Grid
Use a 4px spacing foundation, preferably mapped to Tailwind's spacing system.

Provisional key intervals:
- 4px — micro separation
- 8px — compact spacing
- 12px — related-content spacing
- 16px — standard component spacing
- 24px — grouped spacing
- 32px — section internals
- 48px and above — larger composition spacing

### Rules
- Spacing must reflect information hierarchy.
- Related content should appear visually grouped.
- Avoid excessively large desktop whitespace that creates poor mobile density.
- Use logical spacing properties where directionality matters.
- Avoid arbitrary pixel values when existing tokens are sufficient.

---

## 6. Shape, Borders & Elevation

### Provisional Radius Scale
- Small: 6px
- Medium: 10px
- Large: 14px
- Extra Large: 20px

These are exploratory values, not approved brand measurements.

### Shape Principles
- Prefer clean, moderately sharp geometry.
- Avoid excessively rounded, pill-shaped cards by default.
- Buttons may use different radius conventions from content containers.
- Do not combine too many unrelated shapes on one surface.

### Borders and Shadows
- Prefer subtle borders and meaningful separation over heavy shadows.
- Keep elevation levels minimal.
- Glass effects must be restrained, readable, and optional.
- Never use blur as a substitute for visual hierarchy.

---

## 7. Layout & Responsiveness

### Approach
Mobile-first, with fluid adaptation to tablet and desktop.

### Reference Viewports for Validation
- 320px — narrow mobile
- 390px — common mobile reference
- 768px — tablet
- 1280px — desktop

These are QA viewports, not mandatory application breakpoints.

### Layout Principles
- Layouts must be responsive rather than simply scaled-down desktop designs.
- Use consistent container and grid rules.
- Preserve sensible content reading order.
- Avoid horizontal overflow.
- Maintain adequate interactive target sizes.
- Treat Arabic directionality as part of the layout architecture.

---

## 8. Graphic Language

### Proposed Concept
Guidance, continuity, and progression.

Potential building blocks:
- Meaningful connecting lines
- Steps and markers
- Subtle directional movement
- Modular visual relationships

### Rules
- Motifs should convey a recognizable meaning.
- Avoid decorative paths that are repeated everywhere.
- Avoid generic AI sparkles, robot imagery, and exaggerated futuristic gradients.
- Do not imitate medical diagnostic systems.
- Graphic motifs are not automatically approved as logo elements.

Test motifs at small and large sizes before adoption.

---

## 9. Imagery & Product Presentation

### Product Packshots
- Preserve authentic brand packaging and labels.
- Use real product imagery where available.
- Do not recolor manufacturer packaging to match Shena Care.
- Use consistent image framing without erasing meaningful brand differences.

### Lifestyle Imagery
- Favor believable, warm, contemporary art direction.
- Represent real personal care rather than unattainable perfection.
- Avoid overusing plants, leaves, botanicals, and natural-only symbolism.

### Editorial Imagery
- Warm lighting and controlled composition.
- Restrained texture.
- Clear focal points.
- Enough negative space for readable text when necessary.

### Overlays
- Use gradients strategically to support text legibility.
- Avoid tinting every image with a strong brand color.
- Validate legibility against varied real images.

Production asset licensing and usage rights must be verified.

---

## 10. Icons & Motion

### Iconography
- Use a consistent icon family; Lucide is a reasonable starting point.
- Keep stroke weight and visual proportions consistent.
- Prefer universally understandable metaphors.
- Provide text labels when icons alone are ambiguous.
- Mirror directional icons for RTL where appropriate.

### Motion
- Motion should clarify interaction or progress.
- Avoid decorative motion without value.
- Respect `prefers-reduced-motion`.
- Never delay core commerce actions for visual effects.

---

## 11. Component Foundation

Use existing shadcn/ui and accessible primitives when appropriate.

Prioritize:
- Button
- Input
- Textarea
- Select
- Checkbox / Radio
- Dialog / Sheet
- Tabs
- Badge
- Skeleton
- Alert / Toast

Do not create an entire commerce component library during the foundation phase.

Specialized components such as Product Card, Routine Step, and Assistant Message can be defined when implementing the relevant features.

Each component must have documented variants, states, and accessibility requirements.

---

## 12. Technical Implementation

### Existing Stack
- Next.js App Router
- React and TypeScript
- Tailwind CSS
- shadcn/ui where appropriate
- Feature-based frontend organization

Inspect actual package versions and existing code before changing configuration.

### Requirements
1. Use centralized CSS variables or an equivalent token layer.
2. Map semantic tokens into Tailwind utilities.
3. Preserve existing components and functionality where valid.
4. Keep visual logic separate from data and business logic.
5. Preserve Arabic/English localization infrastructure.
6. Avoid hardcoded user-facing copy.
7. Avoid hardcoded theme colors in feature components.
8. Do not rewrite working authentication, cart, checkout, or API integration code during design foundation work.
9. Document all new dependencies.
10. Keep the theme swappable without feature-level refactoring.

---

## 13. Foundation Deliverables

Claude Code must provide:
- Token definitions and Tailwind mappings
- One provisional Olive theme
- Typography specimens
- Spacing and shape specimens
- Basic component state previews
- Arabic RTL and English LTR validation
- Automated contrast results for relevant token pairs
- A short decision log

### Exit Criteria
The foundation is acceptable when:
- Reusable semantic tokens exist.
- Core components consume semantic tokens.
- Arabic and English render correctly in representative examples.
- Required contrast checks pass.
- No existing business logic is changed.
- All provisional identity decisions remain clearly marked.

**Do not proceed to full page redesign until the foundation review gate is passed.**