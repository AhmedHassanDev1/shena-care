/**
 * Print outcome of one shipment's two paper documents, derived from the operator-confirmed events (never inferred by the server).
 *
 * The latest event of each document wins: a confirmation after a failure makes it printed again, and a failure after a confirmation makes it
 * unprinted again (the paper must be redone). A PRINT_FAILED without a document refers to both. A shipment may be handed off only when
 * both documents are currently printed.
 */
export const PRINT_DOCUMENTS = ['RECEIPT', 'LABEL'] as const;
export type PrintDocument = (typeof PRINT_DOCUMENTS)[number];
export type PrintStatus = 'pending' | 'printed' | 'failed';

export interface PrintEventRow { type: string; reasonCode?: string | null; notes?: string | null; createdAt: Date }

export interface PrintState {
  receipt: PrintStatus;
  label: PrintStatus;
  /** The label data exists (the barcode was generated); the slip cannot be confirmed before this. */
  labelGenerated: boolean;
  /** Both documents are currently confirmed printed. */
  ready: boolean;
  /** The most recent failure that is still open, so the operator sees what went wrong and reprints. */
  lastFailure: { document: PrintDocument | 'BOTH'; note: string | null; at: Date } | null;
}

export const PRINT_EVENT_TYPES_FOR_STATE = ['LABEL_GENERATED', 'LABEL_PRINTED', 'RECEIPT_PRINTED', 'PRINT_FAILED'] as const;

export function derivePrintState(events: PrintEventRow[]): PrintState {
  const ordered = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let receipt: PrintStatus = 'pending';
  let label: PrintStatus = 'pending';
  let labelGenerated = false;
  let lastFailure: PrintState['lastFailure'] = null;
  for (const event of ordered) {
    if (event.type === 'LABEL_GENERATED') labelGenerated = true;
    else if (event.type === 'RECEIPT_PRINTED') receipt = 'printed';
    else if (event.type === 'LABEL_PRINTED') label = 'printed';
    else if (event.type === 'PRINT_FAILED') {
      const document = (PRINT_DOCUMENTS as readonly string[]).includes(event.reasonCode ?? '') ? (event.reasonCode as PrintDocument) : null;
      if (document !== 'LABEL') receipt = 'failed';
      if (document !== 'RECEIPT') label = 'failed';
      lastFailure = { document: document ?? 'BOTH', note: event.notes ?? null, at: event.createdAt };
    }
  }
  if (receipt === 'printed' && label === 'printed') lastFailure = null;
  else if (lastFailure && receipt !== 'failed' && label !== 'failed') lastFailure = null;
  return { receipt, label, labelGenerated, ready: receipt === 'printed' && label === 'printed', lastFailure };
}
