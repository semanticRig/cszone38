'use strict';

var fs = require('fs');
var path = require('path');

var L00 = require('zone38/src/pipeline/L00-ingestion.js');
var L02 = require('zone38/src/pipeline/L02-surface.js');
var L05 = require('./L05-preflight-cs');
var L06 = require('zone38/src/pipeline/L06-herd.js');
var L07 = require('./L07-deep-cs');
var L08 = require('zone38/src/pipeline/L08-arbitration.js');
var L09 = require('zone38/src/pipeline/L09-url.js');

var L01 = require('./L01-role-cs');
var L01b = require('./L01b-razor-preprocess');
var L03 = require('./L03-corpus-cs');
var L04 = require('./L04-harvest-cs');
var L10 = require('./L10-rules-cs');

var IDENTIFIER_BOOST_SUBSTRINGS = [
  'apikey',
  'secret',
  'token',
  'password',
  'bearer',
  'credential',
];

function _pathDepth(relPath) {
  var normalized = String(relPath || '').replace(/\\/g, '/');
  var depth = 0;
  for (var i = 0; i < normalized.length; i++) {
    if (normalized[i] === '/') depth++;
  }
  return depth;
}

function _createRecord(filePath, options) {
  var absPath = path.resolve(filePath);
  var stat = fs.statSync(absPath);
  var relativePath = options && options.relativePath ? options.relativePath : path.basename(absPath);

  return {
    path: absPath,
    relativePath: relativePath,
    ext: path.extname(absPath).toLowerCase(),
    size: stat.size,
    depth: _pathDepth(relativePath),
    territory: L00.classifyTerritory(relativePath),
    role: null,
    surface: null,
    compression: null,
    candidates: [],
    findings: [],
    review: [],
    patternHits: [],
    urlFindings: [],
  };
}

function _candidateLookupKey(item) {
  return [
    item.lineIndex,
    item.type || 'string',
    item.identifierName || '',
    item.callSiteContext || '',
    item.value || '',
  ].join('|');
}

function _round(value) {
  return Math.round(value * 1000) / 1000;
}

function _countOtherSignals(signals) {
  var count = 0;
  if (signals && signals.icSignal) count++;
  if (signals && signals.ctfSignal) count++;
  if (signals && signals.egsSpike) count++;
  if (signals && signals.windowEgsSpike) count++;
  if (signals && signals.uniformity) count++;
  if (signals && signals.windowUniformBlock) count++;
  return count;
}

function _hasIdentifierContextBoost(candidate) {
  var identifierName = candidate && candidate.identifierName ? String(candidate.identifierName).toLowerCase() : '';

  if (identifierName.length < 5) return false;

  for (var i = 0; i < IDENTIFIER_BOOST_SUBSTRINGS.length; i++) {
    if (identifierName.indexOf(IDENTIFIER_BOOST_SUBSTRINGS[i]) !== -1) {
      return true;
    }
  }

  return false;
}

function _hasFragmentedAssignmentBoost(candidate) {
  return !!(candidate && candidate.tags && candidate.tags.indexOf('fragmented_assignment') !== -1);
}

function _boostedSignalCount(candidate, signals) {
  var count = _countOtherSignals(signals);

  if (_hasIdentifierContextBoost(candidate)) count++;
  if (_hasFragmentedAssignmentBoost(candidate)) count++;

  return count;
}

function _classifyShape(value) {
  if (!value) return 'mixed';
  if (/^eyJ/.test(value)) return 'jwt';
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(value)) return 'uuid';
  if (/^[0-9a-fA-F]+$/.test(value)) return 'hex-shaped';
  if (/^[A-Za-z0-9+/]+=*$/.test(value) && value.length > 8) return 'base64-shaped';
  return 'mixed';
}

function _topSubResult(item) {
  if (!item || !item.subResults || item.subResults.length === 0) return null;

  var result = item.subResults[0];
  for (var i = 1; i < item.subResults.length; i++) {
    if (item.subResults[i].resolvedScore > result.resolvedScore) {
      result = item.subResults[i];
    }
  }

  return result;
}

