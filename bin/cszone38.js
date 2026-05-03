#!/usr/bin/env node
'use strict';

// CLI entry point — async boundary lives here ONLY.
// Arg parsing, WASM init, file collection, pipeline dispatch, and output rendering.
// No detection logic. No pipeline logic. This file is a driver, not a library.

var path = require('path');
var fs   = require('fs');
var pkg = require('../package.json');
var WasmParser = require('../src/wasm-parser');
var Fixer = require('../src/fix-cs');
var DeepToolchain = require('../src/deep-toolchain-cs');
var ProgressUi = require('../src/progress-ui-cs');
var api = require('../src/index.js');
var L15 = require('../src/L15-output-cs');

var RESET = '\x1b[0m';
var BOLD = '\x1b[1m';
var DIM = '\x1b[2m';
var CYAN = '\x1b[36m';
var TOOL_VERSION = pkg.version || '0.0.0';

function resolveEditor() {
  var fromEnv = process.env.VISUAL || process.env.EDITOR;
  if (fromEnv) return fromEnv;
  return 'less';
}

function buildOpenArgs(editor, filePath, lineNumber) {
  var base = editor.split(' ')[0];
  var name = path.basename(base);

  if (name === 'code') return ['code', '--goto', filePath + ':' + lineNumber];
  if (name === 'vim' || name === 'nvim') return [name, '-R', '+' + lineNumber, '+set cursorline', filePath];
  if (name === 'less') return ['less', '-R', '-N', '+' + lineNumber + 'g', '-j3'];
  if (name === 'emacs') return ['emacs', '--eval', '(view-file "' + filePath + '")', '+' + lineNumber];
  return [editor, '+' + lineNumber, filePath];
}

var HIGHLIGHT_BG = '\x1b[43m\x1b[30m';

function _colorizeFileLine(filePath, lineNumber) {
  var content = fs.readFileSync(filePath, 'utf8');
  var lines = content.split('\n');
  var idx = lineNumber - 1;
  if (idx >= 0 && idx < lines.length) {
    lines[idx] = HIGHLIGHT_BG + lines[idx] + RESET;
  }
  return lines.join('\n');
}

