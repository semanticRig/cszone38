'use strict';

var BasePreflight = require('zone38/src/pipeline/L05-preflight.js');

var MIN_PIPELINE_LEN = 8;

function _hasMinimumPipelineLength(candidate) {
  var value = candidate && typeof candidate.value === 'string' ? candidate.value : '';
  return value.length >= MIN_PIPELINE_LEN;
}

function _isSafeSinkCandidate(candidate) {
  return !!(candidate && candidate.safeSink);
}

function preflight(candidates, fileRecord) {
  var filteredCandidates = [];

  for (var i = 0; i < candidates.length; i++) {
    if (!_isSafeSinkCandidate(candidates[i])) {
      filteredCandidates.push(candidates[i]);
    }
  }

  var preflighted = BasePreflight.preflight(filteredCandidates, fileRecord);
  var result = [];

  for (var j = 0; j < preflighted.length; j++) {
    if (_hasMinimumPipelineLength(preflighted[j])) {
      result.push(preflighted[j]);
    }
  }

  return result;
}

module.exports = {
  preflight: preflight,
  _hasMinimumPipelineLength: _hasMinimumPipelineLength,
  _isSafeSinkCandidate: _isSafeSinkCandidate,
};