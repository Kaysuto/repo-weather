// Pure logic: no network, no filesystem. Everything here is covered by test/weather.test.js.

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
// These conclusions say nothing about the code's health, so an older run decides instead.
const IGNORED = new Set(['cancelled', 'skipped', 'neutral', 'stale']);

/** Runs sorted newest first (as the API returns them). Latest meaningful run per workflow decides. */
export function ciState(runs) {
  const seen = new Set();
  let failing = false;
  for (const run of runs) {
    if (run.status !== 'completed' || IGNORED.has(run.conclusion) || seen.has(run.workflow_id)) continue;
    seen.add(run.workflow_id);
    if (FAILED.has(run.conclusion)) failing = true;
  }
  if (seen.size === 0) return 'none';
  return failing ? 'failing' : 'passing';
}

/** A ready (non-draft) PR is blocked when it conflicts, has changes requested, or has not moved for `staleDays`. */
export function countBlocked(prs, staleDays, now) {
  const staleMs = staleDays * 86_400_000;
  return prs.filter(
    (pr) =>
      !pr.isDraft &&
      (pr.mergeable === 'CONFLICTING' ||
        pr.reviewDecision === 'CHANGES_REQUESTED' ||
        now - Date.parse(pr.updatedAt) > staleMs),
  ).length;
}

/** Worst condition wins: blocked PRs > failing CI > open issues. */
export function pickWeather({ ci, issues, blocked }, issuesThreshold = 0) {
  if (blocked > 0) return 'stormy';
  if (ci === 'failing') return 'rainy';
  if (issues > issuesThreshold) return 'cloudy';
  return 'sunny';
}

const TEXT = {
  fr: {
    title: 'Météo du dépôt',
    weather: { sunny: 'Ensoleillé', cloudy: 'Nuageux', rainy: 'Pluvieux', stormy: 'Orageux' },
    ci: { passing: 'CI ok', failing: 'CI en échec', none: 'pas de CI' },
    issues: (n) => `${n} issue${n > 1 ? 's' : ''}`,
    blocked: (n) => `${n} PR bloquée${n > 1 ? 's' : ''}`,
    commit: (state) => `chore: météo du dépôt, ${state.toLowerCase()} [skip ci]`,
  },
  en: {
    title: 'Repo weather',
    weather: { sunny: 'Sunny', cloudy: 'Cloudy', rainy: 'Rainy', stormy: 'Stormy' },
    ci: { passing: 'CI passing', failing: 'CI failing', none: 'no CI' },
    issues: (n) => `${n} issue${n === 1 ? '' : 's'}`,
    blocked: (n) => `${n} blocked PR${n === 1 ? '' : 's'}`,
    commit: (state) => `chore: repo weather, ${state.toLowerCase()} [skip ci]`,
  },
};

export const LANGS = Object.keys(TEXT);

export function commitMessage(weather, lang = 'fr') {
  const t = TEXT[lang];
  return t.commit(t.weather[weather]);
}

const CLOUD = 'M14 34h22a8 8 0 0 0 0-16 11 11 0 0 0-21-2 7 7 0 0 0-1 18z';

function sun() {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (r) => `${(24 + r * Math.cos(a)).toFixed(1)} ${(24 + r * Math.sin(a)).toFixed(1)}`;
    return `M${p(13)}L${p(18)}`;
  }).join('');
  return `<circle class="sun" cx="24" cy="24" r="9"/><path class="ray" d="${rays}"/>`;
}

const ICONS = {
  sunny: sun,
  cloudy: () => `<path class="cloud" d="${CLOUD}"/>`,
  rainy: () => `<path class="cloud" d="${CLOUD}"/><path class="rain" d="M17 38l-2 6M25 38l-2 6M33 38l-2 6"/>`,
  stormy: () => `<path class="storm" d="${CLOUD}"/><path class="bolt" d="M26 33l-6 9h5l-3 7 9-11h-5l3-5z"/>`,
};

export function renderSvg(weather, stats, lang = 'fr') {
  const t = TEXT[lang];
  if (!t) throw new Error(`Unknown lang "${lang}", expected one of: ${LANGS.join(', ')}`);
  const state = t.weather[weather];
  const detail = [t.ci[stats.ci], t.issues(stats.issues), t.blocked(stats.blocked)].join(' · ');
  // shortcut: width from average glyph widths, upgrade to real font metrics if text gets clipped.
  const width = Math.ceil(64 + Math.max(t.title.length * 6.4, state.length * 9.6, detail.length * 6.4) + 16);
  const label = `${t.title} : ${state} — ${detail}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="66" viewBox="0 0 ${width} 66" role="img" aria-label="${label}">
<title>${label}</title>
<style>
.bg{fill:#fff;stroke:#d0d7de}.t{fill:#59636e}.s{fill:#1f2328}
.sun{fill:#f5a623}.ray{stroke:#f5a623;stroke-width:2.5;stroke-linecap:round}
.cloud{fill:#b6c2cf}.storm{fill:#6e7681}.rain{stroke:#3b82f6;stroke-width:2.5;stroke-linecap:round}.bolt{fill:#f5c400}
@media (prefers-color-scheme:dark){.bg{fill:#0d1117;stroke:#30363d}.t{fill:#9198a1}.s{fill:#f0f6fc}.cloud{fill:#8b949e}.storm{fill:#484f58}}
</style>
<rect class="bg" x="0.5" y="0.5" width="${width - 1}" height="65" rx="8"/>
<g transform="translate(8 8)">${ICONS[weather]()}</g>
<g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<text class="t" x="64" y="18" font-size="11">${t.title}</text>
<text class="s" x="64" y="37" font-size="16" font-weight="600">${state}</text>
<text class="t" x="64" y="54" font-size="11">${detail}</text>
</g>
</svg>
`;
}
