module.exports = {
  parserPreset: {
    parserOpts: {
      headerPattern: /^(L\d+) (.+)$/,
      headerCorrespondence: ['type', 'subject'],
    },
  },
  plugins: [{ rules: {
    'sole-owner': parsed => [
      !/^\s*(?:co-authored(?:-by)?|contributed-by|contributors?|authored-by|assisted-by|generated-by|ai-(?:assisted|generated)-by|signed-off-by|reviewed-by|tested-by|claude-session):/im.test(parsed.raw)
        && !/\b(?:generated|written|created|assisted)\s+(?:by|with)\s+(?:chatgpt|codex|openai|claude|an?\s+ai\s+(?:tool|assistant|model))\b/i.test(parsed.raw),
      'Use the owner alone; omit attribution and session trailers',
    ],
  }}],
  rules: {
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
    'body-empty': [2, 'never'],
    'body-leading-blank': [2, 'always'],
    'body-max-line-length': [2, 'always', 100],
    'sole-owner': [2, 'always'],
  },
};
