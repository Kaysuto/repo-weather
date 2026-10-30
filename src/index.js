import { appendFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  LANGS,
  STYLES,
  THEMES,
  ciState,
  commitMessage,
  countBlocked,
  parseMessages,
  phrase,
  pickWeather,
  renderSvg,
} from './weather.js';

const input = (name, fallback) => process.env[`INPUT_${name.toUpperCase()}`]?.trim() || fallback;

function oneOf(name, fallback, values) {
  const value = input(name, fallback);
  if (!values.includes(value)) throw new Error(`Le paramètre "${name}" doit valoir : ${values.join(', ')}`);
  return value;
}

function number(name, fallback) {
  const value = Number(input(name, fallback));
  if (!Number.isFinite(value) || value < 0) throw new Error(`Le paramètre "${name}" doit être un nombre positif ou nul`);
  return value;
}

const token = input('token');
// Le badge est toujours committé dans le dépôt qui exécute le workflow, même quand il décrit un autre dépôt.
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';

async function gh(url, { method = 'GET', body, allow404 = false } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${api}${url}`, {
    method,
    body,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
  return res.json();
}

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN, first: 100) { nodes { isDraft mergeable reviewDecision updatedAt } }
  }
}`;

async function main() {
  if (!token) throw new Error('Le paramètre "token" est vide');
  const path = input('path', '.github/repo-weather.svg').replace(/^\.\//, '');
  const staleDays = number('stale-days', '14');
  const issuesThreshold = number('issues-threshold', '0');
  const lang = oneOf('lang', 'fr', LANGS);
  const theme = oneOf('theme', 'auto', THEMES);
  const animated = oneOf('animated', 'true', ['true', 'false']) === 'true';
  const commit = oneOf('commit', 'true', ['true', 'false']) === 'true';
  const style = oneOf('style', 'card', STYLES);
  const messages = parseMessages(input('messages', ''));
  const target = input('repo', process.env.GITHUB_REPOSITORY);
  if (!/^[\w.-]+\/[\w.-]+$/.test(target)) throw new Error(`Le paramètre "repo" doit être de la forme propriétaire/nom, reçu : "${target}"`);
  const [targetOwner, targetName] = target.split('/');
  const isSelf = target.toLowerCase() === process.env.GITHUB_REPOSITORY.toLowerCase();

  const { data, errors } = await gh(process.env.GITHUB_GRAPHQL_URL ?? `${api}/graphql`, {
    method: 'POST',
    body: JSON.stringify({ query: QUERY, variables: { owner: targetOwner, name: targetName } }),
  });
  if (errors) throw new Error(errors.map((e) => e.message).join('; '));
  const repository = data.repository;
  const defaultBranch = repository.defaultBranchRef?.name;
  if (!defaultBranch) throw new Error(`Le dépôt ${target} n'a pas encore de branche par défaut (dépôt vide ?)`);

  const { workflow_runs: runs } = await gh(
    `/repos/${target}/actions/runs?branch=${encodeURIComponent(defaultBranch)}&exclude_pull_requests=true&per_page=100`,
  );
  // Le workflow qui exécute l'Action ne doit pas se juger lui-même : il est encore en cours, ou bouclerait sur son propre résultat.
  const ownPath = isSelf ? process.env.GITHUB_WORKFLOW_REF?.split('@')[0].slice(`${owner}/${repo}/`.length) : undefined;
  const others = runs.filter((run) => !isSelf || (run.path !== ownPath && String(run.id) !== process.env.GITHUB_RUN_ID));

  const stats = {
    ci: ciState(others),
    issues: repository.issues.totalCount,
    // raccourci : seules les 100 PR ouvertes les plus récentes sont examinées, paginer si un dépôt en a davantage.
    blocked: countBlocked(repository.pullRequests.nodes, staleDays, Date.now()),
  };
  const weather = pickWeather(stats, issuesThreshold);
  const svg = renderSvg(weather, stats, { lang, style, theme, animated, messages });
  const bulletin = phrase(weather, stats, { lang, messages });
  console.log(`Météo de ${target} : ${bulletin}`, stats);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, svg);
  const ownBranch = isSelf ? defaultBranch : (await gh(`/repos/${owner}/${repo}`)).default_branch;
  const changed = commit && (await commitBadge(path, svg, commitMessage(weather, lang), ownBranch));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `weather=${weather}\nphrase=${bulletin}\npath=${path}\nchanged=${changed}\n`);
  }
}

/** Committe le badge s'il a changé. Renvoie true si un commit a été fait. */
async function commitBadge(path, svg, defaultMessage, defaultBranch) {
  const branch = input('branch', defaultBranch);
  const file = `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const current = await gh(`${file}?ref=${encodeURIComponent(branch)}`, { allow404: true });
  const content = Buffer.from(svg).toString('base64');
  if (current?.content?.replace(/\n/g, '') === content) {
    console.log('Badge inchangé, rien à committer');
    return false;
  }
  const message = input('commit-message', defaultMessage);
  await gh(file, { method: 'PUT', body: JSON.stringify({ message, content, branch, sha: current?.sha }) });
  console.log(`${path} committé sur ${branch}`);
  return true;
}

main().catch((error) => {
  console.log(`::error::${error.message}`);
  process.exit(1);
});
