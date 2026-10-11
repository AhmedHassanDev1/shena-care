import { FileStoragePort, ObjectMetadata } from './storage.port';
import { Readable } from 'stream';

export class S3CompatibleStorageAdapter implements FileStoragePort {
  constructor() {
    console.warn('S3CompatibleStorageAdapter is initialized but requires @aws-sdk/client-s3 which is not installed. Will throw on use.');
  }

  async put(objectKey: string, data: Buffer | Readable, metadata?: ObjectMetadata): Promise<void> {
    throw new Error('S3 implementation requires @aws-sdk/client-s3');
  }

  async readStream(objectKey: string): Promise<Readable> {
    throw new Error('S3 implementation requires @aws-sdk/client-s3');
  }

  async exists(objectKey: string): Promise<boolean> {
    throw new Error('S3 implementation requires @aws-sdk/client-s3');
  }

  async delete(objectKey: string): Promise<void> {
    throw new Error('S3 implementation requires @aws-sdk/client-s3');
  }
}
