# Repo Weather

![Météo du dépôt](.github/repo-weather.svg)

Une GitHub Action qui transforme l'état de ton dépôt en bulletin météo, sous forme de badge SVG à afficher dans ton README.

| Ensoleillé | Nuageux | Pluvieux | Orageux |
| --- | --- | --- | --- |
| ![Ensoleillé](examples/sunny.svg) | ![Nuageux](examples/cloudy.svg) | ![Pluvieux](examples/rainy.svg) | ![Orageux](examples/stormy.svg) |

Le badge suit le thème clair ou sombre de GitHub. Les icônes sont légèrement animées (soleil qui tourne, pluie qui tombe, éclairs), sauf si le lecteur a demandé à réduire les animations.

## Comment la météo est calculée

La condition la plus grave l'emporte :

| Météo | Condition |
| --- | --- |
| Orageux | Au moins une PR bloquée |
| Pluvieux | La CI échoue sur la branche par défaut |
| Nuageux | Il reste des issues ouvertes (au-delà de `issues-threshold`) |
| Ensoleillé | Tout va bien |

- **CI** : pour chaque workflow, le dernier run terminé sur la branche par défaut. Les runs annulés ou ignorés ne comptent pas, et le workflow qui génère le badge ne se juge pas lui-même.
- **PR bloquée** : une PR ouverte, hors brouillon, qui est en conflit, qui a reçu une demande de modifications, ou qui n'a pas bougé depuis `stale-days` jours.

## Utilisation

Crée `.github/workflows/weather.yml` :

```yaml
name: Météo du dépôt

on:
  schedule:
    - cron: '0 */6 * * *'
  issues:
    types: [opened, closed, reopened]
  workflow_run:
    workflows: [Tests] # le nom de ton workflow de CI
    types: [completed]
  workflow_dispatch:

permissions:
  contents: write
  actions: read
  issues: read
  pull-requests: read

concurrency:
  group: repo-weather

jobs:
  weather:
    runs-on: ubuntu-latest
    steps:
      - uses: Kaysuto/repo-weather@v1
```

Puis ajoute le badge à ton README :

```markdown
![Météo du dépôt](.github/repo-weather.svg)
```

L'Action committe le badge seulement quand il change, avec `[skip ci]` dans le message.

## Paramètres

| Nom | Défaut | Description |
| --- | --- | --- |
| `token` | `github.token` | Jeton utilisé pour lire le dépôt et committer le badge |
| `path` | `.github/repo-weather.svg` | Chemin du badge dans le dépôt |
| `stale-days` | `14` | Jours sans activité avant qu'une PR compte comme bloquée |
| `issues-threshold` | `0` | Issues ouvertes tolérées avant le temps nuageux |
| `lang` | `fr` | Langue du badge : `fr` ou `en` |
| `commit` | `true` | `false` pour seulement écrire le fichier (à publier toi-même) |
| `branch` | branche par défaut | Branche où committer le badge |

Sorties : `weather` (`sunny`, `cloudy`, `rainy`, `stormy`) et `path`.

## Limites

- Seules les 100 PR ouvertes les plus récentes sont examinées.
- Si la branche par défaut est protégée, le jeton par défaut ne peut pas y committer : utilise `branch` pour viser une autre branche, ou `commit: false` et publie le fichier toi-même.

## Développement

Aucune dépendance, Node 24 suffit :

```bash
npm test
```

```bash
npm run examples
```

## Licence

[MIT](LICENSE)
