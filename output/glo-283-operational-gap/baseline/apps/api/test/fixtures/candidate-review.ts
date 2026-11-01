import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FIXTURE_SOURCE_URL } from './sellable-sku';
import { PrismaService } from '../../src/platform/database/prisma.service';

/** A 1x1 PNG: real image bytes so the upload passes content-type sniffing. */
export const FIXTURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/bkAAAAASUVORK5CYII=', 'base64');

/**
 * Runs the human evidence + media review steps that approval now requires before a
 * candidate may be published (GLO-183): trusted size evidence, an uploaded real image,
 * and the mediaReviews payload to send with PATCH /ingestion/candidates/:id/approve.
 */
export async function reviewCandidateMedia(
  app: INestApplication, auth: { Authorization: string }, itemId: string, barcode: string, size = 50, sizeUnit = 'ml',
) {
  // Let the background enrichment settle first: human evidence writes are compare-and-set and
  // correctly refuse (409) a candidate that the enrichment worker is updating concurrently.
  const prisma = app.get(PrismaService);
  const deadline = Date.now() + 5000;
  for (;;) {
    const item = await prisma.ingestionItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.enrichmentStatus !== 'pending' || item.enrichmentError || Date.now() > deadline) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  await request(app.getHttpServer()).patch(`/ingestion/candidates/${itemId}/evidence`).set(auth).send({ fields: [
    { field: 'size', sourceUrl: FIXTURE_SOURCE_URL, sourceType: 'OFFICIAL_MANUFACTURER', size, sizeUnit, excerpt: `Synthetic package: ${size} ${sizeUnit}` },
  ] }).expect(200);
  const media = await request(app.getHttpServer()).post(`/ingestion/candidates/${itemId}/media`).set(auth)
    .attach('file', FIXTURE_PNG, { filename: 'packshot.png', contentType: 'image/png' }).expect(201);
  return [{ url: media.body.url as string, sourceUrl: FIXTURE_SOURCE_URL, sourceType: 'OFFICIAL_MANUFACTURER',
    barcode, size, sizeUnit, variantName: `${size} ${sizeUnit}` }];
}
