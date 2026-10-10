import { Controller, Get, Param, Res, NotFoundException, UseGuards, ForbiddenException, Req } from '@nestjs/common';
import { Response } from 'express';
import { StorageService } from './storage.service';
import { AuthGuard } from '../../modules/accounts/guards/auth.guard';
import * as fs from 'fs';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('public/:folder/:filename')
  servePublicFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(folder) || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) {
      throw new NotFoundException('Invalid file path');
    }

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
    if (!isInternal && user.supplierId !== supplierId) {
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
