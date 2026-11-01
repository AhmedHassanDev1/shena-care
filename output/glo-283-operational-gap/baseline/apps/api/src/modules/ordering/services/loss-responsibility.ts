/**
 * Who bears the loss of a returned, damaged or expired product (owner decision 2026-10-25). A cause decides it:
 * the supplier for a defect it caused, ShinaCare for an app mistake, the hub for storage/handling/delivery, and
 * ShinaCare and the hub half each when nobody is clearly at fault. Several at fault: shares by fault, set by the owner.
 */
export const LOSS_PARTIES = ['NONE', 'SUPPLIER', 'HUB', 'APP', 'GENERAL', 'SPLIT'] as const;
export type LossParty = typeof LOSS_PARTIES[number];

/** What happens to the goods: sealed and intact go back to the supplier, anything else is written off. */
export const LOSS_DISPOSITIONS = ['RETURN_TO_SUPPLIER', 'WRITE_OFF'] as const;
export type LossDisposition = typeof LOSS_DISPOSITIONS[number];

export interface LossShares { supplier: number; hub: number; shinacare: number }

/** Shares in whole percent; they always add up to 100 (NONE means nobody loses). */
export function lossShares(party: LossParty, explicit?: Partial<LossShares>): LossShares | null {
  switch (party) {
    case 'NONE': return null;
    case 'SUPPLIER': return { supplier: 100, hub: 0, shinacare: 0 };
    case 'HUB': return { supplier: 0, hub: 100, shinacare: 0 };
    case 'APP': return { supplier: 0, hub: 0, shinacare: 100 };
    case 'GENERAL': return { supplier: 0, hub: 50, shinacare: 50 };
    case 'SPLIT': {
      const shares = { supplier: explicit?.supplier ?? 0, hub: explicit?.hub ?? 0, shinacare: explicit?.shinacare ?? 0 };
      const values = Object.values(shares);
      if (!values.every(v => Number.isInteger(v) && v >= 0 && v <= 100) || values.reduce((a, b) => a + b, 0) !== 100) {
        throw new RangeError('A split needs whole-percent shares (supplier, hub, shinacare) that add up to 100');
      }
      return shares;
    }
  }
}
