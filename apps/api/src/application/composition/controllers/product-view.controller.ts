import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ProductViewService } from '../services/product-view.service';

@Controller('products')
export class ProductViewController {
  constructor(private readonly productViewService: ProductViewService) {}

  @Get()
  async listProducts() {
    return this.productViewService.getProductViews();
  }

  @Get(':slugOrId')
  async getProduct(@Param('slugOrId') slugOrId: string) {
    const productView = await this.productViewService.getProductView(slugOrId);

    if (!productView) {
      throw new NotFoundException(`Product not found: ${slugOrId}`);
    }

    return productView;
  }
}
