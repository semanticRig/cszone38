'use strict';

// Layer 4 — C# entity harvesting
// Extracts C# string literals with a single-pass PDA and tags structural context.

var WasmParser = require('./wasm-parser');

var MIN_STRING_LEN = 4;

var CONTEXT_FACTORS = {
  attribute_argument: 0.5,
  argument: 0.7,
  const_declaration: 1.3,
  field_declaration: 1.2,
  default: 1.0,
};

function _countRun(content, index, ch) {
  var count = 0;
  while (index + count < content.length && content[index + count] === ch) count++;
  return count;
}

function _hasExactRun(content, index, ch, count) {
  return _countRun(content, index, ch) === count;
}

function _advance(state, content, count) {
  for (var i = 0; i < count; i++) {
    if (state.index >= content.length) return;
    var ch = content[state.index];
    state.index++;
    if (ch === '\n') {
      state.lineIndex++;
      state.col = 0;
    } else {
      state.col++;
    }
  }
}

function _consumeLineComment(state, content) {
  _advance(state, content, 2);
  while (state.index < content.length && content[state.index] !== '\n') {
    _advance(state, content, 1);
  }
}

function _consumeBlockComment(state, content) {
  _advance(state, content, 2);
  while (state.index < content.length) {
    if (content[state.index] === '*' && content[state.index + 1] === '/') {
      _advance(state, content, 2);
      return;
    }
    _advance(state, content, 1);
  }
}

function _consumeCharLiteral(state, content) {
  _advance(state, content, 1);
  while (state.index < content.length) {
    var ch = content[state.index];
    if (ch === '\\') {
      _advance(state, content, 2);
      continue;
    }
    _advance(state, content, 1);
    if (ch === '\'' || ch === '\n') return;
  }
}

function _decodeEscape(content, index) {
  var next = content[index + 1];
  if (next == null) return { value: '', width: 1 };

  var map = {
    '0': '\0',
    'a': '\x07',
    'b': '\b',
    'f': '\f',
    'n': '\n',
    'r': '\r',
    't': '\t',
    'v': '\v',
    '\\': '\\',
    '\'': '\'',
    '"': '"',
  };

  if (map[next] !== undefined) {
    return { value: map[next], width: 2 };
  }

  if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(content.slice(index + 2, index + 6))) {
    return {
      value: String.fromCharCode(parseInt(content.slice(index + 2, index + 6), 16)),
      width: 6,
    };
  }

  if (next === 'U' && /^[0-9a-fA-F]{8}$/.test(content.slice(index + 2, index + 10))) {
    return {
      value: String.fromCodePoint(parseInt(content.slice(index + 2, index + 10), 16)),
      width: 10,
    };
  }

  if (next === 'x') {
    var hexEnd = index + 2;
    while (hexEnd < Math.min(content.length, index + 6) && /[0-9a-fA-F]/.test(content[hexEnd])) {
      hexEnd++;
    }
    if (hexEnd > index + 2) {
      return {
        value: String.fromCharCode(parseInt(content.slice(index + 2, hexEnd), 16)),
        width: hexEnd - index,
      };
    }
  }

  return { value: next, width: 2 };
}

function _detectStringStart(content, index) {
  var ch = content[index];
  if (ch !== '"' && ch !== '$' && ch !== '@') return null;

  var cursor = index;
  var dollarCount = 0;
  var hasAt = false;

  if (ch === '$' || ch === '@') {
    while (cursor < content.length) {
      if (content[cursor] === '$') {
        dollarCount++;
        cursor++;
        continue;
      }
      if (content[cursor] === '@' && !hasAt) {
        hasAt = true;
        cursor++;
        continue;
      }
      break;
    }
    if (content[cursor] !== '"') return null;
  }

  var quoteCount = _countRun(content, cursor, '"');
  if (quoteCount >= 3 && !hasAt) {
    return {
      kind: 'raw',
      startIndex: index,
      quoteIndex: cursor,
      prefixLength: cursor - index,
      quoteCount: quoteCount,
      dollarCount: dollarCount,
    };
  }

  if (quoteCount !== 1) return null;

  if (dollarCount > 0 && hasAt) {
    return {
      kind: 'interpolated_verbatim',
      startIndex: index,
      quoteIndex: cursor,
      prefixLength: cursor - index,
      quoteCount: 1,
      dollarCount: dollarCount,
    };
  }

  if (dollarCount > 0) {
    return {
      kind: 'interpolated',
      startIndex: index,
      quoteIndex: cursor,
      prefixLength: cursor - index,
      quoteCount: 1,
      dollarCount: dollarCount,
    };
  }

  if (hasAt) {
    return {
      kind: 'verbatim',
      startIndex: index,
      quoteIndex: cursor,
      prefixLength: cursor - index,
      quoteCount: 1,
      dollarCount: 0,
    };
  }

  if (ch === '"') {
    return {
      kind: 'standard',
      startIndex: index,
      quoteIndex: cursor,
      prefixLength: 0,
      quoteCount: 1,
      dollarCount: 0,
    };
  }

  return null;
}

