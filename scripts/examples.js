// Régénère les badges de référence (README et tests) : npm run examples
import { mkdir, writeFile } from 'node:fs/promises';
import { renderSvg } from '../src/weather.js';
import { CASES } from './cases.js';

await mkdir('examples', { recursive: true });
for (const { file, weather, stats, options } of CASES) {
  await writeFile(`examples/${file}`, renderSvg(weather, stats, options));
}
console.log(`${CASES.length} badges écrits dans examples/`);
