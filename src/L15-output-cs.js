'use strict';

var RESET = '\x1b[0m';
var BOLD = '\x1b[1m';
var DIM = '\x1b[2m';
var RED = '\x1b[31m';
var GREEN = '\x1b[32m';
var YELLOW = '\x1b[33m';
var CYAN = '\x1b[36m';
var GRAY = '\x1b[90m';

var CATEGORY_COLOR = {
  security: RED,
  'config-exposure': RED,
  slopsquatting: RED,
  'error-handling': RED,
  'debug-pollution': YELLOW,
  'context-confusion': YELLOW,
  'structure-smell': YELLOW,
  'complexity-spike': YELLOW,
  'magic-values': YELLOW,
  'comment-mismatch': YELLOW,
  'scaffold-residue': YELLOW,
  'promise-graveyard': YELLOW,
  'async-abuse': YELLOW,
  'dead-code': CYAN,
  'over-engineering': CYAN,
  dependency: CYAN,
  'import-hygiene': CYAN,
  'clone-pollution': CYAN,
  'accessor-bloat': CYAN,
  'interface-bloat': CYAN,
  'branch-symmetry': CYAN,
  'type-theater': CYAN,
  'test-theater': CYAN,
  'naming-entropy': CYAN,
  verbosity: GRAY,
};

var DEFAULT_THRESHOLDS = { A: 50, B: 25, C: 100 };
var VALID_SECTIONS = { hits: true, secrets: true, review: true, exposure: true, breakdown: true };
var AXIS_DEFS = [
  { key: 'A', label: 'AI SLOP' },
  { key: 'B', label: 'SECURITY' },
  { key: 'C', label: 'QUALITY' },
];
var VERDICT_MAP = {
  Clean: 'CLEAN',
  Minimal: 'MINIMAL',
  'Some issues': 'SOME ISSUES',
  Concerning: 'NOTICEABLE',
  Heavy: 'HEAVY',
  Critical: 'CATASTROPHIC',
};
var ACT_SCORE_FLOOR = 0.70;
var LOOK_SCORE_FLOOR = 0.55;
var ACT_LEN_FLOOR = 16;
var LOOK_LEN_FLOOR = 12;
var MAX_ACT_DEFAULT = 3;
var MAX_LOOK_DEFAULT = 5;
var ANSI_RE = /\x1b\[[0-9;]*m/g;
var KW_RE = /\b(var|let|const|function|return|if|else|new|this|class|import|require|async|await|throw|typeof|instanceof)\b/g;
var STR_RE = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

function _severityColor(severity) {
  if (severity >= 9) return RED;
  if (severity >= 7) return YELLOW;
  if (severity >= 5) return CYAN;
  return GRAY;
}

function _categoryColor(category) {
  return CATEGORY_COLOR[category] || YELLOW;
}

function _highlight(line) {
  if (!line || typeof line !== 'string') return '';
  var commentIdx = line.indexOf('//');
  var code = commentIdx !== -1 ? line.slice(0, commentIdx) : line;
  var comment = commentIdx !== -1 ? line.slice(commentIdx) : '';

  code = code.replace(STR_RE, function (match) { return GREEN + match + RESET; });
  code = code.replace(KW_RE, function (match) { return CYAN + match + RESET; });

  if (comment) code += GRAY + comment + RESET;
  return code;
}

function _groupByCategory(hits) {
  var order = [];
  var map = {};
  for (var i = 0; i < hits.length; i++) {
    var category = hits[i].category || 'unknown';
    if (!map[category]) {
      map[category] = [];
      order.push(category);
    }
    map[category].push(hits[i]);
  }

  var groups = [];
  for (var j = 0; j < order.length; j++) {
    groups.push({ category: order[j], hits: map[order[j]] });
  }
  return groups;
}

function _padLeft(value, length) {
  var text = String(value);
  while (text.length < length) text = ' ' + text;
  return text;
}

function _padRight(value, length) {
  var text = String(value);
  while (text.length < length) text += ' ';
  return text;
}

function _scoreColor(score) {
  if (score <= 10) return '';
  if (score <= 50) return YELLOW;
  return RED;
}

function _verdictLabel(verdict) {
  return VERDICT_MAP[verdict] || String(verdict || '').toUpperCase();
}

function _axisAVerdict(score) {
  if (score < 15) return 'Looks human-written';
  if (score < 35) return 'Mixed - some AI-assisted patterns';
  if (score < 60) return 'Heavily AI-scaffolded';
  return 'Likely fully generated - audit before merge';
}

function _axisVerdictLabel(axisKey, score, verdict) {
  if (axisKey === 'A') return _axisAVerdict(score || 0);
  return _verdictLabel(verdict);
}

function _bar(score, width) {
  var filled = Math.round(score / 100 * width);
  if (filled > width) filled = width;
  var empty = width - filled;
  return '\u2500'.repeat(filled) + '\u2591'.repeat(empty);
}

function _signalLabel(value) {
  if (value == null) return '?';
  if (value < 0.33) return 'low';
  if (value < 0.66) return 'medium';
  return 'high';
}

function _parseAxisFilter(axisArg) {
  if (!axisArg) return null;
  var parts = axisArg.toUpperCase().split(',');
  var filter = {};
  for (var i = 0; i < parts.length; i++) {
    var axis = parts[i].trim();
    if (axis === 'A' || axis === 'B' || axis === 'C') filter[axis] = true;
  }
  return Object.keys(filter).length > 0 ? filter : null;
}

function _parseThresholds(thresholdArg) {
  var thresholds = { A: DEFAULT_THRESHOLDS.A, B: DEFAULT_THRESHOLDS.B, C: DEFAULT_THRESHOLDS.C };
  if (!thresholdArg) return thresholds;

  var parts = thresholdArg.split(',');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split(':');
    if (kv.length !== 2) continue;
    var axis = kv[0].trim().toUpperCase();
    var value = parseInt(kv[1], 10);
    if ((axis === 'A' || axis === 'B' || axis === 'C') && !isNaN(value)) {
      thresholds[axis] = value;
    }
  }

  return thresholds;
}

