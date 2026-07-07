import { spawn } from 'child_process';
import path from 'path';

export interface PipelineEvent {
  stage: string;
  message?: string;
  sourcePixelWidth?: number;
  sourcePixelHeight?: number;
}

const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';
const INGEST_SCRIPT = path.join(process.cwd(), 'scripts', 'ingest.py');

export async function* runIngestPipeline(pdfPath: string, outputDir: string): AsyncGenerator<PipelineEvent> {
  const child = spawn(PYTHON_BIN, [INGEST_SCRIPT, pdfPath, outputDir], {
    cwd: process.cwd(),
  });

  let buffer = '';
  let stderr = '';
  const events: PipelineEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as PipelineEvent);
      } catch {
        // ignore non-JSON stdout noise
      }
    }
    resolveNext?.();
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf-8');
  });

  const exitPromise = new Promise<number>((resolve) => {
    child.on('close', (code) => {
      done = true;
      resolveNext?.();
      resolve(code ?? 1);
    });
  });

  while (!done || events.length > 0) {
    if (events.length > 0) {
      yield events.shift()!;
      continue;
    }
    await new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
  }

  const exitCode = await exitPromise;
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Ingestion process exited with code ${exitCode}`);
  }
}
