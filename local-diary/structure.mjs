import { load } from 'cheerio';

const monthHeading = /^(?:十一|十二|十|[一二三四五六七八九])月(?:[上中下]旬)?$/;
export function archiveDate(url) {
  const match = url.match(/^source\/(\d{2})\/(\d{2})\/(\d{2})(?:[-~][a-z0-9]+)?\//i);
  if (!match) return null;
  const value = `20${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(value + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

// Remove navigation-only OneNote pages from the app, while retaining raw sources.
// Unknown objects or any actual content keep the page visible.
export function isEmptyStructurePage(entry, xml) {
  if (!entry.group || !monthHeading.test(entry.title.trim()) || entry.imageCount || entry.attachmentCount || entry.importSources?.length) return false;
  if (entry.blocks.length !== 1 || entry.blocks[0].type !== 'archive' || entry.pinned || entry.tags?.length) return false;
  const $ = load(xml, { xmlMode: true });
  const local = e => e.name?.split(':').at(-1);
  const nodes = () => $('*').toArray();
  if (!nodes().some(e => local(e) === 'Page')) return false;
  for (const e of nodes().filter(e => ['Title', 'OCRData'].includes(local(e)))) $(e).remove();
  for (const e of nodes()) {
    if (local(e) === 'T' && load($(e).text()).text().replace(/[\s\u200b\uFEFF]/g, '')) return false;
    if (['Image', 'InsertedFile', 'InkDrawing', 'InkWord', 'InkParagraph', 'Table', 'AudioRecording', 'VideoRecording', 'Future'].includes(local(e))) return false;
    if (local(e) === 'OE') {
      const children = $(e).children().toArray();
      if (!children.length || children.some(child => !['T', 'OEChildren', 'Meta'].includes(local(child)))) return false;
    }
  }
  return true;
}
