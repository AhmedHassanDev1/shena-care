import { Controller, Get, Param, Res, NotFoundException, UseGuards, ForbiddenException, Req, Inject } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../../modules/accounts/guards/auth.guard';
import { PrismaService } from '../database/prisma.service';
import { publicMediaVisibility } from '../security/media-review';
import { FILE_STORAGE_PORT, FileStoragePort } from './storage.port';

const MIME_BY_EXT: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

function mimeForFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

@Controller('storage')
export class StorageController {
  constructor(
    @Inject(FILE_STORAGE_PORT) private readonly storagePort: FileStoragePort,
    private readonly prisma: PrismaService
  ) {}

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
      where: { originType: { in: ['verified', 'derived'] }, product: { isPublished: true }, url: { endsWith: `/storage/public/media/${filename}` } },
      include: { product: { include: { skus: true } } },
    });
    const approved = records.some((record) => publicMediaVisibility(record).live);
    if (!approved) throw new NotFoundException('Public asset not approved');
    const objectKey = `public/${folder}/${filename}`;
    if (!(await this.storagePort.exists(objectKey))) {
      throw new NotFoundException('File not found');
    }

    res.setHeader('Content-Type', mimeForFilename(filename));
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const stream = await this.storagePort.readStream(objectKey);
    stream.pipe(res);
  }

  @Get('private/:supplierId/:folder/:filename')
  @UseGuards(AuthGuard)
  async servePrivateFile(
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

    const objectKey = `private/${supplierId}/${folder}/${filename}`;
    if (!(await this.storagePort.exists(objectKey))) {
      throw new NotFoundException('File not found');
    }

    res.setHeader('Content-Type', mimeForFilename(filename));
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = await this.storagePort.readStream(objectKey);
    stream.pipe(res);
  }
}
