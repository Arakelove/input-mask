class MaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaskError';
  }
}

type SymbolKind = 'A' | '0' | 'literal';

type SymbolNode = {
  type: 'symbol';
  kind: SymbolKind;
  value?: string;
  min: number;
  max: number;
};

type GroupNode = {
  type: 'group';
  alternatives: MaskNode[][];
};

type MaskNode = SymbolNode | GroupNode;

type ParsedMask = {
  fragments: MaskNode[][];
  separators: string[];
};

type ConsumeResult = {
  out: string;
  raw: string;
  pos: number;
  satisfied: boolean;
  advanced: number;
};

// буква или нет
const LETTER_RE = /[A-Za-z\u0400-\u04FF]/;
const DIGIT_RE = /\d/;

const Mask = {
  create(pattern: string) {
    const parsed = parseMask(pattern);

    return {
      format(value: unknown): string {
        return formatValue(parsed, value).masked;
      },
    };
  },
};

function parseMask(pattern: string): ParsedMask {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    fail('Pattern must be a non-empty string');
  }

  const { fragments: rawFragments, separators } = splitBySeparators(pattern);
  const fragments = rawFragments.map(parseFragment);

  return { fragments, separators };
}

function splitBySeparators(pattern: string): { fragments: string[]; separators: string[] } {
  const fragments: string[] = [];
  const separators: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    const next = pattern[i + 1];

    if (ch === '[' && next === '[') {
      depth += 1;
      current += '[[';
      i += 1;
      continue;
    }

    if (ch === ']' && next === ']') {
      if (depth === 0) {
        fail('Unmatched closing group "]]"');
      }
      depth -= 1;
      current += ']]';
      i += 1;
      continue;
    }

    if (ch === ':' && depth === 0) {
      const end = pattern.indexOf(':', i + 1);
      if (end === -1) {
        fail('Separator must be closed with ":"');
      }
      const sep = pattern.slice(i + 1, end);
      if (current.length === 0) {
        fail('Empty fragment before separator');
      }
      fragments.push(current);
      separators.push(sep);
      current = '';
      i = end;
      continue;
    }

    if (ch === ':' && depth > 0) {
      fail('Separators are not allowed inside groups');
    }

    current += ch;
  }

  if (depth !== 0) {
    fail('Unclosed group "[["');
  }

  if (current.length === 0) {
    fail('Empty fragment at end of pattern');
  }

  fragments.push(current);

  return { fragments, separators };
}

function parseFragment(fragment: string): MaskNode[] {
  const nodes: MaskNode[] = [];
  let i = 0;

  while (i < fragment.length) {
    const ch = fragment[i];
    const next = fragment[i + 1];

    if (ch === '[' && next === '[') {
      i += 2;
      const groupNode = parseGroup();
      if (fragment[i] === '{') {
        fail('Quantifiers cannot be applied to groups');
      }
      nodes.push(groupNode);
      continue;
    }

    if (ch === ']' || (ch === ']' && next === ']')) {
      fail('Unexpected closing bracket');
    }

    if (ch === '|') {
      fail('Unexpected "|" outside a group');
    }

    const node = makeSymbolNode(ch);
    i += 1;

    if (fragment[i] === '{') {
      const { min, max, nextIndex } = parseQuantifier(fragment, i + 1);
      node.min = min;
      node.max = max;
      i = nextIndex;
    }

    nodes.push(node);
  }

  return nodes;

  function parseGroup(): GroupNode {
    const alternatives: MaskNode[][] = [];
    let current: MaskNode[] = [];

    while (i < fragment.length) {
      const currentChar = fragment[i];
      const lookahead = fragment[i + 1];

      if (currentChar === ':' && lookahead !== undefined) {
        fail('Separators are not allowed inside groups');
      }

      if (currentChar === '[' && lookahead === '[') {
        i += 2;
        current.push(parseGroup());
        continue;
      }

      if (currentChar === '|' && i < fragment.length) {
        if (current.length === 0) {
          fail('Empty alternative in group');
        }
        alternatives.push(current);
        current = [];
        i += 1;
        continue;
      }

      if (currentChar === ']' && lookahead === ']') {
        if (current.length === 0) {
          fail('Empty alternative in group');
        }
        alternatives.push(current);
        i += 2;
        return { type: 'group', alternatives };
      }

      if (currentChar === ']' || currentChar === '{' || currentChar === '}') {
        fail(`Unexpected symbol "${currentChar}" in group`);
      }

      const node = makeSymbolNode(currentChar);
      i += 1;

      if (fragment[i] === '{') {
        const { min, max, nextIndex } = parseQuantifier(fragment, i + 1);
        node.min = min;
        node.max = max;
        i = nextIndex;
      }

      current.push(node);
    }

    fail('Unclosed group "[["');
  }
}