function _parseShowFilter(showArg) {
  if (!showArg) return null;
  var parts = showArg.toLowerCase().split(',');
  var filter = {};
  for (var i = 0; i < parts.length; i++) {
    var name = parts[i].trim();
    if (VALID_SECTIONS[name]) filter[name] = true;
  }
  return Object.keys(filter).length > 0 ? filter : null;
}

function _shouldShow(sectionName, showFilter) {
  if (!showFilter) return true;
  return showFilter[sectionName] === true;
}

function _commaNum(number) {
  var text = String(number);
  var parts = [];
  while (text.length > 3) {
    parts.unshift(text.slice(-3));
    text = text.slice(0, -3);
  }
  parts.unshift(text);
  return parts.join(',');
}

function _countByFile(items) {
  var map = {};
  for (var i = 0; i < items.length; i++) {
    var file = items[i].file;
    if (!file) continue;
    map[file] = (map[file] || 0) + 1;
  }
  return map;
}

function _basename(filePath) {
  if (!filePath) return '';
  var index = filePath.lastIndexOf('/');
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

function _renderAxisTable(axes, verdicts, axisFilter) {
  var lines = [];
  for (var i = 0; i < AXIS_DEFS.length; i++) {
    var axis = AXIS_DEFS[i];
    if (axisFilter && !axisFilter[axis.key]) continue;
    var score = axes[axis.key] || 0;
    var color = _scoreColor(score);
    var verdict = _axisVerdictLabel(axis.key, score, verdicts[axis.key] || 'Clean');
    lines.push('  ' + axis.key + '  ' + _padRight(axis.label, 13)
      + color + _padLeft(score.toFixed(1), 5) + RESET
      + '   ' + color + _bar(score, 23) + RESET
      + '  ' + color + verdict + RESET);
  }
  return lines;
}

function _renderExitLine(code, axes, thresholds) {
  var t = thresholds || DEFAULT_THRESHOLDS;
  if (code === 0) {
    return '  EXIT 0' + DIM + '  .  all axes within thresholds' + RESET;
  }

  var reasons = [];
  if ((axes.A || 0) > t.A) reasons.push('Axis A exceeds threshold (' + t.A + ')');
  if ((axes.B || 0) > t.B) reasons.push('Axis B exceeds threshold (' + t.B + ')');
  if ((axes.C || 0) > t.C) reasons.push('Axis C exceeds threshold (' + t.C + ')');
  return '  EXIT 1' + DIM + '  .  ' + reasons.join(', ') + RESET;
}

function _renderPatternHits(hits, fileFilter, verbose) {
  if (!hits || hits.length === 0) return [];

  var filtered = [];
  for (var i = 0; i < hits.length; i++) {
    if (!fileFilter || hits[i].file === fileFilter) filtered.push(hits[i]);
  }
  if (filtered.length === 0) return [];

  var lines = [];
  lines.push('');
  lines.push(BOLD + 'PATTERN HITS' + RESET + '  ' + DIM + '(' + filtered.length + ')' + RESET);
  lines.push('');

  var groups = _groupByCategory(filtered);
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    var dashes = Math.max(0, 40 - group.category.length);
    lines.push('  ' + DIM + '-- ' + group.category + ' ' + '-'.repeat(dashes) + RESET);

    if (!verbose) {
      var byRule = {};
      var order = [];
      for (var r = 0; r < group.hits.length; r++) {
        var hit = group.hits[r];
        var key = hit.ruleId || 'unknown';
        if (!byRule[key]) {
          byRule[key] = { ruleId: key, category: hit.category, severity: hit.severity, fix: hit.fix, hits: [] };
          order.push(key);
        }
        byRule[key].hits.push(hit);
      }

      for (var o = 0; o < order.length; o++) {
        var ruleGroup = byRule[order[o]];
        var count = ruleGroup.hits.length;
        var badge = _categoryColor(ruleGroup.category) + '[' + ruleGroup.ruleId + ']' + RESET;
        var severityColor = _severityColor(ruleGroup.severity || 0);
        var firstLines = ruleGroup.hits.slice(0, 3).map(function (item) { return 'L' + item.lineNumber; }).join(' ');
        var more = count > 3 ? '  ' + DIM + '+' + (count - 3) + ' more' + RESET : '';
        lines.push('  ' + badge + '  ' + severityColor + BOLD + count + ' hit' + (count === 1 ? '' : 's') + RESET
          + '  ' + DIM + '-' + RESET + '  ' + firstLines + more);

        var examples = ruleGroup.hits.slice().sort(function (left, right) {
          return (right.severity || 0) - (left.severity || 0);
        }).slice(0, 2);
        for (var e = 0; e < examples.length; e++) {
          if (!examples[e].source) continue;
          var snippet = examples[e].source.trim();
          if (snippet.length > 72) snippet = snippet.substring(0, 71) + '...';
          lines.push('     ' + DIM + 'L' + _padRight(String(examples[e].lineNumber), 4) + RESET + ' | ' + _highlight(snippet));
        }
        if (ruleGroup.fix) {
          lines.push('     ' + GREEN + '-> ' + ruleGroup.fix + RESET);
        }
        lines.push('');
      }
      continue;
    }

    for (var j = 0; j < group.hits.length; j++) {
      var groupedHit = group.hits[j];
      var lineTag = 'L' + groupedHit.lineNumber;
      var hitBadge = _categoryColor(groupedHit.category) + '[' + groupedHit.ruleId + ']' + RESET;
      lines.push('  ' + _severityColor(groupedHit.severity || 0) + BOLD + _padRight(lineTag, 6) + RESET + '  ' + hitBadge);
      if (groupedHit.source) {
        var source = groupedHit.source.trim();
        if (source.length > 80) source = source.substring(0, 79) + '...';
        lines.push('          | ' + _highlight(source));
      }
      if (groupedHit.fix) {
        lines.push('          | ' + GREEN + '-> ' + groupedHit.fix + RESET);
      }
      lines.push('');
    }
  }

  if (!verbose) {
    lines.push('  ' + DIM + 'run with -v to see every hit line' + RESET);
    lines.push('');
  }

  return lines;
}

