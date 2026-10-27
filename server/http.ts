// Small helpers shared by the API modules: JSON replies, reading a JSON
// body with a size limit, and an error type that carries an HTTP status.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';

export const MAX_BODY = 4096;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function readJson(req: IncomingMessage, maxBody = MAX_BODY): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return reject(new HttpError(415, 'Expected JSON.'));
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // keep reading (and dropping) the rest, so the 413 reply can still be sent
      if (size <= maxBody) chunks.push(chunk);
      else if (size > maxBody * 16) req.destroy();
    });
    req.on('end', () => {
      if (size > maxBody) return reject(new HttpError(413, 'Request too large.'));
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

export const isHttps = (req: IncomingMessage, trustProxy: boolean) =>
  !!(req.socket as TLSSocket).encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