function parseQuantifier(fragment: string, startIndex: number): { min: number; max: number; nextIndex: number } {
  const end = fragment.indexOf('}', startIndex);
  if (end === -1) {
    fail('Unclosed quantifier');
  }

  const body = fragment.slice(startIndex, end);

  if (body.length === 0) {
    fail('Empty quantifier "{}" is invalid');
  }

  if (body === '+') {
    return { min: 1, max: Infinity, nextIndex: end + 1 };
  }

  if (!/^[1-9]\d*$/.test(body)) {
    fail(`Invalid quantifier "${body}"`);
  }

  const count = Number(body);
  return { min: count, max: count, nextIndex: end + 1 };
}

function makeSymbolNode(ch: string): SymbolNode {
  if (ch === ':' || ch === '{' || ch === '}' || ch === '|' || ch === ']') {
    fail(`Unexpected symbol "${ch}"`);
  }

  if (ch === '[') {
    fail('Unexpected "[" without pair');
  }

  const isLetter = ch === 'A';
  const isDigit = ch === '0';

  return {
    type: 'symbol',
    kind: isLetter ? 'A' : isDigit ? '0' : 'literal',
    value: isLetter || isDigit ? undefined : ch,
    min: 1,
    max: 1,
  };
}

function formatValue(parsed: ParsedMask, rawValue: unknown): { raw: string; masked: string } {
  const input = rawValue == null ? '' : String(rawValue);
  const { separators } = parsed;

  // Special fast-path: manual spaces between parts (e.g., holder). Only use when mask contains non-digit symbols.
  const separatorsAreSpaces = separators.length > 0 && separators.every((s) => s === ' ');
  const manualSpaceMask =
    separatorsAreSpaces && parsed.fragments.some((fragment) => hasNonDigitSymbol(fragment));
  if (manualSpaceMask) {
    const hasTrailingSpace = /\s$/.test(input);
    const parts = input.split(/\s+/).filter(Boolean);
    const fragmentsOut: string[] = [];
    const fragmentsRaw: string[] = [];
    for (let i = 0; i < parsed.fragments.length; i += 1) {
      const fragmentNodes = parsed.fragments[i];
      const valuePart = parts[i] ?? '';
      const result = consumeNodes(fragmentNodes, valuePart, 0, []);
      fragmentsOut.push(result.out);
      fragmentsRaw.push(result.raw);
      if (!result.satisfied) break;
    }
    let masked = fragmentsOut.join(' ');
    if (hasTrailingSpace) {
      masked = masked.replace(/\s+$/, ' ');
    } else {
      masked = masked.trimEnd();
    }
    return {
      raw: fragmentsRaw.join(''),
      masked,
    };
  }

  const fragmentsOut: string[] = [];
  const fragmentsRaw: string[] = [];
  const sepList = separators.filter(Boolean).sort((a, b) => b.length - a.length);
  let pos = 0;

  for (let i = 0; i < parsed.fragments.length; i += 1) {
    const fragmentNodes = parsed.fragments[i];
    const tail = parsed.fragments[i + 1];
    const result = consumeNodes(fragmentNodes, input, pos, sepList, tail);
    fragmentsOut.push(result.out);
    fragmentsRaw.push(result.raw);
    pos = result.pos;

    if (!result.satisfied) {
      break;
    }
  }

  return {
    raw: fragmentsRaw.join(''),
    masked: joinWithSeparators(fragmentsOut, separators),
  };
}

function hasNonDigitSymbol(nodes: MaskNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'symbol') {
      if (node.kind !== '0') return true;
      continue;
    }
    if (node.type === 'group') {
      for (const alt of node.alternatives) {
        if (hasNonDigitSymbol(alt)) return true;
      }
    }
  }
  return false;
}

