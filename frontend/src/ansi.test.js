import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAnsiLines } from './ansi.js';

test('parses basic ANSI foreground colors and resets', () => {
  const [line] = parseAnsiLines('plain \u001b[31mred\u001b[0m end\n');
  assert.deepEqual(line.segments.map(({ text, style }) => ({ text, style })), [
    { text: 'plain ', style: {} },
    { text: 'red', style: { color: '#bd4b3f' } },
    { text: ' end', style: {} },
  ]);
});

test('supports indexed and RGB colors', () => {
  const [line] = parseAnsiLines('\u001b[38;5;196mindexed \u001b[48;2;12;34;56mbackground');
  assert.equal(line.segments[0].style.color, 'rgb(255, 0, 0)');
  assert.equal(line.segments[1].style.backgroundColor, 'rgb(12, 34, 56)');
});

test('preserves active styles across captured lines', () => {
  const lines = parseAnsiLines('\u001b[32mfirst\nsecond\u001b[0m\nplain');
  assert.equal(lines[0].segments[0].style.color, '#5d7e5a');
  assert.equal(lines[1].segments[0].style.color, '#5d7e5a');
  assert.deepEqual(lines[2].segments[0].style, {});
});

test('keeps output text as data instead of HTML', () => {
  const [line] = parseAnsiLines('\u001b[1m<script>alert(1)</script>');
  assert.equal(line.segments[0].text, '<script>alert(1)</script>');
  assert.equal(line.segments[0].style.fontWeight, '700');
});