function _dedupeReview(items) {
  var seen = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var key = items[i].file + ':' + items[i].lineNumber + ':' + (items[i].value || '');
    if (seen[key]) continue;
    seen[key] = true;
    out.push(items[i]);
  }
  return out;
}

function _reviewTier(item) {
  var score = item.pipelineScore || 0;
  var length = item.valueLength || 0;
  if (score >= ACT_SCORE_FLOOR && length > ACT_LEN_FLOOR) return 'ACT';
  if (score >= LOOK_SCORE_FLOOR && score < ACT_SCORE_FLOOR && length > LOOK_LEN_FLOOR) return 'LOOK';
  return 'LOG';
}

function _splitReviewHierarchy(items) {
  var deduped = _dedupeReview(items || []);
  var tiers = { act: [], look: [], log: [] };

  for (var i = 0; i < deduped.length; i++) {
    var tier = _reviewTier(deduped[i]);
    if (tier === 'ACT') tiers.act.push(deduped[i]);
    else if (tier === 'LOOK') tiers.look.push(deduped[i]);
    else tiers.log.push(deduped[i]);
  }

  return tiers;
}

function _renderReviewItem(tag, item, includeFile) {
  var score = typeof item.pipelineScore === 'number' ? item.pipelineScore.toFixed(2) : '0.00';
  var length = item.valueLength || 0;
  var fileText = includeFile ? '  ' + item.file : '';
  return '  [' + tag + ']  '
    + _padRight('L' + item.lineNumber, 6)
    + DIM + 'score=' + score + '  len=' + _padLeft(length, 3)
    + '  char-freq:' + _signalLabel(item.charFreqSignal)
    + '  bigram:' + _signalLabel(item.bigramSignal)
    + fileText + RESET;
}

function _appendReviewTier(lines, tag, items, maxVisible, includeFile, showAll) {
  if (!items.length) return;

  var visible = showAll ? items : items.slice(0, maxVisible);
  lines.push('  [' + tag + ']  ' + items.length + ' candidate' + (items.length === 1 ? '' : 's'));
  for (var i = 0; i < visible.length; i++) {
    lines.push(_renderReviewItem(tag, visible[i], includeFile));
  }

  if (!showAll && items.length > visible.length) {
    lines.push('  ' + DIM + '[' + tag + ']  ' + (items.length - visible.length) + ' more hidden (--all to show)' + RESET);
  }

  lines.push('');
}

function _renderReview(items, fileFilter, opts) {
  if (!items || items.length === 0) return [];

  var filtered = [];
  for (var i = 0; i < items.length; i++) {
    if (!fileFilter || items[i].file === fileFilter) filtered.push(items[i]);
  }
  if (filtered.length === 0) return [];

  var tiers = _splitReviewHierarchy(filtered);
  var lines = [];
  var total = tiers.act.length + tiers.look.length + tiers.log.length;
  var showAll = !!(opts && opts.all);
  var includeFile = !fileFilter;

  lines.push('');
  lines.push(BOLD + 'REVIEW' + RESET + '  (' + total + ' candidates)');
  lines.push('');

  _appendReviewTier(lines, 'ACT', tiers.act, MAX_ACT_DEFAULT, includeFile, showAll);
  _appendReviewTier(lines, 'LOOK', tiers.look, MAX_LOOK_DEFAULT, includeFile, showAll);

  if (tiers.log.length > 0) {
    if (showAll) {
      lines.push('  [LOG]  ' + tiers.log.length + ' low-signal item' + (tiers.log.length === 1 ? '' : 's'));
      for (var j = 0; j < tiers.log.length; j++) {
        lines.push(_renderReviewItem('LOG', tiers.log[j], includeFile));
      }
      lines.push('');
    } else {
      lines.push('  [LOG]  ' + tiers.log.length + ' low-signal item' + (tiers.log.length === 1 ? '' : 's') + ' hidden (--all to show)');
      lines.push('');
    }
  }

  return lines;
}

