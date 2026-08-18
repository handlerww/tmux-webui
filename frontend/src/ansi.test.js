import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAnsiLines } from './ansi.js';

test('parses basic ANSI foreground colors and resets', () => {
  const [line] = parseAnsiLines('plain \u001b[31mred\u001b[0m end\n');
  assert.deepEqual(line.segments.map(({ text, style }) => ({ text, style })), [
    { text: 'plain ', style: {} },
    { text: 'red', style: { color: 'var(--ansi-red)' } },
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
  assert.equal(lines[0].segments[0].style.color, 'var(--ansi-green)');
  assert.equal(lines[1].segments[0].style.color, 'var(--ansi-green)');
  assert.deepEqual(lines[2].segments[0].style, {});
});

test('uses theme-aware colors for inverse text', () => {
  const [line] = parseAnsiLines('\u001b[7minverse');
  assert.deepEqual(line.segments[0].style, {
    color: 'var(--reader-bg)',
    backgroundColor: 'var(--reader-fg)',
  });
});

test('keeps output text as data instead of HTML', () => {
  const [line] = parseAnsiLines('\u001b[1m<script>alert(1)</script>');
  assert.equal(line.segments[0].text, '<script>alert(1)</script>');
  assert.equal(line.segments[0].style.fontWeight, '700');
});

test('parses OSC 8 hyperlinks terminated by ST or BEL', () => {
  const docs = 'https://docs.datadoghq.com/account_management/billing/usage_metrics/';
  const [line] = parseAnsiLines([
    `\u001b]8;;${docs}\u001b\\Datadog\u001b]8;;\u001b\\`,
    ' and ',
    `\u001b]8;id=usage;${docs}\u0007Estimated Usage\u001b]8;;\u0007`,
  ].join(''));

  assert.deepEqual(line.segments.map(({ text, href = '' }) => ({ text, href })), [
    { text: 'Datadog', href: docs },
    { text: ' and ', href: '' },
    { text: 'Estimated Usage', href: docs },
  ]);
});

test('strips unsupported OSC controls and rejects unsafe hyperlink protocols', () => {
  const [line] = parseAnsiLines('\u001b]0;window title\u0007before \u001b]8;;javascript:alert(1)\u001b\\unsafe\u001b]8;;\u001b\\ after');

  assert.deepEqual(line.segments.map(({ text, href = '' }) => ({ text, href })), [
    { text: 'before unsafe after', href: '' },
  ]);
});
