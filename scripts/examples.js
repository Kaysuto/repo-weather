// Regenerates the preview badges shown in the README: npm run examples
import { mkdir, writeFile } from 'node:fs/promises';
import { renderSvg } from '../src/weather.js';

const samples = {
  sunny: { ci: 'passing', issues: 0, blocked: 0 },
  cloudy: { ci: 'passing', issues: 4, blocked: 0 },
  rainy: { ci: 'failing', issues: 4, blocked: 0 },
  stormy: { ci: 'failing', issues: 4, blocked: 2 },
};

await mkdir('examples', { recursive: true });
for (const [weather, stats] of Object.entries(samples)) {
  await writeFile(`examples/${weather}.svg`, renderSvg(weather, stats));
}
console.log(`Wrote ${Object.keys(samples).length} badges to examples/`);
