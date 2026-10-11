import { Readable } from 'stream';

export interface ObjectMetadata {
  size: number;
  mimeType: string;
  sha256?: string;
  sourceId?: string;
  createdAt?: Date;
}

export interface FileStoragePort {
  put(objectKey: string, data: Buffer | Readable, metadata?: ObjectMetadata): Promise<void>;
  readStream(objectKey: string): Promise<Readable>;
  exists(objectKey: string): Promise<boolean>;
  delete(objectKey: string): Promise<void>;
  getSignedReadUrl?(objectKey: string): Promise<string>;
}

export const FILE_STORAGE_PORT = Symbol('FILE_STORAGE_PORT');
