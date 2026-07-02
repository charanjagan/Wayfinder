import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';

const WEB_WIDTH = 1400;
const WEB_QUALITY = 80;
// pdf-poppler's `scale` option maps to pdftocairo's `-scale-to`, which sizes the
// longer page edge to N pixels (not a DPI value). 2000px comfortably exceeds
// WEB_WIDTH so the later sharp resize always has real detail to downscale from.
const PDF_SCALE_TO = 2000;

export interface ProcessedImage {
  width: number;
  height: number;
  originalFilename: string;
}

export async function processUpload(
  buffer: Buffer,
  originalName: string,
  dir: string,
): Promise<ProcessedImage> {
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') {
    return processPdf(buffer, dir);
  }
  return processImage(buffer, dir, ext || '.png');
}

async function processImage(buffer: Buffer, dir: string, ext: string): Promise<ProcessedImage> {
  const originalFilename = `original${ext}`;
  await fs.writeFile(path.join(dir, originalFilename), buffer);

  const webPath = path.join(dir, 'web.jpg');
  const resized = sharp(buffer).resize({ width: WEB_WIDTH, withoutEnlargement: true }).jpeg({ quality: WEB_QUALITY });
  await resized.toFile(webPath);

  const metadata = await sharp(webPath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read processed image dimensions');
  }

  return { width: metadata.width, height: metadata.height, originalFilename };
}

async function processPdf(buffer: Buffer, dir: string): Promise<ProcessedImage> {
  const originalFilename = 'original.pdf';
  const pdfPath = path.join(dir, originalFilename);
  await fs.writeFile(pdfPath, buffer);

  let convert: (file: string, opts: Record<string, unknown>) => Promise<unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ convert } = require('pdf-poppler'));
  } catch {
    throw new Error('PDF conversion requires the pdf-poppler package (and poppler binaries) to be installed.');
  }

  const outPrefix = 'page';
  try {
    await convert(pdfPath, {
      format: 'png',
      out_dir: dir,
      out_prefix: outPrefix,
      page: 1,
      scale: PDF_SCALE_TO,
    });
  } catch (err) {
    throw new Error(
      `Failed to convert PDF page to image. Ensure poppler-utils (pdftoppm) is installed and on PATH. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  const files = await fs.readdir(dir);
  const pageFile = files.find((f) => f.startsWith(outPrefix) && f.endsWith('.png'));
  if (!pageFile) {
    throw new Error('PDF conversion did not produce an output image.');
  }
  const pagePath = path.join(dir, pageFile);

  const webPath = path.join(dir, 'web.jpg');
  await sharp(pagePath)
    .resize({ width: WEB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: WEB_QUALITY })
    .toFile(webPath);

  await fs.rm(pagePath, { force: true });

  const metadata = await sharp(webPath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read processed image dimensions');
  }

  return { width: metadata.width, height: metadata.height, originalFilename };
}
