import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import {
  CategoryService,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../../../modules/catalog/public';

// ─── CategoryController ───────────────────────────────────────────────────────
// يعرض شجرة التصنيفات للـ frontend ويوفر إدارة التصنيفات للأدمن

@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  // GET /categories
  // يرجع شجرة التصنيفات الكاملة: root + children (?includeInactive=true للأدمن)
  @Get()
  async listCategories(@Query('includeInactive') includeInactive?: string) {
    const showAll = includeInactive === 'true' || includeInactive === '1';
    return this.categoryService.getCategories(showAll);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCategory(@Body() dto: CreateCategoryDto) {
    return this.categoryService.createCategory(dto);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
  async updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoryService.updateCategory(id, dto);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  async deleteCategory(@Param('id') id: string) {
    return this.categoryService.deleteCategory(id);
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
