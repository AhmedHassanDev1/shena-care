import * as fs from 'fs';
import * as path from 'path';

describe('Architecture Tests', () => {
  const srcDir = path.join(__dirname, '../../src');

  describe('Module Boundaries', () => {
    it('should not allow Commerce to import Catalog repositories', () => {
      const commerceFiles = getFilesRecursive(path.join(srcDir, 'modules/commerce'));

      commerceFiles.forEach((file) => {
        const content = fs.readFileSync(file, 'utf-8');

        // Should not import Catalog repositories or entities directly
        expect(content).not.toMatch(/from ['"].*catalog.*entities/);
        expect(content).not.toMatch(/from ['"].*catalog.*repositories/);

        // Should only import from Catalog's public API
        if (content.includes('catalog')) {
          expect(content).toMatch(/from ['"].*catalog\/public['"]/);
        }
      });
    });

    it('should not allow Catalog to import Commerce', () => {
      const catalogFiles = getFilesRecursive(path.join(srcDir, 'modules/catalog'));

      catalogFiles.forEach((file) => {
        const content = fs.readFileSync(file, 'utf-8');

        // Catalog should not depend on Commerce at all
        expect(content).not.toMatch(/from ['"].*commerce/);
      });
    });

    it('should not allow direct ORM entity sharing across contexts', () => {
      const compositionFiles = getFilesRecursive(path.join(srcDir, 'application/composition'));

      compositionFiles.forEach((file) => {
        const content = fs.readFileSync(file, 'utf-8');

        // Composition should not import entities directly
        expect(content).not.toMatch(/from ['"].*\/entities\//);

        // Should use public APIs
        if (content.includes('catalog') || content.includes('commerce')) {
          expect(content).toMatch(/\/public['"]/);
        }
      });
    });
  });

  describe('Public API Contracts', () => {
    it('should have explicit public.ts for each business module', () => {
      const catalogPublic = path.join(srcDir, 'modules/catalog/public.ts');
      const commercePublic = path.join(srcDir, 'modules/commerce/public.ts');

      expect(fs.existsSync(catalogPublic)).toBe(true);
      expect(fs.existsSync(commercePublic)).toBe(true);
    });

    it('should only export services and types from public.ts', () => {
      const catalogPublic = path.join(srcDir, 'modules/catalog/public.ts');
      const content = fs.readFileSync(catalogPublic, 'utf-8');

      // Should export service
      expect(content).toMatch(/export.*CatalogService/);

      // Should export types
      expect(content).toMatch(/export type/);

      // Should not export entities or repositories
      expect(content).not.toMatch(/export.*\.entity/);
      expect(content).not.toMatch(/export.*Repository/);
    });
  });

  describe('Database Schema Organization', () => {
    it('should use schema-qualified table names', () => {
      const entities = [
        ...getFilesRecursive(path.join(srcDir, 'modules/catalog/entities')),
        ...getFilesRecursive(path.join(srcDir, 'modules/commerce/entities')),
      ];

      entities.forEach((file) => {
        const content = fs.readFileSync(file, 'utf-8');

        if (content.includes('@Entity')) {
          // Should specify schema
          expect(content).toMatch(/@Entity\(\s*\{\s*schema:/);

          // Catalog entities should use catalog schema
          if (file.includes('catalog/entities')) {
            expect(content).toMatch(/schema:\s*['"]catalog['"]/);
          }

          // Commerce entities should use commerce schema
          if (file.includes('commerce/entities')) {
            expect(content).toMatch(/schema:\s*['"]commerce['"]/);
          }
        }
      });
    });
  });

  describe('Code Organization', () => {
    it('should not have circular dependencies between modules', () => {
      // This is a simplified check - a full circular dependency check would require
      // parsing the entire dependency graph
      const catalogFiles = getFilesRecursive(path.join(srcDir, 'modules/catalog'));

      let catalogImportsCommerce = false;

      catalogFiles.forEach((file) => {
        const content = fs.readFileSync(file, 'utf-8');
        if (content.includes('commerce')) {
          catalogImportsCommerce = true;
        }
      });

      // Catalog should not import Commerce
      expect(catalogImportsCommerce).toBe(false);

      // Commerce may import Catalog's public API (acceptable)
      // but we verified above it only imports from public.ts
    });
  });
});

function getFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  const items = fs.readdirSync(dir);

  items.forEach((item) => {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getFilesRecursive(fullPath));
    } else if (item.endsWith('.ts') && !item.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  });

  return files;
}
