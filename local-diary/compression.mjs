import { promisify } from 'node:util';
import { brotliCompress, gzip, constants, createBrotliCompress, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const brotli = promisify(brotliCompress), gz = promisify(gzip);
const brotliOptions = { params:{ [constants.BROTLI_PARAM_QUALITY]:4 } };
const minimumSize = 1024;
const compressible = type => /^(?:text\/|application\/(?:json|javascript|xml)\b|image\/svg\+xml\b)/i.test(type ?? '');

function quality(header, name) {
  const values = new Map(String(header ?? '').toLowerCase().split(',').map(part => {
    const [coding, ...parameters] = part.trim().split(';');
    const parameter = parameters.find(value => /^\s*q\s*=/.test(value));
    const q = parameter ? Number(parameter.split('=')[1].trim()) : 1;
    return [coding.trim(), Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
  }));
  return values.has(name) ? values.get(name) : (values.get('*') ?? 0);
}

export function responseEncoding(req, type, size) {
  if (size < minimumSize || !compressible(type)) return null;
  const br = quality(req.headers['accept-encoding'], 'br'), gzipQuality = quality(req.headers['accept-encoding'], 'gzip');
  return br > 0 && br >= gzipQuality ? 'br' : gzipQuality > 0 ? 'gzip' : null;
}

function vary(res, type) {
  if (!compressible(type)) return;
  const previous = String(res.getHeader('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!previous.some(value => value.toLowerCase() === 'accept-encoding')) res.setHeader('Vary', [...previous, 'Accept-Encoding'].join(', '));
}

export async function sendBuffer(req, res, bytes, { status=200, type=res.getHeader('Content-Type') }={}) {
  vary(res, type);
  const encoding = responseEncoding(req, type, bytes.length);
  if (encoding) {
    // Async compression keeps diary saves and health checks responsive during a large bootstrap.
    const compressed = encoding === 'br' ? await brotli(bytes, brotliOptions) : await gz(bytes);
    if (compressed.length < bytes.length) { bytes = compressed; res.setHeader('Content-Encoding', encoding); }
  }
  if (res.destroyed) return;
  res.setHeader('Content-Length', bytes.length);
  res.writeHead(status);
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

export async function sendStream(req, res, stream, { type, size }) {
  vary(res, type);
  const encoding = responseEncoding(req, type, size);
  if (encoding) {
    res.setHeader('Content-Encoding', encoding);
    res.removeHeader('Content-Length');
  }
  if (req.method === 'HEAD') { stream.destroy(); res.end(); return; }
  try {
    if (encoding) await pipeline(stream, encoding === 'br' ? createBrotliCompress(brotliOptions) : createGzip(), res);
    else await pipeline(stream, res);
  } catch { res.destroy(); }
}
