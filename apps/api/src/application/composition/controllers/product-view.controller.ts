import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
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
  UseGuards,
  Req,
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
  // GET /products?category=moisturizers&brand=cerave&productLine=cerave-daily-moisturizers&page=1&limit=20
  @Get()
  async listProducts(
    @Query('category') categorySlug?: string,
    @Query('brand') brandSlug?: string,
    @Query('productLine') productLineSlug?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : undefined;

    return this.productViewService.getProductViews({
      categorySlug,
      brandSlug,
      productLineSlug,
      page: pageNum && !isNaN(pageNum) ? pageNum : undefined,
      limit: limitNum && !isNaN(limitNum) ? limitNum : undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // SKU Management (Declared before :slugOrId to prevent route conflict)
  // ---------------------------------------------------------------------------

  // PATCH /products/skus/:skuId
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'HUB_OPERATOR')
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
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'HUB_OPERATOR')
  @Patch('media/:mediaId')
  async updateMedia(
    @Req() req: { user: { id: string } },
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdateProductMediaDto,
  ) {
    return this.catalogService.updateMedia(mediaId, dto, req.user.id);
  }

  // DELETE /products/media/:mediaId
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'HUB_OPERATOR')
  @Delete('media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedia(@Param('mediaId') mediaId: string) {
    await this.catalogService.deleteMedia(mediaId);
  }

  // ---------------------------------------------------------------------------
  // Product Write
  // ---------------------------------------------------------------------------

  // POST /products
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'HUB_OPERATOR')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Body() dto: CreateProductDto) {
    return this.catalogService.createProduct(dto);
  }

  // PATCH /products/:id
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'HUB_OPERATOR')
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
    const product = await this.productViewService.getProductView(productId);
    if (!product) throw new NotFoundException('Product not published');
    return product.skus;
  }

  // POST /products/:productId/skus
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'HUB_OPERATOR')
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
    const product = await this.productViewService.getProductView(productId);
    if (!product) throw new NotFoundException('Product not published');
    return product.media;
  }

  // POST /products/:productId/media
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'HUB_OPERATOR')
  @Post(':productId/media')
  @HttpCode(HttpStatus.CREATED)
  async addProductMedia(
    @Req() req: { user: { id: string } },
    @Param('productId') productId: string,
    @Body() dto: CreateProductMediaDto,
  ) {
    return this.catalogService.addMedia(productId, dto, req.user.id);
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