function _buildArbitrationEntry(item) {
  var candidate = item.candidate || {};
  var signals = item.signals || {};
  var topSubResult = _topSubResult(item);
  var aggregatorSignals = topSubResult && topSubResult.aggregator ? topSubResult.aggregator.signals : null;

  return {
    value: candidate.value,
    line: candidate.line,
    lineIndex: candidate.lineIndex,
    identifierName: candidate.identifierName,
    callSiteContext: candidate.callSiteContext,
    type: candidate.type,
    pipelineScore: _round(signals.maxPipelineScore || 0),
    signalCount: _countOtherSignals(signals),
    signals: signals,
    topValue: topSubResult ? topSubResult.value : candidate.value,
    shape: _classifyShape(candidate.value),
    valueLength: candidate.value ? candidate.value.length : 0,
    charFreqSignal: aggregatorSignals && aggregatorSignals.charFrequency != null ? aggregatorSignals.charFrequency : null,
    bigramSignal: aggregatorSignals && aggregatorSignals.bigram != null ? aggregatorSignals.bigram : null,
    compressionSignal: aggregatorSignals && aggregatorSignals.compression != null ? aggregatorSignals.compression : null,
  };
}

function _resolveConfidence(pipelineScore, valueLength, signalCount) {
  var effectivePipeline = pipelineScore * L08._lengthMultiplier(valueLength);

  if (effectivePipeline >= L08.HIGH_PIPELINE && signalCount >= 2) return 'HIGH';
  if (effectivePipeline >= L08.MEDIUM_PIPELINE && signalCount >= 2) return 'MEDIUM';
  if (pipelineScore >= L08.UNCERTAIN_FLOOR || signalCount >= 1) return 'UNCERTAIN';
  return null;
}

function arbitrateSignalSets(signalSets) {
  var arbitrated = L08.arbitrate(signalSets);
  var findings = (arbitrated.findings || []).slice();
  var review = (arbitrated.review || []).slice();
  var findingLookup = {};
  var reviewLookup = {};
  var reviewIndexes = {};

  for (var i = 0; i < findings.length; i++) {
    findingLookup[_candidateLookupKey(findings[i])] = findings[i];
  }

  for (var j = 0; j < review.length; j++) {
    var reviewKey = _candidateLookupKey(review[j]);
    reviewLookup[reviewKey] = review[j];
    reviewIndexes[reviewKey] = j;
  }

  for (var k = 0; k < signalSets.length; k++) {
    var item = signalSets[k];
    var candidate = item && item.candidate ? item.candidate : null;
    var signals = item && item.signals ? item.signals : {};
    var lookupKey;
    var baseSignalCount;
    var boostedSignalCount;
    var confidence;
    var entry;
    var reviewIndex;

    lookupKey = _candidateLookupKey(candidate);
    baseSignalCount = _countOtherSignals(signals);
    boostedSignalCount = _boostedSignalCount(candidate, signals);

    if (boostedSignalCount === baseSignalCount) continue;

    confidence = _resolveConfidence(signals.maxPipelineScore || 0, candidate && candidate.value ? candidate.value.length : 0, boostedSignalCount);

    if (!confidence) continue;

    if (findingLookup[lookupKey]) {
      findingLookup[lookupKey].signalCount = Math.max(findingLookup[lookupKey].signalCount || 0, boostedSignalCount);
      continue;
    }

    if (reviewLookup[lookupKey]) {
      reviewLookup[lookupKey].signalCount = Math.max(reviewLookup[lookupKey].signalCount || 0, boostedSignalCount);
      if (confidence === 'HIGH' || confidence === 'MEDIUM') {
        reviewLookup[lookupKey].confidence = confidence;
        findings.push(reviewLookup[lookupKey]);
        findingLookup[lookupKey] = reviewLookup[lookupKey];
        reviewIndex = reviewIndexes[lookupKey];
        review[reviewIndex] = null;
        delete reviewLookup[lookupKey];
        delete reviewIndexes[lookupKey];
      }
      continue;
    }

    entry = _buildArbitrationEntry(item);
    entry.signalCount = boostedSignalCount;
    entry.confidence = confidence;

    if (confidence === 'HIGH' || confidence === 'MEDIUM') {
      findings.push(entry);
      findingLookup[lookupKey] = entry;
    } else {
      review.push(entry);
      reviewLookup[lookupKey] = entry;
      reviewIndexes[lookupKey] = review.length - 1;
    }
  }

  return {
    findings: findings,
    review: review.filter(function (item) { return !!item; }),
  };
}

