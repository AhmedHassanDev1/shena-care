import 'reflect-metadata';
// Domain consumers enter through the public contract. A provider importing its
// own public barrel can observe that barrel before its exports are initialized.
import { CatalogModule, BrandResearchService, BrandService, CanonicalResearchService,
  CatalogService, IngredientService, CatalogIntakeService } from '../../src/modules/catalog/public';

describe('Catalog owner module injection', () => {
  it('retains the concrete BrandService token when imported through the public contract', () => {
    expect(CatalogModule).toBeDefined();
    const dependencies = Reflect.getMetadata('design:paramtypes', BrandResearchService);
    expect(dependencies[1]).toBe(BrandService);
  });
  it('retains every canonical research owner-service injection token', () => {
    const dependencies = Reflect.getMetadata('design:paramtypes', CanonicalResearchService);
    expect(dependencies[1]).toBe(CatalogService);
    expect(dependencies[2]).toBe(IngredientService);
    expect(dependencies[5]).toBe(CatalogIntakeService);
  });
});
