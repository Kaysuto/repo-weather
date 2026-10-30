import { appendFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LANGS, ciState, commitMessage, countBlocked, pickWeather, renderSvg } from './weather.js';

const input = (name, fallback) => process.env[`INPUT_${name.toUpperCase()}`]?.trim() || fallback;

function number(name, fallback) {
  const value = Number(input(name, fallback));
  if (!Number.isFinite(value) || value < 0) throw new Error(`Input "${name}" must be a positive number`);
  return value;
}

const token = input('token');
const path = input('path', '.github/repo-weather.svg').replace(/^\.\//, '');
const staleDays = number('stale-days', '14');
const issuesThreshold = number('issues-threshold', '0');
const lang = input('lang', 'fr');
const commit = input('commit', 'true') === 'true';
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
  if (!token) throw new Error('Input "token" is empty');
  if (!LANGS.includes(lang)) throw new Error(`Input "lang" must be one of: ${LANGS.join(', ')}`);

  const { data, errors } = await gh(process.env.GITHUB_GRAPHQL_URL ?? `${api}/graphql`, {
    method: 'POST',
    body: JSON.stringify({ query: QUERY, variables: { owner, name: repo } }),
  });
  if (errors) throw new Error(errors.map((e) => e.message).join('; '));
  const repository = data.repository;
  const defaultBranch = repository.defaultBranchRef?.name;
  if (!defaultBranch) throw new Error('Repository has no default branch yet (empty repository?)');

  const { workflow_runs: runs } = await gh(
    `/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(defaultBranch)}&exclude_pull_requests=true&per_page=100`,
  );
  // Le workflow qui exécute l'Action ne doit pas se juger lui-même : il est encore en cours, ou bouclerait sur son propre résultat.
  const ownPath = process.env.GITHUB_WORKFLOW_REF?.split('@')[0].slice(`${owner}/${repo}/`.length);
  const others = runs.filter((run) => run.path !== ownPath && String(run.id) !== process.env.GITHUB_RUN_ID);

  const stats = {
    ci: ciState(others),
    issues: repository.issues.totalCount,
    // raccourci : seules les 100 PR ouvertes les plus récentes sont examinées, paginer si un dépôt en a davantage.
    blocked: countBlocked(repository.pullRequests.nodes, staleDays, Date.now()),
  };
  const weather = pickWeather(stats, issuesThreshold);
  const svg = renderSvg(weather, stats, lang);
  console.log(`Weather: ${weather}`, stats);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, svg);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `weather=${weather}\npath=${path}\n`);
  if (!commit) return;

  const branch = input('branch', defaultBranch);
  const file = `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const current = await gh(`${file}?ref=${encodeURIComponent(branch)}`, { allow404: true });
  const content = Buffer.from(svg).toString('base64');
  if (current?.content?.replace(/\n/g, '') === content) {
    console.log('Badge unchanged, nothing to commit');
    return;
  }
  await gh(file, {
    method: 'PUT',
    body: JSON.stringify({ message: commitMessage(weather, lang), content, branch, sha: current?.sha }),
  });
  console.log(`Committed ${path} on ${branch}`);
}

main().catch((error) => {
  console.log(`::error::${error.message}`);
  process.exit(1);
});
