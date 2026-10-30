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
    sep: ' : ',
    allClear: 'tout va bien',
    weather: { sunny: 'Ensoleillé', cloudy: 'Nuageux', rainy: 'Pluvieux', stormy: 'Orageux' },
    ci: { passing: 'CI ok', failing: 'CI en échec', none: 'pas de CI' },
    issues: (n) => `${n} issue${n > 1 ? 's' : ''}`,
    blocked: (n) => `${n} PR bloquée${n > 1 ? 's' : ''}`,
    commit: (state) => `chore: météo du dépôt, ${state.toLowerCase()} [skip ci]`,
  },
  en: {
    title: 'Repo weather',
    sep: ': ',
    allClear: 'all clear',
    weather: { sunny: 'Sunny', cloudy: 'Cloudy', rainy: 'Rainy', stormy: 'Stormy' },
    ci: { passing: 'CI passing', failing: 'CI failing', none: 'no CI' },
    issues: (n) => `${n} issue${n === 1 ? '' : 's'}`,
    blocked: (n) => `${n} blocked PR${n === 1 ? '' : 's'}`,
    commit: (state) => `chore: repo weather, ${state.toLowerCase()} [skip ci]`,
  },
};

export const LANGS = Object.keys(TEXT);

function text(lang) {
  const t = TEXT[lang];
  if (!t) throw new Error(`Langue inconnue "${lang}", valeurs possibles : ${LANGS.join(', ')}`);
  return t;
}

export function commitMessage(weather, lang = 'fr') {
  const t = text(lang);
  return t.commit(t.weather[weather]);
}

/** Lit le paramètre messages : une ligne « météo: texte » par météo à personnaliser. */
export function parseMessages(input = '') {
  const messages = {};
  for (const line of input.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const match = line.match(/^(sunny|cloudy|rainy|stormy)\s*:\s*(.+)$/);
    if (!match) throw new Error(`Ligne de "messages" invalide : "${line}" (attendu : sunny|cloudy|rainy|stormy: texte)`);
    messages[match[1]] = match[2];
  }
  return messages;
}

/** Raison de la météo, par défaut ou personnalisée ({issues}, {blocked} et {ci} sont remplacés). */
export function cause(weather, stats, { lang = 'fr', messages = {} } = {}) {
  const t = text(lang);
  if (messages[weather]) {
    const values = { issues: stats.issues, blocked: stats.blocked, ci: t.ci[stats.ci] };
    return messages[weather].replace(/\{(issues|blocked|ci)\}/g, (_, key) => values[key]);
  }
  if (weather === 'stormy') return t.blocked(stats.blocked);
  if (weather === 'rainy') return t.ci.failing;
  if (weather === 'cloudy') return t.issues(stats.issues);
  return t.allClear;
}

