// Smoke test for a running ViewSarn image: renders a Thai document as PDF and PNG.
//   node scripts/smoke.mjs <base-url> <api-key> [--container <name>]
// With --container it also checks the baked-in Thai fonts inside that container.
import { execFileSync } from 'node:child_process';

const [baseUrl, apiKey, ...rest] = process.argv.slice(2);
if (!baseUrl || !apiKey) {
  console.error('Usage: node scripts/smoke.mjs <base-url> <api-key> [--container <name>]');
  process.exit(2);
}
const container = rest[0] === '--container' ? rest[1] : null;

const fail = (message) => { console.error(`SMOKE FAIL: ${message}`); process.exit(1); };

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  fail('service did not become healthy within 60 s');
}

async function render(options) {
  const res = await fetch(`${baseUrl}/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ html: '<h1>รายงานประจำเดือน</h1><p>ทดสอบฟอนต์ Sarabun และ Noto Sans Thai</p>', options })
  });
  if (res.status !== 200) fail(`/convert ${JSON.stringify(options)} returned ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

await waitForHealth();

const pdf = await render({ filename: 'รายงาน.pdf' });
if (pdf.subarray(0, 4).toString() !== '%PDF' || pdf.length < 1000) fail(`PDF looks wrong (${pdf.length} bytes)`);

const png = await render({ png: true });
if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || png.length < 500) {
  fail(`PNG looks wrong (${png.length} bytes)`);
}

if (container) {
  const fonts = execFileSync('docker', ['exec', container, 'fc-list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const name of ['Sarabun', 'Noto Sans Thai']) {
    if (!fonts.includes(name)) fail(`font not installed in the image: ${name}`);
  }
}

console.log(`SMOKE OK: pdf ${pdf.length} bytes, png ${png.length} bytes${container ? ', fonts present' : ''}`);