function _consumeInterpolationExpression(state, content, closeBraceCount) {
  var depth = 0;

  while (state.index < content.length) {
    if (depth === 0 && _hasExactRun(content, state.index, '}', closeBraceCount)) {
      _advance(state, content, closeBraceCount);
      return;
    }

    var ch = content[state.index];
    var next = content[state.index + 1];

    if (ch === '/' && next === '/') {
      _consumeLineComment(state, content);
      continue;
    }

    if (ch === '/' && next === '*') {
      _consumeBlockComment(state, content);
      continue;
    }

    if (ch === '\'') {
      _consumeCharLiteral(state, content);
      continue;
    }

    var nestedStart = _detectStringStart(content, state.index);
    if (nestedStart) {
      _consumeStringToken(state, content, nestedStart, null);
      continue;
    }

    if (ch === '{') {
      depth++;
      _advance(state, content, 1);
      continue;
    }

    if (ch === '}' && depth > 0) {
      depth--;
      _advance(state, content, 1);
      continue;
    }

    _advance(state, content, 1);
  }
}

function _consumeStandardString(state, content, collector) {
  _advance(state, content, 1);

  while (state.index < content.length) {
    var ch = content[state.index];
    if (ch === '"') {
      _advance(state, content, 1);
      return true;
    }
    if (ch === '\\') {
      var decoded = _decodeEscape(content, state.index);
      if (collector) collector.push(decoded.value);
      _advance(state, content, decoded.width);
      continue;
    }
    if (ch === '\n') return false;
    if (collector) collector.push(ch);
    _advance(state, content, 1);
  }

  return false;
}

function _consumeVerbatimString(state, content, collector) {
  _advance(state, content, 2);

  while (state.index < content.length) {
    var ch = content[state.index];
    var next = content[state.index + 1];

    if (ch === '"' && next === '"') {
      if (collector) collector.push('"');
      _advance(state, content, 2);
      continue;
    }

    if (ch === '"') {
      _advance(state, content, 1);
      return true;
    }

    if (collector) collector.push(ch);
    _advance(state, content, 1);
  }

  return false;
}

function _consumeInterpolatedString(state, content, collector) {
  _advance(state, content, 2);

  while (state.index < content.length) {
    var ch = content[state.index];
    var next = content[state.index + 1];

    if (ch === '"') {
      _advance(state, content, 1);
      return true;
    }

    if (ch === '\\') {
      var decoded = _decodeEscape(content, state.index);
      if (collector) collector.push(decoded.value);
      _advance(state, content, decoded.width);
      continue;
    }

    if (ch === '{') {
      if (next === '{') {
        if (collector) collector.push('{');
        _advance(state, content, 2);
        continue;
      }
      _advance(state, content, 1);
      _consumeInterpolationExpression(state, content, 1);
      continue;
    }

    if (ch === '}' && next === '}') {
      if (collector) collector.push('}');
      _advance(state, content, 2);
      continue;
    }

    if (ch === '\n') return false;
    if (collector) collector.push(ch);
    _advance(state, content, 1);
  }

  return false;
}

function _consumeInterpolatedVerbatimString(state, content, collector) {
  _advance(state, content, 3);

  while (state.index < content.length) {
    var ch = content[state.index];
    var next = content[state.index + 1];

    if (ch === '"' && next === '"') {
      if (collector) collector.push('"');
      _advance(state, content, 2);
      continue;
    }

    if (ch === '"') {
      _advance(state, content, 1);
      return true;
    }

    if (ch === '{') {
      if (next === '{') {
        if (collector) collector.push('{');
        _advance(state, content, 2);
        continue;
      }
      _advance(state, content, 1);
      _consumeInterpolationExpression(state, content, 1);
      continue;
    }

    if (ch === '}' && next === '}') {
      if (collector) collector.push('}');
      _advance(state, content, 2);
      continue;
    }

    if (collector) collector.push(ch);
    _advance(state, content, 1);
  }

  return false;
}