function openFileAtLine(filePath, lineNumber) {
  var spawnSync = require('child_process').spawnSync;

  if (!fs.existsSync(filePath)) {
    process.stderr.write('  warning: cannot open ' + filePath + ' - file not found\n');
    return;
  }

  var editor = resolveEditor();
  var openArgs = buildOpenArgs(editor, filePath, lineNumber);
  var editorName = path.basename(editor.split(' ')[0]);

  if (editorName === 'less') {
    var colorized = _colorizeFileLine(filePath, lineNumber);
    var lessResult = spawnSync(openArgs[0], openArgs.slice(1), {
      input: colorized,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: false,
    });
    if (lessResult.error) {
      process.stderr.write('  warning: could not open editor (' + openArgs[0] + '): ' + lessResult.error.message + '\n');
    }
    return;
  }

  var result = spawnSync(openArgs[0], openArgs.slice(1), {
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    process.stderr.write('  warning: could not open editor (' + openArgs[0] + '): ' + result.error.message + '\n');
  }
}

function countLines(str) {
  var count = 0;
  for (var i = 0; i < str.length; i++) {
    if (str[i] === '\n') count++;
  }
  return count;
}

function printHitContext(hit) {
  var line = hit.lineNumber || '?';
  var ruleId = hit.ruleId || '';
  var snippet = hit.fullSnippet || hit.snippet || '';
  var fix = hit.fix || '';
  var headerBody = 'L' + line + '  ' + ruleId;
  var dashes = '';
  var dashCount = Math.max(0, 52 - String(line).length - ruleId.length);

  for (var i = 0; i < dashCount; i++) dashes += '\u2500';

  var divider = DIM + '\u2500\u2500 ' + headerBody + ' ' + dashes + RESET;
  var closeDivider = DIM;
  for (var j = 0; j < 60; j++) closeDivider += '\u2500';
  closeDivider += RESET;

  process.stdout.write('\n');
  process.stdout.write('  ' + divider + '\n\n');
  if (snippet) {
    process.stdout.write('    ' + snippet + '\n\n');
  }
  if (fix) {
    process.stdout.write('    -> ' + fix + '\n\n');
  }
  process.stdout.write('  ' + closeDivider + '\n');
  process.stdout.write('  ' + DIM + 'opening in ' + resolveEditor() + '...' + RESET + '\n\n');
}

function collectAllHits(patternHits, basePath) {
  var baseDir;

  try {
    baseDir = fs.statSync(basePath).isDirectory() ? basePath : path.dirname(basePath);
  } catch (_err) {
    baseDir = path.dirname(basePath);
  }

  var hits = [];
  for (var i = 0; i < patternHits.length; i++) {
    var ph = patternHits[i];
    hits.push({
      filePath: path.resolve(baseDir, ph.file),
      fileName: path.basename(ph.file),
      lineNumber: ph.lineNumber,
      ruleId: ph.ruleId || '',
      snippet: (ph.source || '').slice(0, 72).trim(),
      fullSnippet: (ph.source || '').trim(),
      fix: ph.fix || '',
    });
  }

  hits.sort(function (left, right) {
    if (left.filePath < right.filePath) return -1;
    if (left.filePath > right.filePath) return 1;
    return left.lineNumber - right.lineNumber;
  });

  return hits;
}

function buildTagIndex(hits) {
  var index = {};

  for (var i = 0; i < hits.length; i++) {
    var tag = hits[i].ruleId || 'uncategorised';
    if (!index[tag]) index[tag] = [];
    index[tag].push(hits[i]);
  }

  var sorted = {};
  Object.keys(index)
    .sort(function (left, right) { return index[right].length - index[left].length; })
    .forEach(function (key) { sorted[key] = index[key]; });

  return sorted;
}

function runTagPicker(tagIndex, allHits, exitCode) {
  var tags = Object.keys(tagIndex);
  var cursor = 0;
  var stdin = process.stdin;

  if (!stdin.isTTY) {
    process.stdout.write('\n  Categories (requires interactive terminal for navigation):\n\n');
    for (var i = 0; i < tags.length; i++) {
      process.stdout.write('  ' + tags[i] + '  (' + tagIndex[tags[i]].length + ' hits)\n');
    }
    process.stdout.write('\n');
    process.exit(exitCode);
    return;
  }

  var pickerLineCount = 0;
  var pickerFirstDraw = true;

  function drawPicker() {
    var out = '';
    out += '\n';
    out += '  ' + BOLD + 'SELECT CATEGORY' + RESET +
      '  ' + DIM + '(' + allHits.length + ' total hit' + (allHits.length === 1 ? '' : 's') + ')' + RESET + '\n\n';

    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      var count = tagIndex[tag].length;
      var selected = i === cursor;
      var marker = selected ? CYAN + '\u25b6' + RESET : ' ';
      var tagLabel = selected ? BOLD + tag + RESET : DIM + tag + RESET;
      var countStr = DIM + '(' + count + ' hit' + (count === 1 ? '' : 's') + ')' + RESET;
      out += '  ' + marker + '  ' + tagLabel + '  ' + countStr + '\n';
    }

    out += '\n  ' + DIM + 'j/k move  Enter select  a all hits  q/Q quit' + RESET + '\n\n';

    if (!pickerFirstDraw) {
      process.stdout.write('\x1b[' + pickerLineCount + 'A\x1b[J');
    }
    pickerFirstDraw = false;
    pickerLineCount = countLines(out);
    process.stdout.write(out);
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  drawPicker();

  function onKey(key) {
    if (key === '\x03' || key === 'Q' || key === 'q') {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKey);
      process.stdout.write('\n');
      process.exit(exitCode);
      return;
    }
    if (key === 'a' || key === 'A') {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKey);
      runHitNavigator(allHits, tagIndex, null, exitCode);
      return;
    }
    if (key === '\r' || key === '\n') {
      var selectedTag = tags[cursor];
      var selectedHits = tagIndex[selectedTag];
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKey);
      runHitNavigator(selectedHits, tagIndex, selectedTag, exitCode);
      return;
    }
    if (key === 'j' || key === '\x1b[B') {
      if (cursor < tags.length - 1) { cursor++; drawPicker(); }
      return;
    }
    if (key === 'k' || key === '\x1b[A') {
      if (cursor > 0) { cursor--; drawPicker(); }
    }
  }

  stdin.on('data', onKey);
}

