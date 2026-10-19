// Netlify 빌드 단계 전용: assets/js 아래 JS 를 제자리에서 압축(minify)한다.
// - 로컬 원본 보호: NETLIFY=true 이거나 --out <폴더> 를 줄 때만 동작
// - 최상위 이름은 바꾸지 않음(esbuild transform 기본) → 다른 스크립트가 쓰는 전역 함수 유지
// - 압축 실패 파일은 원본 그대로 둠
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'assets', 'js');
const outIdx = process.argv.indexOf('--out');
const outRoot = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : null;

if (!outRoot && process.env.NETLIFY !== 'true') {
  console.log('[minify-js] Netlify 빌드가 아니므로 건너뜀 (로컬 시험: --out <폴더>)');
  process.exit(0);
}

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.min.js')) yield p;
  }
}

let before = 0, after = 0, n = 0, failed = 0;
for await (const file of walk(srcDir)) {
  const code = await fs.readFile(file, 'utf8');
  const dest = outRoot ? path.join(outRoot, path.relative(root, file)) : file;
  let out = code;
  try {
    const r = await transform(code, { loader: 'js', minify: true, charset: 'utf8', legalComments: 'none' });
    if (r.code.length < code.length) out = r.code;
  } catch (e) {
    failed++;
    console.warn(`[minify-js] 원본 유지: ${path.relative(root, file)} — ${e.message.split('\n')[0]}`);
  }
  if (outRoot) await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, out, 'utf8');
  before += Buffer.byteLength(code); after += Buffer.byteLength(out); n++;
}
console.log(`[minify-js] ${n}개 파일 ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB (실패 ${failed}개는 원본 유지)`);
