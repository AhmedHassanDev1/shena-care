export const MEDIA_PROCESSOR = 'MEDIA_PROCESSOR';
export const BACKGROUND_REMOVAL = 'BACKGROUND_REMOVAL';

export interface InspectedImage {
  format: 'jpeg' | 'png' | 'webp';
  mimeType: string;
  width: number;
  height: number;
  hasAlpha: boolean;
}

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/** Pixel operations only. It never adds text or claims, and a failure leaves the original asset untouched. */
export interface MediaProcessorPort {
  /** Decodes the real bytes; a file that does not decode as a supported raster image is refused. */
  inspect(buffer: Buffer): Promise<InspectedImage>;
  /** Web-ready copy: bounded size, no upscaling, no metadata. */
  optimize(buffer: Buffer): Promise<ProcessedImage>;
  /** Template 01: a transparent cut-out on a solid field, square, with no added text or decoration. */
  composeOnField(cutout: Buffer, fieldColor: string): Promise<ProcessedImage>;
}

export class BackgroundRemovalUnavailableError extends Error {
  constructor() {
    super('BACKGROUND_REMOVAL_UNAVAILABLE');
  }
}

/** A separate boundary so a provider can be added without touching the media service. None is configured for launch. */
export interface BackgroundRemovalPort {
  removeBackground(buffer: Buffer): Promise<Buffer>;
}
