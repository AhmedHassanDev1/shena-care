import { isDeliverablePin, saveConfirmedPin, searchDeliveryLocations } from './checkout-location';

describe('checkout location', () => {
  it('rejects a missing, unconfirmed, invalid, default, or outside-service pin', () => {
    expect(isDeliverablePin(null)).toBe(false);
    expect(isDeliverablePin({ latitude: 30.0386, longitude: 31.2122, confirmed: false })).toBe(false);
    expect(isDeliverablePin({ latitude: Number.NaN, longitude: 31.2122, confirmed: true })).toBe(false);
    expect(isDeliverablePin({ latitude: 30.0444, longitude: 31.2357, confirmed: true })).toBe(false);
    expect(isDeliverablePin({ latitude: 31.2001, longitude: 29.9187, confirmed: true })).toBe(false);
    expect(isDeliverablePin({ latitude: 30.0386, longitude: 31.2122, confirmed: true })).toBe(true);
  });

  it('finds a local area with Arabic or English search and skips blank requests', async () => {
    expect((await searchDeliveryLocations('الدقي')).items[0]).toMatchObject({ latitude: 30.0386, longitude: 31.2122 });
    expect((await searchDeliveryLocations('Dokki')).items[0]).toMatchObject({ latitude: 30.0386, longitude: 31.2122 });
    expect(await searchDeliveryLocations('  ')).toEqual({ items: [], providerFailed: false });
  });

  it('persists a confirmed saved-address pin and propagates API failure', async () => {
    const pin = { latitude: 30.0386, longitude: 31.2122, confirmed: true, locationSource: 'map_pin' as const };
    const update = jest.fn(async () => undefined);
    await saveConfirmedPin('address-1', pin, update);
    expect(update).toHaveBeenCalledWith({ id: 'address-1', data: {
      latitude: pin.latitude, longitude: pin.longitude, locationSource: pin.locationSource,
    } });
    await expect(saveConfirmedPin('address-1', { ...pin, confirmed: false }, update)).rejects.toThrow();
    expect(update).toHaveBeenCalledTimes(1);
    await expect(saveConfirmedPin('address-1', pin, async () => { throw new Error('API unavailable'); })).rejects.toThrow('API unavailable');
  });

  it('accepts coordinate search but marks unavailable service area', async () => {
    expect((await searchDeliveryLocations('30.0386, 31.2122')).items[0]).toMatchObject({ latitude: 30.0386, longitude: 31.2122, deliverable: true });
    expect((await searchDeliveryLocations('31.2001, 29.9187')).items[0]).toMatchObject({ deliverable: false });
    expect((await searchDeliveryLocations('999, 31')).items).toEqual([]);
  });

  it('uses provider coordinates, rejects malformed results, and reports API failure with local fallback', async () => {
    const ok = jest.fn(async () => ({ ok: true, json: async () => ({ features: [
      { id: 'good', place_name: 'Road 9, Maadi', center: [31.2569, 29.9602] },
      { id: 'bad', place_name: 'Invalid', center: ['oops', 29.9] },
    ] }) })) as unknown as typeof fetch;
    expect((await searchDeliveryLocations('Road 9', { token: 'test', fetcher: ok })).items).toMatchObject([
      { latitude: 29.9602, longitude: 31.2569, deliverable: true },
    ]);
    const failed = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const result = await searchDeliveryLocations('Dokki', { token: 'test', fetcher: failed });
    expect(result.providerFailed).toBe(true);
    expect(result.items[0].name).toContain('Dokki');
  });
});
