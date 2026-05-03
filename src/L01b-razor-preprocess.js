'use strict';

function _blankLineLike(line) {
  return String(line || '').replace(/[^ \t]/g, ' ');
}

function _braceDelta(line) {
  var text = String(line || '');
  var delta = 0;
  var inString = false;
  var inChar = false;
  var escaped = false;

  for (var index = 0; index < text.length; index++) {
    var ch = text[index];
    var next = text[index + 1];

    if (!inString && !inChar && ch === '/' && next === '/') break;

    if (inString) {
      if (!escaped && ch === '"') inString = false;
      escaped = !escaped && ch === '\\';
      continue;
    }

    if (inChar) {
      if (!escaped && ch === "'") inChar = false;
      escaped = !escaped && ch === '\\';
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      continue;
    }

    if (ch === "'") {
      inChar = true;
      escaped = false;
      continue;
    }

    if (ch === '{') delta++;
    if (ch === '}') delta--;
  }

  return delta;
}

function _extractInlineExpressions(line) {
  return _extractInlineExpressionSegments(line).map(function (segment) {
    return segment.expression;
  }).filter(Boolean);
}

function _extractInlineExpressionSegments(line) {
  var text = String(line || '');
  var expressions = [];
  var index = 0;

  while (index < text.length) {
    if (text[index] !== '@' || text[index + 1] !== '(') {
      index++;
      continue;
    }

    var cursor = index + 2;
    var depth = 1;
    var inString = false;
    var inChar = false;
    var escaped = false;

    while (cursor < text.length) {
      var ch = text[cursor];

      if (inString) {
        if (!escaped && ch === '"') inString = false;
        escaped = !escaped && ch === '\\';
        cursor++;
        continue;
      }

      if (inChar) {
        if (!escaped && ch === "'") inChar = false;
        escaped = !escaped && ch === '\\';
        cursor++;
        continue;
      }

      if (ch === '"') {
        inString = true;
        escaped = false;
        cursor++;
        continue;
      }

      if (ch === "'") {
        inChar = true;
        escaped = false;
        cursor++;
        continue;
      }

      if (ch === '(') depth++;
      if (ch === ')') depth--;

      cursor++;

      if (depth === 0) {
        var rawExpression = text.slice(index + 2, cursor - 1);
        var trimmedExpression = rawExpression.trim();
        var leadingWhitespace = rawExpression.length - rawExpression.replace(/^\s+/, '').length;
        var trailingWhitespace = rawExpression.length - rawExpression.replace(/\s+$/, '').length;

        if (trimmedExpression) {
          expressions.push({
            expression: trimmedExpression,
            originalStartColumn: index,
            originalEndColumn: cursor - 1,
            originalExpressionStartColumn: index + 2 + leadingWhitespace,
            originalExpressionEndColumn: cursor - 2 - trailingWhitespace,
          });
        }
        break;
      }
    }

    index = cursor;
  }

  return expressions;
}

function _extractMultilineInlineExpression(lines, startLineIndex) {
  var startLine = String((lines || [])[startLineIndex] || '');
  var startColumn = startLine.indexOf('@(');

  if (startColumn === -1) return null;

  var chunks = [];
  var lineIndex = startLineIndex;
  var cursor = startColumn + 2;
  var depth = 1;
  var inString = false;
  var inChar = false;
  var escaped = false;

  while (lineIndex < lines.length) {
    var line = String(lines[lineIndex] || '');
    var chunk = '';
    var chunkStartColumn = cursor;

    while (cursor < line.length) {
      var ch = line[cursor];

      if (inString) {
        chunk += ch;
        if (!escaped && ch === '"') inString = false;
        escaped = !escaped && ch === '\\';
        cursor++;
        continue;
      }

      if (inChar) {
        chunk += ch;
        if (!escaped && ch === "'") inChar = false;
        escaped = !escaped && ch === '\\';
        cursor++;
        continue;
      }

      if (ch === '"') {
        inString = true;
        escaped = false;
        chunk += ch;
        cursor++;
        continue;
      }

      if (ch === "'") {
        inChar = true;
        escaped = false;
        chunk += ch;
        cursor++;
        continue;
      }

      if (ch === '(') {
        depth++;
        chunk += ch;
        cursor++;
        continue;
      }

      if (ch === ')') {
        depth--;
        if (depth === 0) {
          chunks.push({
            lineIndex: lineIndex,
            text: chunk,
            originalStartColumn: chunk.length > 0 ? chunkStartColumn : null,
            originalEndColumn: chunk.length > 0 ? (chunkStartColumn + chunk.length - 1) : null,
          });
          return {
            startLineIndex: startLineIndex,
            endLineIndex: lineIndex,
            chunks: chunks,
          };
        }

        chunk += ch;
        cursor++;
        continue;
      }

      chunk += ch;
      cursor++;
    }

    chunks.push({
      lineIndex: lineIndex,
      text: chunk,
      originalStartColumn: chunk.length > 0 ? chunkStartColumn : null,
      originalEndColumn: chunk.length > 0 ? (chunkStartColumn + chunk.length - 1) : null,
    });

    lineIndex++;
    cursor = 0;
    escaped = false;
  }

  return null;
}

