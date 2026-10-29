// 번역 키 점검: 코드에서 사용하는 정적 키가 ko 사전에 있는지, 각 언어 사전이 ko의 모든 키를 갖는지 확인
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'client', 'src');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== 'locales') walk(p); } else if (/\.tsx?$/.test(f.name)) files.push(p);
  }
})(root);

const readKeys = (lang) => {
  const src = fs.readFileSync(path.join(root, 'i18n', 'locales', `${lang}.ts`), 'utf8');
  return new Map([...src.matchAll(/^\s*'([^']+)':\s*(['"`])((?:\\.|(?!\2).)*)\2/gm)].map((m) => [m[1], m[3]]));
};
const ko = readKeys('ko');
const used = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/\?\s*'([a-z]+\.[a-zA-Z0-9_.]+)'\s*:\s*'([a-z]+\.[a-zA-Z0-9_.]+)'/g)) { used.add(m[1]); used.add(m[2]); }
}
let bad = 0;
const missing = [...used].filter((k) => !ko.has(k));
console.log(`ko: ${ko.size} keys, used static: ${used.size}, missing in ko: ${missing.length}`, missing);
bad += missing.length;
for (const lang of ['en', 'ru', 'ja', 'zh']) {
  const d = readKeys(lang);
  const miss = [...ko.keys()].filter((k) => !d.has(k));
  const ph = [...ko.keys()].filter((k) => d.has(k) && JSON.stringify([...ko.get(k).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()) !== JSON.stringify([...d.get(k).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()));
  console.log(`${lang}: ${d.size} keys, missing ${miss.length}, placeholder mismatch ${ph.length}`, miss.slice(0, 10), ph.slice(0, 10));
  bad += miss.length + ph.length;
}
process.exit(bad ? 1 : 0);