function runHitNavigator(hits, tagIndex, activeTag, exitCode) {
  if (hits.length === 0) {
    process.stdout.write('\n  No hits in this category.\n\n');
    var emptyBackHits = [];
    Object.keys(tagIndex).forEach(function (tag) {
      tagIndex[tag].forEach(function (hit) { emptyBackHits.push(hit); });
    });
    runTagPicker(tagIndex, emptyBackHits, exitCode);
    return;
  }

  var cursor = 0;
  var maxVisible = 14;
  var stdin = process.stdin;
  var label = activeTag ? activeTag : 'all hits';

  if (!stdin.isTTY) {
    process.stdout.write('\n  Hits (' + label + ') (requires interactive terminal for navigation):\n\n');
    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i];
      process.stdout.write(
        '  ' + hit.fileName + '  L' + hit.lineNumber +
        (hit.ruleId ? '  [' + hit.ruleId + ']' : '') +
        (hit.snippet ? '  ' + hit.snippet : '') + '\n'
      );
    }
    process.stdout.write('\n');
    process.exit(exitCode);
    return;
  }

  var navLineCount = 0;
  var navFirstDraw = true;

  function drawList() {
    var total = hits.length;
    var winStart = Math.max(0, cursor - Math.floor(maxVisible / 2));
    var winEnd = Math.min(total, winStart + maxVisible);
    if (winEnd - winStart < maxVisible) {
      winStart = Math.max(0, winEnd - maxVisible);
    }

    var out = '';
    out += '\n';
    out += '  ' + BOLD + label.toUpperCase() + RESET +
      '  ' + DIM + '(' + total + ' hit' + (total === 1 ? '' : 's') + ')' + RESET + '\n\n';

    var lastFile = null;
    for (var i = winStart; i < winEnd; i++) {
      var hit = hits[i];
      if (hit.filePath !== lastFile) {
        out += '  ' + DIM + '\u2014 ' + hit.fileName + ' \u2014' + RESET + '\n';
        lastFile = hit.filePath;
      }
      var selected = i === cursor;
      var marker = selected ? CYAN + '\u25b6' + RESET : ' ';
      var lineStr = DIM + 'L' + hit.lineNumber + RESET;
      var snipStr = DIM + hit.snippet + RESET;
      out += '  ' + marker + '  ' + lineStr + '  ' + snipStr + '\n';
    }

    if (total > maxVisible) {
      var pct = Math.round((cursor / Math.max(total - 1, 1)) * 100);
      out += '\n  ' + DIM + pct + '%  \u2014  ' + total + ' total' + RESET + '\n';
    }

    out += '\n  ' + DIM + 'j/k move  Enter open  q back to categories  Q quit' + RESET + '\n\n';

    if (!navFirstDraw) {
      process.stdout.write('\x1b[' + navLineCount + 'A\x1b[J');
    }
    navFirstDraw = false;
    navLineCount = countLines(out);
    process.stdout.write(out);
  }

  function openCurrent() {
    var hit = hits[cursor];
    stdin.setRawMode(false);
    stdin.pause();
    printHitContext(hit);
    openFileAtLine(hit.filePath, hit.lineNumber);
    stdin.resume();
    stdin.setRawMode(true);
    navFirstDraw = true;
    drawList();
  }

  function returnToPicker() {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.removeListener('data', onKey);
    var backHits = [];
    Object.keys(tagIndex).forEach(function (tag) {
      tagIndex[tag].forEach(function (hit) { backHits.push(hit); });
    });
    runTagPicker(tagIndex, backHits, exitCode);
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  drawList();

  function onKey(key) {
    if (key === '\x03' || key === 'Q') {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKey);
      process.stdout.write('\n');
      process.exit(exitCode);
      return;
    }
    if (key === 'q') {
      returnToPicker();
      return;
    }
    if (key === '\r' || key === '\n') {
      openCurrent();
      return;
    }
    if (key === 'j' || key === '\x1b[B') {
      if (cursor < hits.length - 1) { cursor++; drawList(); }
      return;
    }
    if (key === 'k' || key === '\x1b[A') {
      if (cursor > 0) { cursor--; drawList(); }
    }
  }

  stdin.on('data', onKey);
}

function _padRight(value, length) {
  var text = String(value);
  while (text.length < length) text += ' ';
  return text;
}

function _formatExplainNumber(value) {
  return typeof value === 'number' && isFinite(value) ? value.toFixed(4) : String(value);
}

function _explainLineNumber(hit) {
  if (hit && typeof hit.lineNumber === 'number' && hit.lineNumber > 0) return hit.lineNumber;
  if (hit && typeof hit.lineIndex === 'number' && hit.lineIndex >= 0) return hit.lineIndex + 1;
  return 1;
}

function findExplainTarget(registry, lineNumber) {
  var explainHits = [];
  var records = registry || [];

  for (var i = 0; i < records.length; i++) {
    var findings = records[i].findings || [];
    var review = records[i].review || [];

    for (var j = 0; j < findings.length; j++) explainHits.push(findings[j]);
    for (var k = 0; k < review.length; k++) explainHits.push(review[k]);
  }

  if (explainHits.length === 0) return null;

  return explainHits.reduce(function (best, hit) {
    var hitLine = _explainLineNumber(hit);
    var bestLine = _explainLineNumber(best);
    return Math.abs(hitLine - lineNumber) < Math.abs(bestLine - lineNumber) ? hit : best;
  });
}