function _createRegion(kind, blockId, lineIndex, extra) {
  var region = {
    kind: kind,
    blockId: blockId,
    originalStartLine: lineIndex,
    originalEndLine: lineIndex,
    syntheticStartLine: lineIndex,
    syntheticEndLine: lineIndex,
  };

  if (extra && typeof extra.expressionCount === 'number') {
    region.expressionCount = extra.expressionCount;
  }

  if (extra && Array.isArray(extra.segments)) {
    region.segments = extra.segments;
  }

  if (extra && Array.isArray(extra.mappings)) {
    region.mappings = extra.mappings;
  }

  return region;
}

function _appendRegionMapping(region, mapping) {
  if (!region || !mapping) return;
  if (!Array.isArray(region.mappings)) region.mappings = [];
  region.mappings.push(mapping);
}

function _createLineMapping(lineIndex, originalLine) {
  var text = String(originalLine || '');

  if (!text.length) return null;

  return {
    kind: 'line',
    originalLine: lineIndex,
    syntheticLine: lineIndex,
    originalStartColumn: 0,
    originalEndColumn: text.length - 1,
    syntheticStartColumn: 0,
    syntheticEndColumn: text.length - 1,
  };
}

function _createExpressionMapping(lineIndex, segment) {
  if (!segment) return null;

  return {
    kind: 'expression',
    originalLine: lineIndex,
    syntheticLine: lineIndex,
    originalStartColumn: segment.originalExpressionStartColumn,
    originalEndColumn: segment.originalExpressionEndColumn,
    syntheticStartColumn: segment.syntheticExpressionStartColumn,
    syntheticEndColumn: segment.syntheticExpressionEndColumn,
  };
}

function _finishRegion(region, endLine) {
  if (!region) return null;
  region.originalEndLine = endLine;
  region.syntheticEndLine = endLine;
  return region;
}

