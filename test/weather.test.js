import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ciState, commitMessage, countBlocked, pickWeather, renderSvg } from '../src/weather.js';

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
  assert.match(renderSvg('sunny', { ci: 'passing', issues: 0, blocked: 0 }, 'en'), /CI passing · 0 issues · 0 blocked PRs/);
  assert.throws(() => renderSvg('sunny', { ci: 'none', issues: 0, blocked: 0 }, 'de'), /Langue inconnue/);
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
    const svg = renderSvg(weather, stats, lang);
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
