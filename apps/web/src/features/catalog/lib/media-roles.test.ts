import { compactImage, galleryImages } from './media-roles';

const media = [
  { id: 'carton', type: 'image', isPrimary: false, sortOrder: 2, role: 'PACKAGING_PROOF' },
  { id: 'pack', type: 'image', isPrimary: true, sortOrder: 1, role: 'PRIMARY_PACKSHOT' },
  { id: 'editorial', type: 'image', isPrimary: false, sortOrder: 0, role: 'CATEGORY_EDITORIAL' },
  { id: 'clip', type: 'video', isPrimary: false, sortOrder: 0, role: null },
];

describe('media roles', () => {
  it('leads the PDP gallery with the editorial image, then the identity packshot, then the carton', () => {
    expect(galleryImages(media).map((item) => item.id)).toEqual(['editorial', 'pack', 'carton']);
  });
  it('uses the identity packshot in compact contexts, even when the editorial image comes first', () => {
    expect(compactImage(media)?.id).toBe('pack');
  });
  it('keeps older media without a role working: primary first', () => {
    const legacy = [{ id: 'b', type: 'image', isPrimary: false, sortOrder: 0 }, { id: 'a', type: 'image', isPrimary: true, sortOrder: 1 }];
    expect(galleryImages(legacy).map((item) => item.id)).toEqual(['a', 'b']);
    expect(compactImage(legacy)?.id).toBe('a');
  });
});
