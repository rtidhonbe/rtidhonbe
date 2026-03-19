'use strict';

const fs   = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');

function loadWordlist(filename) {
  try {
    return fs.readFileSync(path.join(dataDir, filename), 'utf8')
      .split('\n')
      .map(w => w.trim().toLowerCase())
      .filter(Boolean);
  } catch { return []; }
}

const allWords = [
  ...loadWordlist('engbadwords.txt'),
  ...loadWordlist('dhibadwords.txt'),
];

// Build regex: match whole words, case-insensitive
// Catches basic evasion: repeated chars (fuuuck), separators between letters (f.u.c.k)
const patterns = allWords.map(word => {
  const flexed = word.split('').map(ch => {
    const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `${escaped}+`;
  }).join('[\\s.*_-]*');
  return flexed;
});

const profanityRegex = new RegExp(`(?:^|\\b|\\s)(${patterns.join('|')})(?:\\b|\\s|$)`, 'i');

function containsProfanity(...texts) {
  for (const text of texts) {
    if (!text || typeof text !== 'string') continue;
    if (profanityRegex.test(text)) return true;
  }
  return false;
}

module.exports = { containsProfanity };
