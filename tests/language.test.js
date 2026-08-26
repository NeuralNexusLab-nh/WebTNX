const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'site.js'), 'utf8');

function detectLanguage({ languages = [], stored = null, account = '', storageUnavailable = false } = {}) {
  let ready;
  const documentElement = { lang: 'en', dataset: { accountLanguage: account } };
  const document = {
    documentElement,
    body: { appendChild() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') ready = callback; },
    dispatchEvent() {}
  };
  const localStorage = {
    getItem() {
      if (storageUnavailable) throw new Error('storage blocked');
      return stored;
    },
    setItem() {
      if (storageUnavailable) throw new Error('storage blocked');
    }
  };
  const context = {
    document,
    localStorage,
    navigator: { languages, language: languages[0] || '' },
    IntersectionObserver: class { observe() {} },
    matchMedia: () => ({ matches: true }),
    CustomEvent: class {},
    setTimeout,
    addEventListener() {}
  };
  context.window = context;
  vm.runInNewContext(source, context);
  ready();
  return documentElement.lang;
}

test('uses Traditional Chinese from browser preferences when no setting exists', () => {
  assert.equal(detectLanguage({ languages: ['zh-Hant-TW', 'en-US'] }), 'zh-TW');
});

test('continues browser language detection when localStorage is unavailable', () => {
  assert.equal(detectLanguage({ languages: ['zh-TW'], storageUnavailable: true }), 'zh-TW');
});

test('uses the first supported language in the browser preference list', () => {
  assert.equal(detectLanguage({ languages: ['ja-JP', 'en-GB', 'zh-TW'] }), 'en');
});

test('account and stored settings take precedence over browser preferences', () => {
  assert.equal(detectLanguage({ languages: ['zh-TW'], stored: 'en' }), 'en');
  assert.equal(detectLanguage({ languages: ['en-US'], stored: 'en', account: 'zh-Hant' }), 'zh-TW');
});

