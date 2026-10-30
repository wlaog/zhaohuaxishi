import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DiaryStore, DiaryError, within, validId } from './store.mjs';
import { remoteAccess, requestAccess } from './access.mjs';
import { loadSettings } from './settings.mjs';
import { DayStore } from './days.mjs';
import { sakuraAccess, createSakuraAuth } from './sakura-auth.mjs';
import { sendBuffer, sendStream } from './compression.mjs';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8' };
const json = (req, res, status, data) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return sendBuffer(req, res, Buffer.from(JSON.stringify(data)), { status });
};
async function body(req, limit = 4_500_000) {
  const parts = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > limit) throw new DiaryError(413, '请求内容过大'); parts.push(part); }
  return Buffer.concat(parts);
}
export async function createDiaryServer({ root = path.resolve(appRoot, '../exports/LIFE'), port = 0, remote = null, sakura = null } = {}) {
  const access = remoteAccess(remote);
  const sakuraConfig = sakuraAccess(sakura);
  const auth = sakuraConfig && createSakuraAuth(sakuraConfig);
  const store = await new DiaryStore(root).init(), token = crypto.randomBytes(32).toString('hex');
  const days = await new DayStore(store.root).init();
  const instance = crypto.randomBytes(12).toString('hex');
  let sequence = 0;
  const changeVersion = () => `${instance}:${sequence}`;
  const handler = isSakura => async (req, res) => {
    try {
      const connection = isSakura ? auth.connection(req) : requestAccess(req, server.address().port, access);
      const url = new URL(req.url, connection.origin);
      if (url.origin !== connection.origin) throw new DiaryError(403, '访问地址无效');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      if (req.headers.origin && req.headers.origin !== connection.origin) throw new DiaryError(403, '来源无效');
      if (isSakura) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
        const entryNavigation = req.method === 'GET' && ['/', '/login'].includes(url.pathname)
          && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
        if (req.headers['sec-fetch-site'] === 'cross-site' && !entryNavigation) throw new DiaryError(403, '来源无效');
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== connection.origin) throw new DiaryError(403, '来源无效');
        const publicFiles = { '/login':'login.html', '/auth/login.js':'login.js', '/auth/style.css':'login.css' };
        if (req.method === 'GET' && Object.hasOwn(publicFiles, url.pathname)) {
          res.setHeader('Content-Type', mime[path.extname(publicFiles[url.pathname])]);
          return await sendBuffer(req, res, await fs.readFile(path.join(appRoot, 'public', publicFiles[url.pathname])));
        }
        if (url.pathname === '/auth/login' && req.method === 'POST') {
          if (req.headers['content-type'] !== 'application/json') throw new DiaryError(415, '需要 JSON 登录请求');
          await auth.login(JSON.parse(await body(req, 2048)).password, res);
          return await json(req, res, 200, { ok:true });
        }
        if (!auth.authenticated(req)) {
          if (req.method === 'GET' && url.pathname === '/') { res.writeHead(302, { Location:'/login' }); return res.end(); }
          throw new DiaryError(401, '登录已过期，请重新登录；当前草稿仍保留在此页');
        }
        if (url.pathname === '/auth/logout' && req.method === 'POST') {
          auth.logout(req, res);
          return await json(req, res, 200, { ok:true });
        }
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new DiaryError(403, '来源无效');
        if (req.method !== 'GET' && req.headers['x-diary-token'] !== token) throw new DiaryError(403, '保存凭据无效，请刷新页面');
        if (req.method === 'GET' && url.pathname === '/api/health') return await json(req, res, 200, { application: 'life-local-diary', root: store.root, remoteOrigin: access?.origin ?? null, sakuraOrigin:sakuraConfig?.origin ?? null, sakuraPort:sakuraServer?.address()?.port ?? null });
        if (req.method === 'GET' && url.pathname === '/api/changes') return await json(req, res, 200, { changeVersion: changeVersion() });
        if (req.method === 'GET' && url.pathname === '/api/bootstrap') return await json(req, res, 200, { token, entries: store.list(), days: days.list(), root: store.root, version: 1, changeVersion: changeVersion(), remoteSession:isSakura });
        const dayMatch=url.pathname.match(/^\/api\/days\/([^/]+)$/);
        if(dayMatch){
          if(req.method==='GET')return await json(req, res,200,await days.get(dayMatch[1]));
          if(req.method==='PUT'){const saved=await days.save(dayMatch[1],JSON.parse(await body(req,5000)));sequence++;return await json(req, res,200,saved);}
          throw new DiaryError(405,'请求方法不支持');
        }
        const match = url.pathname.match(/^\/api\/entries\/([^/]+)(?:\/(images|history|restore))?$/);
        if (!match || !validId(match[1])) throw new DiaryError(404, '接口不存在');
        const [, id, action] = match;
        if (req.method === 'GET' && !action) return await json(req, res, 200, store.get(id));
        if (req.method === 'GET' && action === 'history') return await json(req, res, 200, await store.history(id));
        if (req.method === 'PUT' && !action) { const saved = await store.save(id, JSON.parse(await body(req))); sequence++; return await json(req, res, 200, saved); }
        if (req.method === 'POST' && action === 'images') return await json(req, res, 200, await store.upload(id, await body(req, 25 * 1024 * 1024)));
        if (req.method === 'POST' && action === 'restore') { const data = JSON.parse(await body(req)); const saved = await store.restore(id, data.restoreRevision, data.revision); sequence++; return await json(req, res, 200, saved); }
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
        return await sendBuffer(req, res, bytes);
      }
      return await sendStream(req, res, createReadStream(real), { type, size:stat.size });
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : error instanceof SyntaxError || error instanceof URIError ? 400 : 500);
      await json(req, res, status, { error: status === 500 ? '本地保存失败，请检查磁盘空间、权限及资料文件。草稿仍保留在当前窗口。' : error.message });
    }
  };
  const server = http.createServer(handler(false));
  const sakuraServer = sakuraConfig ? http.createServer(handler(true)) : null;
  const listeners = [server, sakuraServer].filter(Boolean);
  const listen = (listener, number) => new Promise((resolve, reject) => {
    listener.requestTimeout = 60_000;
    const onError = error => { listener.off('listening', onListening); reject(error); };
    const onListening = () => { listener.off('error', onError); resolve(); };
    listener.once('error', onError); listener.once('listening', onListening); listener.listen(number, '127.0.0.1');
  });
  const close = () => Promise.all(listeners.map(listener => new Promise(resolve => listener.close(resolve))));
  try {
    await listen(server, port);
    if (sakuraServer) await listen(sakuraServer, sakuraConfig.port);
  } catch (error) { await close(); throw error; }
  return { server, sakuraServer, store, days, url: `http://127.0.0.1:${server.address().port}`, close };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let remote;
  try { remote = JSON.parse(await fs.readFile(path.resolve(appRoot, '../local-state/remote-access.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let sakura;
  try { sakura = JSON.parse(await fs.readFile(path.resolve(appRoot, '../local-state/sakura-access.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const settings=await loadSettings(path.resolve(appRoot,'..'));
  const port=process.env.DIARY_PORT===undefined?settings.port:Number(process.env.DIARY_PORT);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('日记端口必须是 1–65535 的整数');
  const instance = await createDiaryServer({ root: process.env.DIARY_ROOT, port, remote, sakura });
  console.log(`LIFE_LOCAL_URL=${instance.url}`);
  console.log('朝花夕拾日记已启动。仅监听本机回环地址；支持已配置的 Tailscale Serve 和 Sakura Frp 独立登录入口。');
}