function _consumeRawString(state, content, descriptor, collector) {
  _advance(state, content, descriptor.prefixLength + descriptor.quoteCount);

  var multiline = false;
  if (content[state.index] === '\r' && content[state.index + 1] === '\n') {
    multiline = true;
    _advance(state, content, 2);
  } else if (content[state.index] === '\n') {
    multiline = true;
    _advance(state, content, 1);
  }

  while (state.index < content.length) {
    var linePrefix = multiline ? (collector != null ? null : null) : null;
    if (_hasExactRun(content, state.index, '"', descriptor.quoteCount)) {
      var canClose = !multiline;
      if (multiline) {
        canClose = /^[ \t]*$/.test(content.slice(state.index - state.col, state.index));
      }

      if (canClose) {
        if (multiline && collector && collector.length > 0) {
          var tail = collector[collector.length - 1];
          if (tail === '\n') {
            collector.pop();
          } else if (collector.length > 1 && collector[collector.length - 2] === '\r' && tail === '\n') {
            collector.pop();
            collector.pop();
          }
        }
        _advance(state, content, descriptor.quoteCount);
        return true;
      }
    }

    if (descriptor.dollarCount > 0 && _hasExactRun(content, state.index, '{', descriptor.dollarCount)) {
      _advance(state, content, descriptor.dollarCount);
      _consumeInterpolationExpression(state, content, descriptor.dollarCount);
      continue;
    }

    if (collector) collector.push(content[state.index]);
    _advance(state, content, 1);
  }

  return false;
}

function _consumeStringToken(state, content, descriptor, collector) {
  if (descriptor.kind === 'standard') {
    return _consumeStandardString(state, content, collector);
  }
  if (descriptor.kind === 'verbatim') {
    return _consumeVerbatimString(state, content, collector);
  }
  if (descriptor.kind === 'interpolated') {
    return _consumeInterpolatedString(state, content, collector);
  }
  if (descriptor.kind === 'interpolated_verbatim') {
    return _consumeInterpolatedVerbatimString(state, content, collector);
  }
  if (descriptor.kind === 'raw') {
    return _consumeRawString(state, content, descriptor, collector);
  }
  return false;
}

function _inferIdentifierName(line, col) {
  var prefix = line.slice(0, col);
  var match = prefix.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*$/);
  return match ? match[1] : null;
}

function _matchesStringFormatTarget(node) {
  return !!(node && /(?:^|\.)(?:string|String)\.Format$/.test(node.text || ''));
}

function _containsNodeType(node, typeName) {
  if (!node) return false;
  if (node.type === typeName) return true;

  var children = node.namedChildren || [];
  for (var i = 0; i < children.length; i++) {
    if (_containsNodeType(children[i], typeName)) return true;
  }

  return false;
}

function _containsBareIdentifierReference(node) {
  if (!node) return false;

  if (node.type === 'identifier') {
    return !node.parent || node.parent.type !== 'member_access_expression';
  }

  var children = node.namedChildren || [];
  for (var i = 0; i < children.length; i++) {
    if (_containsBareIdentifierReference(children[i])) return true;
  }

  return false;
}

function _isStringFormatTemplateArgument(node) {
  var argumentNode = node;

  while (argumentNode && argumentNode.type !== 'argument') {
    argumentNode = argumentNode.parent;
  }

  if (!argumentNode) return false;

  var argumentList = argumentNode.parent;
  var invocation = argumentList && argumentList.parent;
  var namedArguments = argumentList && argumentList.namedChildren ? argumentList.namedChildren : [];
  var firstArgument = namedArguments[0];
  var targetNode = invocation && invocation.namedChildren ? invocation.namedChildren[0] : null;

  if (!argumentList || argumentList.type !== 'argument_list') return false;
  if (!invocation || invocation.type !== 'invocation_expression') return false;
  if (!firstArgument) return false;
  if (firstArgument.startIndex !== argumentNode.startIndex || firstArgument.endIndex !== argumentNode.endIndex) return false;

  return _matchesStringFormatTarget(targetNode);
}