function preprocessRazorContent(content) {
  var source = String(content || '');
  var lines = source.split('\n');
  var output = [];
  var regions = [];
  var inCodeBlock = false;
  var braceDepth = 0;
  var codeBlockCount = 0;
  var closingSuffix = '';
  var currentRegion = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (!inCodeBlock) {
      if (/@(?:code|functions)\s*\{/.test(line)) {
        var codeBlockMatch = line.match(/@(code|functions)\s*\{/);
        codeBlockCount++;
        var rewritten = line.replace(/@(?:code|functions)\s*\{/, 'class __RazorComponent' + codeBlockCount + ' {');
        currentRegion = _createRegion(codeBlockMatch ? codeBlockMatch[1] : 'code', codeBlockCount, i, {
          mappings: [],
        });
        output.push(rewritten);
        braceDepth = _braceDelta(rewritten);
        closingSuffix = '';
        inCodeBlock = braceDepth > 0;
        if (!inCodeBlock) {
          var finishedCodeRegion = _finishRegion(currentRegion, i);
          if (finishedCodeRegion) regions.push(finishedCodeRegion);
          currentRegion = null;
        }
      } else if (/^\s*@\{/.test(line)) {
        codeBlockCount++;
        var statementRewritten = line.replace(/^\s*@\{/, 'class __RazorStatements' + codeBlockCount + ' { void __RazorRender' + codeBlockCount + '() {');
        currentRegion = _createRegion('statement', codeBlockCount, i, {
          mappings: [],
        });
        braceDepth = _braceDelta(statementRewritten);
        closingSuffix = '}';
        if (braceDepth === 1) {
          statementRewritten += closingSuffix;
          braceDepth = 0;
          closingSuffix = '';
          inCodeBlock = false;
          var finishedStatementRegion = _finishRegion(currentRegion, i);
          if (finishedStatementRegion) regions.push(finishedStatementRegion);
          currentRegion = null;
        } else {
          inCodeBlock = braceDepth > 0;
        }
        output.push(statementRewritten);
      } else {
        var inlineExpressionSegments = _extractInlineExpressionSegments(line);
        if (inlineExpressionSegments.length > 0) {
          codeBlockCount++;
          var rewrittenExpressions = [];
          var expressionRegion = _createRegion('expression', codeBlockCount, i, {
            expressionCount: inlineExpressionSegments.length,
            segments: [],
            mappings: [],
          });
          var rewrittenPrefix = 'class __RazorInlineExpression' + codeBlockCount + ' { void __RazorRender' + codeBlockCount + '() { ';
          var syntheticColumn = rewrittenPrefix.length;

          for (var expressionIndex = 0; expressionIndex < inlineExpressionSegments.length; expressionIndex++) {
            var inlineSegment = inlineExpressionSegments[expressionIndex];
            var variableName = '__razorValue' + codeBlockCount + '_' + (expressionIndex + 1);
            var assignmentPrefix = 'var ' + variableName + ' = ';
            var assignment = assignmentPrefix + inlineSegment.expression + ';';
            var segmentMetadata = {
              expression: inlineSegment.expression,
              variableName: variableName,
              originalStartColumn: inlineSegment.originalStartColumn,
              originalEndColumn: inlineSegment.originalEndColumn,
              originalExpressionStartColumn: inlineSegment.originalExpressionStartColumn,
              originalExpressionEndColumn: inlineSegment.originalExpressionEndColumn,
              syntheticExpressionStartColumn: syntheticColumn + assignmentPrefix.length,
              syntheticExpressionEndColumn: syntheticColumn + assignmentPrefix.length + inlineSegment.expression.length - 1,
            };

            rewrittenExpressions.push(assignment);
            expressionRegion.segments.push(segmentMetadata);
            _appendRegionMapping(expressionRegion, _createExpressionMapping(i, segmentMetadata));
            syntheticColumn += assignment.length + 1;
          }
          output.push(rewrittenPrefix + rewrittenExpressions.join(' ') + ' } }');
          regions.push(_finishRegion(expressionRegion, i));
        } else {
          var multilineInlineExpression = _extractMultilineInlineExpression(lines, i);
          if (multilineInlineExpression) {
            codeBlockCount++;
            var multilineRegion = _createRegion('expression', codeBlockCount, i, {
              expressionCount: 1,
              mappings: [],
            });
            var multilineVariableName = '__razorValue' + codeBlockCount + '_1';
            var multilinePrefix = 'class __RazorInlineExpression' + codeBlockCount + ' { void __RazorRender' + codeBlockCount + '() { var ' + multilineVariableName + ' = ';
            var multilineSuffix = '; } }';

            for (var chunkIndex = 0; chunkIndex < multilineInlineExpression.chunks.length; chunkIndex++) {
              var chunk = multilineInlineExpression.chunks[chunkIndex];
              var rewrittenLine = '';
              var syntheticStartColumn = 0;

              if (chunkIndex === 0) {
                rewrittenLine += multilinePrefix;
                syntheticStartColumn = multilinePrefix.length;
              }

              rewrittenLine += chunk.text;

              if (chunkIndex === (multilineInlineExpression.chunks.length - 1)) {
                rewrittenLine += multilineSuffix;
              }

              output.push(rewrittenLine);

              if (chunk.text.length > 0) {
                _appendRegionMapping(multilineRegion, {
                  kind: 'expression',
                  originalLine: chunk.lineIndex,
                  syntheticLine: chunk.lineIndex,
                  originalStartColumn: chunk.originalStartColumn,
                  originalEndColumn: chunk.originalEndColumn,
                  syntheticStartColumn: syntheticStartColumn,
                  syntheticEndColumn: syntheticStartColumn + chunk.text.length - 1,
                });
              }
            }

            regions.push(_finishRegion(multilineRegion, multilineInlineExpression.endLineIndex));
            i = multilineInlineExpression.endLineIndex;
          } else {
            output.push(_blankLineLike(line));
          }
        }
      }
      continue;
    }

    var processedLine = line;
    braceDepth += _braceDelta(line);

    if (closingSuffix && braceDepth === 1) {
      processedLine += closingSuffix;
      braceDepth = 0;
      closingSuffix = '';
    }

    output.push(processedLine);
    _appendRegionMapping(currentRegion, _createLineMapping(i, line));

    if (braceDepth <= 0) {
      inCodeBlock = false;
      braceDepth = 0;
      var finishedRegion = _finishRegion(currentRegion, i);
      if (finishedRegion) regions.push(finishedRegion);
      currentRegion = null;
    }
  }

  return {
    content: output.join('\n'),
    lineCount: lines.length,
    codeBlockCount: codeBlockCount,
    regions: regions,
  };
}

module.exports = {
  preprocessRazorContent: preprocessRazorContent,
  _braceDelta: _braceDelta,
  _extractInlineExpressions: _extractInlineExpressions,
  _extractInlineExpressionSegments: _extractInlineExpressionSegments,
  _extractMultilineInlineExpression: _extractMultilineInlineExpression,
};