function _renderFlagged(items, fileFilter) {
  if (!items || items.length === 0) return [];

  var filtered = [];
  for (var i = 0; i < items.length; i++) {
    if (!fileFilter || items[i].file === fileFilter) filtered.push(items[i]);
  }
  if (filtered.length === 0) return [];

  var lines = [];
  var includeFile = !fileFilter;
  lines.push('');
  lines.push(BOLD + 'FLAGGED' + RESET + '  (' + filtered.length + ' high-signal finding' + (filtered.length === 1 ? '' : 's') + ')');
  lines.push('');
  for (var j = 0; j < filtered.length; j++) {
    var item = filtered[j];
    var fileText = includeFile ? '  ' + item.file : '';
    var label = item.confidence || 'FLAGGED';
    lines.push('  ' + _padLeft('L' + item.lineNumber, 6) + '  ' + RED + label + RESET
      + '  ' + DIM + _padRight(item.shape || 'mixed', 14) + 'len=' + _padLeft(item.valueLength || 0, 3)
      + fileText + RESET);
  }
  return lines;
}

function _renderExposure(items, fileFilter) {
  if (!items || items.length === 0) return [];

  var filtered = [];
  for (var i = 0; i < items.length; i++) {
    if (!fileFilter || items[i].file === fileFilter) filtered.push(items[i]);
  }
  if (filtered.length === 0) return [];

  var lines = [];
  lines.push('');
  lines.push(BOLD + 'EXPOSURE' + RESET + '  (' + filtered.length + ' URLs)');
  lines.push('');
  for (var j = 0; j < filtered.length; j++) {
    lines.push('  ' + _padLeft('L' + filtered[j].lineNumber, 6) + '  ' + YELLOW + filtered[j].url + RESET + '  '
      + DIM + filtered[j].classification + '  ' + filtered[j].file + RESET);
  }
  return lines;
}

function _renderSlopBreakdown(items) {
  if (!items || items.length === 0) return [];
  var lines = [];
  lines.push('');
  lines.push(BOLD + 'SLOP BREAKDOWN' + RESET);
  lines.push('');
  for (var i = 0; i < items.length; i++) {
    lines.push('  ' + _padLeft(items[i].hitCount, 4) + ' hits  '
      + DIM + _padLeft(items[i].fileCount, 3) + ' files' + RESET
      + '  ' + _padRight(items[i].category, 22)
      + DIM + 'top sev: ' + items[i].topSeverity + RESET);
  }
  return lines;
}

function _renderCorrelation(correlation) {
  if (!correlation) return [];
  var lines = [];
  var any = false;

  if (correlation.duplicateSecrets && correlation.duplicateSecrets.length > 0) {
    if (!any) {
      lines.push('');
      lines.push(BOLD + 'CORRELATION' + RESET);
      lines.push('');
      any = true;
    }
    var totalFiles = 0;
    for (var i = 0; i < correlation.duplicateSecrets.length; i++) {
      totalFiles += correlation.duplicateSecrets[i].fileCount;
    }
    lines.push('  ' + correlation.duplicateSecrets.length + ' duplicate flagged value'
      + (correlation.duplicateSecrets.length === 1 ? '' : 's')
      + ' appear across ' + totalFiles + ' file' + (totalFiles === 1 ? '' : 's'));
  }

  if (correlation.slopClusters && correlation.slopClusters.length > 0) {
    if (!any) {
      lines.push('');
      lines.push(BOLD + 'CORRELATION' + RESET);
      lines.push('');
      any = true;
    }
    for (var j = 0; j < correlation.slopClusters.length; j++) {
      var cluster = correlation.slopClusters[j];
      lines.push('  1 slop cluster detected in ' + cluster.directory
        + ' (' + cluster.fileCount + ' files, dominant: ' + cluster.category + ')');
    }
  }

  if (correlation.clonePollutionMap && correlation.clonePollutionMap.length > 0) {
    if (!any) {
      lines.push('');
      lines.push(BOLD + 'CORRELATION' + RESET);
      lines.push('');
      any = true;
    }
    lines.push('  ' + correlation.clonePollutionMap.length + ' duplicated function'
      + (correlation.clonePollutionMap.length === 1 ? '' : 's') + ' across multiple files');
  }

  return lines;
}

function _verdictFromScore(score) {
  if (score <= 0) return 'Clean';
  if (score <= 10) return 'Minimal';
  if (score <= 25) return 'Some issues';
  if (score <= 50) return 'Concerning';
  if (score <= 75) return 'Heavy';
  return 'Critical';
}

