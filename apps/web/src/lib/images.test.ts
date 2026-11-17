import { canOptimizeImage, resolveImageUrl } from './images';

describe('resolveImageUrl', () => {
  it('returns null for null, undefined, or empty string', () => {
    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
    expect(resolveImageUrl('')).toBeNull();
    expect(resolveImageUrl('   ')).toBeNull();
  });

  it('resolves cloudinary:// protocol URLs to Cloudinary CDN URLs', () => {
    expect(resolveImageUrl('cloudinary://folder/packshot.jpg')).toBe(
      'https://res.cloudinary.com/dkcmjjkno/image/upload/folder/packshot.jpg'
    );
    expect(resolveImageUrl('cloudinary://shena-care/products/2448adb2-990e-4324-80c8-0aabfe9d427e')).toBe(
      'https://res.cloudinary.com/dkcmjjkno/image/upload/shena-care/products/2448adb2-990e-4324-80c8-0aabfe9d427e'
    );
  });

  it('resolves relative storage and uploads paths with the API URL', () => {
    expect(resolveImageUrl('/storage/public/media/test.webp')).toMatch(
      /\/storage\/public\/media\/test\.webp$/
    );
    expect(resolveImageUrl('storage/public/media/test.webp')).toMatch(
      /\/storage\/public\/media\/test\.webp$/
    );
    expect(resolveImageUrl('/uploads/catalog/image.png')).toMatch(
      /\/uploads\/catalog\/image\.png$/
    );
  });

  it('preserves existing absolute URLs', () => {
    expect(resolveImageUrl('https://res.cloudinary.com/demo/image.png')).toBe(
      'https://res.cloudinary.com/demo/image.png'
    );
    expect(resolveImageUrl('http://localhost:3001/storage/media.webp')).toBe(
      'http://localhost:3001/storage/media.webp'
    );
  });
});

describe('canOptimizeImage', () => {
  it('returns false for localhost and 127.0.0.1 to serve local images unoptimized', () => {
    expect(canOptimizeImage('http://localhost:3001/storage/media.webp')).toBe(false);
    expect(canOptimizeImage('http://127.0.0.1:4107/search-test-media/item.jpg')).toBe(false);
  });

  it('returns true for configured CDN hosts', () => {
    expect(canOptimizeImage('https://res.cloudinary.com/demo/image.png')).toBe(true);
    expect(canOptimizeImage('https://cdn.shopify.com/s/files/1.jpg')).toBe(true);
    expect(canOptimizeImage('https://lh3.googleusercontent.com/avatar.jpg')).toBe(true);
    expect(canOptimizeImage('https://xyz.supabase.co/storage/v1/object/public/images/1.jpg')).toBe(true);
  });

  it('returns false for arbitrary unverified hosts', () => {
    expect(canOptimizeImage('https://untrusted-domain.com/photo.jpg')).toBe(false);
    expect(canOptimizeImage('not-a-url')).toBe(false);
  });
});
