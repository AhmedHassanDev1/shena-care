# Shena Care — Design Review Rules v0.1

**Status:** Proposed review policy  
**Role:** Senior Design Reviewer / Red Team  
**Applies to:** Claude Code, Codex, Antigravity, and other contributors.

## 1. Purpose

Prevent design drift, generic AI-generated interfaces, accessibility failures, and uncontrolled design-system changes.

All visual work must align with the approved Shena Care brand strategy.

A design is not acceptable simply because it looks polished or modern.

---

## 2. Source of Truth

Review decisions in this order:

1. Explicitly approved decisions from the project owner
2. `01-brand-direction.md`
3. `02-visual-references.md`
4. `03-design-foundations.md`
5. Existing approved design-system implementation

When sources conflict, stop and report the conflict.

Do not silently replace an approved decision with a newer proposal.

### Decision Statuses
- **APPROVED:** Explicitly accepted for implementation.
- **PROPOSED:** May be explored and tested.
- **REJECTED:** Must not be reintroduced without justification and approval.
- **OPEN:** Not yet decided.

A generated image never constitutes automatic approval.

---

## 3. Red Team Review Dimensions

### A. Brand Alignment — Weight 25%

Questions:
- Does the interface communicate a personal care companion?
- Does it feel warm, modern, helpful, and trustworthy?
- Is guidance meaningfully represented?
- Is shopping still straightforward?
- Does it avoid unsupported natural, organic, or medical positioning?

**Reject when:** The interface changes the brand's fundamental positioning.

### B. Visual Distinctiveness — Weight 20%

Questions:
- Would the interface remain recognizable without the logo?
- Is there a coherent visual language beyond the chosen colors?
- Does typography contribute to brand character?
- Are distinctive graphic elements purposeful?
- Is the result materially different from common AI beauty templates?

**Reject when:** The result depends entirely on a logo, stock imagery, and generic component styling for its identity.

### C. Visual Harmony & Hierarchy — Weight 20%

Questions:
- Do typography, colors, spacing, imagery, and shapes feel coordinated?
- Are there clear primary and secondary focal points?
- Are decorative elements competing with information?
- Are colors and shapes used consistently?
- Is negative space intentional?

**Reject when:** Visual decoration overwhelms important content or the system feels internally inconsistent.

### D. Accessibility & Arabic UX — Weight 20%

Questions:
- Are Arabic headings and body text readable?
- Does the layout work correctly in RTL?
- Are contrast thresholds satisfied?
- Can controls be used with a keyboard?
- Are focus, disabled, error, and loading states identifiable?
- Is meaningful information communicated without color alone?

**Reject when:** Critical interactions are inaccessible or primary content is unreadable.

### E. Technical Consistency — Weight 15%

Questions:
- Are semantic design tokens used?
- Are existing components reused?
- Are visual and business logic separated?
- Are new dependencies justified?
- Is the work consistent with the current frontend architecture?
- Does the implementation avoid unnecessary duplication?

**Reject when:** A visual change requires avoidable business-logic rewrites or introduces uncontrolled component duplication.

---

## 4. Scoring Rules

Each dimension receives a score from 0 to 5.

- 0 — Fails fundamentally
- 1 — Major issues
- 2 — Below standard
- 3 — Acceptable with improvements
- 4 — Strong
- 5 — Excellent

Weighted score:

`Total = sum((dimension score / 5) × dimension weight)`

### Decision
- **85–100:** Candidate for approval
- **70–84:** Revise specific weaknesses
- **Below 70:** Rework the direction or implementation

Scores are a reviewer heuristic, not user-research evidence.

A high total score cannot override a critical failure.

---

## 5. Critical Blockers

Any of the following blocks approval regardless of score:

1. Material contradiction of approved brand positioning.
2. Unreadable important text or failed applicable accessibility criteria.
3. Broken primary RTL layout or important keyboard interaction.
4. False or unverified product claims presented as facts.
5. Loss of important purchasing or guidance functionality.
6. Unapproved destructive changes to existing functionality.
7. Hardcoded theme values repeated through feature components.
8. Misrepresentation of a proposal as an approved decision.

Critical issues must be corrected before proceeding.

---

## 6. Drift Detection

### Brand Drift
Examples:
- Turning Shena Care into an organic-only store
- Using medical imagery or diagnostic language unnecessarily
- Positioning the assistant as a compulsory purchasing gateway
- Making unsupported personalized recommendations appear certain

### Generic Drift
Examples:
- Repeated generic rounded cards with no meaningful hierarchy
- Default shadcn styling presented as final brand expression
- Generic AI sparkles and gradient-heavy hero treatments
- Template-like compositions that could fit any beauty retailer
- Decorative imagery unrelated to the brand strategy

### Visual Drift
Examples:
- Inconsistent corner radii
- Unrelated icon styles
- Arbitrary colors
- Excessive surface tinting
- Different typography scales across equivalent components

### Technical Drift
Examples:
- New components duplicating existing ones
- Hardcoded hexadecimal colors
- Direct business/API logic embedded in presentation components
- Rewriting functioning APIs to accommodate a visual concept
- Adding unnecessary animation or styling dependencies

### UX Drift
Examples:
- Requiring customers to use AI before browsing products
- Hiding prices or important product information for visual simplicity
- Using confusing navigation metaphors
- Impairing checkout or product discovery
- Making the interface desktop-first despite mobile requirements

---

## 7. Anti-Generic Review Tests

### Test 1 — Logo Removal
Temporarily remove the Shena Care logo.

Ask whether the remaining typography, composition, imagery treatment