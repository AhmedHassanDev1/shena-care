import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ProductViewService } from '../services/product-view.service';
import {
  CatalogService,
  CreateProductDto,
  UpdateProductDto,
  CreateSkuDto,
  UpdateSkuDto,
  CreateProductMediaDto,
  UpdateProductMediaDto,
} from '../../../modules/catalog/public';

@Controller('products')
export class ProductViewController {
  constructor(
    private readonly productViewService: ProductViewService,
    private readonly catalogService: CatalogService,
  ) {}

  // ---------------------------------------------------------------------------
  // Product Read & Query
  // ---------------------------------------------------------------------------

  // GET /products
  // GET /products?category=moisturizers&brand=cerave&productLine=cerave-daily-moisturizers
  @Get()
  async listProducts(
    @Query('category') categorySlug?: string,
    @Query('brand') brandSlug?: string,
    @Query('productLine') productLineSlug?: string,
  ) {
    return this.productViewService.getProductViews({
      categorySlug,
      brandSlug,
      productLineSlug,
    });
  }

  // ---------------------------------------------------------------------------
  // SKU Management (Declared before :slugOrId to prevent route conflict)
  // ---------------------------------------------------------------------------

  // PATCH /products/skus/:skuId
  @Patch('skus/:skuId')
  async updateSku(
    @Param('skuId') skuId: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.catalogService.updateSku(skuId, dto);
  }

  // ---------------------------------------------------------------------------
  // Media Management (Declared before :slugOrId to prevent route conflict)
  // ---------------------------------------------------------------------------

  // PATCH /products/media/:mediaId
  @Patch('media/:mediaId')
  async updateMedia(
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdateProductMediaDto,
  ) {
    return this.catalogService.updateMedia(mediaId, dto);
  }

  // DELETE /products/media/:mediaId
  @Delete('media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedia(@Param('mediaId') mediaId: string) {
    await this.catalogService.deleteMedia(mediaId);
  }

  // ---------------------------------------------------------------------------
  // Product Write
  // ---------------------------------------------------------------------------

  // POST /products
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Body() dto: CreateProductDto) {
    return this.catalogService.createProduct(dto);
  }

  // PATCH /products/:id
  @Patch(':id')
  async updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Product Sub-resources (SKUs & Media by product ID)
  // ---------------------------------------------------------------------------

  // GET /products/:productId/skus
  @Get(':productId/skus')
  async listProductSkus(@Param('productId') productId: string) {
    return this.catalogService.getSkus(productId);
  }

  // POST /products/:productId/skus
  @Post(':productId/skus')
  @HttpCode(HttpStatus.CREATED)
  async createSku(
    @Param('productId') productId: string,
    @Body() dto: CreateSkuDto,
  ) {
    return this.catalogService.createSku(productId, dto);
  }

  // GET /products/:productId/media
  @Get(':productId/media')
  async listProductMedia(@Param('productId') productId: string) {
    return this.catalogService.getMedia(productId);
  }

  // POST /products/:productId/media
  @Post(':productId/media')
  @HttpCode(HttpStatus.CREATED)
  async addProductMedia(
    @Param('productId') productId: string,
    @Body() dto: CreateProductMediaDto,
  ) {
    return this.catalogService.addMedia(productId, dto);
  }

  // ---------------------------------------------------------------------------
  // Single Product Read
  // ---------------------------------------------------------------------------

  // GET /products/:slugOrId
  @Get(':slugOrId')
  async getProduct(@Param('slugOrId') slugOrId: string) {
    const productView = await this.productViewService.getProductView(slugOrId);

    if (!productView) {
      throw new NotFoundException(`Product not found: ${slugOrId}`);
    }

    return productView;
  }
}
