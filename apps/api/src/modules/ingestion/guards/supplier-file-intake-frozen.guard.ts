import { CanActivate, ConflictException, Injectable } from '@nestjs/common';
import { isBroadcastMode } from '../../sourcing/public';

/**
 * MVP freeze (GLO-285): while BROADCAST_ON_DEMAND is the active sourcing mode, supplier-facing CSV/XLSX uploads, inventory feeds, stock synchronization and
 * ERP integrations are not part of any workflow. The code, data and reads stay intact and the routes come back the moment the mode returns to OFFER_BASED.
 *
 * Scope: this guard sits only on the supplier-file lifecycle routes. It is NOT a freeze of the ingestion module. Admin-controlled catalog ingestion
 * (research, enrichment, media, candidate review, publication) is active in every mode, and the Admin catalog-list upload is a separate route that
 * never carries supplier, stock or offer semantics, so it must not be given this guard.
 */
@Injectable()
export class SupplierFileIntakeFrozenGuard implements CanActivate {
  canActivate(): boolean {
    if (isBroadcastMode()) {
      throw new ConflictException({ code: 'SUPPLIER_INGESTION_FROZEN', message: 'Supplier file intake is frozen while procurement runs on broadcast requests' });
    }
    return true;
  }
}
