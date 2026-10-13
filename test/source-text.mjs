import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';

// Source-shape checks were written against K's former dense one-line style. The formatter now
// adds whitespace around punctuation; collapse it so the same patterns keep checking the same code.
// Keep the single space a dense source also had between `}` and a following word (JSX
// attributes, `} from`), except before else/catch/finally, which dense code wrote as `}else`.
export const compactSource = text =>
  text
    .replace(/\s+/g, ' ')
    .replace(/ ?([=(){}[\];,:?<>+\-*/&|!.]) ?/g, '$1')
    .replace(/\}(?=[A-Za-z_$])/g, '} ')
    .replace(/\} (else|catch|finally)\b/g, '}$1')
    .replace(/\bimport\{/g, 'import {');
export const readSource = async url => compactSource(await readFile(url, 'utf8'));
export const readSourceSync = url => compactSource(readFileSync(url, 'utf8'));

// The arrow/function expression assigned by `const <name> = ...`, found by matching braces
// (strings, templates and comments skipped), independent of line breaks.
export function functionInitializer(source, name) {
  const declaration = source.match(new RegExp(`const ${name}\\s*=\\s*`));
  if (!declaration) throw Error(`const ${name} not found`);
  const start = declaration.index + declaration[0].length;
  let i = source.indexOf('{', source.indexOf('=>', start));
  for (let depth = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++;
    } else if (c === '/' && source[i + 1] === '/') i = source.indexOf('\n', i);
    else if (c === '/' && source[i + 1] === '*') i = source.indexOf('*/', i) + 1;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw Error(`const ${name} has no closing brace`);
}
