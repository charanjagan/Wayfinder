import { spawn } from 'child_process';

const DEFAULT_DPI = 200;

/** Rasterizes page 1 of a PDF to a PNG via poppler's pdftoppm CLI.
 * Requires poppler installed and on PATH (e.g. `choco install poppler` on Windows). */
export function rasterizePdf(pdfPath: string, outputBasePath: string, dpi = DEFAULT_DPI): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftoppm', ['-png', '-r', String(dpi), '-singlefile', pdfPath, outputBasePath]);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf-8')));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            'pdftoppm not found. Install poppler (e.g. `choco install poppler` on Windows) and ensure it is on PATH.',
          ),
        );
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `pdftoppm exited with code ${code}`));
        return;
      }
      resolve(`${outputBasePath}.png`);
    });
  });
}

export const PDF_RASTER_DPI = DEFAULT_DPI;
