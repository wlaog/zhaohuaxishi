import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { load } from 'cheerio';
import sharp from 'sharp';
import { archiveDate, isEmptyStructurePage } from './structure.mjs';

export class DiaryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new DiaryError(status, message); };
export const validId = id => /^(?:[a-f0-9]{20}|n-[a-f0-9]{24})$/.test(id);
export function within(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\0') || relative.includes('\\')) fail(400, '无效路径');
  const result = path.resolve(root, relative);
  if (result !== root && !result.startsWith(root + path.sep)) fail(403, '路径超出资料目录');
  return result;
}
export function validDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const text = html => { const $ = load(html ?? ''); $('head,script,style').remove(); return $.text().replace(/\s+/g, ' ').trim(); };
export function sanitizeText(html) {
  const $ = load(String(html ?? ''), null, false);
  $('script,style,iframe,object,embed,svg,math,form,input,button,textarea,link,meta').remove();
  const allowed = new Set('p div br span strong b em i u s strike h2 h3 h4 ul ol li blockquote pre code a hr'.split(' '));
  $('*').each((_, el) => {
    const node = $(el);
    if (!allowed.has(el.tagName)) { node.replaceWith(node.contents()); return; }
    for (const attr of Object.keys(el.attribs)) {
      if (el.tagName === 'a' && attr === 'href' && /^(https?:|mailto:)/i.test(el.attribs[attr])) continue;
      node.removeAttr(attr);
    }
    if (el.tagName === 'a') node.attr('target', '_blank').attr('rel', 'noopener noreferrer');
  });
  return $.html();
}
export async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const handle = await fs.open(temp, 'wx');
  try { await handle.writeFile(JSON.stringify(data, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temp, file); } catch (e) { await fs.rm(temp, { force: true }); throw e; }
}