function _hasFragmentedAssignmentTag(node) {
  var current = node;
  var owner = null;
  var valueExpression = null;
  var ownerChildren;

  while (current) {
    if (current.type === 'variable_declarator' || current.type === 'assignment_expression') {
      owner = current;
      break;
    }
    current = current.parent;
  }

  if (!owner) return false;

  ownerChildren = owner.namedChildren || [];
  valueExpression = ownerChildren[1] || null;

  if (!valueExpression) return false;
  if (!_containsNodeType(valueExpression, 'binary_expression')) return false;
  if (_containsNodeType(valueExpression, 'invocation_expression')) return false;
  if (_containsNodeType(valueExpression, 'interpolated_string_expression')) return false;

  return _containsBareIdentifierReference(valueExpression);
}

function _determineStructuralContext(node) {
  var current = node;
  while (current) {
    if (current.type === 'attribute_argument') return 'attribute_argument';
    if (current.type === 'argument') return 'argument';
    if (current.type === 'field_declaration') {
      for (var i = 0; i < current.children.length; i++) {
        if (current.children[i].type === 'modifier' && current.children[i].text === 'const') {
          return 'const_declaration';
        }
      }
      return 'field_declaration';
    }
    current = current.parent;
  }
  return 'default';
}

function _applyStructuralContext(content, candidates, parserInput) {
  for (var i = 0; i < candidates.length; i++) {
    candidates[i].structuralContext = 'default';
    candidates[i].contextFactor = CONTEXT_FACTORS.default;
    candidates[i].safeSink = false;
    candidates[i].tags = [];
  }

  if (!parserInput || candidates.length === 0) return candidates;

  var parser = parserInput.parser ? parserInput.parser : parserInput;
  var tree;

  try {
    tree = WasmParser.parse(parser, content);
  } catch (_err) {
    return candidates;
  }

  for (var j = 0; j < candidates.length; j++) {
    var candidate = candidates[j];
    var node = tree.rootNode.namedDescendantForPosition({
      row: candidate.lineIndex,
      column: candidate.col,
    });

    var context = _determineStructuralContext(node);
    candidate.structuralContext = context;
    candidate.contextFactor = CONTEXT_FACTORS[context] || CONTEXT_FACTORS.default;
    candidate.safeSink = _isStringFormatTemplateArgument(node);
    if (_hasFragmentedAssignmentTag(node)) {
      candidate.tags.push('fragmented_assignment');
    }
  }

  return candidates;
}

function _buildCandidate(lines, startLineIndex, quoteCol, value) {
  return {
    value: value,
    line: lines[startLineIndex] || '',
    col: quoteCol,
    lineIndex: startLineIndex,
    identifierName: _inferIdentifierName(lines[startLineIndex] || '', quoteCol),
    callSiteContext: null,
    type: 'string',
    priority: 'normal',
    structuralContext: 'default',
    contextFactor: CONTEXT_FACTORS.default,
    safeSink: false,
    tags: [],
  };
}

function harvestCSharpEntities(content, fileRecord, parserInput) {
  var lines = content.split('\n');
  var candidates = [];
  var state = {
    index: 0,
    lineIndex: 0,
    col: 0,
  };

  while (state.index < content.length) {
    var ch = content[state.index];
    var next = content[state.index + 1];

    if (ch === '/' && next === '/') {
      _consumeLineComment(state, content);
      continue;
    }

    if (ch === '/' && next === '*') {
      _consumeBlockComment(state, content);
      continue;
    }

    if (ch === '\'') {
      _consumeCharLiteral(state, content);
      continue;
    }

    var descriptor = _detectStringStart(content, state.index);
    if (!descriptor) {
      _advance(state, content, 1);
      continue;
    }

    var startLineIndex = state.lineIndex;
    var quoteCol = state.col + descriptor.prefixLength;
    var collector = [];
    var terminated = _consumeStringToken(state, content, descriptor, collector);
    var value = collector.join('');

    if (terminated && value.length >= MIN_STRING_LEN) {
      candidates.push(_buildCandidate(lines, startLineIndex, quoteCol, value));
    }
  }

  _applyStructuralContext(content, candidates, parserInput);

  if (fileRecord) fileRecord.candidates = candidates;
  return candidates;
}

module.exports = {
  harvestCSharpEntities: harvestCSharpEntities,
  harvestEntities: harvestCSharpEntities,
  _applyStructuralContext: _applyStructuralContext,
  _detectStringStart: _detectStringStart,
  _determineStructuralContext: _determineStructuralContext,
  _isStringFormatTemplateArgument: _isStringFormatTemplateArgument,
  _hasFragmentedAssignmentTag: _hasFragmentedAssignmentTag,
};