// Badges de référence : affichés dans le README et comparés octet par octet par les tests.
export const CASES = [
  { file: 'sunny.svg', weather: 'sunny', stats: { ci: 'passing', issues: 0, blocked: 0 } },
  { file: 'cloudy.svg', weather: 'cloudy', stats: { ci: 'passing', issues: 4, blocked: 0 } },
  { file: 'rainy.svg', weather: 'rainy', stats: { ci: 'failing', issues: 4, blocked: 0 } },
  { file: 'stormy.svg', weather: 'stormy', stats: { ci: 'failing', issues: 4, blocked: 2 } },
  { file: 'stormy-dark.svg', weather: 'stormy', stats: { ci: 'failing', issues: 4, blocked: 2 }, options: { theme: 'dark' } },
  {
    file: 'rainy-static-en.svg',
    weather: 'rainy',
    stats: { ci: 'failing', issues: 12, blocked: 0 },
    options: { lang: 'en', animated: false },
  },
  { file: 'pill-sunny.svg', weather: 'sunny', stats: { ci: 'passing', issues: 0, blocked: 0 }, options: { style: 'pill' } },
  { file: 'pill-stormy.svg', weather: 'stormy', stats: { ci: 'failing', issues: 4, blocked: 2 }, options: { style: 'pill' } },
  {
    file: 'pill-message.svg',
    weather: 'cloudy',
    stats: { ci: 'passing', issues: 7, blocked: 0 },
    options: { style: 'pill', messages: { cloudy: '{issues} issues à trier & classer' } },
  },
];
