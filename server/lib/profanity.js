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

const badWords = new Set([
  ...loadWordlist('engbadwords.txt'),
  ...loadWordlist('dhibadwords.txt'),
]);

// Normalize: lowercase, collapse repeated chars, strip separators
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[\s.*_\-]/g, '')       // strip separators
    .replace(/(.)\1+/g, '$1');       // collapse repeated chars (fuuuck → fuck)
}

function containsProfanity(...texts) {
  for (const text of texts) {
    if (!text || typeof text !== 'string') continue;
    const normalized = normalize(text);
    for (const word of badWords) {
      if (normalized.includes(word)) return true;
    }
  }
  return false;
}

module.exports = { containsProfanity };
