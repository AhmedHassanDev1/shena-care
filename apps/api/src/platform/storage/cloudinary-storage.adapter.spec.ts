import { CloudinaryStorageAdapter } from './cloudinary-storage.adapter';
import { v2 as cloudinary } from 'cloudinary';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
    api: {
      update: jest.fn(),
    },
    url: jest.fn((id) => `https://res.cloudinary.com/demo/image/upload/${id}`),
  },
}));

describe('CloudinaryStorageAdapter', () => {
  let adapter: CloudinaryStorageAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new CloudinaryStorageAdapter();
  });

  it('should initialize cloudinary config', () => {
    expect(cloudinary.config).toHaveBeenCalled();
  });

  it('should format delivery URL correctly', () => {
    const url = adapter.getDeliveryUrl('cloudinary://test-id');
    expect(cloudinary.url).toHaveBeenCalledWith('test-id', { secure: true });
    expect(url).toBe('https://res.cloudinary.com/demo/image/upload/test-id');
  });

  it('should fallback to input URL if not a cloudinary string', () => {
    const url = adapter.getDeliveryUrl('http://example.com/image.png');
    expect(url).toBe('http://example.com/image.png');
    expect(cloudinary.url).not.toHaveBeenCalled();
  });

  it('should publish media by updating resource type', async () => {
    (cloudinary.api.update as jest.Mock).mockResolvedValue({ public_id: 'test-id' });
    const res = await adapter.publishMedia('cloudinary://test-id');
    expect(cloudinary.api.update).toHaveBeenCalledWith('test-id', { type: 'upload' });
    expect(res).toBe('cloudinary://test-id');
  });

  it('should delete media by destroying resource', async () => {
    (cloudinary.uploader.destroy as jest.Mock).mockResolvedValue({});
    await adapter.delete('cloudinary://test-id');
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('test-id', { invalidate: true });
  });
});
