// Netlify 빌드 단계 전용: 사이트에 필요 없는 파일을 공개 대상(빌드 폴더)에서 지운다.
// - 저장소 원본은 그대로 (NETLIFY=true 일 때만 동작, 로컬 시험: --dry)
// - 서버 코드·키 파일·관리 스크립트·문서·백업 파일이 누구나 내려받을 수 있게 공개되던 문제 (2026-10-21)
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
if (!DRY && process.env.NETLIFY !== 'true') {
  console.log('[strip-private] Netlify 빌드가 아니므로 건너뜀 (로컬 시험: --dry)');
  process.exit(0);
}

// 통째로 지울 폴더 (사이트에서 참조하지 않음)
const DIRS = ['functions', 'contract', 'contract-deploy', 'scripts', 'docs', 'game-server', '.agents', 'node_modules', 'tests', 'test', '__pycache__'];
// 맨 위 폴더에서 남길 파일 (사이트가 쓰는 것) — 나머지 비-웹 파일은 지움
const KEEP_ROOT = new Set(['manifest.json', 'manifest.webmanifest', 'tonconnect-manifest.json', 'sw.js', 'robots.txt', 'sitemap.xml', '_redirects', '_headers', 'BestClub_MERCHANT_API.md']); // md: api-docs.html 에서 링크
const WEB_EXT = new Set(['.html', '.webmanifest', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.woff', '.woff2', '.mp3', '.mp4', '.webm']);
// 어디에 있든 지울 파일
const ANYWHERE = [/\.bak$/i, /\.orig$/i, /service_account.*\.json$/i, /^\.env/i];

const removed = [];
const rm = async (p) => { removed.push(path.relative(root, p)); if (!DRY) await fs.rm(p, { recursive: true, force: true }); };

for (const d of DIRS) {
  try { await fs.access(path.join(root, d)); await rm(path.join(root, d)); } catch { /* 없음 */ }
}
for (const e of await fs.readdir(root, { withFileTypes: true })) {
  if (!e.isFile()) continue;
  if (KEEP_ROOT.has(e.name)) continue;
  if (WEB_EXT.has(path.extname(e.name).toLowerCase())) continue;
  await rm(path.join(root, e.name));
}
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') await walk(p); }
    else if (ANYWHERE.some(r => r.test(e.name)) || (e.name.endsWith('.bak'))) await rm(p);
  }
}
await walk(root);

console.log(`[strip-private] ${DRY ? '(미리보기) ' : ''}공개 대상에서 제외 ${removed.length}개`);
if (DRY) console.log(removed.join('\n'));
