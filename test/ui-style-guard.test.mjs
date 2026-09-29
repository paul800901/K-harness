import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const frontend = path.resolve('frontend');
const cssFiles = fs.readdirSync(frontend).filter((name) => name.endsWith('.css'));
const tokenFile = fs.readFileSync(path.join(frontend, 'tokens.css'), 'utf8');
const tokenNames = new Set(tokenFile.match(/--[\w-]+(?=\s*:)/g) ?? []);
const cssColorLiteral = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i;

test('frontend component CSS uses semantic colors and declared custom properties', () => {
  assert.ok(cssFiles.includes('tokens.css'), 'shared tokens.css must exist');
  for (const file of cssFiles.filter((name) => name !== 'tokens.css')) {
    const source = fs.readFileSync(path.join(frontend, file), 'utf8');
    assert.doesNotMatch(source, cssColorLiteral, `${file} must use palette tokens rather than literal colors`);
    for (const [, variable] of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const declaredLocally = new RegExp(`${variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(source);
      assert.ok(tokenNames.has(variable) || declaredLocally, `${file} references undefined ${variable}`);
    }
  }
});

test('frontend component CSS keeps typography on the shared scale', () => {
  for (const file of cssFiles.filter((name) => name !== 'tokens.css')) {
    const source = fs.readFileSync(path.join(frontend, file), 'utf8');
    for (const [, value] of source.matchAll(/font-size\s*:\s*([^;}]+)/gi)) {
      assert.match(value.trim(), /^(?:var\(--k-text-[\w-]+\)|var\(--k-dialogue-font-size\)|(?:\d*\.)?\d+em)$/i,
        `${file} has an unscaled font-size: ${value.trim()}`);
    }
    for (const [, value] of source.matchAll(/font-weight\s*:\s*([^;}]+)/gi)) {
      assert.ok(['400', '700'].includes(value.trim()), `${file} has unsupported font-weight: ${value.trim()}`);
    }
  }
});

test('JSX inline color styles do not hard-code palette values', () => {
  const jsxFiles = fs.readdirSync(frontend).filter((name) => /\.[jt]sx?$/.test(name));
  const namedColors = /^(?:black|white|red|green|blue|gray|grey|orange|purple|yellow|teal|navy|maroon)$/i;
  for (const file of jsxFiles) {
    const source = fs.readFileSync(path.join(frontend, file), 'utf8');
    for (const [, style] of source.matchAll(/style\s*=\s*\{\{([\s\S]*?)\}\}/g)) {
      for (const [, value] of style.matchAll(/(?:^|[,;])\s*(?:color|backgroundColor|borderColor|outlineColor)\s*:\s*([^,;}]+)/g)) {
        const literal = value.trim().replace(/^['"]|['"]$/g, '');
        assert.ok(!cssColorLiteral.test(literal) && !namedColors.test(literal),
          `${file} hard-codes an inline color: ${literal}`);
      }
    }
  }
});
