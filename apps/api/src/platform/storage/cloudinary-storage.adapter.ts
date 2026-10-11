import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiOptions } from 'cloudinary';
import { MediaStoragePort, MediaUploadOptions } from './media-storage.port';
import * as crypto from 'crypto';

@Injectable()
export class CloudinaryStorageAdapter implements MediaStoragePort {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async upload(buffer: Buffer, options: MediaUploadOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      // Create a unique public ID (without extension, cloudinary handles it)
      const uniqueId = crypto.randomUUID();
      const folderPath = options.folder; 
      // E.g. "shena-care/candidates" or "shena-care/public/media"

      const uploadOptions: UploadApiOptions = {
        folder: folderPath,
        public_id: uniqueId,
        resource_type: 'image',
        type: options.isPrivate ? 'private' : 'upload', 
      };

      const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error || !result) {
          console.error('Cloudinary upload error:', error);
          return reject(new InternalServerErrorException('Failed to upload media'));
        }
        // Return stable identifier: cloudinary://<public_id>
        resolve(`cloudinary://${result.public_id}`);
      });

      stream.end(buffer);
    });
  }

  getDeliveryUrl(assetId: string): string {
    if (!assetId.startsWith('cloudinary://')) {
      return assetId; // Fallback if it's already a URL
    }
    const publicId = assetId.replace('cloudinary://', '');
    
    // We can generate a signed URL if it's a private asset, 
    // but for Cloudinary, if we mapped it correctly, we can use cloudinary.url
    // Actually, if it's private, we need a signed URL or serve via backend proxy.
    // For now, generate the Cloudinary URL.
    return cloudinary.url(publicId, { secure: true });
  }

  async publishMedia(assetId: string): Promise<string> {
    if (!assetId.startsWith('cloudinary://')) return assetId;
    const publicId = assetId.replace('cloudinary://', '');
    
    try {
      // Cloudinary doesn't strictly have a 'publish' in the same way, but if we uploaded as 'private',
      // we can change its type to 'upload' (public).
      const result = await cloudinary.api.update(publicId, { type: 'upload' });
      return `cloudinary://${result.public_id}`;
    } catch (error) {
      console.error('Cloudinary publish error:', error);
      throw new InternalServerErrorException('Failed to publish media');
    }
  }

  async delete(assetId: string): Promise<void> {
    if (!assetId.startsWith('cloudinary://')) return;
    const publicId = assetId.replace('cloudinary://', '');
    try {
      await cloudinary.uploader.destroy(publicId, { invalidate: true });
    } catch (error) {
      console.error('Cloudinary delete error:', error);
    }
  }
}
