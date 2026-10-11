import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { DatabaseModule } from '../database/database.module';
import { FILE_STORAGE_PORT } from './storage.port';
import { MEDIA_STORAGE_PORT } from './media-storage.port';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3CompatibleStorageAdapter } from './s3-storage.adapter';
import { CloudinaryStorageAdapter } from './cloudinary-storage.adapter';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: FILE_STORAGE_PORT,
      useFactory: () => {
        const provider = process.env.FILE_STORAGE_PROVIDER;
        if (provider === 's3') {
          return new S3CompatibleStorageAdapter();
        }
        return new LocalStorageAdapter();
      },
    },
    {
      provide: MEDIA_STORAGE_PORT,
      useClass: CloudinaryStorageAdapter,
    },
    StorageService
  ],
  controllers: [StorageController],
  exports: [StorageService, FILE_STORAGE_PORT, MEDIA_STORAGE_PORT],
})
export class StorageModule {}