export class DiaryStore {
  constructor(root) { this.root = path.resolve(root); this.entries = new Map(); this.files = new Map(); this.legacy = new Map(); this.imported = new Map(); this.removedGroups = []; this.queue = Promise.resolve(); }
  async init() {
    try {
      const imports = JSON.parse(await fs.readFile(path.join(this.root, '_imports/manifest.json'), 'utf8'));
      for (const source of imports.sources) {
        within(this.root, source.originalPath);
        if (source.viewPath) within(this.root, source.viewPath);
        if (!this.imported.has(source.entryId)) this.imported.set(source.entryId, []);
        this.imported.get(source.entryId).push(source);
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let manifest = { pages: [], sections: [] }, catalog = { pages: [] };
    try { manifest = JSON.parse(await fs.readFile(path.join(this.root, 'manifest.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    try { catalog = JSON.parse((await fs.readFile(path.join(this.root, 'assets/catalog.js'), 'utf8')).replace(/^window\.NOTEBOOK\s*=\s*/, '').replace(/;\s*$/, '')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const searches = new Map(catalog.pages.map(p => [p.key, p.search]));
    for (const page of manifest.pages) {
      if (!validId(page.key)) fail(500, '归档页面标识无效');
      within(this.root, page.url);
      const folder = path.posix.dirname(page.url);
      const date = archiveDate(page.url);
      const entry = {
        id: page.key, title: page.title, date, folder, group: !date, legacy: true,
        created: page.created, updated: page.modified, revision: 0, pinned: false, deleted: false, tags: [],
        blocks: [{ id: 'original', type: 'archive', pageKey: page.key }],
        archiveUrl: '/archive/' + page.url, search: searches.get(page.key) ?? page.title, previewText: '',
        imageCount: page.images.length, attachmentCount: page.attachments.length,
        thumbnail: page.images.find(img => /\.(png|jpe?g|gif|webp)$/i.test(img.file))?.file ?? null,
      };
      this.legacy.set(page.key, entry); this.entries.set(page.key, { ...entry, importSources: this.imported.get(page.key) ?? [] });
    }
    const source = path.join(this.root, 'source');
    const walk = async dir => {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        if (item.isSymbolicLink()) continue;
        const file = path.join(dir, item.name);
        if (item.isDirectory() && !item.name.endsWith('.files') && item.name !== '_history') await walk(file);
        else if (item.isFile() && /^entry-(?:n-)?[a-f0-9]+\.json$/.test(item.name)) {
          const saved = JSON.parse(await fs.readFile(file, 'utf8'));
          if (!validId(saved.id) || this.files.has(saved.id)) fail(500, '本地日记标识重复或无效');
          saved.folder = path.relative(this.root, dir).replaceAll('\\', '/');
          this.entries.set(saved.id, this.decorate(saved)); this.files.set(saved.id, file);
        }
      }
    };
    try { await walk(source); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const page of manifest.pages) {
      const entry = this.entries.get(page.key);
      if (!entry?.group || typeof page.source !== 'string') continue;
      const bytes = await fs.readFile(within(this.root, page.source));
      // A mismatched source snapshot must never be used as proof that a page is empty.
      if (!page.sourceHash || crypto.createHash('sha256').update(bytes).digest('hex') !== page.sourceHash) continue;
      if (isEmptyStructurePage(entry, bytes.toString('utf8'))) {
        this.entries.delete(page.key);
        this.removedGroups.push({ id: page.key, title: page.title, source: page.source, sourceHash: page.sourceHash });
      }
    }
    return this;
  }
  decorate(saved) {
    const original = this.legacy.get(saved.id);
    const combined = { ...original, ...saved };
    combined.importSources = this.imported.get(saved.id) ?? [];
    combined.search = [combined.title, ...combined.tags, ...combined.blocks.map(b => b.type === 'text' ? text(b.html) : b.type === 'html' ? text(b.html) : b.type === 'image' ? b.caption : original?.search ?? '')].join(' ');
    combined.previewText = combined.blocks.filter(b => b.type === 'text' || b.type === 'html' && !b.originPageKey).map(b => text(b.html)).join(' ').slice(0, 220);
    const originalLinked = combined.blocks.some(b => b.type === 'archive' || b.type === 'html' && b.originPageKey === combined.id);
    combined.imageCount = combined.blocks.filter(b => b.type === 'image').length + (originalLinked ? original?.imageCount ?? 0 : 0)
      + combined.blocks.filter(b => b.type === 'html' && !b.originPageKey).reduce((sum, b) => sum + load(b.html)('img').length, 0);
    if (!originalLinked) combined.thumbnail = null;
    if (!combined.thumbnail) {
      const preview = combined.importSources.flatMap(s => s.assets).find(a => a.role === 'original-image'
        && combined.blocks.some(b => b.type === 'html' && b.html.includes(path.posix.basename(a.path))));
      if (preview) combined.thumbnail = path.posix.relative(combined.folder, preview.path);
    }
    return combined;
  }
  get(id) { return structuredClone(this.entries.get(id) ?? fail(404, '日记不存在')); }
  list() { return [...this.entries.values()].map(({ blocks, search, ...e }) => ({ ...e, excerpt: search.slice(0, 220), search, blockTypes: blocks.map(b => b.type), media: blocks.filter(b => b.type === 'image').map(b => b.file) })); }
  serial(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
  save(id, input) { return this.serial(() => this._save(id, input)); }
  async _save(id, input) {
    if (!validId(id)) fail(400, '无效日记标识');
    const current = this.entries.get(id);
    if (!current && !id.startsWith('n-')) fail(404, '日记不存在');
    if (input.revision !== (current?.revision ?? 0)) fail(409, '另一窗口已保存新版本。请先下载当前草稿，再重新加载，避免覆盖。');
    const date = current?.date ?? input.date;
    if (!current?.group && !validDate(date)) fail(400, '日期无效');
    if (current && input.date !== current.date) fail(400, '已保存日记的归档日期不能移动；请新建对应日期的日记');
    if (typeof input.title !== 'string' || input.title.length > 300) fail(400, '标题最多 300 字');
    if (!Array.isArray(input.blocks) || input.blocks.length > 150) fail(400, '内容块数量无效');
    const folder = current?.folder ?? `source/${date.slice(2, 4)}/${date.slice(5, 7)}/${date.slice(8, 10)}`;
    // Imports or another process may have advanced the file since this server started.
    const diskFile = within(this.root, `${folder}/entry-${id}.json`);
    try {
      const disk = JSON.parse(await fs.readFile(diskFile, 'utf8'));
      if (disk.revision !== input.revision) fail(409, '本地文件已有新版本，请先导出草稿再重新加载。');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const ids = new Set();
    const blocks = input.blocks.map(block => {
      if (typeof block.id !== 'string' || !/^[\w-]{1,80}$/.test(block.id) || ids.has(block.id)) fail(400, '内容块标识重复或无效');
      ids.add(block.id);
      if (block.type === 'archive') {
        if (!this.legacy.has(id) || block.pageKey !== id) fail(400, '原始页面引用无效');
        return { id: block.id, type: 'archive', pageKey: id };
      }
      if (block.type === 'text' || block.type === 'html') {
        if (typeof block.html !== 'string' || block.html.length > 2_000_000) fail(400, '内容块过大');
        const saved = { id: block.id, type: block.type, html: block.type === 'text' ? sanitizeText(block.html) : block.html };
        if (block.type === 'html' && block.originPageKey !== undefined) {
          if (block.originPageKey !== id || !this.legacy.has(id)) fail(400, '原始 HTML 来源无效');
          saved.originPageKey = id;
        }
        return saved;
      }
      if (block.type === 'image') {
        if (!/^media-[a-f0-9]{64}\.(png|jpg|gif|webp|avif)$/.test(block.file ?? '')) fail(400, '图片引用无效');
        return { id: block.id, type: 'image', file: block.file, caption: String(block.caption ?? '').slice(0, 2000) };
      }
      fail(400, '不支持的内容块');
    });
    for (const b of blocks) if (b.type === 'image') await fs.access(within(this.root, `${folder}/${b.file}`)).catch(() => fail(400, '图片文件不存在'));
    const now = new Date().toISOString();
    const entry = { schemaVersion: 1, id, title: input.title.trim() || '无标题日记', date, folder, group: !!current?.group, legacy: !!current?.legacy,
      created: current?.created ?? now, updated: now, revision: (current?.revision ?? 0) + 1,
      pinned: !!input.pinned, deleted: !!input.deleted, tags: [...new Set((Array.isArray(input.tags) ? input.tags : []).map(t => String(t).replace(/^#/, '').trim().slice(0, 40)).filter(Boolean))].slice(0, 20), blocks };
    const file = within(this.root, `${folder}/entry-${id}.json`);
    if (current) await atomicJson(within(this.root, `${folder}/_history/${id}/${String(current.revision).padStart(8, '0')}.json`), current);
    await atomicJson(file, entry);
    const decorated = this.decorate(entry);
    this.entries.set(id, decorated); this.files.set(id, file);
    return structuredClone(decorated);
  }
  async upload(id, bytes) {
    const entry = this.get(id);
    if (bytes.length > 25 * 1024 * 1024 || !bytes.length) fail(413, '每张图片最多 25 MB');
    const info = await sharp(bytes, { limitInputPixels: 150_000_000, animated: true }).metadata().catch(() => fail(400, '图片格式无法识别'));
    const ext = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', avif: 'avif', heif: 'avif' }[info.format];
    if (!ext || (info.format === 'heif' && info.compression !== 'av1')) fail(400, '支持 PNG、JPEG、GIF、WebP、AVIF 图片');
    const file = `media-${crypto.createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    const target = within(this.root, `${entry.folder}/${file}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    return { file, url: `/archive/${entry.folder}/${file}`, width: info.width, height: info.height, bytes: bytes.length };
  }
  async history(id) {
    const entry = this.get(id), dir = within(this.root, `${entry.folder}/_history/${id}`);
    try {
      const files = (await fs.readdir(dir)).filter(f => /^\d{8}\.json$/.test(f)).sort().reverse();
      return Promise.all(files.map(async file => { const e = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')); return { revision: e.revision, updated: e.updated, title: e.title }; }));
    } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }
  restore(id, revision, expectedRevision) { return this.serial(async () => {
    if (!Number.isSafeInteger(revision) || revision < 0) fail(400, '版本无效');
    const entry = this.get(id);
    const old = JSON.parse(await fs.readFile(within(this.root, `${entry.folder}/_history/${id}/${String(revision).padStart(8, '0')}.json`), 'utf8').catch(() => fail(404, '历史版本不存在')));
    return this._save(id, { ...old, revision: expectedRevision });
  }); }
}
