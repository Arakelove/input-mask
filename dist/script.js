"use strict";
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
                return formatValue(parsed, source).masked;
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
            if (current.length === 0) {
                logError('Empty fragment before separator');
                throw new MaskError('Empty fragment before separator');
            }
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
    if (current.length === 0) {
        logError('Empty fragment at end of pattern');
        throw new MaskError('Empty fragment at end of pattern');
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
                if (current.length === 0) {
                    logError('Empty alternative in group');
                    throw new MaskError('Empty alternative in group');
                }
                alternatives.push(current);
                current = [];
                i += 1;
                continue;
            }
            if (currentChar === ']' && lookahead === ']') {
                if (current.length === 0) {
                    logError('Empty alternative in group');
                    throw new MaskError('Empty alternative in group');
                }
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
        logError('Unclosed quantifier');
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
    var _a;
    const input = rawValue == null ? '' : String(rawValue);
    const { separators } = parsed;
    // Special fast-path: manual spaces between parts (e.g., holder). Only use when mask contains non-digit symbols.
    const separatorsAreSpaces = separators.length > 0 && separators.every((s) => s === ' ');
    const manualSpaceMask = separatorsAreSpaces && parsed.fragments.some((fragment) => hasNonDigitSymbol(fragment));
    if (manualSpaceMask) {
        const hasTrailingSpace = /\s$/.test(input);
        const parts = input.split(/\s+/).filter(Boolean);
        const fragmentsOut = [];
        const fragmentsRaw = [];
        for (let i = 0; i < parsed.fragments.length; i += 1) {
            const fragmentNodes = parsed.fragments[i];
            const valuePart = (_a = parts[i]) !== null && _a !== void 0 ? _a : '';
            const result = consumeNodes(fragmentNodes, valuePart, 0, []);
            fragmentsOut.push(result.out);
            fragmentsRaw.push(result.raw);
            if (!result.satisfied)
                break;
        }
        let masked = fragmentsOut.join(' ');
        if (hasTrailingSpace) {
            masked = masked.replace(/\s+$/, ' ');
        }
        else {
            masked = masked.trimEnd();
        }
        return {
            raw: fragmentsRaw.join(''),
            masked,
        };
    }
    const fragmentsOut = [];
    const fragmentsRaw = [];
    const sepList = separators.filter(Boolean).slice().sort((a, b) => b.length - a.length);
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
function hasNonDigitSymbol(nodes) {
    for (const node of nodes) {
        if (node.type === 'symbol') {
            if (node.kind !== '0')
                return true;
            continue;
        }
        if (node.type === 'group') {
            for (const alt of node.alternatives) {
                if (hasNonDigitSymbol(alt))
                    return true;
            }
        }
    }
    return false;
}
function consumeNodes(nodes, input, startPos, separators, tailNodes) {
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
function consumeNode(node, input, startPos, separators, remainingNodes) {
    if (node.type === 'symbol') {
        return consumeSymbol(node, input, startPos, separators, remainingNodes);
    }
    if (node.type === 'group') {
        return consumeGroup(node, input, startPos, separators, remainingNodes);
    }
    return { out: '', raw: '', pos: startPos, satisfied: false, advanced: 0 };
}
function consumeSymbol(node, input, startPos, separators, remainingNodes) {
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
        }
        else if (count >= node.min && canStartWithChar(remainingNodes, ch)) {
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
function consumeGroup(node, input, startPos, separators, tailNodes) {
    let best = { out: '', raw: '', pos: startPos, satisfied: false, advanced: 0 };
    for (const alt of node.alternatives) {
        const result = consumeNodes(alt, input, startPos, separators, tailNodes);
        const better = result.raw.length > best.raw.length ||
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
function canStartWithChar(nodes, ch) {
    if (!nodes || nodes.length === 0)
        return false;
    const first = nodes[0];
    if (first.type === 'symbol') {
        return matchesNode(first, ch);
    }
    if (first.type === 'group') {
        for (const alt of first.alternatives) {
            if (canStartWithChar(alt, ch))
                return true;
        }
        return false;
    }
    return false;
}
function separatorLengthAt(input, pos, separators) {
    for (let i = 0; i < separators.length; i += 1) {
        const sep = separators[i];
        if (!sep)
            continue;
        if (input.startsWith(sep, pos))
            return sep.length;
    }
    return 0;
}
function joinWithSeparators(fragmentOutputs, separators) {
    let output = '';
    for (let i = 0; i < fragmentOutputs.length; i += 1) {
        const part = fragmentOutputs[i];
        if (!part)
            break;
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
if (typeof window !== 'undefined') {
    window.Mask = Mask;
}
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { Mask, MaskError };
}