function _renderMcpFindings(items) {
  if (!items || items.length === 0) return [];
  var lines = [];
  lines.push('');
  lines.push(BOLD + 'MCP RISKS' + RESET + '  (' + items.length + ' finding' + (items.length === 1 ? '' : 's') + ')');
  lines.push('');
  for (var i = 0; i < items.length; i++) {
    var severityColor = items[i].severity >= 8 ? RED : YELLOW;
    lines.push('  ' + severityColor + 'sev:' + items[i].severity + RESET + '  '
      + _padRight(items[i].ruleId, 26) + DIM + items[i].source + RESET);
    lines.push('       ' + DIM + '-> ' + items[i].fix + RESET);
  }
  return lines;
}

function _renderCalibrationWarning(summary) {
  var warning = summary && summary.calibrationWarning;
  if (!warning) return [];

  return [
    '',
    BOLD + YELLOW + 'CALIBRATION WARNING' + RESET,
    '  ' + DIM + warning + RESET,
  ];
}

function _formatDuration(ms) {
  if (!ms) return '0ms';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + 's';
}

function _deepConfidenceCounts(findings) {
  var counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };

  for (var i = 0; i < findings.length; i++) {
    var confidence = findings[i].confidence || 'LOW';
    if (counts[confidence] == null) counts[confidence] = 0;
    counts[confidence]++;
  }

  return counts;
}

function _isDeepPartialWarning(deep) {
  return !!(deep && deep.warning && /^--deep scan incomplete/i.test(String(deep.warning)));
}

function _deepStatus(deep) {
  var findings = Array.isArray(deep && deep.findings) ? deep.findings : [];

  if (!deep || !deep.requested) return null;
  if (!deep.available) return { label: 'unavailable', color: YELLOW };
  if (deep.warning && !deep.attempted) return { label: 'skipped', color: YELLOW };
  if (_isDeepPartialWarning(deep)) return { label: 'partial', color: YELLOW };
  if (deep.warning) return { label: 'fallback', color: YELLOW };

  if (!deep.attempted) return { label: 'ready', color: CYAN };
  if (findings.length === 0) return { label: 'scanned clean', color: GREEN };
  return { label: 'scanned ' + findings.length + ' taint finding' + (findings.length === 1 ? '' : 's'), color: RED };
}

function _deepFindingSummary(deep, findings, counts, fileCount) {
  if (!deep.available) return DIM + 'toolchain unavailable' + RESET;
  if (deep.warning && !deep.attempted) return DIM + 'not run' + RESET;
  if (_isDeepPartialWarning(deep) && findings.length === 0) {
    return DIM + 'no taint findings in loaded projects' + RESET;
  }
  if (deep.warning) return DIM + 'math-only fallback' + RESET;

  if (findings.length === 0) {
    return DIM + 'no taint findings' + RESET;
  }

  var summary = [];
  if (counts.HIGH) summary.push(RED + 'HIGH ' + counts.HIGH + RESET);
  if (counts.MEDIUM) summary.push(YELLOW + 'MEDIUM ' + counts.MEDIUM + RESET);
  if (counts.LOW) summary.push(CYAN + 'LOW ' + counts.LOW + RESET);
  if (_isDeepPartialWarning(deep)) {
    return summary.join('  ') + DIM + '  partial coverage across ' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + RESET;
  }
  return summary.join('  ') + DIM + '  across ' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + RESET;
}

function _renderDeepSummary(deep) {
  if (!deep || !deep.requested) return [];

  var findings = Array.isArray(deep.findings) ? deep.findings : [];
  var status = _deepStatus(deep) || { label: 'unknown', color: YELLOW };
  var counts = _deepConfidenceCounts(findings);
  var files = {};
  var fileCount = 0;
  var lines = [];

  for (var i = 0; i < findings.length; i++) {
    if (!findings[i].file || files[findings[i].file]) continue;
    files[findings[i].file] = true;
    fileCount++;
  }

  lines.push('');
  lines.push(BOLD + 'DEEP ANALYSIS (--deep)' + RESET);
  lines.push('');
  lines.push('  ' + _padRight('status', 12) + status.color + status.label + RESET);
  lines.push('  ' + _padRight('engine', 12) + (deep.engine || 'security-code-scan'));
  if (deep.solution) lines.push('  ' + _padRight('solution', 12) + _basename(deep.solution));
  if (deep.scan_time_ms > 0) lines.push('  ' + _padRight('runtime', 12) + _formatDuration(deep.scan_time_ms));
  lines.push('  ' + _padRight('findings', 12) + _deepFindingSummary(deep, findings, counts, fileCount));

  return lines;
}

function _renderDeepAxisNote(report) {
  var findings = report && report.deep && Array.isArray(report.deep.findings) ? report.deep.findings : [];
  if (findings.length === 0) return [];

  return [
    '                          ' + DIM + '(includes ' + findings.length + ' taint finding' + (findings.length === 1 ? '' : 's') + ' from --deep)' + RESET,
  ];
}

function _renderDeepWarning(deep) {
  var warning = deep && deep.warning;
  if (!warning) return [];

  return [
    '',
    BOLD + YELLOW + 'DEEP WARNING' + RESET,
    '  ' + DIM + warning + RESET,
  ];
}

function _renderVerifyWarning(verify) {
  var lines = [];

  if (verify && verify.startupWarning) {
    lines.push('');
    lines.push(BOLD + YELLOW + 'VERIFY WARNING' + RESET);
    lines.push('  ' + DIM + verify.startupWarning + RESET);
  }

  if (verify && verify.warning) {
    if (lines.length === 0) {
      lines.push('');
      lines.push(BOLD + YELLOW + 'VERIFY WARNING' + RESET);
    }
    lines.push('  ' + DIM + verify.warning + RESET);
  }

  return lines;
}

