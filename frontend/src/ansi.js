const ANSI_COLORS = [
  '#242824', '#bd4b3f', '#5d7e5a', '#9b7525',
  '#496f91', '#8a5d86', '#3d7d7a', '#e8e6df',
  '#6f746e', '#d76755', '#759a6e', '#bd9140',
  '#648aad', '#a675a1', '#58a09b', '#ffffff',
];

const SGR_PATTERN = /\u001b\[([0-9;:]*)m/g;

export function parseAnsiLines(content) {
  const rawLines = content.replaceAll('\r', '').split('\n');
  while (rawLines.length > 0 && rawLines.at(-1) === '') rawLines.pop();

  const state = defaultState();
  return rawLines.map((rawLine) => {
    const initialState = stateSignature(state);
    const segments = [];
    let offset = 0;
    SGR_PATTERN.lastIndex = 0;
    for (let match = SGR_PATTERN.exec(rawLine); match; match = SGR_PATTERN.exec(rawLine)) {
      appendSegment(segments, rawLine.slice(offset, match.index), state);
      applySgr(state, parseParameters(match[1]));
      offset = SGR_PATTERN.lastIndex;
    }
    appendSegment(segments, rawLine.slice(offset), state);
    return {
      key: `${initialState}\u0000${rawLine}`,
      segments,
    };
  });
}

function defaultState() {
  return {
    foreground: '',
    background: '',
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    hidden: false,
    strike: false,
  };
}

function parseParameters(value) {
  if (value === '') return [0];
  if (value.includes(':')) {
    return value.split(':').filter((part) => part !== '').map(Number);
  }
  return value.split(';').map((part) => (part === '' ? 0 : Number(part)));
}

function applySgr(state, parameters) {
  for (let index = 0; index < parameters.length; index += 1) {
    const code = parameters[index];
    if (code === 0) Object.assign(state, defaultState());
    else if (code === 1) state.bold = true;
    else if (code === 2) state.dim = true;
    else if (code === 3) state.italic = true;
    else if (code === 4) state.underline = true;
    else if (code === 7) state.inverse = true;
    else if (code === 8) state.hidden = true;
    else if (code === 9) state.strike = true;
    else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) state.italic = false;
    else if (code === 24) state.underline = false;
    else if (code === 27) state.inverse = false;
    else if (code === 28) state.hidden = false;
    else if (code === 29) state.strike = false;
    else if (code >= 30 && code <= 37) state.foreground = ANSI_COLORS[code - 30];
    else if (code === 39) state.foreground = '';
    else if (code >= 40 && code <= 47) state.background = ANSI_COLORS[code - 40];
    else if (code === 49) state.background = '';
    else if (code >= 90 && code <= 97) state.foreground = ANSI_COLORS[code - 90 + 8];
    else if (code >= 100 && code <= 107) state.background = ANSI_COLORS[code - 100 + 8];
    else if (code === 38 || code === 48) {
      const color = readExtendedColor(parameters, index + 1);
      if (color.value) {
        if (code === 38) state.foreground = color.value;
        else state.background = color.value;
      }
      index += color.consumed;
    }
  }
}

function readExtendedColor(parameters, offset) {
  const mode = parameters[offset];
  if (mode === 5 && Number.isInteger(parameters[offset + 1])) {
    return { value: indexedColor(parameters[offset + 1]), consumed: 2 };
  }
  if (mode === 2 && parameters.slice(offset + 1, offset + 4).every(isColorChannel)) {
    const [red, green, blue] = parameters.slice(offset + 1, offset + 4);
    return { value: `rgb(${red}, ${green}, ${blue})`, consumed: 4 };
  }
  return { value: '', consumed: 0 };
}

function indexedColor(index) {
  if (index < 0 || index > 255) return '';
  if (index < 16) return ANSI_COLORS[index];
  if (index < 232) {
    const value = index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const red = levels[Math.floor(value / 36)];
    const green = levels[Math.floor((value % 36) / 6)];
    const blue = levels[value % 6];
    return `rgb(${red}, ${green}, ${blue})`;
  }
  const level = 8 + ((index - 232) * 10);
  return `rgb(${level}, ${level}, ${level})`;
}

function isColorChannel(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function appendSegment(segments, text, state) {
  if (!text) return;
  const signature = stateSignature(state);
  const previous = segments.at(-1);
  if (previous?.signature === signature) {
    previous.text += text;
    return;
  }
  segments.push({ text, signature, style: styleForState(state) });
}

function styleForState(state) {
  const style = {};
  let foreground = state.foreground;
  let background = state.background;
  if (state.inverse) {
    [foreground, background] = [background || '#fbfaf7', foreground || '#30332f'];
  }
  if (foreground) style.color = foreground;
  if (background) style.backgroundColor = background;
  if (state.bold) style.fontWeight = '700';
  if (state.dim) style.opacity = '0.65';
  if (state.italic) style.fontStyle = 'italic';
  const decorations = [];
  if (state.underline) decorations.push('underline');
  if (state.strike) decorations.push('line-through');
  if (decorations.length > 0) style.textDecorationLine = decorations.join(' ');
  if (state.hidden) style.color = 'transparent';
  return style;
}

function stateSignature(state) {
  return [
    state.foreground,
    state.background,
    Number(state.bold),
    Number(state.dim),
    Number(state.italic),
    Number(state.underline),
    Number(state.inverse),
    Number(state.hidden),
    Number(state.strike),
  ].join('|');
}
