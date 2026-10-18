import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DiaryStore, DiaryError, within, validId } from './store.mjs';
import { remoteAccess, requestAccess } from './access.mjs';
import { loadSettings } from './settings.mjs';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8' };
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req, limit = 4_500_000) {
  const parts = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > limit) throw new DiaryError(413, '请求内容过大'); parts.push(part); }
  return Buffer.concat(parts);
}
export async function createDiaryServer({ root = path.resolve(appRoot, '../exports/LIFE'), port = 0, remote = null } = {}) {
  const access = remoteAccess(remote);
  const store = await new DiaryStore(root).init(), token = crypto.randomBytes(32).toString('hex');
  const instance = crypto.randomBytes(12).toString('hex');
  let sequence = 0;
  const changeVersion = () => `${instance}:${sequence}`;
  const server = http.createServer(async (req, res) => {
    try {
      const connection = requestAccess(req, server.address().port, access);
      const url = new URL(req.url, connection.origin);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      if (req.headers.origin && req.headers.origin !== connection.origin) throw new DiaryError(403, '来源无效');
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new DiaryError(403, '来源无效');
        if (req.method !== 'GET' && req.headers['x-diary-token'] !== token) throw new DiaryError(403, '保存凭据无效，请刷新页面');
        if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { application: 'life-local-diary', root: store.root, remoteOrigin: access?.origin ?? null });
        if (req.method === 'GET' && url.pathname === '/api/changes') return json(res, 200, { changeVersion: changeVersion() });
        if (req.method === 'GET' && url.pathname === '/api/bootstrap') return json(res, 200, { token, entries: store.list(), root: store.root, version: 1, changeVersion: changeVersion() });
        const match = url.pathname.match(/^\/api\/entries\/([^/]+)(?:\/(images|history|restore))?$/);
        if (!match || !validId(match[1])) throw new DiaryError(404, '接口不存在');
        const [, id, action] = match;
        if (req.method === 'GET' && !action) return json(res, 200, store.get(id));
        if (req.method === 'GET' && action === 'history') return json(res, 200, await store.history(id));
        if (req.method === 'PUT' && !action) { const saved = await store.save(id, JSON.parse(await body(req))); sequence++; return json(res, 200, saved); }
        if (req.method === 'POST' && action === 'images') return json(res, 200, await store.upload(id, await body(req, 25 * 1024 * 1024)));
        if (req.method === 'POST' && action === 'restore') { const data = JSON.parse(await body(req)); const saved = await store.restore(id, data.restoreRevision, data.revision); sequence++; return json(res, 200, saved); }
        throw new DiaryError(405, '请求方法不支持');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new DiaryError(405, '请求方法不支持');
      const archived = url.pathname.startsWith('/archive/');
      const base = archived ? store.root : path.join(appRoot, 'public');
      const relative = decodeURIComponent(archived ? url.pathname.slice(9) : url.pathname.slice(1)) || 'index.html';
      const file = within(base, relative);
      // Do not serve symlinks outside the private archive or app directory.
      const real = await fs.realpath(file), realBase = await fs.realpath(base);
      if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new DiaryError(403, '文件路径无效');
      const stat = await fs.stat(real);
      if (!stat.isFile()) throw new DiaryError(404, '文件不存在');
      const ext = path.extname(real).toLowerCase();
      const type = mime[ext] ?? 'application/octet-stream';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', archived ? 'no-store' : 'no-cache');
      res.setHeader('Content-Length', stat.size);
      if (!archived) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      if (archived && /\.html?$/.test(ext) && relative !== 'index.html' && !relative.startsWith('assets/')) {
        res.setHeader('Content-Security-Policy', "sandbox allow-same-origin allow-downloads; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'self'; form-action 'none'");
        // Keep the file itself byte-for-byte intact. Only strip scripts from the HTTP view.
        const original = await fs.readFile(real, 'utf8');
        const view = original.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
        const bytes = Buffer.from(view);
        res.setHeader('Content-Length', bytes.length);
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      if (req.method === 'HEAD') return res.end();
      createReadStream(real).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : error instanceof SyntaxError || error instanceof URIError ? 400 : 500);
      json(res, status, { error: status === 500 ? '本地保存失败，请检查磁盘空间、权限及资料文件。草稿仍保留在当前窗口。' : error.message });
    }
  });
  server.requestTimeout = 60_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, store, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let remote;
  try { remote = JSON.parse(await fs.readFile(path.resolve(appRoot, '../local-state/remote-access.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const settings=await loadSettings(path.resolve(appRoot,'..'));
  const port=process.env.DIARY_PORT===undefined?settings.port:Number(process.env.DIARY_PORT);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('日记端口必须是 1–65535 的整数');
  const instance = await createDiaryServer({ root: process.env.DIARY_ROOT, port, remote });
  console.log(`LIFE_LOCAL_URL=${instance.url}`);
  console.log('朝花夕拾日记已启动。监听本机回环地址；远程访问仅通过已配置的 Tailscale Serve。');
}
