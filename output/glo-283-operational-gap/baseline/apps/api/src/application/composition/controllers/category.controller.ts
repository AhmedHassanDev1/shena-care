import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { CategoryService } from '../../../modules/catalog/public';

// ─── CategoryController ───────────────────────────────────────────────────────
// يعرض شجرة التصنيفات للـ frontend
// الـ frontend هيستخدمها لبناء:
//   - الـ Navigation Menu
//   - الـ Sidebar Filters
//   - صفحة كل تصنيف بمنتجاته

@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  // GET /categories
  // يرجع شجرة التصنيفات الكاملة: root + children
  @Get()
  async listCategories() {
    return this.categoryService.getCategories();
  }

  // GET /categories/:slug
  // يرجع تصنيف محدد مع المنتجات المربوطة بيه
  @Get(':slug')
  async getCategory(@Param('slug') slug: string) {
    const category = await this.categoryService.getCategory(slug);

    if (!category) {
      throw new NotFoundException(`Category not found: ${slug}`);
    }

    return category;
  }
}
