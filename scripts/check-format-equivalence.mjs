// Usage: node scripts/check-format-equivalence.mjs <gitRef> <file>...   (run from repo root)
// Proves formatting-only changes: parses <gitRef>:<file> and the working file,
// drops positions/raw text/redundant parentheses, normalizes JSX whitespace the
// way React's JSX transform does, and requires the trees to be identical.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseAst} from 'rolldown/parseAst';

const [ref, ...files] = process.argv.slice(2);
const DROP = new Set(['start', 'end', 'range', 'loc', 'raw', 'comments', 'hashbang']);

// Babel/React JSX text cleaning (cleanJSXElementLiteralChild).
function cleanJsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let last = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) last = i;
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, ' ');
    if (i !== 0) line = line.replace(/^[ ]+/, '');
    if (i !== lines.length - 1) line = line.replace(/[ ]+$/, '');
    if (line) {
      if (i !== last) line += ' ';
      out += line;
    }
  }
  return out;
}
function jsxChildren(children) {
  const out = [];
  const pushText = text => {
    if (!text) return;
    const prev = out.at(-1);
    if (prev && prev.type === '#text') prev.value += text;
    else out.push({type: '#text', value: text});
  };
  for (const child of children) {
    if (child.type === 'JSXText') {
      pushText(cleanJsxText(child.value));
      continue;
    }
    if (child.type === 'JSXExpressionContainer') {
      let e = child.expression;
      while (e && e.type === 'ParenthesizedExpression') e = e.expression;
      if (e && e.type === 'Literal' && typeof e.value === 'string') {
        pushText(e.value);
        continue;
      }
      if (e && e.type === 'JSXEmptyExpression') continue;
    }
    out.push(norm(child));
  }
  return out;
}
function norm(node) {
  if (Array.isArray(node)) return node.filter(n => n?.type !== 'EmptyStatement').map(norm);
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'ParenthesizedExpression') return norm(node.expression);
  // ?? || && are associative with identical left-to-right short-circuit order: compare as flat chains.
  if (node.type === 'LogicalExpression') {
    const operands = [];
    const collect = e => {
      while (e && e.type === 'ParenthesizedExpression') e = e.expression;
      if (e.type === 'LogicalExpression' && e.operator === node.operator) {
        collect(e.left);
        collect(e.right);
      } else operands.push(norm(e));
    };
    collect(node);
    return {type: 'LogicalChain', operator: node.operator, operands};
  }
  const out = {};
  for (const key of Object.keys(node).sort()) {
    if (DROP.has(key)) continue;
    if (key === 'children' && (node.type === 'JSXElement' || node.type === 'JSXFragment')) {
      out.children = jsxChildren(node.children);
      continue;
    }
    if (node.type === 'TemplateElement' && key === 'value') {
      out.value = {cooked: node.value.cooked};
      continue;
    }
    out[key] = norm(node[key]);
  }
  return out;
}
function parse(text, file) {
  const lang = file.endsWith('.jsx') ? 'jsx' : 'js';
  return norm(parseAst(text, {lang, sourceType: file.endsWith('.cjs') ? 'script' : 'module'}).body);
}
function firstDiff(a, b, path = '$') {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return path;
  if (!a || typeof a !== 'object')
    return a === b ? null : path + ` (${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)})`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
let bad = 0;
for (const file of files) {
  const before = execFileSync('git', ['show', `${ref}:${file}`], {encoding: 'utf8', maxBuffer: 64 << 20});
  const after = readFileSync(file, 'utf8');
  let d;
  try {
    d = firstDiff(parse(before, file), parse(after, file));
  } catch (e) {
    d = 'PARSE ERROR ' + e.message;
  }
  if (d) {
    bad++;
    console.log('DIFF', file, d.slice(0, 300));
  }
}
console.log(`${files.length - bad}/${files.length} files equivalent`);
process.exit(bad ? 1 : 0);
