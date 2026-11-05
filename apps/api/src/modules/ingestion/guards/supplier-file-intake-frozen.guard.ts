import { CanActivate, ConflictException, Injectable } from '@nestjs/common';
import { isBroadcastMode } from '../../sourcing/public';

/**
 * MVP freeze (GLO-285): while BROADCAST_ON_DEMAND is the active sourcing mode, supplier files, stock synchronization and catalog matching are not
 * part of any workflow. The code, data and reads stay intact and the routes come back the moment the mode returns to OFFER_BASED.
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
