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
    // Two theme-colors so the browser chrome matches before JS runs;
    // theme.js keeps the tag in step afterwards.
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFEFF" />',
    '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#222B36" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    '<meta name="apple-mobile-web-app-title" content="DrivePro" />',
    '<link rel="manifest" href="/manifest.json" />',
    '<link rel="icon" href="/favicon.ico" sizes="48x48" />',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    // Sizing the app with a viewport height unit does not survive mobile:
    // height:100% resolves against the large viewport (so the bottom hides
    // under a collapsing URL bar), and 100dvh is reported short of the web
    // view in an iOS standalone PWA, which leaves a dead band below the app.
    //
    // position:fixed + inset:0 sidesteps both: the root is laid out against
    // the layout viewport itself, so it fills whatever the browser or the
    // home-screen shell actually gives us, and follows it when that changes.
    // height:auto is required - an explicit height would beat `bottom:0`.
    // Comes after #expo-reset in the head, so it wins on equal specificity.
    '<style>',
    // Painted before the bundle loads, so the first frame is not a white
    // flash in dark mode or a black one in light.
    '      html,body{background:#FFFEFF}',
    '      @media (prefers-color-scheme: dark){html,body{background:#222B36}}',
    '      html,body{height:100%;overflow:hidden;overscroll-behavior:none}',
    '      #root{position:fixed;top:0;right:0;bottom:0;left:0;height:auto;display:flex}',
    '    </style>',
  ]
    .map((t) => `    ${t}`)
    .join('\n');
  html = html.replace('</head>', `${tags}\n  </head>`);
}

fs.writeFileSync(file, html);
console.log(before === html ? 'postexport: already up to date' : 'postexport: PWA head tags installed');
