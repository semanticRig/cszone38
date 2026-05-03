'use strict';

var fs = require('fs');
var path = require('path');

var fileWalker = require('./file-walker-cs');
var L01 = require('./L01-role-cs');

function _trim(line) {
  return (line || '').trim();
}

function _isCommentLine(line) {
  var trimmed = _trim(line);
  return trimmed.indexOf('//') === 0 || trimmed.indexOf('/*') === 0 || trimmed.indexOf('*') === 0;
}

function _nextNonEmptyIndex(lines, startIndex) {
  for (var i = startIndex; i < lines.length; i++) {
    if (_trim(lines[i]) !== '') return i;
  }
  return -1;
}

function _matchWholeLineConsoleWriteLine(line) {
  if (_isCommentLine(line)) return false;
  return /^\s*Console\.WriteLine\s*\([^;]*\)\s*;\s*(?:\/\/.*)?$/.test(line);
}

function _rewriteTodoMarker(line) {
  var match = line.match(/^(\s*\/\/\s*)(TODO|FIXME|HACK)\b[:\-\s]*(.*)$/i);
  if (!match) return null;

  var remainder = (match[3] || '').trim();
  if (!remainder) return '';
  return match[1] + remainder;
}

function _buildCatchHeader(headerLine) {
  var indent = (headerLine.match(/^\s*/) || [''])[0];
  var trimmed = _trim(headerLine);
  var typedWithName = trimmed.match(/^catch\s*\(\s*([A-Za-z0-9_\.<>]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\)$/);
  var typedNoName = trimmed.match(/^catch\s*\(\s*([A-Za-z0-9_\.<>]+)\s*\)$/);

  if (typedWithName) return indent + 'catch (' + typedWithName[1] + ' ' + typedWithName[2] + ')';
  if (typedNoName) return indent + 'catch (' + typedNoName[1] + ' ex)';
  if (trimmed === 'catch') return indent + 'catch (System.Exception ex)';
  return indent + 'catch (System.Exception ex)';
}

function _catchVariableName(headerLine) {
  var trimmed = _trim(headerLine);
  var typedWithName = trimmed.match(/^catch\s*\(\s*[A-Za-z0-9_\.<>]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\)$/);
  if (typedWithName) return typedWithName[1];
  return 'ex';
}

function _matchEmptyCatch(lines, startIndex) {
  var line = lines[startIndex];
  var trimmed = _trim(line);
  if (!/^catch\b/.test(trimmed)) return null;

  var indent = (line.match(/^\s*/) || [''])[0];
  var headerLine = line;
  var openIndex = -1;
  var closeIndex = -1;

  if (/^catch(?:\s*\([^)]*\))?\s*\{\s*\}$/.test(trimmed)) {
    openIndex = startIndex;
    closeIndex = startIndex;
  } else if (trimmed.indexOf('{') !== -1) {
    openIndex = startIndex;
    closeIndex = _nextNonEmptyIndex(lines, startIndex + 1);
    if (closeIndex === -1 || _trim(lines[closeIndex]) !== '}') return null;
  } else {
    openIndex = _nextNonEmptyIndex(lines, startIndex + 1);
    if (openIndex === -1 || _trim(lines[openIndex]) !== '{') return null;
    closeIndex = _nextNonEmptyIndex(lines, openIndex + 1);
    if (closeIndex === -1 || _trim(lines[closeIndex]) !== '}') return null;
  }

  var replacementHeader = _buildCatchHeader(headerLine);
  var variableName = _catchVariableName(replacementHeader);
  var bodyIndent = indent + '    ';

  return {
    endIndex: closeIndex,
    replacement: [
      replacementHeader,
      indent + '{',
      bodyIndent + 'System.Diagnostics.Trace.TraceError(' + variableName + '.ToString());',
      bodyIndent + 'throw;',
      indent + '}',
    ],
  };
}

function applyFixesToContent(content, options) {
  var opts = options || {};
  var lines = String(content || '').split('\n');
  var output = [];
  var summary = {
    consoleWriteLine: 0,
    todoMarkers: 0,
    emptyCatchBlocks: 0,
  };

  for (var i = 0; i < lines.length; i++) {
    var emptyCatch = _matchEmptyCatch(lines, i);
    if (emptyCatch) {
      for (var j = 0; j < emptyCatch.replacement.length; j++) {
        output.push(emptyCatch.replacement[j]);
      }
      summary.emptyCatchBlocks++;
      i = emptyCatch.endIndex;
      continue;
    }

    var line = lines[i];

    if (!opts.isTest && _matchWholeLineConsoleWriteLine(line)) {
      summary.consoleWriteLine++;
      continue;
    }

    var rewrittenTodo = _rewriteTodoMarker(line);
    if (rewrittenTodo !== null) {
      summary.todoMarkers++;
      if (rewrittenTodo !== '') output.push(rewrittenTodo);
      continue;
    }

    output.push(line);
  }

  return {
    content: output.join('\n'),
    changed: summary.consoleWriteLine > 0 || summary.todoMarkers > 0 || summary.emptyCatchBlocks > 0,
    summary: summary,
  };
}

function fixFile(fileInfo) {
  var record = {
    path: fileInfo.path,
    relativePath: fileInfo.relativePath || path.basename(fileInfo.path),
    ext: path.extname(fileInfo.path).toLowerCase(),
  };
  L01.classifyRole(record);

  var original = fs.readFileSync(fileInfo.path, 'utf8');
  var result = applyFixesToContent(original, { isTest: !!record.role.isTest });

  if (result.changed && result.content !== original) {
    fs.writeFileSync(fileInfo.path, result.content, 'utf8');
  }

  return {
    filePath: fileInfo.path,
    relativePath: record.relativePath,
    changed: result.changed && result.content !== original,
    summary: result.summary,
  };
}

function fixTarget(targetPath, opts) {
  var files = fileWalker.collectCSharpFiles(targetPath, opts || {});
  var fileResults = [];
  var totals = {
    consoleWriteLine: 0,
    todoMarkers: 0,
    emptyCatchBlocks: 0,
    changedFiles: 0,
  };

  for (var i = 0; i < files.length; i++) {
    var result = fixFile(files[i]);
    fileResults.push(result);
    totals.consoleWriteLine += result.summary.consoleWriteLine;
    totals.todoMarkers += result.summary.todoMarkers;
    totals.emptyCatchBlocks += result.summary.emptyCatchBlocks;
    if (result.changed) totals.changedFiles++;
  }

  return {
    fileCount: files.length,
    totals: totals,
    files: fileResults,
  };
}

module.exports = {
  applyFixesToContent: applyFixesToContent,
  fixFile: fixFile,
  fixTarget: fixTarget,
  _matchEmptyCatch: _matchEmptyCatch,
  _rewriteTodoMarker: _rewriteTodoMarker,
  _matchWholeLineConsoleWriteLine: _matchWholeLineConsoleWriteLine,
};