// Plural category selection, kept free of React Native imports so it can be
// unit-tested directly by server/tests/smoke24.mjs.
//
// Keys that change with a count are stored as `key.one` / `.few` / `.many`;
// i18n's t() picks the variant from params.n using these rules.
//
//   en  1 -> one, everything else -> many
//   ru  1, 21, 31 … -> one;  2-4, 22-24 … -> few;  the rest -> many
//       (11-14 are `many` despite ending in 1-4)
//   kk  a noun after a numeral stays singular ("2 тапсырыс"), so one form
//       covers every count and only `key.one` needs to exist.

export const PLURAL_RULES = {
  en: (n) => (n === 1 ? 'one' : 'many'),
  kk: () => 'one',
  ru: (n) => {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return 'many';
    if (last === 1) return 'one';
    if (last >= 2 && last <= 4) return 'few';
    return 'many';
  },
};

export function pluralCategory(lang, n) {
  const rule = PLURAL_RULES[lang] || PLURAL_RULES.en;
  const num = Number(n);
  return rule(Number.isFinite(num) ? num : 0);
}
