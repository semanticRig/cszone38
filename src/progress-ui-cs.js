'use strict';

var RESET = '\x1b[0m';
var BOLD = '\x1b[1m';
var DIM = '\x1b[2m';
var CYAN = '\x1b[36m';
var FRAME_WIDTH = 78;
var MIN_FRAME_WIDTH = 15;
var MAX_FRAME_WIDTH = 110;
var FRAME_LABEL_WIDTH = 13;

function _repeat(ch, count) {
  var out = '';
  for (var i = 0; i < count; i++) out += ch;
  return out;
}

function _padRight(value, length) {
  var text = String(value);
  while (text.length < length) text += ' ';
  return text;
}

function _countLines(text) {
  var count = 0;

  for (var i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }

  return count;
}

function _stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function _truncateMiddle(value, maxLength) {
  var text = String(value || 'pending');
  var headLength;

  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);

  headLength = Math.max(1, Math.floor((maxLength - 3) / 2));
  return text.slice(0, headLength) + '...' + text.slice(-(maxLength - 3 - headLength));
}

function _truncateAnsiEnd(value, maxVisibleLength) {
  var text = String(value || '');
  var plain = _stripAnsi(text);
  var limit = Math.max(0, maxVisibleLength || 0);
  var visibleLimit;
  var visible = 0;
  var index = 0;
  var out = '';
  var ansiEnd;
  var hasAnsi = plain !== text;

  if (plain.length <= limit) return text;
  if (limit <= 3) return plain.slice(0, limit);

  visibleLimit = limit - 3;

  while (index < text.length && visible < visibleLimit) {
    if (text[index] === '\x1b') {
      ansiEnd = index + 1;
      while (ansiEnd < text.length && text[ansiEnd] !== 'm') ansiEnd++;
      if (ansiEnd < text.length) ansiEnd++;
      out += text.slice(index, ansiEnd);
      index = ansiEnd;
      continue;
    }

    out += text[index];
    visible++;
    index++;
  }

  return out + '...' + (hasAnsi ? RESET : '');
}

function _resolveMaxFrameWidth(columns) {
  if (!columns || columns < 1) return MAX_FRAME_WIDTH;
  return Math.max(MIN_FRAME_WIDTH, Math.min(MAX_FRAME_WIDTH, columns - 4));
}

function _requiredFrameWidth(rows) {
  var width = FRAME_WIDTH;

  for (var i = 0; i < rows.length; i++) {
    width = Math.max(width, 1 + FRAME_LABEL_WIDTH + _stripAnsi(rows[i].value).length);
  }

  return width;
}

function _resolveFrameWidth(rows, maxFrameWidth) {
  var desired = _requiredFrameWidth(rows);
  var ceiling = maxFrameWidth || desired;

  return Math.min(desired, ceiling);
}

function _frameBorder(left, right, frameWidth) {
  return '  ' + DIM + left + _repeat('─', frameWidth) + right + RESET;
}

function _formatElapsed(startedAt, now) {
  var elapsed = Math.max(0, (now || Date.now()) - startedAt);
  var minutes = Math.floor(elapsed / 60000);
  var seconds = Math.floor((elapsed % 60000) / 1000);
  var tenths = Math.floor((elapsed % 1000) / 100);
  var minuteText = minutes < 10 ? '0' + minutes : String(minutes);
  var secondText = seconds < 10 ? '0' + seconds : String(seconds);

  return minuteText + ':' + secondText + '.' + tenths;
}

function _formatShortDuration(ms) {
  var value = Math.max(0, ms || 0);

  if (value < 1000) return value + 'ms';
  if (value < 60000) return (value / 1000).toFixed(1) + 's';
  return _formatElapsed(0, value);
}

