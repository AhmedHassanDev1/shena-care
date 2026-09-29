import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { BrandService } from '../../../modules/catalog/public';

// ─── BrandController ──────────────────────────────────────────────────────────
// هذا الـ Controller جزء من الـ Composition Layer
// بيعرض بيانات البراندات عبر HTTP
//
// لاحظ: بيستخدم BrandService من catalog/public.ts فقط
// مش من catalog/services/brand.service.ts مباشرة
// ده بيطبق قاعدة "public API only"

@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  // GET /brands
  // يرجع كل الماركات النشطة مع خطوط الإنتاج بتاعتها
  @Get()
  async listBrands() {
    return this.brandService.getBrands();
  }

  // GET /brands/:slug
  // يرجع ماركة محددة مع كل منتجاتها
  @Get(':slug')
  async getBrand(@Param('slug') slug: string) {
    const brand = await this.brandService.getBrand(slug);

    if (!brand) {
      throw new NotFoundException(`Brand not found: ${slug}`);
    }

    return brand;
  }
}
