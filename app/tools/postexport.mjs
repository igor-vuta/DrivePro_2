#!/usr/bin/env node
// Post-processes app/dist/index.html after `npx expo export -p web`:
// RU document language, PWA manifest link, theme color, iOS install polish,
// favicon links and a no-flash dark background. Idempotent - run as often
// as you like. Zero dependencies.
//
// Usage: node tools/postexport.mjs   (from app/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');
let html = fs.readFileSync(file, 'utf8');
const before = html;

html = html.replace('<html lang="en">', '<html lang="ru">');
html = html.replace(
  'content="width=device-width, initial-scale=1, shrink-to-fit=no"',
  'content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"'
);

const MARK = '<!-- drivepro:pwa -->';
if (!html.includes(MARK)) {
  const tags = [
    MARK,
    '<meta name="theme-color" content="#06070d" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    '<meta name="apple-mobile-web-app-title" content="DrivePro" />',
    '<link rel="manifest" href="/manifest.json" />',
    '<link rel="icon" href="/favicon.ico" sizes="48x48" />',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<style>html,body{background:#06070d}</style>',
  ]
    .map((t) => `    ${t}`)
    .join('\n');
  html = html.replace('</head>', `${tags}\n  </head>`);
}

fs.writeFileSync(file, html);
console.log(before === html ? 'postexport: already up to date' : 'postexport: PWA head tags installed');
