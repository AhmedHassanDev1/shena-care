describe('test provider isolation', () => {
  it('cannot inherit remote media providers from a developer environment', () => {
    const previous = { file: process.env.FILE_STORAGE_PROVIDER, media: process.env.MEDIA_STORAGE_PROVIDER };
    try {
      process.env.FILE_STORAGE_PROVIDER = 'remote'; process.env.MEDIA_STORAGE_PROVIDER = 'cloudinary';
      jest.isolateModules(() => require('../isolate-providers'));
      expect(process.env.FILE_STORAGE_PROVIDER).toBe('local');
      expect(process.env.MEDIA_STORAGE_PROVIDER).toBe('local');
    } finally {
      for (const [key, value] of [['FILE_STORAGE_PROVIDER', previous.file], ['MEDIA_STORAGE_PROVIDER', previous.media]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