/** Bulletin en une ligne, par exemple « Orageux : 2 PR bloquées ». */
export function phrase(weather, stats, options = {}) {
  const t = text(options.lang ?? 'fr');
  return `${t.weather[weather]}${t.sep}${cause(weather, stats, options)}`;
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

// Largeur estimée à partir des métriques d'Arial/Helvetica (en em, par famille de caractères).
// Elle sert aussi de textLength : le moteur de rendu ajuste le texte à cette largeur, quelle que soit la police réellement utilisée.
function textWidth(text, size, bold = false) {
  let em = 0;
  for (const c of text) {
    if (/[il.,:;'!|· ]/.test(c)) em += 0.28;
    else if (/[jtfr()-]/.test(c)) em += 0.33;
    else if (/[mwMW]/.test(c)) em += 0.83;
    else if (/\d/.test(c)) em += 0.56;
    else if (c !== c.toLowerCase()) em += 0.67;
    else em += 0.55;
  }
  return Math.ceil(em * size * (bold ? 1.08 : 1));
}

const fit = (text, size, bold, adjust = 'spacingAndGlyphs') =>
  `textLength="${textWidth(text, size, bold)}" lengthAdjust="${adjust}"`;

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LIGHT = '.base{fill:#fff;stroke:#d0d7de}.h{fill:#6e7781}.s{fill:#1f2328}.t{fill:#424a53}.dot{fill:#8c959f}.chip{fill:#f6f8fa;stroke:#d0d7de}';
const DARK = '.base{fill:#0d1117;stroke:#30363d}.h{fill:#848d97}.s{fill:#f0f6fc}.t{fill:#c9d1d9}.chip{fill:#161b22;stroke:#30363d}';
const THEME_CSS = { auto: `${LIGHT}\n@media (prefers-color-scheme:dark){${DARK}}`, light: LIGHT, dark: DARK };
export const THEMES = Object.keys(THEME_CSS);
export const STYLES = ['card', 'pill'];

const ANIMATION_CSS = `.spin{transform-box:fill-box;transform-origin:center;animation:spin 24s linear infinite}
.float{animation:float 6s ease-in-out infinite}.drop{animation:fall 1.2s linear infinite}.bolt{animation:flash 4s infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes float{50%{transform:translateX(2px)}}
@keyframes fall{0%{transform:translateY(-3px);opacity:0}30%{opacity:1}100%{transform:translateY(3px);opacity:0}}
@keyframes flash{0%,86%,92%,100%{opacity:1}89%{opacity:.15}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`;

const FONT = `font-family="system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"`;

/** Début commun aux deux styles : dimensions, dégradés, styles et fond teinté. */
function frame({ width, height, radius, label, accent, gradient, theme, animated }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
<title>${label}</title>
<defs>
<linearGradient id="tint" ${gradient}><stop offset="0" stop-color="${accent}" stop-opacity="0.22"/><stop offset="0.7" stop-color="${accent}" stop-opacity="0"/></linearGradient>
<radialGradient id="sun" cx="0.35" cy="0.35" r="0.75"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></radialGradient>
<linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f5f9"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
<linearGradient id="storm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#94a3b8"/><stop offset="1" stop-color="#475569"/></linearGradient>
</defs>
<style>
${THEME_CSS[theme]}
.ray{stroke:#f59e0b;stroke-width:2.5;stroke-linecap:round}.drop{stroke:#3b82f6;stroke-width:2.5;stroke-linecap:round}.bolt{fill:#facc15}
${animated ? ANIMATION_CSS : ''}</style>
<rect class="base" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}"/>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}" fill="url(#tint)"/>
`;
}

function card(weather, stats, t, theme, animated) {
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
      const w = textWidth(text, 11) + 26;
      const chip = `<g transform="translate(${x} 52)"><rect class="chip" x="0.5" y="0.5" width="${w - 1}" height="19" rx="9.5"/><circle cx="11" cy="10" r="3.5" fill="${color}"/><text class="t" x="20" y="14" font-size="11" ${fit(text, 11)}>${text}</text></g>`;
      x += w + 6;
      return chip;
    })
    .join('');
  // Le titre est espacé (0,08 em par lettre) via textLength + lengthAdjust="spacing".
  const titleWidth = textWidth(title, 10, true) + Math.ceil(title.length * 0.8);
  const width = Math.max(x - 6, 76 + textWidth(state, 17, true), 76 + titleWidth) + 16;
  const accent = ACCENT[weather];
  const label = `${t.title} : ${state} — ${chips.map(([text]) => text).join(' · ')}`;
  return `${frame({ width, height: 84, radius: 14, label, accent, gradient: 'x1="0" y1="0" x2="1" y2="1"', theme, animated })}<rect x="14" y="18" width="48" height="48" rx="12" fill="${accent}" fill-opacity="0.16"/>
<g transform="translate(20 24) scale(0.75)">${ICONS[weather]()}</g>
<g ${FONT}>
<text class="h" x="76" y="24" font-size="10" font-weight="600" textLength="${titleWidth}" lengthAdjust="spacing">${title}</text>
<text class="s" x="76" y="43" font-size="17" font-weight="650" ${fit(state, 17, true)}>${state}</text>
${chipsSvg}
</g>
</svg>
`;
}

/** Pastille de 28 px de haut, à placer à côté d'un titre ou dans une rangée de badges. */
function pill(weather, stats, t, lang, theme, animated, messages) {
  const state = t.weather[weather];
  const reason = cause(weather, stats, { lang, messages });
  const stateWidth = textWidth(state, 12, true);
  const reasonX = 30 + stateWidth + 11;
  const width = reasonX + textWidth(reason, 12) + 12;
  const label = esc(`${t.title}${t.sep}${phrase(weather, stats, { lang, messages })}`);
  return `${frame({ width, height: 28, radius: 14, label, accent: ACCENT[weather], gradient: 'x1="0" y1="0" x2="1" y2="0"', theme, animated })}<g transform="translate(4 3) scale(0.46)">${ICONS[weather]()}</g>
<g ${FONT}>
<text class="s" x="30" y="18.5" font-size="12" font-weight="650" ${fit(state, 12, true)}>${state}</text>
<circle class="dot" cx="${30 + stateWidth + 5.5}" cy="14" r="1.5"/>
<text class="t" x="${reasonX}" y="18.5" font-size="12" ${fit(reason, 12)}>${esc(reason)}</text>
</g>
</svg>
`;
}

/**
 * style : card (carte complète) ou pill (pastille). theme : auto (suit le lecteur), light ou dark (forcé).
 * animated : false donne un SVG sans aucune animation. messages : raisons personnalisées, affichées par la pastille.
 */
export function renderSvg(weather, stats, { lang = 'fr', style = 'card', theme = 'auto', animated = true, messages = {} } = {}) {
  const t = text(lang);
  if (!THEME_CSS[theme]) throw new Error(`Thème inconnu "${theme}", valeurs possibles : ${THEMES.join(', ')}`);
  if (!STYLES.includes(style)) throw new Error(`Style inconnu "${style}", valeurs possibles : ${STYLES.join(', ')}`);
  if (style === 'pill') return pill(weather, stats, t, lang, theme, animated, messages);
  return card(weather, stats, t, theme, animated);
}
