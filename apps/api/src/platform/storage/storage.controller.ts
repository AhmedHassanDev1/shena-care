import { Controller, Get, Param, Res, NotFoundException, UseGuards, ForbiddenException, Req } from '@nestjs/common';
import { Response } from 'express';
import { StorageService } from './storage.service';
import { AuthGuard } from '../../modules/accounts/guards/auth.guard';
import * as fs from 'fs';
import { PrismaService } from '../database/prisma.service';
import { requireMediaReview } from '../security/media-review';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService, private readonly prisma: PrismaService) {}

  @Get('public/:folder/:filename')
  async servePublicFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(folder) || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) {
      throw new NotFoundException('Invalid file path');
    }

    if (folder !== 'media') throw new NotFoundException('Public asset not approved');
    const records = await this.prisma.productMedia.findMany({
      where: { originType: 'verified', product: { isPublished: true }, url: { endsWith: `/storage/public/media/${filename}` } },
      include: { product: { include: { skus: true } } },
    });
    const approved = records.some(record => {
      try {
        const review = requireMediaReview(record.generationMetadata);
        return record.product.skus.some(sku => sku.id === review.skuId && sku.isActive &&
          sku.barcode === review.barcode && sku.size?.toNumber() === review.size &&
          sku.sizeUnit === review.sizeUnit && sku.variantName === review.variantName);
      } catch { return false; }
    });
    if (!approved) throw new NotFoundException('Public asset not approved');
    const filePath = this.storageService.getFilePath(`public/${folder}/${filename}`);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    res.sendFile(filePath);
  }

  @Get('private/:supplierId/:folder/:filename')
  @UseGuards(AuthGuard)
  servePrivateFile(
    @Param('supplierId') supplierId: string,
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user) throw new ForbiddenException();

    const isInternal = user.roles?.includes('ADMIN') || user.roles?.includes('HUB_OPERATOR');
    if (!isInternal && (!user.roles?.includes('SUPPLIER') || user.supplierId !== supplierId)) {
      throw new ForbiddenException('Access denied to private media');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(folder) || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename) || !/^[a-zA-Z0-9_-]+$/.test(supplierId)) {
      throw new NotFoundException('Invalid file path');
    }

    const filePath = this.storageService.getFilePath(`private/${supplierId}/${folder}/${filename}`);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    res.sendFile(filePath);
  }
}
