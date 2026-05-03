'use strict';

var fileWalker = require('./file-walker-cs');
var runner = require('./runner-cs');
var Deep = require('./deep-scan-cs');
var Verify = require('./verify-cs');

var L11 = require('zone38/src/pipeline/L11-correlation.js');
var L12 = require('./L12-calibration-cs');
var L13 = require('zone38/src/pipeline/L13-scoring.js');
var L14 = require('zone38/src/pipeline/L14-report.js');
var L15 = require('./L15-output-cs');

function _collectUnmaskedSecrets(registry) {
  var secrets = [];

  for (var i = 0; i < registry.length; i++) {
    var rec = registry[i];
    var findings = rec.findings || [];

    for (var j = 0; j < findings.length; j++) {
      var finding = findings[j];
      secrets.push({
        value: finding.value || '',
        file: rec.relativePath || rec.path,
        lineNumber: (finding.lineIndex || 0) + 1,
        axis: 'B',
        ruleId: null,
        confidence: finding.confidence,
        signals: finding.signalCount || 0,
        shape: finding.shape || 'mixed',
        valueLength: finding.valueLength || 0,
        charFreqSignal: finding.charFreqSignal,
        bigramSignal: finding.bigramSignal,
        compressionSignal: finding.compressionSignal,
      });
    }
  }

  return secrets;
}

function _deepContribution(confidence) {
  if (confidence === 'HIGH') return 15;
  if (confidence === 'MEDIUM') return 8;
  return 3;
}

function _applyDeepResult(report, deepResult) {
  var findings = (deepResult && deepResult.findings) || [];
  var summary = report && report.projectSummary ? report.projectSummary : null;
  var perFile = (report && report.perFile) || [];
  var cleanFiles = (report && report.cleanFiles) || [];
  var contributionsByFile = {};

  report.deep = {
    requested: !!(deepResult && deepResult.requested),
    available: !!(deepResult && deepResult.available),
    attempted: !!(deepResult && deepResult.attempted),
    engine: deepResult && deepResult.engine ? deepResult.engine : Deep.ENGINE,
    solution: deepResult && deepResult.solution ? deepResult.solution : null,
    scan_time_ms: deepResult && deepResult.scanTimeMs ? deepResult.scanTimeMs : 0,
    findings: findings,
    warning: deepResult && deepResult.warning ? deepResult.warning : null,
  };

  if (!summary) return;

  summary.deepFindingCount = findings.length;
  summary.deepContribution = deepResult && deepResult.scoreContribution ? deepResult.scoreContribution : 0;

  if (findings.length === 0) return;

  for (var i = 0; i < findings.length; i++) {
    var file = findings[i].file || '';
    contributionsByFile[file] = (contributionsByFile[file] || 0) + _deepContribution(findings[i].confidence);
  }

  summary.axes.B = Math.min(100, (summary.axes.B || 0) + summary.deepContribution);
  summary.verdicts.B = L15._verdictFromScore(summary.axes.B || 0);

  for (var j = 0; j < perFile.length; j++) {
    var contribution = contributionsByFile[perFile[j].path] || 0;
    if (!contribution) continue;
    perFile[j].axes.B = Math.min(100, (perFile[j].axes.B || 0) + contribution);
  }

  report.cleanFiles = cleanFiles.filter(function (entry) {
    return !contributionsByFile[entry.file];
  });
}

function _applyVerifyResult(report, verifyResult) {
  report.verify = {
    enabled: !!(verifyResult && verifyResult.enabled),
    allowNetwork: !!(verifyResult && verifyResult.allowNetwork),
    timeout_ms: verifyResult && verifyResult.timeoutMs ? verifyResult.timeoutMs : 0,
    findings: verifyResult && verifyResult.findings ? verifyResult.findings : [],
    warning: verifyResult && verifyResult.warning ? verifyResult.warning : null,
    startupWarning: verifyResult && verifyResult.startupWarning ? verifyResult.startupWarning : null,
  };
}

function run(targetPath, opts) {
  opts = opts || {};

  var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  var parser = opts.parser || null;
  var files = fileWalker.collectCSharpFiles(targetPath, opts);
  var registry = [];

  if (onProgress) {
    onProgress({ type: 'discover', total: files.length, targetPath: targetPath });
    onProgress({ type: 'scan', current: 0, total: files.length, file: null });
  }

  for (var i = 0; i < files.length; i++) {
    registry.push(runner.scanCSharpFile(files[i].path, parser, {
      relativePath: files[i].relativePath,
    }));

    if (onProgress) {
      onProgress({
        type: 'scan',
        current: i + 1,
        total: files.length,
        file: files[i].relativePath || files[i].path,
      });
    }
  }

  var correlation = L11.correlate(registry);
  var calibration = L12.calibrate(registry);
  var scoring = L13.computeAxes(registry, calibration);
  var report = L14.assembleReport(scoring, registry, correlation);
  var deepRunner = opts.deepRunner || Deep.runDeepScan;
  var verifyRunner = opts.verifyRunner || Verify.verifySecrets;
  var deepResult = deepRunner(targetPath, opts);
  var verifyResult;

  if (report && report.projectSummary) {
    report.projectSummary.calibrationWarning = calibration.warning || null;
    report.projectSummary.calibrationState = {
      poisoned: !!calibration.poisoned,
      entropyMedian: calibration.entropyMedian || 0,
      blendedEntropyMAD: calibration.blendedEntropyMAD || 0,
      globalFloor: calibration.globalFloor || 0,
    };
  }

  // zone38's stock report masks confirmed secret values. Keep the terminal
  // presentation safe, but preserve raw values in the structured JSON layer so
  // users can triage exact findings without re-running explain mode per hit.
  report.secrets = _collectUnmaskedSecrets(registry);

  if (onProgress && opts.deep) {
    onProgress({
      type: 'deep-start',
      note: 'running Roslyn taint analysis',
    });
  }

  _applyDeepResult(report, deepResult);

  if (onProgress && opts.verify) {
    onProgress({
      type: 'verify-start',
      note: opts.allowNetwork ? 'verifying confirmed credentials' : 'checking verify policy',
    });
  }

  verifyResult = verifyRunner(registry, opts);
  _applyVerifyResult(report, verifyResult);

  return {
    report: report,
    registry: registry,
    calibration: calibration,
    correlation: correlation,
    scoring: scoring,
    deep: deepResult,
    verify: verifyResult,
  };
}

function renderJson(report) {
  return L15.renderJson(report);
}

function exitCode(axes, thresholds) {
  return L15.exitCode(axes, thresholds);
}

module.exports = {
  run:       run,
  renderJson: renderJson,
  exitCode:  exitCode,
};
