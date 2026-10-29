import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ciState, commitMessage, countBlocked, pickWeather, renderSvg } from '../src/weather.js';

const run = (workflow_id, conclusion, status = 'completed') => ({ workflow_id, conclusion, status });

test('ciState: latest meaningful run per workflow decides', () => {
  assert.equal(ciState([]), 'none');
  assert.equal(ciState([run(1, 'success'), run(1, 'failure')]), 'passing');
  assert.equal(ciState([run(1, 'failure'), run(1, 'success')]), 'failing');
  assert.equal(ciState([run(1, 'success'), run(2, 'timed_out')]), 'failing');
  assert.equal(ciState([run(1, 'cancelled'), run(1, 'failure')]), 'failing');
  assert.equal(ciState([run(1, null, 'in_progress'), run(1, 'success')]), 'passing');
  assert.equal(ciState([run(1, 'skipped')]), 'none');
});

test('countBlocked: conflicts, changes requested and stale PRs, drafts excluded', () => {
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

test('pickWeather: worst condition wins', () => {
  assert.equal(pickWeather({ ci: 'passing', issues: 0, blocked: 0 }), 'sunny');
  assert.equal(pickWeather({ ci: 'none', issues: 0, blocked: 0 }), 'sunny');
  assert.equal(pickWeather({ ci: 'passing', issues: 3, blocked: 0 }), 'cloudy');
  assert.equal(pickWeather({ ci: 'passing', issues: 3, blocked: 0 }, 5), 'sunny');
  assert.equal(pickWeather({ ci: 'failing', issues: 3, blocked: 0 }), 'rainy');
  assert.equal(pickWeather({ ci: 'failing', issues: 3, blocked: 1 }), 'stormy');
});

test('renderSvg: labels, plurals and languages', () => {
  const svg = renderSvg('stormy', { ci: 'failing', issues: 1, blocked: 2 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /Orageux/);
  assert.match(svg, /CI en échec · 1 issue · 2 PR bloquées/);
  assert.match(renderSvg('sunny', { ci: 'passing', issues: 0, blocked: 0 }, 'en'), /CI passing · 0 issues · 0 blocked PRs/);
  assert.throws(() => renderSvg('sunny', { ci: 'none', issues: 0, blocked: 0 }, 'de'), /Unknown lang/);
});

test('commitMessage: follows the badge language', () => {
  assert.equal(commitMessage('stormy'), 'chore: météo du dépôt, orageux [skip ci]');
  assert.equal(commitMessage('sunny', 'en'), 'chore: repo weather, sunny [skip ci]');
});
