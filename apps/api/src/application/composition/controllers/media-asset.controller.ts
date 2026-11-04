import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { DeriveMediaAssetDto, ProductMediaService, RegisterMediaAssetDto, ReviewMediaAssetDto } from '../../../modules/catalog/public';
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

  @Get('sku/:skuId')
  list(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.media.listForSku(skuId);
  }

  @Get('sku/:skuId/readiness')
  readiness(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.media.readiness(skuId);
  }
}
