export const MEDIA_STORAGE_PORT = 'MEDIA_STORAGE_PORT';

export interface MediaUploadOptions {
  folder: string;
  isPrivate: boolean;
  mimetype?: string;
}

export interface MediaStoragePort {
  /** Uploads a buffer and returns a stable asset identifier (e.g. cloudinary://public_id) */
  upload(buffer: Buffer, options: MediaUploadOptions): Promise<string>;
  
  /** Retrieves a secure, signed delivery URL for a given stable asset identifier */
  getDeliveryUrl(assetId: string): string;
  
  /** Moves/Copies a media asset from private/candidate storage to public storage */
  publishMedia(assetId: string): Promise<string>;
  
  /** Deletes a media asset */
  delete(assetId: string): Promise<void>;
}
