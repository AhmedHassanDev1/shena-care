import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ProductViewService } from '../services/product-view.service';

@Controller('products')
export class ProductViewController {
  constructor(private readonly productViewService: ProductViewService) {}

  // GET /products
  // GET /products?category=moisturizers
  // GET /products?brand=cerave
  @Get()
  async listProducts(
    @Query('category') categorySlug?: string,
    @Query('brand') brandSlug?: string,
  ) {
    return this.productViewService.getProductViews({ categorySlug, brandSlug });
  }

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
