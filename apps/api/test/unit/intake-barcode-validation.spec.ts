import { parseBarcode, parseSpreadsheet, readAdminRows, readSupplierRows } from '../../src/modules/intake/public';

describe('intake barcode validation', () => {
  it.each(['3337875597181', '123456789', '1234567890', '12345678901', '0000000000000', 'EAN3337875597180', '3.33787559718E+12'])(
    'refuses malformed or checksum-invalid identity %s', value => expect(parseBarcode(value)).toBeNull(),
  );
  it('keeps leading zeroes and accepts Arabic/Persian representations of valid GTINs', () => {
    expect(parseBarcode('0036000291452')).toBe('0036000291452');
    expect(parseBarcode('٣٣٣٧٨٧٥٥٩٧١٨٠')).toBe('3337875597180');
    expect(parseBarcode('۳۳۳۷۸۷۵۵۹۷۱۸۰')).toBe('3337875597180');
  });
  it('holds an explicitly invalid barcode instead of silently matching by name', () => {
    const sheet = parseSpreadsheet(Buffer.from('name,barcode,purchase price\nCeraVe Hydrating Cleanser 236ml,3337875597181,100\n'), 'list.csv', 'text/csv');
    for (const read of [readAdminRows, readSupplierRows]) {
      expect(read(sheet)[0]).toMatchObject({ outcome: 'INVALID', reasonCode: 'INVALID_BARCODE' });
    }
  });
});