function applyContextMultipliers(record) {
  var lookup = {};
  var candidates = record.candidates || [];
  var review = record.review || [];
  var findings = record.findings || [];
  var downgraded = [];
  var retained = [];

  for (var i = 0; i < candidates.length; i++) {
    lookup[_candidateLookupKey(candidates[i])] = candidates[i];
  }

  for (var j = 0; j < review.length; j++) {
    var reviewCandidate = lookup[_candidateLookupKey(review[j])];
    review[j].contextFactor = reviewCandidate ? reviewCandidate.contextFactor : 1.0;
    review[j].structuralContext = reviewCandidate ? reviewCandidate.structuralContext : 'default';
    review[j].adjustedPipelineScore = _round((review[j].pipelineScore || 0) * (review[j].contextFactor || 1.0));
  }

  for (var k = 0; k < findings.length; k++) {
    var finding = findings[k];
    var candidate = lookup[_candidateLookupKey(finding)];
    var contextFactor = candidate ? candidate.contextFactor : 1.0;
    var structuralContext = candidate ? candidate.structuralContext : 'default';
    var valueLength = finding.value ? finding.value.length : 0;
    var adjustedPipelineScore = (finding.pipelineScore || 0) * contextFactor;
    var adjustedEffectivePipeline = adjustedPipelineScore * L08._lengthMultiplier(valueLength);

    finding.contextFactor = contextFactor;
    finding.structuralContext = structuralContext;
    finding.adjustedPipelineScore = _round(adjustedPipelineScore);

    if (contextFactor < 1.0 && adjustedEffectivePipeline < L08.MEDIUM_PIPELINE) {
      finding.confidence = 'UNCERTAIN';
      downgraded.push(finding);
    } else {
      retained.push(finding);
    }
  }

  record.findings = retained;
  record.review = review.concat(downgraded);
  return record;
}

function _splitUrlCandidates(candidates) {
  var urlCandidates = [];
  var otherCandidates = [];

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (/^https?:\/\//i.test(candidate.value || '')) {
      var urlCandidate = {
        value: candidate.value,
        line: candidate.line,
        col: candidate.col,
        lineIndex: candidate.lineIndex,
        identifierName: candidate.identifierName,
        callSiteContext: candidate.callSiteContext,
        type: 'url',
        priority: candidate.priority,
      };
      urlCandidates.push(urlCandidate);
    }
    otherCandidates.push(candidate);
  }

  return { urlCandidates: urlCandidates, otherCandidates: otherCandidates };
}

function scanCSharpFile(filePath, parserInput, options) {
  var record = _createRecord(filePath, options || {});
  var analysisContent;
  var content;

  try {
    content = fs.readFileSync(record.path, 'utf8');
  } catch (_err) {
    return record;
  }

  L01.classifyRole(record);

  if (record.ext === '.razor') {
    var razorPreprocess = L01b.preprocessRazorContent(content);
    analysisContent = razorPreprocess.content;
    record.razorPreprocess = {
      lineCount: razorPreprocess.lineCount,
      codeBlockCount: razorPreprocess.codeBlockCount,
      regions: razorPreprocess.regions,
    };
  } else {
    analysisContent = content;
  }

  L02.characteriseRecord(record, analysisContent);
  if (record.surface) {
    record.surface.minified = false;
  }

  L03.analyseFile(record, analysisContent, null);

  var harvested = L04.harvestCSharpEntities(analysisContent, record, parserInput);
  var split = _splitUrlCandidates(harvested);
  var urlCandidates = split.urlCandidates;
  var candidates = split.otherCandidates;

  if (record.role && record.role.isGenerated) {
    record.candidates = [];
    record.findings = [];
    record.review = [];
    record.urlFindings = L09.analyseUrls(urlCandidates);
    record.patternHits = L10.applyRules(analysisContent, record).filter(function (hit) {
      return hit.severity >= 7;
    });
    return record;
  }

  candidates = L05.preflight(candidates, record);
  record.candidates = candidates;

  var stringCandidates = [];
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i].priority !== 'blob') {
      stringCandidates.push(candidates[i]);
    }
  }

  var escalated = L06.discriminate(stringCandidates);
  var signalSets = L07.deepAnalysis(escalated);
  var arbitrated = arbitrateSignalSets(signalSets);

  record.findings = arbitrated.findings || [];
  record.review = arbitrated.review || [];

  applyContextMultipliers(record);

  record.urlFindings = L09.analyseUrls(urlCandidates);
  record.patternHits = L10.applyRules(analysisContent, record);

  return record;
}

module.exports = {
  scanCSharpFile: scanCSharpFile,
  applyContextMultipliers: applyContextMultipliers,
  arbitrateSignalSets: arbitrateSignalSets,
};