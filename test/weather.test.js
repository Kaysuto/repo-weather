import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CASES } from '../scripts/cases.js';
import { cause, ciState, commitMessage, countBlocked, parseMessages, phrase, pickWeather, renderSvg } from '../src/weather.js';

const run = (workflow_id, conclusion, status = 'completed') => ({ workflow_id, conclusion, status });

test('ciState : le dernier run significatif de chaque workflow décide', () => {
  assert.equal(ciState([]), 'none');
  assert.equal(ciState([run(1, 'success'), run(1, 'failure')]), 'passing');
  assert.equal(ciState([run(1, 'failure'), run(1, 'success')]), 'failing');
  assert.equal(ciState([run(1, 'success'), run(2, 'timed_out')]), 'failing');
  assert.equal(ciState([run(1, 'cancelled'), run(1, 'failure')]), 'failing');
  assert.equal(ciState([run(1, null, 'in_progress'), run(1, 'success')]), 'passing');
  assert.equal(ciState([run(1, 'skipped')]), 'none');
});

test('countBlocked : conflits, modifications demandées et PR inactives, brouillons exclus', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  const fresh = '2026-10-28T00:00:00Z';
  const old = '2026-10-01T00:00:00Z';
  const prs = [
    { isDraft: false, mergeable: 'MERGEABLE', reviewDecision: null, updatedAt: fresh },
    { isDraft: false, mergeable: 'CONFLICTING', reviewDecision: null, updatedAt: fresh },
    { isDraft: false, mergeable: 'UNKNOWN', reviewDecision: 'CHANGES_REQUESTED', updatedAt: fresh },
    { isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', updatedAt: old },
    { isDraft: true, mergeable: 'CONFLICTING', reviewDecision: null, updatedAt: old },
  ];
  assert.equal(countBlocked(prs, 14, now), 3);
  assert.equal(countBlocked(prs, 60, now), 2);
});

test("pickWeather : la pire condition l'emporte", () => {
  assert.equal(pickWeather({ ci: 'passing', issues: 0, blocked: 0 }), 'sunny');
  assert.equal(pickWeather({ ci: 'none', issues: 0, blocked: 0 }), 'sunny');
  assert.equal(pickWeather({ ci: 'passing', issues: 3, blocked: 0 }), 'cloudy');
  assert.equal(pickWeather({ ci: 'passing', issues: 3, blocked: 0 }, 5), 'sunny');
  assert.equal(pickWeather({ ci: 'failing', issues: 3, blocked: 0 }), 'rainy');
  assert.equal(pickWeather({ ci: 'failing', issues: 3, blocked: 1 }), 'stormy');
});

test('renderSvg : libellés, pluriels et langues', () => {
  const svg = renderSvg('stormy', { ci: 'failing', issues: 1, blocked: 2 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /Orageux/);
  assert.match(svg, /CI en échec · 1 issue · 2 PR bloquées/);
  assert.match(renderSvg('sunny', { ci: 'passing', issues: 0, blocked: 0 }, { lang: 'en' }), /CI passing · 0 issues · 0 blocked PRs/);
  assert.throws(() => renderSvg('sunny', { ci: 'none', issues: 0, blocked: 0 }, { lang: 'de' }), /Langue inconnue/);
});

/** Pastilles du badge : position, largeur, couleur du point, texte et largeur imposée au texte. */
function chips(svg) {
  const re =
    /<g transform="translate\((\d+) 52\)"><rect class="chip" x="0.5" y="0.5" width="(\d+)"[^>]*\/><circle[^>]*fill="(#[0-9a-f]{6})"\/><text[^>]*x="20"[^>]*textLength="(\d+)"[^>]*>([^<]+)<\/text><\/g>/g;
  return [...svg.matchAll(re)].map(([, x, w, color, textLength, text]) => ({
    x: +x,
    w: +w + 1,
    color,
    textLength: +textLength,
    text,
  }));
}

const svgWidth = (svg) => +svg.match(/^<svg [^>]*width="(\d+)"/)[1];

test('renderSvg : trois pastilles avec la bonne couleur de point', () => {
  const GREEN = '#1f883d';
  const colors = (stats) => chips(renderSvg(pickWeather(stats), stats)).map((c) => c.color);
  assert.deepEqual(colors({ ci: 'passing', issues: 0, blocked: 0 }), [GREEN, GREEN, GREEN]);
  assert.deepEqual(colors({ ci: 'failing', issues: 3, blocked: 1 }), ['#cf222e', '#d4a72c', '#8250df']);
  assert.deepEqual(colors({ ci: 'none', issues: 0, blocked: 0 }), ['#8c959f', GREEN, GREEN]);
  assert.deepEqual(
    chips(renderSvg('stormy', { ci: 'failing', issues: 1, blocked: 2 })).map((c) => c.text),
    ['CI en échec', '1 issue', '2 PR bloquées'],
  );
});

test('renderSvg : tout le texte tient dans le badge, quelle que soit la longueur', () => {
  const cases = [
    ['sunny', { ci: 'passing', issues: 0, blocked: 0 }, 'fr'],
    ['stormy', { ci: 'failing', issues: 1234, blocked: 56 }, 'fr'],
    ['rainy', { ci: 'failing', issues: 99999, blocked: 0 }, 'en'],
    ['cloudy', { ci: 'none', issues: 7, blocked: 0 }, 'en'],
  ];
  for (const [weather, stats, lang] of cases) {
    const svg = renderSvg(weather, stats, { lang });
    const width = svgWidth(svg);
    const all = chips(svg);
    assert.equal(all.length, 3, `${weather}/${lang} : 3 pastilles`);
    all.forEach((chip, i) => {
      assert.ok(20 + chip.textLength <= chip.w, `texte "${chip.text}" dans sa pastille`);
      if (i > 0) assert.ok(chip.x >= all[i - 1].x + all[i - 1].w, 'pastilles sans chevauchement');
    });
    const last = all.at(-1);
    assert.ok(last.x + last.w <= width - 16, `${weather}/${lang} : pastilles dans le badge`);
    for (const [, x, textLength] of svg.matchAll(/<text class="[hs]" x="(\d+)"[^>]*textLength="(\d+)"/g)) {
      assert.ok(+x + +textLength <= width - 16, `${weather}/${lang} : titre et météo dans le badge`);
    }
    // Sans textLength, une police plus large que prévu déborderait.
    assert.equal(svg.match(/<text /g).length, svg.match(/<text [^>]*textLength="\d+"/g).length);
  }
});

test('renderSvg : animations par météo, coupées si le lecteur réduit les animations', () => {
  const stats = { ci: 'passing', issues: 0, blocked: 0 };
  assert.match(renderSvg('sunny', stats), /class="ray spin"/);
  assert.match(renderSvg('cloudy', stats), /class="float"/);
  const rainy = renderSvg('rainy', stats);
  const delays = [...rainy.matchAll(/class="drop" style="animation-delay:([\d.]+)s"/g)].map((m) => m[1]);
  assert.deepEqual(delays, ['0', '0.4', '0.8']);
  assert.match(renderSvg('stormy', stats), /class="bolt"/);
  for (const weather of ['sunny', 'cloudy', 'rainy', 'stormy']) {
    const svg = renderSvg(weather, stats);
    assert.match(svg, /@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important\}\}/);
    assert.match(svg, /@media \(prefers-color-scheme:dark\)/);
  }
});

