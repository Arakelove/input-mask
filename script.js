class MaskError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MaskError';
  }
}

const Mask = {
  create(pattern) {
    const parsed = parseMask(pattern);

    return {
      format(value) {
        const source = value == null ? '' : String(value);
        return formatValue(parsed, source);
      },
    };
  },
};

function parseMask(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new MaskError('Pattern must be a non-empty string');
  }

  const { fragments: rawFragments, separators } = splitBySeparators(pattern);
  const fragments = rawFragments.map(parseFragment);

  return { fragments, separators };
}

function splitBySeparators(pattern) {
  const fragments = [];
  const separators = [];
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
        logError('Unmatched closing group "]]"');
        throw new MaskError('Unmatched closing group "]]"');
      }
      depth -= 1;
      current += ']]';
      i += 1;
      continue;
    }

    if (ch === ':' && depth === 0) {
      const end = pattern.indexOf(':', i + 1);
      if (end === -1) {
        logError('Separator must be closed with ":"');
        throw new MaskError('Separator must be closed with ":"');
      }
      const sep = pattern.slice(i + 1, end);
      fragments.push(current);
      separators.push(sep);
      current = '';
      i = end;
      continue;
    }

    if (ch === ':' && depth > 0) {
      logError('Separators are not allowed inside groups');
      throw new MaskError('Separators are not allowed inside groups');
    }

    current += ch;
  }

  if (depth !== 0) {
    logError('Unclosed group "[["');
    throw new MaskError('Unclosed group "[["');
  }

  fragments.push(current);

  return { fragments, separators };
}

