// Usage: node scripts/check-format-equivalence.mjs <gitRef> <file>...   (run from repo root)
// Proves formatting-only changes: parses <gitRef>:<file> and the working file,
// drops positions and literal quote style, normalizes JSX whitespace the
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
// `{' '}` containers merge into text only inside lowercase DOM elements, where React renders a
// string and adjacent strings identically; components could observe string vs array children.
function jsxChildren(children, mergeStrings) {
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
      const e = child.expression;
      if (mergeStrings && e.type === 'Literal' && typeof e.value === 'string') {
        pushText(e.value);
        continue;
      }
      if (e.type === 'JSXEmptyExpression') continue;
    }
    out.push(norm(child));
  }
  return out;
}
function norm(node) {
  if (Array.isArray(node)) return node.filter(n => n?.type !== 'EmptyStatement').map(norm);
  if (!node || typeof node !== 'object') return node;
  // ?? || && are associative with identical left-to-right short-circuit order: compare as flat chains.
  if (node.type === 'LogicalExpression') {
    const operands = [];
    const collect = e => {
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
      const tag = node.openingElement?.name;
      out.children = jsxChildren(node.children, tag?.type === 'JSXIdentifier' && /^[a-z]/.test(tag.name));
      continue;
    }
    if (node.type === 'TemplateElement' && key === 'value') {
      out.value = {raw: node.value.raw, cooked: node.value.cooked};
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
let bad = 0,
  added = 0;
for (const file of files) {
  let before;
  try {
    before = execFileSync('git', ['show', `${ref}:${file}`], {encoding: 'utf8', maxBuffer: 64 << 20, stdio: 'pipe'});
  } catch {
    added++;
    console.log('NEW', file, '(not in', ref + ', not compared)');
    continue;
  }
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
console.log(`${files.length - added - bad}/${files.length - added} files equivalent, ${bad} differ, ${added} new`);
process.exit(bad ? 1 : 0);