test('commitMessage : suit la langue du badge', () => {
  assert.equal(commitMessage('stormy'), 'chore: météo du dépôt, orageux [skip ci]');
  assert.equal(commitMessage('sunny', 'en'), 'chore: repo weather, sunny [skip ci]');
});

test('renderSvg : thème forcé et version sans animation', () => {
  const stats = { ci: 'passing', issues: 0, blocked: 0 };
  const auto = renderSvg('sunny', stats);
  const dark = renderSvg('sunny', stats, { theme: 'dark' });
  const light = renderSvg('sunny', stats, { theme: 'light' });
  assert.match(auto, /prefers-color-scheme:dark/);
  assert.doesNotMatch(dark, /prefers-color-scheme/);
  assert.ok(dark.includes('.base{fill:#0d1117'));
  assert.doesNotMatch(light, /prefers-color-scheme/);
  assert.ok(light.includes('.base{fill:#fff'));
  assert.throws(() => renderSvg('sunny', stats, { theme: 'sepia' }), /Thème inconnu/);
  for (const weather of ['sunny', 'cloudy', 'rainy', 'stormy']) {
    const svg = renderSvg(weather, stats, { animated: false });
    assert.doesNotMatch(svg, /animation:|@keyframes/, `${weather} statique`);
  }
});

test('badges de référence : identiques octet par octet (npm run examples pour les régénérer)', async () => {
  for (const { file, weather, stats, options } of CASES) {
    // Git peut convertir les fins de ligne sous Windows.
    const expected = (await readFile(new URL(`../examples/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    assert.equal(renderSvg(weather, stats, options), expected, file);
  }
});

test('cause et phrase : raison par défaut, puis personnalisée', () => {
  const stats = { ci: 'failing', issues: 3, blocked: 2 };
  assert.equal(phrase('stormy', stats), 'Orageux : 2 PR bloquées');
  assert.equal(phrase('rainy', stats), 'Pluvieux : CI en échec');
  assert.equal(phrase('cloudy', stats), 'Nuageux : 3 issues');
  assert.equal(phrase('sunny', stats, { lang: 'en' }), 'Sunny: all clear');
  const messages = { stormy: '{blocked} PR à débloquer, {issues} issues, {ci}' };
  assert.equal(cause('stormy', stats, { messages }), '2 PR à débloquer, 3 issues, CI en échec');
  assert.equal(cause('rainy', stats, { messages }), 'CI en échec');
});

test('parseMessages : une ligne par météo, erreur sur une ligne invalide', () => {
  assert.deepEqual(parseMessages('stormy: Orage !\n\n  sunny :  Beau temps  \n'), { stormy: 'Orage !', sunny: 'Beau temps' });
  assert.deepEqual(parseMessages(''), {});
  assert.throws(() => parseMessages('snowy: Neige'), /Ligne de "messages" invalide/);
});

test('renderSvg : pastille de 28 px, texte échappé et contenu dans la largeur', () => {
  const stats = { ci: 'passing', issues: 7, blocked: 0 };
  const svg = renderSvg('cloudy', stats, { style: 'pill', messages: { cloudy: '<b>{issues}</b> & "co"' } });
  assert.match(svg, /^<svg [^>]*height="28"/);
  assert.match(svg, />&lt;b&gt;7&lt;\/b&gt; &amp; &quot;co&quot;<\/text>/);
  assert.doesNotMatch(svg, /<b>/);
  const width = svgWidth(svg);
  for (const [, x, textLength] of svg.matchAll(/<text [^>]*x="([\d.]+)"[^>]*textLength="(\d+)"/g)) {
    assert.ok(+x + +textLength <= width - 12, 'texte dans la pastille');
  }
  assert.throws(() => renderSvg('cloudy', stats, { style: 'banner' }), /Style inconnu/);
});