function parseFragment(fragment) {
  const nodes = [];
  let i = 0;

  while (i < fragment.length) {
    const ch = fragment[i];
    const next = fragment[i + 1];

    if (ch === '[' && next === '[') {
      i += 2;
      const groupNode = parseGroup();
      // Quantifier after group is not allowed.
      if (fragment[i] === '{') {
        logError('Quantifiers cannot be applied to groups');
        throw new MaskError('Quantifiers cannot be applied to groups');
      }
      nodes.push(groupNode);
      continue;
    }

    if (ch === ']' || (ch === ']' && next === ']')) {
      logError('Unexpected closing bracket');
      throw new MaskError('Unexpected closing bracket');
    }

    if (ch === '|') {
      logError('Unexpected "|" outside a group');
      throw new MaskError('Unexpected "|" outside a group');
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

  function parseGroup() {
    const alternatives = [];
    let current = [];

    while (i < fragment.length) {
      const currentChar = fragment[i];
      const lookahead = fragment[i + 1];

      if (currentChar === ':' && lookahead !== undefined) {
        logError('Separators are not allowed inside groups');
        throw new MaskError('Separators are not allowed inside groups');
      }

      if (currentChar === '[' && lookahead === '[') {
        i += 2;
        current.push(parseGroup());
        continue;
      }

      if (currentChar === '|' && i < fragment.length) {
        alternatives.push(current);
        current = [];
        i += 1;
        continue;
      }

      if (currentChar === ']' && lookahead === ']') {
        alternatives.push(current);
        i += 2;
        return { type: 'group', alternatives };
      }

      if (currentChar === ']' || currentChar === '{' || currentChar === '}') {
        logError(`Unexpected symbol "${currentChar}" in group`);
        throw new MaskError(`Unexpected symbol "${currentChar}" in group`);
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

    logError('Unclosed group "[["');
    throw new MaskError('Unclosed group "[["');
  }
}

function parseQuantifier(fragment, startIndex) {
  const end = fragment.indexOf('}', startIndex);
  if (end === -1) {
    throw new MaskError('Unclosed quantifier');
  }

  const body = fragment.slice(startIndex, end);

  if (body.length === 0) {
    logError('Empty quantifier "{}" is invalid');
    throw new MaskError('Empty quantifier "{}" is invalid');
  }

  if (body === '+') {
    return { min: 1, max: Infinity, nextIndex: end + 1 };
  }

  if (!/^[1-9]\d*$/.test(body)) {
    logError(`Invalid quantifier "${body}"`);
    throw new MaskError(`Invalid quantifier "${body}"`);
  }

  const count = Number(body);
  return { min: count, max: count, nextIndex: end + 1 };
}

function makeSymbolNode(ch) {
  if (ch === ':' || ch === '{' || ch === '}' || ch === '|' || ch === ']') {
    logError(`Unexpected symbol "${ch}"`);
    throw new MaskError(`Unexpected symbol "${ch}"`);
  }

  if (ch === '[') {
    logError('Unexpected "[" without pair');
    throw new MaskError('Unexpected "[" without pair');
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

function formatValue(parsed, rawValue) {
  const cleaned = removeSeparators(rawValue, parsed.separators);
  const consumption = matchInput(cleaned, parsed.fragments);

  if (!consumption) {
    logError('Input does not satisfy the mask');
    throw new MaskError('Input does not satisfy the mask');
  }

  return insertSeparators(cleaned, consumption, parsed.separators);
}

function removeSeparators(value, separators) {
  return separators.reduce((acc, sep) => {
    if (!sep) return acc;
    return acc.split(sep).join('');
  }, value);
}

function insertSeparators(cleaned, consumption, separators) {
  let output = '';
  let offset = 0;

  for (let i = 0; i < consumption.length; i += 1) {
    const take = consumption[i] || 0;
    output += cleaned.slice(offset, offset + take);
    offset += take;

    if (i < separators.length && offset < cleaned.length) {
      output += separators[i];
    }
  }

  return output;
}

function matchInput(cleaned, fragments) {
  const path = new Array(fragments.length).fill(0);

  function matchFragment(fragmentIdx, nodeIdx, pos, consumed) {
    if (pos === cleaned.length) {
      const finalPath = path.slice();
      if (fragmentIdx < finalPath.length) {
        finalPath[fragmentIdx] = consumed;
      }
      return finalPath;
    }

    if (fragmentIdx >= fragments.length) {
      return null;
    }

    const nodes = fragments[fragmentIdx];

    if (nodeIdx >= nodes.length) {
      path[fragmentIdx] = consumed;
      return matchFragment(fragmentIdx + 1, 0, pos, 0);
    }

    const node = nodes[nodeIdx];

    if (node.type === 'symbol') {
      const available = cleaned.length - pos;
      if (available <= 0) {
        return null;
      }

      const maxRepeat = Math.min(node.max, available);
      const startRepeat = available < node.min ? 1 : node.min;

      for (let count = startRepeat; count <= maxRepeat; count += 1) {
        let ok = true;
        for (let k = 0; k < count; k += 1) {
          if (!matchesNode(node, cleaned[pos + k])) {
            ok = false;
            break;
          }
        }

        if (!ok) continue;

        const result = matchFragment(fragmentIdx, nodeIdx + 1, pos + count, consumed + count);
        if (result) return result;
      }

      return null;
    }

    if (node.type === 'group') {
      for (const alt of node.alternatives) {
        const result = matchGroupNodes(
          alt,
          0,
          pos,
          consumed,
          pos,
          (nextPos, nextConsumed) => matchFragment(fragmentIdx, nodeIdx + 1, nextPos, nextConsumed)
        );
        if (result) return result;
      }

      return null;
    }

    return null;
  }

  function matchGroupNodes(nodes, idx, pos, consumedForFragment, startPos, onComplete) {
    if (pos === cleaned.length) {
      const added = pos - startPos;
      return onComplete(pos, consumedForFragment + added);
    }

    if (idx >= nodes.length) {
      const added = pos - startPos;
      return onComplete(pos, consumedForFragment + added);
    }

    const node = nodes[idx];

    if (node.type === 'symbol') {
      const available = cleaned.length - pos;
      if (available <= 0) {
        return null;
      }

      const maxRepeat = Math.min(node.max, available);
      const startRepeat = available < node.min ? 1 : node.min;

      for (let count = startRepeat; count <= maxRepeat; count += 1) {
        let ok = true;
        for (let k = 0; k < count; k += 1) {
          if (!matchesNode(node, cleaned[pos + k])) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        const result = matchGroupNodes(
          nodes,
          idx + 1,
          pos + count,
          consumedForFragment + count,
          startPos,
          onComplete
        );
        if (result) return result;
      }

      return null;
    }

    if (node.type === 'group') {
      for (const alt of node.alternatives) {
        const result = matchGroupNodes(
          alt,
          0,
          pos,
          consumedForFragment,
          pos,
          (nextPos, nextConsumed) => matchGroupNodes(nodes, idx + 1, nextPos, nextConsumed, startPos, onComplete)
        );
        if (result) return result;
      }
    }

    return null;
  }

  return matchFragment(0, 0, 0, 0);
}

function matchesNode(node, ch) {
  if (node.kind === 'A') {
    return /[A-Za-z\u0400-\u04FF]/.test(ch);
  }

  if (node.kind === '0') {
    return /\d/.test(ch);
  }

  return ch === node.value;
}

function logError(message) {
  if (typeof console !== 'undefined' && console.error) {
    console.error(`[Mask] ${message}`);
  }
}

// Expose Mask globally for the demo page or as a module for testing.
if (typeof window !== 'undefined') {
  window.Mask = Mask;
}

if (typeof module !== 'undefined') {
  module.exports = { Mask, MaskError };
}