function printExplain(hit) {
  var line = _explainLineNumber(hit);
  var preview = hit.value ? hit.value.slice(0, 60) : null;
  var signalDetails = hit.signals || {};
  var signalCount = hit.signalCount;
  var signals = [
    ['entropy', hit.charFreqSignal],
    ['bigram randomness', hit.bigramSignal],
    ['compression ratio', hit.compressionSignal],
    ['IC', signalDetails.ic],
  ];

  process.stdout.write('\n');
  process.stdout.write('  -- explain  L' + line + '\n\n');

  if (preview) {
    process.stdout.write('    ' + _padRight('candidate value', 20) + '"' + preview + '"\n');
  }
  if (hit.shape) {
    process.stdout.write('    ' + _padRight('shape', 20) + hit.shape + '\n');
  }
  if (hit.valueLength !== undefined) {
    process.stdout.write('    ' + _padRight('length', 20) + hit.valueLength + ' chars\n');
  }
  if (hit.structuralContext) {
    process.stdout.write('    ' + _padRight('context', 20) + hit.structuralContext + '\n');
  }
  if (hit.contextFactor !== undefined) {
    process.stdout.write('    ' + _padRight('context factor', 20) + hit.contextFactor + '\n');
  }

  process.stdout.write('\n    signals fired\n');
  for (var i = 0; i < signals.length; i++) {
    if (signals[i][1] !== undefined && signals[i][1] !== null) {
      process.stdout.write('      ' + _padRight(signals[i][0], 24) + _formatExplainNumber(signals[i][1]) + '\n');
    }
  }

  process.stdout.write('\n');
  if (signalCount !== undefined) {
    process.stdout.write('    ' + _padRight('signals agreed', 20) + signalCount + '\n');
  }
  if (hit.pipelineScore !== undefined) {
    process.stdout.write('    ' + _padRight('pipeline score', 20) + _formatExplainNumber(hit.pipelineScore) + '\n');
  }
  if (hit.adjustedPipelineScore !== undefined) {
    process.stdout.write('    ' + _padRight('adjusted pipeline', 20) + _formatExplainNumber(hit.adjustedPipelineScore) + '\n');
  }
  if (hit.confidence) {
    process.stdout.write('    ' + _padRight('confidence', 20) + hit.confidence + '\n');
    process.stdout.write('    ' + _padRight('tier', 20) + hit.confidence + '\n');
  }

  process.stdout.write('\n');
  process.stdout.write('    ' + _padRight('verdict', 20) + (hit.confidence || (hit.pipelineScore !== undefined ? 'REVIEW' : '?')) + '\n\n');
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------
function buildHelp() {
  return [
    '',
    '  cszone38  v' + TOOL_VERSION,
    '',
    '  Static analysis for C# codebases.',
    '  Scores three axes on every run:',
    '    A  AI slop and structural over-engineering',
    '    B  secrets, exposure, and optional deep taint findings',
    '    C  code quality and maintenance risk',
    '',
    '  Quick start',
    '    cszone38 .                  Scan the current project',
    '    cszone38 . -v               Show flagged files in detail',
    '    cszone38 ./src --axis=B     Run a security-only pass',
    '    cszone38 Auth.cs --no-slop  Fast single-file Axis B+C scan',
    '',
    '  Deep analysis',
    '    cszone38 doctor',
    '    cszone38 setup deep',
    '    cszone38 setup deep --bundle=/path/to/deep-bundle',
    '    cszone38 . --deep',
    '',
    '  Usage',
    '    cszone38 <path> [options]',
    '    cszone38 doctor [--json]',
    '    cszone38 setup deep [--bundle=PATH]',
    '',
    '  Most used options',
    '    -v, --verbose           Show detailed file breakdown for flagged files',
    '    -a, --all               Show every file, not just flagged files',
    '    -j, --json              Output machine-readable JSON',
    '    -A, --axis=A,B,C        Limit the scan to selected axes',
    '    -S, --since=REF         Scan only files changed since a git ref',
    '        --deep              Run private Roslyn taint analysis when installed',
    '        --no-slop           Skip Axis A and WASM init for a faster B+C scan',
    '',
    '  Output control',
    '    -f, --file=NAME         Show one file only',
    '    -s, --show=SECTION      hits|secrets|review|exposure|breakdown',
    '    -o, --open              Open the interactive hit navigator',
    '        --explain=LINE      Explain the nearest signal near a line number',
    '',
    '  Maintenance and advanced',
    '        --fix               Apply supported offline fixes before scanning',
    '        --verify            Attempt opt-in credential verification',
    '        --allow-network     Permit provider network calls for --verify',
    '        --solution=PATH     Force a .sln, .slnx, or .csproj for --deep',
    '        --bundle=PATH       Manual bundle directory for setup deep fallback',
    '    -t, --threshold=A:N     Override an axis exit threshold, e.g. B:10',
    '',
    '  Commands',
    '        doctor              Show base and deep readiness',
    '        setup deep          Seed the installed companion package or install a private deep bundle',
    '',
    '  Info',
    '    -h, --help              Show this help',
    '    -V, --version           Show cszone38 version',
    '',
    '  Examples',
    '    npx cszone38 .',
    '    npx cszone38 ./src --verbose',
    '    npx cszone38 ./Auth.cs --no-slop --json',
    '    npx cszone38 . --axis=B --since=HEAD~1',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Argument parser — no dependencies, no magic
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  var opts = {
    command:   'scan',
    setupTopic: null,
    target:    null,
    verbose:   false,
    all:       false,
    file:      null,
    show:      null,
    axis:      null,
    open:      false,
    json:      false,
    fix:       false,
    since:     null,
    threshold: null,
    explain:   null,
    bundle:    null,
    solution:  null,
    deep:      false,
    verify:    false,
    allowNetwork: false,
    noSlop:    false,
    help:      false,
    version:   false,
  };

  var args = argv.slice(2);

  if (args[0] === 'setup') {
    opts.command = 'setup';
    opts.setupTopic = args[1] || null;
    args = args.slice(2);
  } else if (args[0] === 'doctor') {
    opts.command = 'doctor';
    args = args.slice(1);
  }

  for (var i = 0; i < args.length; i++) {
    var arg = args[i];

    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    if (arg === '--version' || arg === '-V') { opts.version = true; continue; }
    if (arg === '--verbose' || arg === '-v') { opts.verbose = true; continue; }
    if (arg === '--all' || arg === '-a') { opts.all = true; continue; }
    if (arg === '--open' || arg === '-o') { opts.open = true; continue; }
    if (arg === '--json' || arg === '-j') { opts.json = true; continue; }
    if (arg === '--fix') { opts.fix = true; continue; }
    if (arg === '--deep') { opts.deep = true; continue; }
    if (arg === '--verify') { opts.verify = true; continue; }
    if (arg === '--allow-network') { opts.allowNetwork = true; continue; }
    if (arg === '--no-slop') { opts.noSlop = true; continue; }
    if (arg.indexOf('--bundle=') === 0) { opts.bundle = arg.slice(9); continue; }
    if (arg === '--bundle' && args[i + 1]) { opts.bundle = args[++i]; continue; }

    // --file=NAME, -f=NAME, or -f NAME
    if (arg.indexOf('--file=') === 0) { opts.file = arg.slice(7); continue; }
    if (arg.indexOf('-f=') === 0) { opts.file = arg.slice(3); continue; }
    if ((arg === '--file' || arg === '-f') && args[i + 1]) { opts.file = args[++i]; continue; }

    // --show=SECTION or -s SECTION
    if (arg.indexOf('--show=') === 0) { opts.show = arg.slice(7); continue; }
    if ((arg === '--show' || arg === '-s') && args[i + 1]) { opts.show = args[++i]; continue; }

    // --axis=A,B,C or -A A,B,C
    if (arg.indexOf('--axis=') === 0) { opts.axis = arg.slice(7); continue; }
    if ((arg === '--axis' || arg === '-A') && args[i + 1]) { opts.axis = args[++i]; continue; }

    // --since=REF or -S REF
    if (arg.indexOf('--since=') === 0) { opts.since = arg.slice(8); continue; }
    if ((arg === '--since' || arg === '-S') && args[i + 1]) { opts.since = args[++i]; continue; }

    // --solution=PATH
    if (arg.indexOf('--solution=') === 0) { opts.solution = arg.slice(11); continue; }
    if (arg === '--solution' && args[i + 1]) { opts.solution = args[++i]; continue; }

    // --threshold=A:N or -t A:N
    if (arg.indexOf('--threshold=') === 0) { opts.threshold = arg.slice(12); continue; }
    if ((arg === '--threshold' || arg === '-t') && args[i + 1]) { opts.threshold = args[++i]; continue; }

    // --explain=LINE
    if (arg.indexOf('--explain=') === 0) {
      var explainEq = parseInt(arg.slice(10), 10);
      if (!isNaN(explainEq) && explainEq > 0) opts.explain = explainEq;
      continue;
    }
    if (arg === '--explain' && args[i + 1]) {
      var explainNext = parseInt(args[++i], 10);
      if (!isNaN(explainNext) && explainNext > 0) opts.explain = explainNext;
      continue;
    }

    // Positional argument — target path
    if (arg[0] !== '-' && opts.target === null) { opts.target = arg; continue; }
  }

  return opts;
}

function printDoctor(report) {
  process.stdout.write('\n');
  process.stdout.write('  DOCTOR\n\n');
  process.stdout.write('    ' + _padRight('base mode', 24) + 'ready\n');
  process.stdout.write('    ' + _padRight('node', 24) + report.base.nodeVersion + '\n');
  process.stdout.write('    ' + _padRight('deep mode', 24) + (report.deep.available ? 'ready' : 'unavailable') + '\n');
  process.stdout.write('    ' + _padRight('deep engine', 24) + report.deep.engine + (report.deep.engineVersion ? ' ' + report.deep.engineVersion : '') + '\n');
  process.stdout.write('    ' + _padRight('deep source', 24) + (report.deep.installSource || 'none') + '\n');
  if (report.deep.packageName) {
    process.stdout.write('    ' + _padRight('deep package', 24) + report.deep.packageName + '\n');
  }
  process.stdout.write('    ' + _padRight('deep store', 24) + report.deep.storeRoot + '\n');
  process.stdout.write('    ' + _padRight('deep manifest', 24) + report.deep.manifestPath + '\n');
  if (report.deep.available) {
    process.stdout.write('    ' + _padRight('security-scan', 24) + report.deep.securityScanPath + '\n');
    process.stdout.write('    ' + _padRight('sdk path', 24) + report.deep.sdkPath + '\n');
  } else if (report.deep.reason) {
    process.stdout.write('    ' + _padRight('reason', 24) + report.deep.reason + '\n');
  }
  process.stdout.write('\n');
}

function printDeepSetupResult(result) {
  process.stdout.write('\n');
  process.stdout.write('  DEEP SETUP\n\n');
  process.stdout.write('    ' + _padRight('engine', 24) + result.engine + (result.engineVersion ? ' ' + result.engineVersion : '') + '\n');
  process.stdout.write('    ' + _padRight('source', 24) + (result.installSource || 'bundle') + '\n');
  if (result.packageName) {
    process.stdout.write('    ' + _padRight('package', 24) + result.packageName + '\n');
  }
  process.stdout.write('    ' + _padRight('store root', 24) + result.storeRoot + '\n');
  process.stdout.write('    ' + _padRight('manifest', 24) + result.manifestPath + '\n');
  process.stdout.write('    ' + _padRight('security-scan', 24) + result.securityScanPath + '\n');
  process.stdout.write('    ' + _padRight('sdk path', 24) + result.sdkPath + '\n');
  process.stdout.write('\n');
}

function ensureDeepToolchain() {
  var explicitManifestPath = process.env.CSZONE38_DEEP_MANIFEST_PATH;
  var current;

  if (explicitManifestPath) return null;

  current = DeepToolchain.resolveToolchain();
  if (current.available) return current;

  return DeepToolchain.seedFromCompanionPackage();
}

function printFixSummary(result) {
  process.stdout.write('  FIX MODE  ·  ' + result.fileCount + ' file' + (result.fileCount === 1 ? '' : 's') + ' scanned\n\n');
  process.stdout.write('    changed files              ' + result.totals.changedFiles + '\n');
  process.stdout.write('    removed Console.WriteLine  ' + result.totals.consoleWriteLine + '\n');
  process.stdout.write('    resolved TODO markers      ' + result.totals.todoMarkers + '\n');
  process.stdout.write('    repaired empty catch       ' + result.totals.emptyCatchBlocks + '\n\n');
}

function _countByFile(items) {
  var counts = {};

  for (var i = 0; i < items.length; i++) {
    var file = items[i].file;
    if (!file) continue;
    counts[file] = (counts[file] || 0) + 1;
  }

  return counts;
}

function _fileMaxAxisScore(perFile) {
  var axes = perFile.axes || { A: 0, B: 0, C: 0 };
  return Math.max(axes.A || 0, axes.B || 0, axes.C || 0);
}

function _selectFocusFiles(report) {
  var patternsByFile = _countByFile(report.patternHits || []);
  var reviewByFile = _countByFile(report.review || []);
  var secretsByFile = _countByFile(report.secrets || []);
  var ranked = [];
  var seen = {};
  var perFile = report.perFile || [];

  for (var i = 0; i < perFile.length; i++) {
    var filePath = perFile[i].path;
    var patternCount = patternsByFile[filePath] || 0;
    var reviewCount = reviewByFile[filePath] || 0;
    var secretCount = secretsByFile[filePath] || 0;

    if (patternCount === 0 && reviewCount === 0 && secretCount === 0) continue;

    ranked.push({
      file: filePath,
      secretCount: secretCount,
      patternCount: patternCount,
      reviewCount: reviewCount,
      axisScore: _fileMaxAxisScore(perFile[i]),
    });
    seen[filePath] = true;
  }

  var countMaps = [secretsByFile, patternsByFile, reviewByFile];
  for (var m = 0; m < countMaps.length; m++) {
    var files = Object.keys(countMaps[m]);
    for (var j = 0; j < files.length; j++) {
      if (seen[files[j]]) continue;
      ranked.push({
        file: files[j],
        secretCount: secretsByFile[files[j]] || 0,
        patternCount: patternsByFile[files[j]] || 0,
        reviewCount: reviewByFile[files[j]] || 0,
        axisScore: 0,
      });
      seen[files[j]] = true;
    }
  }

  ranked.sort(function (left, right) {
    if (right.secretCount !== left.secretCount) return right.secretCount - left.secretCount;
    if (right.patternCount !== left.patternCount) return right.patternCount - left.patternCount;
    if (right.reviewCount !== left.reviewCount) return right.reviewCount - left.reviewCount;
    if (right.axisScore !== left.axisScore) return right.axisScore - left.axisScore;
    return left.file.localeCompare(right.file);
  });

  return ranked.slice(0, 3).map(function (entry) { return entry.file; });
}

function _summaryFindingLocation(report) {
  var findings = report.secrets || [];
  var deepFindings = report.deep && report.deep.findings ? report.deep.findings : [];
  if (findings.length === 0 && deepFindings.length === 0) return 'none';
  if (findings.length === 0) return path.basename(deepFindings[0].file || '') + ':' + deepFindings[0].line;
  return path.basename(findings[0].file || '') + ':' + findings[0].lineNumber;
}

function _prepareDisplayReport(report) {
  var displayReport = {};
  var keys = Object.keys(report || {});
  var reviewByFile = _countByFile((report && report.review) || []);

  for (var i = 0; i < keys.length; i++) {
    displayReport[keys[i]] = report[keys[i]];
  }

  displayReport.cleanFiles = ((report && report.cleanFiles) || []).filter(function (entry) {
    return !reviewByFile[entry.file];
  });

  return displayReport;
}

function renderResultSummary(report, opts) {
  var secrets = report.secrets || [];
  var deepFindings = report.deep && report.deep.findings ? report.deep.findings : [];
  var reviewBuckets = L15._splitReviewHierarchy(report.review || []);
  var visibleCandidates = reviewBuckets.act.length + reviewBuckets.look.length;
  var hiddenCandidates = reviewBuckets.log.length;
  var detailVisible = !!(opts && (opts.verbose || opts.all || opts.file || opts.show));
  var lookHint = detailVisible ? 'shown below' : 'run with -v to see';
  var logHint = opts && opts.all ? 'shown below' : 'hidden (--all to show)';
  var lines = [];

  lines.push('');
  lines.push('  ' + _padRight('Act on this', 15) + (secrets.length + deepFindings.length) + ' high-signal finding' + ((secrets.length + deepFindings.length) === 1 ? '' : 's') + '  -> ' + _summaryFindingLocation(report));
  lines.push('  ' + _padRight('Worth a look', 15) + visibleCandidates + ' candidate' + (visibleCandidates === 1 ? '' : 's') + '  -> ' + lookHint);
  lines.push('  ' + _padRight('Math logged', 15) + hiddenCandidates + ' low-signal item' + (hiddenCandidates === 1 ? '' : 's') + '  -> ' + logHint);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  var opts = parseArgs(process.argv);

  if (opts.version) {
    process.stdout.write('cszone38 ' + TOOL_VERSION + '\n');
    process.exit(0);
  }

  if (opts.command === 'doctor') {
    var doctorReport = DeepToolchain.doctor();
    if (opts.json) {
      process.stdout.write(JSON.stringify(doctorReport) + '\n');
    } else {
      printDoctor(doctorReport);
    }
    process.exit(0);
  }

  if (opts.command === 'setup') {
    if (opts.setupTopic !== 'deep') {
      process.stderr.write('cszone38: setup only supports `deep` right now\n');
      process.exit(1);
    }

    var setupResult = opts.bundle
      ? DeepToolchain.installBundle(opts.bundle)
      : DeepToolchain.seedFromCompanionPackage();
    if (!setupResult.ok) {
      process.stderr.write('cszone38: setup deep failed: ' + setupResult.reason + '\n');
      process.exit(1);
    }

    printDeepSetupResult(setupResult);
    process.exit(0);
  }

  if (opts.help || opts.target === null) {
    process.stdout.write(buildHelp() + '\n');
    process.exit(opts.help ? 0 : 1);
  }

  var targetPath = path.resolve(opts.target);
  var parserBundle = null;
  var progress = null;

  if (!fs.existsSync(targetPath)) {
    process.stderr.write('cszone38: path not found: ' + targetPath + '\n');
    process.exit(1);
  }

  if (opts.fix) {
    printFixSummary(Fixer.fixTarget(targetPath, { since: opts.since }));
    process.exit(0);
  }

  progress = ProgressUi.createProgressDisplay({
    enabled: !!(process.stdout.isTTY && !opts.json),
    stream: process.stdout,
    version: TOOL_VERSION,
    targetPath: targetPath,
    deep: opts.deep,
    verify: opts.verify,
  });

  try {
    if (opts.deep) {
      ensureDeepToolchain();
    }

    progress.event({
      type: 'init',
      note: opts.noSlop ? 'preparing fast Axis B+C pipeline' : 'loading C# parser',
    });

    if (!opts.noSlop) {
      parserBundle = await WasmParser.initialize();
    }

    var result = api.run(targetPath, {
      parser: parserBundle,
      noSlop: opts.noSlop,
      since: opts.since,
      solution: opts.solution,
      deep: opts.deep,
      verify: opts.verify,
      allowNetwork: opts.allowNetwork,
      onProgress: progress.event,
    });
    var report = _prepareDisplayReport(result.report);
    var thresholds = L15._parseThresholds(opts.threshold);
    var completionFrame = '';

    if (opts.json) {
      progress.stop();
      process.stdout.write(api.renderJson(result.report) + '\n');
    } else {
      if (opts.since && report.projectSummary && report.projectSummary.fileCount === 0) {
        progress.stop();
        process.stdout.write('  No changed C# files since ' + opts.since + '. Nothing to scan.\n\n');
        process.exit(0);
      }

      completionFrame = progress.complete({
        fileCount: report.projectSummary && report.projectSummary.fileCount ? report.projectSummary.fileCount : 0,
        totalLines: report.projectSummary && report.projectSummary.totalLines ? report.projectSummary.totalLines : 0,
        deep: report.deep,
        finishedAt: Date.now(),
      });
      if (completionFrame) process.stdout.write(completionFrame);

      process.stdout.write(renderResultSummary(report, opts));
      process.stdout.write(L15.renderCli(report, {
        verbose: opts.verbose,
        all: opts.all,
        file: opts.file,
        axis: opts.axis,
        show: opts.show,
        compact: !opts.verbose && !opts.all && !opts.file && !opts.show,
        targetPath: path.resolve(targetPath),
        thresholds: thresholds,
      }));
    }

    var exitCode = api.exitCode((report.projectSummary && report.projectSummary.axes) || { A: 0, B: 0, C: 0 }, thresholds);

    if (opts.explain !== null && !opts.json) {
      var isDirectory = false;

      try {
        isDirectory = fs.statSync(targetPath).isDirectory();
      } catch (err) {
        isDirectory = false;
      }

      if (isDirectory) {
        process.stdout.write('  warning: --explain requires a single file path, not a directory\n');
      } else {
        var explainTarget = findExplainTarget(result.registry, opts.explain);
        if (!explainTarget) {
          process.stdout.write('  --explain: no hit found near L' + opts.explain + '\n');
        } else {
          printExplain(explainTarget);
        }
      }
    }

    if (opts.open && !opts.json) {
      var allHits = collectAllHits(report.patternHits || [], path.resolve(targetPath));
      var tagIndex = buildTagIndex(allHits);

      if (allHits.length === 0) {
        process.stdout.write('\n  No hits to navigate.\n\n');
        process.exit(exitCode);
        return;
      }

      runTagPicker(tagIndex, allHits, exitCode);
      return;
    }

    process.exit(exitCode);
  } finally {
    progress.stop();
  }
}

main().catch(function (err) {
  process.stderr.write('cszone38: fatal: ' + err.message + '\n');
  process.exit(1);
});
