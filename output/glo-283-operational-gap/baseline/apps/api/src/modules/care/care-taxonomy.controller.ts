import { Controller, Get } from '@nestjs/common';
import { CareService } from './services/care.service';

/**
 * Public, read-only care taxonomy. Concerns are shopping aids that guests need for discovery (Home "shop by
 * concern"), so this controller is deliberately unguarded and kept apart from CareController, whose class-level
 * guards protect profiles and administration. It returns reference data only: never profiles or anything
 * tied to a customer. Writes stay on CareController (ADMIN + catalog.manage).
 */
@Controller('care')
export class CareTaxonomyController {
  constructor(private readonly careService: CareService) {}

  @Get('concerns')
  async getConcerns() {
    return this.careService.getPublicConcerns();
  }
}
