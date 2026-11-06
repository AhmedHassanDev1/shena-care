import { BadRequestException, Injectable } from '@nestjs/common';
import sharp, { Metadata, Sharp } from 'sharp';
import {
  BackgroundRemovalPort, BackgroundRemovalUnavailableError, ComposedImage, InspectedImage, MediaProcessorPort, ProcessedImage,
} from './media-processor.port';
import { composeOnTemplate, CutoutOptions, cutOutProduct, TemplateRules } from './product-compositor';

const MAX_INPUT_PIXELS = 50_000_000;
const MAX_DELIVERY_EDGE = 1600;
const WEBP_QUALITY = 82;
const MIME_BY_FORMAT = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

@Injectable()
export class SharpMediaProcessor implements MediaProcessorPort {
  private open(buffer: Buffer) {
    return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
  }

  async inspect(buffer: Buffer): Promise<InspectedImage> {
    let metadata: Metadata;
    try {
      metadata = await this.open(buffer).metadata();
      // The header can look fine over truncated pixel data; a full decode is the only proof.
      await this.open(buffer).stats();
    } catch {
      throw new BadRequestException('File is not a readable image');
    }
    const format = metadata.format as keyof typeof MIME_BY_FORMAT;
    if (!MIME_BY_FORMAT[format] || !metadata.width || !metadata.height) {
      throw new BadRequestException('Only JPEG, PNG and WebP images are accepted');
    }
    return { format, mimeType: MIME_BY_FORMAT[format], width: metadata.width, height: metadata.height, hasAlpha: Boolean(metadata.hasAlpha) };
  }

  private async toWebp(pipeline: Sharp): Promise<ProcessedImage> {
    const { data, info } = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
    return { buffer: data, mimeType: 'image/webp', width: info.width, height: info.height };
  }

  optimize(buffer: Buffer): Promise<ProcessedImage> {
    return this.toWebp(this.open(buffer).rotate().resize({ width: MAX_DELIVERY_EDGE, height: MAX_DELIVERY_EDGE, fit: 'inside', withoutEnlargement: true }));
  }

  async composeOnTemplate(source: Buffer, template: Buffer, rules: TemplateRules, options: CutoutOptions = {}): Promise<ComposedImage> {
    const output = await composeOnTemplate(source, template, rules, options);
    return { buffer: output.buffer, mimeType: 'image/webp', width: output.width, height: output.height, report: output.report };
  }

  async composeOnField(cutout: Buffer, fieldColor: string): Promise<ProcessedImage> {
    const { width = 0, height = 0, hasAlpha } = await this.open(cutout).metadata();
    if (!hasAlpha) throw new BadRequestException('Template 01 needs a transparent cut-out');
    const edge = Math.min(Math.max(width, height), MAX_DELIVERY_EDGE);
    const fitted = await this.open(cutout).rotate().resize({ width: edge, height: edge, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true }).png().toBuffer();
    return this.toWebp(sharp({ create: { width: edge, height: edge, channels: 3, background: fieldColor } }).composite([{ input: fitted, gravity: 'center' }]));
  }
}

@Injectable()
export class DeterministicBackgroundRemoval implements BackgroundRemovalPort {
  /** Plain or transparent sources only; a busy background fails with a recorded reason instead of producing a damaged pack. */
  async removeBackground(buffer: Buffer): Promise<Buffer> {
    const cut = await cutOutProduct(buffer);
    return sharp(cut.rgba, { raw: { width: cut.width, height: cut.height, channels: 4 } }).png().toBuffer();
  }
}

@Injectable()
export class DisabledBackgroundRemoval implements BackgroundRemovalPort {
  async removeBackground(): Promise<Buffer> {
    throw new BackgroundRemovalUnavailableError();
  }
}
