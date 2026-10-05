import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const main=readFileSync(new URL('../frontend/main.jsx',import.meta.url),'utf8');
const component=readFileSync(new URL('../frontend/response-annotations.jsx',import.meta.url),'utf8');

test('selection toolbar reuses assistant-ui Root and does not wrap or hide messages',()=>{
  assert.match(main,/import \{[^}]*SelectionToolbarPrimitive[^}]*\} from '@assistant-ui\/react'/);
  const start=main.indexOf('function SelectionToolbarAction'),end=main.indexOf('function WorkProgress');
  assert.ok(start>=0&&end>start);
  const button=main.slice(start,end);
  assert.match(button,/<SelectionToolbarPrimitive\.Root/);
  assert.match(button,/aria-label="加入聊天"/);
  assert.doesNotMatch(button,/ThreadPrimitive\.Messages/);
  assert.match(main,/<AddResponseSelectionButton[^>]*\/><div className="viewport-region"><ThreadPrimitive\.Viewport[\s\S]*?<ThreadPrimitive\.Messages/);
});

test('only complete assistant response text is marked quote-selectable; user and worker messages are excluded',()=>{
  assert.match(main,/data-aui-quote-selectable=\{quoteable\?'true':'false'\}/);
  assert.match(main,/className="message user-message" data-aui-quote-selectable="false"/);
  assert.match(main,/className="message worker-event" data-aui-quote-selectable="false"/);
  assert.match(main,/source\?\.role!=='assistant'\|\|source\.partial\|\|source\.streaming/);
});

test('selection comment popover and composer annotation list are mutually exclusive; outside and Escape dismiss the list',()=>{
  assert.match(component,/data-response-comment-popover="true"/);
  assert.match(component,/aria-label=\{responseQuoteCountLabel\(quotes\.length\)\}/);
  assert.match(component,/if\(!quotes\?\.length\|\|collapse\)setExpanded\(false\)/);
  const quotes=component.slice(component.indexOf('export function ResponseQuotes'),component.indexOf('export function ResponseSelectionPopover'));
  assert.match(quotes,/addEventListener\('pointerdown',outside,true\)/);
  assert.match(quotes,/removeEventListener\('pointerdown',outside,true\)/);
  assert.match(quotes,/if\(event\.key==='Escape'\)\{event\.preventDefault\(\);setExpanded\(false\);\}/);
  assert.doesNotMatch(component,/response-quotes-actions|aria-label="送出引用與註解"/);
  assert.match(main,/setQuotePopover\(\{mode:'comment',quoteId:quote\.id,range,rect:range\.getBoundingClientRect\(\)\}\)/);
  assert.match(main,/<ResponseSelectionPopover selection=\{quotePopover\}/);
  assert.match(main,/<ResponseQuotes[^>]*collapse=\{!!quotePopover\}/);
});
