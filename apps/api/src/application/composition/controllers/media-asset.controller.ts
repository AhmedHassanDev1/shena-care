import { BadRequestException, Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { DeriveMediaAssetDto, MediaTemplateService, ProductMediaService, RegisterMediaAssetDto, RegisterMediaTemplateDto, ReprocessMediaTemplateDto, ReviewMediaAssetDto, SetMediaTemplateStateDto } from '../../../modules/catalog/public';
import { multerOptions } from '../../../platform/security/upload-validator';

type AuthenticatedRequest = { user: { id: string } };

@Controller('catalog/media-assets')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
export class MediaAssetController {
  constructor(private readonly media: ProductMediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', multerOptions))
  register(@Req() req: AuthenticatedRequest, @Body() dto: RegisterMediaAssetDto, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Image file is required');
    return this.media.registerOriginal(dto, file, req.user.id);
  }

  @Post(':id/derive')
  derive(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeriveMediaAssetDto) {
    return this.media.derive(id, dto, req.user.id);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  review(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewMediaAssetDto) {
    return this.media.review(id, dto, req.user.id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.publish(id, req.user.id);
  }

  /** Private bytes for the reviewer's before/after view. */
  @Get(':id/file')
  @Header('Cache-Control', 'private, no-store')
  async file(@Param('id', ParseUUIDPipe) id: string) {
    const { buffer, mimeType } = await this.media.readAssetFile(id);
    return new StreamableFile(buffer, { type: mimeType });
  }

  @Get('sku/:skuId')
  list(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.media.listForSku(skuId);
  }

  @Get('sku/:skuId/readiness')
  readiness(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.media.readiness(skuId);
  }
}

/** The template registry: an Admin replaces a scene by uploading a file, with no code change. Editorial images record the exact version that made them. */
@Controller('catalog/media-templates')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class MediaTemplateController {
  constructor(private readonly templates: MediaTemplateService, private readonly media: ProductMediaService) {}

  @Get()
  list(@Query('templateKey') templateKey?: string) {
    return this.templates.list(templateKey);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', multerOptions))
  register(@Req() req: AuthenticatedRequest, @Body() dto: RegisterMediaTemplateDto, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Template image file is required');
    return this.templates.register(dto, file, req.user.id);
  }

  @Patch(':id/state')
  setState(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetMediaTemplateStateDto) {
    return this.templates.setActive(id, dto.isActive);
  }

  @Post('reprocess')
  @HttpCode(HttpStatus.OK)
  reprocess(@Req() req: AuthenticatedRequest, @Body() dto: ReprocessMediaTemplateDto) {
    return this.media.reprocessTemplate(dto.templateKey, req.user.id);
  }

  @Get(':id/file')
  @Header('Cache-Control', 'private, no-store')
  async file(@Param('id', ParseUUIDPipe) id: string) {
    const template = await this.templates.get(id);
    return new StreamableFile(await this.templates.readFile(template), { type: template.mimeType });
  }
}