function _formatCount(value) {
  return String(Math.max(0, value || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function _formatRate(current, startedAt, now) {
  var elapsed = Math.max(1, (now || Date.now()) - startedAt);
  var rate = current > 0 ? (current * 1000) / elapsed : 0;

  return rate.toFixed(2) + ' f/s';
}

function _phaseOrder(opts) {
  var order = ['init', 'scan'];

  if (opts && opts.deep) order.push('deep');
  if (opts && opts.verify) order.push('verify');

  return order;
}

function _phaseLabel(phase) {
  if (phase === 'init') return 'INITIALIZE';
  if (phase === 'scan') return 'SCAN';
  if (phase === 'deep') return 'DEEP';
  if (phase === 'verify') return 'VERIFY';
  return 'SCAN';
}

function _renderBar(current, total, width) {
  var ratio = total > 0 ? current / total : 0;
  var filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);

  return _repeat('█', filled) + _repeat('░', Math.max(0, width - filled));
}

function _renderFileProgress(current, total) {
  if (total <= 0) return 'collecting targets';
  return current + '/' + total + '  ' + ((current / total) * 100).toFixed(1) + '%';
}

function _renderPhaseTrack(phaseOrder, activePhase) {
  var chips = [];

  for (var i = 0; i < phaseOrder.length; i++) {
    var phase = phaseOrder[i];
    var active = phase === activePhase;
    var label = _phaseLabel(phase);

    if (active) {
      chips.push(CYAN + '[' + label + ']' + RESET);
    } else {
      chips.push(DIM + label + RESET);
    }
  }

  return chips.join('  ');
}

function _isPartialDeepWarning(deep) {
  return !!(deep && deep.warning && /^--deep scan incomplete/i.test(String(deep.warning)));
}

function _renderFrameLine(label, value, frameWidth) {
  var width = frameWidth || FRAME_WIDTH;
  var left = '  ' + DIM + '│' + RESET + ' ' + _padRight(label, FRAME_LABEL_WIDTH);
  var maxValueWidth = Math.max(1, width - 1 - FRAME_LABEL_WIDTH);
  var fittedValue = _truncateAnsiEnd(value, maxValueWidth);
  var padding = maxValueWidth - _stripAnsi(fittedValue).length;

  if (padding < 0) padding = 0;

  return left + fittedValue + _repeat(' ', padding) + DIM + '│' + RESET;
}

function _formatCompletion(state, summary) {
  summary = summary || {};

  var filesText = _formatCount(summary.fileCount || 0) + ' files';
  var linesText = _formatCount(summary.totalLines || 0) + ' lines';
  var totalText = 'total ' + _formatElapsed(state.startedAt, summary.finishedAt || state.now);
  var cadenceText = 'cadence ' + _formatRate(summary.fileCount || state.fileCurrent, state.startedAt, summary.finishedAt || state.now);
  var deepText = 'disabled';
  var deep = summary.deep || null;
  var findingCount = 0;
  var lines = [];
  var rows;
  var frameWidth;
  var detail;

  if (deep && deep.requested) {
    findingCount = Array.isArray(deep.findings) ? deep.findings.length : 0;

    if (!deep.available) {
      deepText = 'unavailable';
    } else if (deep.warning && !deep.attempted) {
      deepText = 'skipped';
    } else if (_isPartialDeepWarning(deep)) {
      deepText = 'partial';
    } else if (deep.warning) {
      deepText = 'fallback';
    } else if (findingCount > 0) {
      deepText = findingCount + ' finding' + (findingCount === 1 ? '' : 's');
    } else {
      deepText = 'scanned clean';
    }

    if (_isPartialDeepWarning(deep) && findingCount > 0) {
      deepText += '  ' + findingCount + ' finding' + (findingCount === 1 ? '' : 's');
    }

    detail = _deepCompletionDetail(deep);
    if (detail) {
      deepText += '  ' + detail;
    }
    if (deep.scan_time_ms > 0) {
      deepText += '  runtime ' + _formatShortDuration(deep.scan_time_ms);
    }
    if (deep.engine) {
      deepText += '  engine ' + deep.engine;
    }
  }

  rows = [
    { label: 'completion', value: BOLD + 'COMPLETE' + RESET + '  ' + filesText + '  ' + linesText + '  ' + totalText + '  ' + cadenceText },
    { label: 'deep', value: deepText },
  ];
  frameWidth = _resolveFrameWidth(rows, state && state.maxFrameWidth);

  lines.push('');
  lines.push(_frameBorder('┌', '┐', frameWidth));
  lines.push(_renderFrameLine(rows[0].label, rows[0].value, frameWidth));
  lines.push(_renderFrameLine(rows[1].label, rows[1].value, frameWidth));
  lines.push(_frameBorder('└', '┘', frameWidth));
  lines.push('');

  return lines.join('\n');
}

function _deepCompletionDetail(deep) {
  var warning = String(deep && deep.warning || '');

  if (!warning) return '';
  if (/^--deep scan incomplete/i.test(warning)) return 'project load failures';
  if (/requires a \.sln, \.slnx, or \.csproj/i.test(warning)) return 'requires .sln/.slnx/.csproj';
  if (/unavailable/i.test(warning)) return 'toolchain unavailable';
  if (/timed out/i.test(warning)) return 'timed out; math-only fallback';
  if (/scan failed/i.test(warning)) return 'scan failed; math-only fallback';
  return _truncateMiddle(warning.replace(/^--deep\s+/i, ''), 44);
}

function _formatFrame(state) {
  var phaseIndex = state.phaseOrder.indexOf(state.phase) + 1;
  var targetText = state.currentFile || state.note || state.targetPath || 'pending';
  var fileBar = _renderBar(state.fileCurrent, state.fileTotal, 24);
  var fileProgress = _renderFileProgress(state.fileCurrent, state.fileTotal);
  var rate = _formatRate(state.fileCurrent, state.startedAt, state.now);
  var phaseValue = _renderPhaseTrack(state.phaseOrder, state.phase) + '  ' + DIM + '[' + phaseIndex + '/' + state.phaseOrder.length + ']' + RESET;
  var fileValue = fileBar + '  ' + fileProgress + '  ' + DIM + 'cadence' + RESET + ' ' + rate;
  var elapsedValue = _formatElapsed(state.startedAt, state.now) + '  ' + DIM + 'target' + RESET + '  ' + _truncateMiddle(targetText, 46);
  var rows;
  var frameWidth;
  var lines = [];

  if (phaseIndex < 1) phaseIndex = 1;

  rows = [
    { label: 'phase matrix', value: phaseValue },
    { label: 'file vector', value: fileValue },
    { label: 'elapsed', value: elapsedValue },
  ];
  frameWidth = _resolveFrameWidth(rows, state && state.maxFrameWidth);

  lines.push('');
  lines.push('  ' + BOLD + 'cszone38' + RESET + '  v' + state.version + '  ' + DIM + 'ANALYSIS PIPELINE' + RESET);
  lines.push(_frameBorder('┌', '┐', frameWidth));
  lines.push(_renderFrameLine(rows[0].label, rows[0].value, frameWidth));
  lines.push(_renderFrameLine(rows[1].label, rows[1].value, frameWidth));
  lines.push(_renderFrameLine(rows[2].label, rows[2].value, frameWidth));
  lines.push(_frameBorder('└', '┘', frameWidth));

  return lines.join('\n') + '\n';
}

function createProgressDisplay(opts) {
  opts = opts || {};

  if (!opts.enabled) {
    return {
      event: function () {},
      complete: function () { return ''; },
      stop: function () {},
    };
  }

  var stream = opts.stream || process.stdout;
  var state = {
    version: opts.version || '0.0.0',
    phaseOrder: _phaseOrder(opts),
    phase: 'init',
    fileCurrent: 0,
    fileTotal: 0,
    currentFile: null,
    note: opts.note || 'preparing pipeline',
    targetPath: opts.targetPath || '',
    startedAt: Date.now(),
    now: Date.now(),
    maxFrameWidth: _resolveMaxFrameWidth((stream && stream.columns) || process.stdout.columns),
    lineCount: 0,
    drawn: false,
  };

  function render() {
    state.maxFrameWidth = _resolveMaxFrameWidth((stream && stream.columns) || process.stdout.columns);
    var frame = _formatFrame(state);

    if (state.drawn) {
      stream.write('\x1b[' + state.lineCount + 'A\x1b[J');
    }

    stream.write(frame);
    state.lineCount = _countLines(frame);
    state.drawn = true;
  }

  return {
    event: function (event) {
      event = event || {};
      state.now = Date.now();

      if (event.type === 'init') {
        state.phase = 'init';
        state.note = event.note || state.note;
      } else if (event.type === 'discover') {
        state.phase = 'scan';
        state.fileTotal = event.total || 0;
        state.targetPath = event.targetPath || state.targetPath;
        state.note = state.fileTotal > 0 ? 'collected ' + state.fileTotal + ' file' + (state.fileTotal === 1 ? '' : 's') : 'no C# files found';
      } else if (event.type === 'scan') {
        state.phase = 'scan';
        state.fileCurrent = event.current || 0;
        state.fileTotal = event.total || state.fileTotal;
        state.currentFile = event.file || state.currentFile;
        state.note = state.currentFile || state.note;
      } else if (event.type === 'deep-start') {
        state.phase = 'deep';
        state.currentFile = null;
        state.note = event.note || 'running Roslyn taint analysis';
      } else if (event.type === 'verify-start') {
        state.phase = 'verify';
        state.currentFile = null;
        state.note = event.note || 'verifying confirmed credentials';
      }

      render();
    },
    complete: function (summary) {
      state.now = Date.now();
      this.stop();
      return _formatCompletion(state, summary);
    },
    stop: function () {
      if (!state.drawn) return;
      stream.write('\x1b[' + state.lineCount + 'A\x1b[J');
      state.drawn = false;
      state.lineCount = 0;
    },
  };
}

module.exports = {
  createProgressDisplay: createProgressDisplay,
  _formatCompletion: _formatCompletion,
  _formatFrame: _formatFrame,
  _phaseOrder: _phaseOrder,
};