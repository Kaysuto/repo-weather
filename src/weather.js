// Logique pure : ni réseau, ni fichiers. Tout est couvert par test/weather.test.js.

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
// Ces conclusions ne disent rien de la santé du code : un run plus ancien décide à leur place.
const IGNORED = new Set(['cancelled', 'skipped', 'neutral', 'stale']);

/** Runs triés du plus récent au plus ancien (ordre de l'API). Le dernier run significatif de chaque workflow décide. */
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

/** Une PR prête (hors brouillon) est bloquée si elle est en conflit, si des modifications sont demandées, ou si elle n'a pas bougé depuis `staleDays` jours. */
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

/** La pire condition l'emporte : PR bloquées > CI en échec > issues ouvertes. */
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
const ACCENT = { sunny: '#f59e0b', cloudy: '#64748b', rainy: '#3b82f6', stormy: '#8b5cf6' };
const GOOD = '#1f883d';
const DOT = { passing: GOOD, failing: '#cf222e', none: '#8c959f' };

function sun() {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (r) => `${(24 + r * Math.cos(a)).toFixed(1)} ${(24 + r * Math.sin(a)).toFixed(1)}`;
    return `M${p(13)}L${p(18)}`;
  }).join('');
  return `<path class="ray spin" d="${rays}"/><circle cx="24" cy="24" r="9" fill="url(#sun)"/>`;
}

const drops = [17, 25, 33].map((x, i) => `<path class="drop" style="animation-delay:${i * 0.4}s" d="M${x} 38l-2 6"/>`).join('');

const ICONS = {
  sunny: sun,
  cloudy: () => `<path class="float" d="${CLOUD}" fill="url(#cloud)"/>`,
  rainy: () => `<path d="${CLOUD}" fill="url(#cloud)"/>${drops}`,
  stormy: () => `<path d="${CLOUD}" fill="url(#storm)"/><path class="bolt" d="M26 33l-6 9h5l-3 7 9-11h-5l3-5z"/>`,
};

// raccourci : largeurs estimées avec une largeur moyenne de caractère, passer à de vraies métriques de police si du texte est coupé.
const textWidth = (text, size) => text.length * size * 0.58;

export function renderSvg(weather, stats, lang = 'fr') {
  const t = TEXT[lang];
  if (!t) throw new Error(`Unknown lang "${lang}", expected one of: ${LANGS.join(', ')}`);
  const state = t.weather[weather];
  const title = t.title.toUpperCase();
  const chips = [
    [t.ci[stats.ci], DOT[stats.ci]],
    [t.issues(stats.issues), stats.issues > 0 ? '#d4a72c' : GOOD],
    [t.blocked(stats.blocked), stats.blocked > 0 ? '#8250df' : GOOD],
  ];
  let x = 76;
  const chipsSvg = chips
    .map(([text, color]) => {
      const w = Math.ceil(textWidth(text, 11) + 26);
      const chip = `<g transform="translate(${x} 52)"><rect class="chip" x="0.5" y="0.5" width="${w - 1}" height="19" rx="9.5"/><circle cx="11" cy="10" r="3.5" fill="${color}"/><text class="t" x="20" y="14" font-size="11">${text}</text></g>`;
      x += w + 6;
      return chip;
    })
    .join('');
  const width = Math.ceil(Math.max(x - 6, 76 + textWidth(state, 17) + 4, 76 + textWidth(title, 10) + title.length) + 16);
  const accent = ACCENT[weather];
  const label = `${t.title} : ${state} — ${chips.map(([text]) => text).join(' · ')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="84" viewBox="0 0 ${width} 84" role="img" aria-label="${label}">
<title>${label}</title>
<defs>
<linearGradient id="tint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.22"/><stop offset="0.7" stop-color="${accent}" stop-opacity="0"/></linearGradient>
<radialGradient id="sun" cx="0.35" cy="0.35" r="0.75"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></radialGradient>
<linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f5f9"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
<linearGradient id="storm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#94a3b8"/><stop offset="1" stop-color="#475569"/></linearGradient>
</defs>
<style>
.base{fill:#fff;stroke:#d0d7de}.h{fill:#6e7781;letter-spacing:.08em}.s{fill:#1f2328}.t{fill:#424a53}.chip{fill:#f6f8fa;stroke:#d0d7de}
.ray{stroke:#f59e0b;stroke-width:2.5;stroke-linecap:round}.drop{stroke:#3b82f6;stroke-width:2.5;stroke-linecap:round}.bolt{fill:#facc15}
.spin{transform-box:fill-box;transform-origin:center;animation:spin 24s linear infinite}
.float{animation:float 6s ease-in-out infinite}.drop{animation:fall 1.2s linear infinite}.bolt{animation:flash 4s infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes float{50%{transform:translateX(2px)}}
@keyframes fall{0%{transform:translateY(-3px);opacity:0}30%{opacity:1}100%{transform:translateY(3px);opacity:0}}
@keyframes flash{0%,86%,92%,100%{opacity:1}89%{opacity:.15}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
@media (prefers-color-scheme:dark){.base{fill:#0d1117;stroke:#30363d}.h{fill:#848d97}.s{fill:#f0f6fc}.t{fill:#c9d1d9}.chip{fill:#161b22;stroke:#30363d}}
</style>
<rect class="base" x="0.5" y="0.5" width="${width - 1}" height="83" rx="14"/>
<rect x="0.5" y="0.5" width="${width - 1}" height="83" rx="14" fill="url(#tint)"/>
<rect x="14" y="18" width="48" height="48" rx="12" fill="${accent}" fill-opacity="0.16"/>
<g transform="translate(20 24) scale(0.75)">${ICONS[weather]()}</g>
<g font-family="system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<text class="h" x="76" y="24" font-size="10" font-weight="600">${title}</text>
<text class="s" x="76" y="43" font-size="17" font-weight="650">${state}</text>
${chipsSvg}
</g>
</svg>
`;
}