function consumeNodes(
  nodes: MaskNode[],
  input: string,
  startPos: number,
  separators: string[],
  tailNodes?: MaskNode[]
): ConsumeResult {
  let out = '';
  let raw = '';
  let pos = startPos;
  let satisfied = true;

  for (let i = 0; i < nodes.length; i += 1) {
    // Skip separators that may precede the next node.
    let sepAhead = separatorLengthAt(input, pos, separators);
    while (sepAhead > 0) {
      pos += sepAhead;
      sepAhead = separatorLengthAt(input, pos, separators);
    }

    const node = nodes[i];
    const remaining = nodes.slice(i + 1);
    const lookahead = tailNodes && tailNodes.length ? remaining.concat(tailNodes) : remaining;
    const result = consumeNode(node, input, pos, separators, lookahead);
    out += result.out;
    raw += result.raw;
    pos = result.pos;
    if (!result.satisfied) {
      satisfied = false;
      break;
    }
  }

  return {
    out,
    raw,
    pos,
    satisfied,
    advanced: pos - startPos,
  };
}

function consumeNode(
  node: MaskNode,
  input: string,
  startPos: number,
  separators: string[],
  remainingNodes?: MaskNode[]
): ConsumeResult {
  if (node.type === 'symbol') {
    return consumeSymbol(node, input, startPos, separators, remainingNodes);
  }

  if (node.type === 'group') {
    return consumeGroup(node, input, startPos, separators, remainingNodes);
  }

  return { out: '', raw: '', pos: startPos, satisfied: false, advanced: 0 };
}

function consumeSymbol(
  node: SymbolNode,
  input: string,
  startPos: number,
  separators: string[],
  remainingNodes?: MaskNode[]
): ConsumeResult {
  let out = '';
  let raw = '';
  let pos = startPos;
  let count = 0;

  while (pos < input.length && count < node.max) {
    const sepLen = separatorLengthAt(input, pos, separators);
    if (sepLen > 0) {
      return {
        out,
        raw,
        pos: pos + sepLen,
        satisfied: count >= node.min,
        advanced: pos - startPos,
      };
    }

    const ch = input[pos];
    if (matchesNode(node, ch)) {
      out += ch;
      raw += ch;
      count += 1;
    } else if (count >= node.min && canStartWithChar(remainingNodes, ch)) {
      break;
    }
    pos += 1;
  }

  return {
    out,
    raw,
    pos,
    satisfied: count >= node.min,
    advanced: pos - startPos,
  };
}

function consumeGroup(
  node: GroupNode,
  input: string,
  startPos: number,
  separators: string[],
  tailNodes?: MaskNode[]
): ConsumeResult {
  let best: ConsumeResult = { out: '', raw: '', pos: startPos, satisfied: false, advanced: 0 };

  for (const alt of node.alternatives) {
    const result = consumeNodes(alt, input, startPos, separators, tailNodes);
    const better =
      result.raw.length > best.raw.length ||
      (result.raw.length === best.raw.length && result.advanced < best.advanced) ||
      (result.raw.length === best.raw.length &&
        result.advanced === best.advanced &&
        result.satisfied &&
        !best.satisfied);

    if (better) {
      best = result;
    }
  }

  return best;
}

function canStartWithChar(nodes: MaskNode[] | undefined, ch: string): boolean {
  if (!nodes || nodes.length === 0) return false;
  const first = nodes[0];

  if (first.type === 'symbol') {
    return matchesNode(first, ch);
  }

  if (first.type === 'group') {
    for (const alt of first.alternatives) {
      if (canStartWithChar(alt, ch)) return true;
    }
    return false;
  }

  return false;
}

function separatorLengthAt(input: string, pos: number, separators: string[]): number {
  for (const sep of separators) {
    if (!sep) continue;
    if (input.startsWith(sep, pos)) return sep.length;
  }
  return 0;
}

function joinWithSeparators(fragmentOutputs: string[], separators: string[]): string {
  let output = '';

  for (let i = 0; i < fragmentOutputs.length; i += 1) {
    const part = fragmentOutputs[i];
    if (!part) break;
    output += part;

    if (i < separators.length) {
      const nextPart = fragmentOutputs[i + 1];
      if (nextPart) {
        output += separators[i];
      }
    }
  }

  return output;
}

function matchesNode(node: SymbolNode, ch: string): boolean {
  if (node.kind === 'A') {
    return LETTER_RE.test(ch);
  }

  if (node.kind === '0') {
    return DIGIT_RE.test(ch);
  }

  return ch === node.value;
}

function logError(message: string): void {
  if (typeof console !== 'undefined' && console.error) {
    console.error(`[Mask] ${message}`);
  }
}

function fail(message: string): never {
  logError(message);
  throw new MaskError(message);
}

declare const module: { exports?: unknown } | undefined;

if (typeof window !== 'undefined') {
  (window as typeof window & { Mask?: typeof Mask }).Mask = Mask;
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = { Mask, MaskError };
}