function _renderDeepFindings(deep, fileFilter) {
  var findings = deep && Array.isArray(deep.findings) ? deep.findings : [];
  var filtered = [];
  var lines = [];

  for (var i = 0; i < findings.length; i++) {
    if (!fileFilter || findings[i].file === fileFilter) filtered.push(findings[i]);
  }

  if (filtered.length === 0) return lines;

  lines.push('');
  lines.push(BOLD + 'TAINT ANALYSIS (--deep)' + RESET);
  lines.push('');

  for (var j = 0; j < filtered.length; j++) {
    var finding = filtered[j];
    var title = String(finding.rule || 'taint-finding').replace(/-/g, ' ').toUpperCase();
    var color = finding.confidence === 'HIGH' ? RED : (finding.confidence === 'MEDIUM' ? YELLOW : CYAN);
    lines.push('  [' + (j + 1) + ']  ' + _padRight(title, 48) + color + finding.confidence + RESET);
    lines.push('       File:   ' + finding.file + '  L' + finding.line);
    if (finding.sink) lines.push('       Sink:   ' + finding.sink);
    if (finding.source) lines.push('       Source: ' + finding.source);
    if (finding.path) lines.push('       Path:   ' + finding.path);
    if (finding.fix) lines.push('       Fix:    ' + finding.fix);
    lines.push('');
  }

  return lines;
}

function _renderVerifyFindings(verify, fileFilter) {
  var findings = verify && Array.isArray(verify.findings) ? verify.findings : [];
  var filtered = [];
  var lines = [];

  for (var i = 0; i < findings.length; i++) {
    if (!fileFilter || findings[i].file === fileFilter) filtered.push(findings[i]);
  }

  if (filtered.length === 0) return lines;

  lines.push('');
  lines.push(BOLD + 'VERIFICATION (--verify)' + RESET);
  lines.push('');

  for (var j = 0; j < filtered.length; j++) {
    lines.push('  VERIFIED  ' + filtered[j].provider + '  L' + filtered[j].line + '  ' + filtered[j].file);
    if (filtered[j].fix) lines.push('           ' + DIM + '-> ' + filtered[j].fix + RESET);
  }

  lines.push('');
  return lines;
}

function exitCode(axes, thresholds) {
  var t = thresholds || DEFAULT_THRESHOLDS;
  if ((axes.A || 0) > (t.A != null ? t.A : DEFAULT_THRESHOLDS.A)) return 1;
  if ((axes.B || 0) > (t.B != null ? t.B : DEFAULT_THRESHOLDS.B)) return 1;
  if ((axes.C || 0) > (t.C != null ? t.C : DEFAULT_THRESHOLDS.C)) return 1;
  return 0;
}

function _renderSingleFile(report, opts) {
  var lines = [];
  var summary = report.projectSummary || {};
  var axes = summary.axes || { A: 0, B: 0, C: 0 };
  var verdicts = summary.verdicts || { A: 'Clean', B: 'Clean', C: 'Clean' };
  var axisFilter = _parseAxisFilter(opts.axis);
  var thresholds = opts.thresholds || DEFAULT_THRESHOLDS;
  var code = exitCode(axes, thresholds);
  var showFilter = _parseShowFilter(opts.show);
  var compact = opts.compact && !opts.verbose && !opts.all && !showFilter;
  var perFile = (report.perFile && report.perFile[0]) || {};
  var fileName = perFile.path || _basename(opts.targetPath || '');
  var lineCount = perFile.lineCount || summary.totalLines || 0;

  lines.push('');
  lines.push(BOLD + 'zone38' + RESET + DIM + '  .  ' + fileName + '  .  ' + _commaNum(lineCount) + ' lines' + RESET);
  lines.push('');

  var axisLines = _renderAxisTable(axes, verdicts, axisFilter);
  for (var i = 0; i < axisLines.length; i++) lines.push(axisLines[i]);
  Array.prototype.push.apply(lines, _renderDeepAxisNote(report));
  lines.push('');
  lines.push(_renderExitLine(code, axes, thresholds));
  Array.prototype.push.apply(lines, _renderCalibrationWarning(summary));
  Array.prototype.push.apply(lines, _renderDeepSummary(report.deep));
  Array.prototype.push.apply(lines, _renderDeepWarning(report.deep));
  Array.prototype.push.apply(lines, _renderVerifyWarning(report.verify));

  if (!compact && _shouldShow('hits', showFilter)) {
    Array.prototype.push.apply(lines, _renderPatternHits(report.patternHits, null, opts.verbose));
  }
  if (_shouldShow('secrets', showFilter)) {
    Array.prototype.push.apply(lines, _renderFlagged(report.secrets, null));
  }
  if (!compact && _shouldShow('exposure', showFilter)) {
    Array.prototype.push.apply(lines, _renderExposure(report.exposure, null));
  }
  Array.prototype.push.apply(lines, _renderMcpFindings(report.mcpFindings));
  Array.prototype.push.apply(lines, _renderDeepFindings(report.deep, null));
  Array.prototype.push.apply(lines, _renderVerifyFindings(report.verify, null));
  if (!compact && _shouldShow('review', showFilter)) {
    Array.prototype.push.apply(lines, _renderReview(report.review, null, opts));
  }
  if ((opts.verbose || opts.all || _shouldShow('breakdown', showFilter)) && report.slopBreakdown) {
    Array.prototype.push.apply(lines, _renderSlopBreakdown(report.slopBreakdown));
  }

  lines.push('');
  return lines.join('\n') + '\n';
}

