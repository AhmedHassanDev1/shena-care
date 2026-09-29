import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  BrandService,
  CreateBrandDto,
  UpdateBrandDto,
  CreateProductLineDto,
  UpdateProductLineDto,
} from '../../../modules/catalog/public';

// ─── BrandController ──────────────────────────────────────────────────────────
// هذا الـ Controller جزء من الـ Composition Layer
// يدير ويعرض بيانات الماركات وخطوط الإنتاج عبر HTTP
//
// يلتزم بقاعدة "public API only" باستيراد كل شيء عبر catalog/public.ts

@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  // GET /brands
  // يرجع كل الماركات (النشطة افتراضياً، أو الكل مع ?includeInactive=true)
  @Get()
  async listBrands(@Query('includeInactive') includeInactive?: string) {
    const showAll = includeInactive === 'true' || includeInactive === '1';
    return this.brandService.getBrands(showAll);
  }

  // POST /brands
  // إنشاء ماركة جديدة
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createBrand(@Body() dto: CreateBrandDto) {
    return this.brandService.createBrand(dto);
  }

  // GET /brands/product-lines/:id
  // جلب خط إنتاج محدد
  @Get('product-lines/:id')
  async getProductLine(@Param('id') id: string) {
    const line = await this.brandService.getProductLine(id);
    if (!line) {
      throw new NotFoundException(`Product line not found: ${id}`);
    }
    return line;
  }

  // PATCH /brands/product-lines/:id
  // تحديث بيانات خط إنتاج
  @Patch('product-lines/:id')
  async updateProductLine(
    @Param('id') id: string,
    @Body() dto: UpdateProductLineDto,
  ) {
    return this.brandService.updateProductLine(id, dto);
  }

  // GET /brands/:brandId/product-lines
  // جلب كل خطوط الإنتاج التابعة لماركة معينة
  @Get(':brandId/product-lines')
  async listProductLines(@Param('brandId') brandId: string) {
    return this.brandService.getProductLines(brandId);
  }

  // POST /brands/:brandId/product-lines
  // إنشاء خط إنتاج جديد وربطه بالماركة
  @Post(':brandId/product-lines')
  @HttpCode(HttpStatus.CREATED)
  async createProductLine(
    @Param('brandId') brandId: string,
    @Body() dto: CreateProductLineDto,
  ) {
    return this.brandService.createProductLine(brandId, dto);
  }

  // GET /brands/:slugOrId
  // يرجع ماركة محددة مع كل منتجاتها وخطوط إنتاجها
  @Get(':slugOrId')
  async getBrand(@Param('slugOrId') slugOrId: string) {
    const brand = await this.brandService.getBrand(slugOrId);
    if (!brand) {
      throw new NotFoundException(`Brand not found: ${slugOrId}`);
    }
    return brand;
  }

  // PATCH /brands/:id
  // تحديث بيانات الماركة
  @Patch(':id')
  async updateBrand(
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brandService.updateBrand(id, dto);
  }
}