function _renderDirectory(report, opts) {
  var lines = [];
  var summary = report.projectSummary || {};
  var axes = summary.axes || { A: 0, B: 0, C: 0 };
  var verdicts = summary.verdicts || { A: 'Clean', B: 'Clean', C: 'Clean' };
  var axisFilter = _parseAxisFilter(opts.axis);
  var thresholds = opts.thresholds || DEFAULT_THRESHOLDS;
  var code = exitCode(axes, thresholds);
  var patternsByFile = _countByFile(report.patternHits || []);
  var reviewByFile = _countByFile(report.review || []);
  var exposureByFile = _countByFile(report.exposure || []);
  var showFilter = _parseShowFilter(opts.show);
  var compact = opts.compact && !opts.verbose && !opts.all && !showFilter;

  lines.push('');
  lines.push(BOLD + 'zone38' + RESET + DIM + '  .  ' + (opts.targetPath || '.') + '  .  '
    + (summary.fileCount || 0) + ' files  .  ' + _commaNum(summary.totalLines || 0) + ' lines' + RESET);
  lines.push('');

  var axisLines = _renderAxisTable(axes, verdicts, axisFilter);
  for (var i = 0; i < axisLines.length; i++) lines.push(axisLines[i]);
  Array.prototype.push.apply(lines, _renderDeepAxisNote(report));
  lines.push('');
  lines.push(_renderExitLine(code, axes, thresholds));
  Array.prototype.push.apply(lines, _renderCalibrationWarning(summary));
  Array.prototype.push.apply(lines, _renderDeepSummary(report.deep));
  Array.prototype.push.apply(lines, _renderDeepWarning(report.deep));
  Array.prototype.push.apply(lines, _renderVerifyWarning(report.verify));

  var perFile = (report.perFile || []).slice();
  perFile.sort(function (left, right) {
    return Math.max(right.axes.A, right.axes.B, right.axes.C) - Math.max(left.axes.A, left.axes.B, left.axes.C);
  });

  var offenders = [];
  for (var j = 0; j < perFile.length; j++) {
    if (Math.max(perFile[j].axes.A, perFile[j].axes.B, perFile[j].axes.C) > 10) offenders.push(perFile[j]);
  }
  if (offenders.length > 0) {
    lines.push('');
    lines.push(BOLD + 'TOP OFFENDERS' + RESET);
    lines.push('');
    var showCount = Math.min(offenders.length, 10);
    var maxPathLen = 20;
    for (var o = 0; o < showCount; o++) {
      if (offenders[o].path.length > maxPathLen) maxPathLen = offenders[o].path.length;
    }
    var pathCol = maxPathLen + 2;
    for (var oi = 0; oi < showCount; oi++) {
      var offender = offenders[oi];
      lines.push('  '
        + 'A:' + _scoreColor(offender.axes.A) + _padLeft(Math.round(offender.axes.A), 3) + RESET + '  '
        + 'B:' + _scoreColor(offender.axes.B) + _padLeft(Math.round(offender.axes.B), 3) + RESET + '  '
        + 'C:' + _scoreColor(offender.axes.C) + _padLeft(Math.round(offender.axes.C), 3) + RESET + '   '
        + _padRight(offender.path, pathCol)
        + DIM + 'patterns:' + _padLeft(patternsByFile[offender.path] || 0, 3)
        + '  candidates:' + (reviewByFile[offender.path] || 0) + RESET);
    }
    if (offenders.length > showCount) {
      lines.push('  ' + DIM + '[and ' + (offenders.length - showCount) + ' more - use --verbose to expand]' + RESET);
    }
  }

  var bConcerns = [];
  for (var b = 0; b < perFile.length; b++) {
    if (perFile[b].axes.B > 1) bConcerns.push(perFile[b]);
  }
  bConcerns.sort(function (left, right) { return right.axes.B - left.axes.B; });
  if (bConcerns.length > 0) {
    lines.push('');
    lines.push(BOLD + 'AXIS B CONCERNS' + RESET + DIM + '  (files with security exposure)' + RESET);
    lines.push('');
    var bShow = Math.min(bConcerns.length, 10);
    for (var bi = 0; bi < bShow; bi++) {
      var concern = bConcerns[bi];
      var details = [];
      if ((reviewByFile[concern.path] || 0) > 0) details.push((reviewByFile[concern.path] || 0) + ' candidate' + ((reviewByFile[concern.path] || 0) === 1 ? '' : 's'));
      if ((exposureByFile[concern.path] || 0) > 0) details.push((exposureByFile[concern.path] || 0) + ' URL' + ((exposureByFile[concern.path] || 0) === 1 ? '' : 's'));
      lines.push('  B:' + _scoreColor(concern.axes.B) + _padLeft(Math.round(concern.axes.B), 3) + RESET + '  '
        + concern.path + (details.length > 0 ? '  ' + DIM + '->  ' + details.join('  ') + RESET : ''));
    }
    if (bConcerns.length > bShow) {
      lines.push('  ' + DIM + '[and ' + (bConcerns.length - bShow) + ' more]' + RESET);
    }
  }

  var cleanFiles = report.cleanFiles || [];
  if (cleanFiles.length > 0) {
    lines.push('');
    lines.push(BOLD + 'CLEAN' + RESET + DIM + '  (' + cleanFiles.length + ' file' + (cleanFiles.length === 1 ? '' : 's') + ')' + RESET);
    var cleanNames = [];
    var showClean = Math.min(cleanFiles.length, 8);
    for (var c = 0; c < showClean; c++) cleanNames.push(_basename(cleanFiles[c].file));
    lines.push('  ' + DIM + cleanNames.join('  ') + RESET);
    if (cleanFiles.length > showClean) {
      lines.push('  ' + DIM + '[and ' + (cleanFiles.length - showClean) + ' more - use --verbose to list all]' + RESET);
    }
  }

  Array.prototype.push.apply(lines, _renderCorrelation(summary.correlation));
  Array.prototype.push.apply(lines, _renderMcpFindings(report.mcpFindings));
  Array.prototype.push.apply(lines, _renderDeepFindings(report.deep, null));
  Array.prototype.push.apply(lines, _renderVerifyFindings(report.verify, null));
  if ((opts.verbose || opts.all || _shouldShow('breakdown', showFilter)) && report.slopBreakdown) {
    Array.prototype.push.apply(lines, _renderSlopBreakdown(report.slopBreakdown));
  }

  var fileArg = opts.file || null;
  var showAll = opts.all || false;
  var verbose = opts.verbose || false;
  var detailFiles = [];
  if (fileArg) {
    for (var d = 0; d < perFile.length; d++) {
      if (perFile[d].path === fileArg || _basename(perFile[d].path) === fileArg) {
        detailFiles.push(perFile[d]);
        break;
      }
    }
  } else if (showAll) {
    detailFiles = perFile;
  } else if (verbose || showFilter) {
    for (var v = 0; v < perFile.length; v++) {
      if (Math.max(perFile[v].axes.A, perFile[v].axes.B, perFile[v].axes.C) > 10) {
        detailFiles.push(perFile[v]);
      }
    }
  }

  if (detailFiles.length > 0) {
    lines.push('');
    for (var dfi = 0; dfi < detailFiles.length; dfi++) {
      var detail = detailFiles[dfi];
      lines.push('');
      lines.push(BOLD + '-- ' + detail.path + RESET + DIM + '  (' + _commaNum(detail.lineCount || 0) + ' lines)' + RESET);
      lines.push('');
      var detailVerdicts = {
        A: _verdictFromScore(detail.axes.A || 0),
        B: _verdictFromScore(detail.axes.B || 0),
        C: _verdictFromScore(detail.axes.C || 0),
      };
      Array.prototype.push.apply(lines, _renderAxisTable(detail.axes || { A: 0, B: 0, C: 0 }, detailVerdicts, axisFilter));

      if (!compact && _shouldShow('hits', showFilter)) {
        Array.prototype.push.apply(lines, _renderPatternHits(report.patternHits, detail.path, opts.verbose));
      }
      if (_shouldShow('secrets', showFilter)) {
        Array.prototype.push.apply(lines, _renderFlagged(report.secrets, detail.path));
      }
      if (!compact && _shouldShow('exposure', showFilter)) {
        Array.prototype.push.apply(lines, _renderExposure(report.exposure, detail.path));
      }
      Array.prototype.push.apply(lines, _renderDeepFindings(report.deep, detail.path));
      Array.prototype.push.apply(lines, _renderVerifyFindings(report.verify, detail.path));
      if (!compact && _shouldShow('review', showFilter)) {
        Array.prototype.push.apply(lines, _renderReview(report.review, detail.path, opts));
      }
    }
  }

  lines.push('');
  return lines.join('\n') + '\n';
}

function renderCli(report, opts) {
  opts = opts || {};
  var perFile = report.perFile || [];
  if (perFile.length <= 1) return _renderSingleFile(report, opts);
  return _renderDirectory(report, opts);
}

function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

function renderBanner() {
  return '';
}

module.exports = {
  renderCli: renderCli,
  renderJson: renderJson,
  exitCode: exitCode,
  renderBanner: renderBanner,
  _parseAxisFilter: _parseAxisFilter,
  _parseThresholds: _parseThresholds,
  _scoreColor: _scoreColor,
  _bar: _bar,
  _verdictLabel: _verdictLabel,
  _axisAVerdict: _axisAVerdict,
  _signalLabel: _signalLabel,
  _commaNum: _commaNum,
  _renderAxisTable: _renderAxisTable,
  _renderExitLine: _renderExitLine,
  _verdictFromScore: _verdictFromScore,
  _parseShowFilter: _parseShowFilter,
  _shouldShow: _shouldShow,
  _splitReviewHierarchy: _splitReviewHierarchy,
  _renderReview: _renderReview,
  DEFAULT_THRESHOLDS: DEFAULT_THRESHOLDS,
};