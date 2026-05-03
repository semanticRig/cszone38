'use strict';

var BaseDeep = require('zone38/src/pipeline/L07-deep.js');
var charFreq = require('zone38/src/string/char-frequency.js');

var WINDOW_SIZE = 16;
var UNIFORM_WINDOW_SIZE = 24;
var MIN_GRADIENT_DELTA = 0.18;
var MIN_SPIKE_ENTROPY = 3.9;
var MIN_BLOCK_ENTROPY = 4.2;
var MAX_BLOCK_STDDEV = 0.02;
var MIN_BLOCK_SECRET_CHARS = 4;
var MAX_PIPELINE_BOOST = 0.06;
var MAX_BLOCK_PIPELINE_BOOST = 0.14;

function _uniformityStdDev(value) {
  var text = String(value || '');
  var freq = {};
  var keys;
  var expectedFreq;
  var sumSq = 0;

  if (!text) return 1;

  for (var i = 0; i < text.length; i++) {
    freq[text[i]] = (freq[text[i]] || 0) + 1;
  }

  keys = Object.keys(freq);
  if (keys.length === 0) return 1;

  expectedFreq = text.length / keys.length;
  for (var j = 0; j < keys.length; j++) {
    var deviation = (freq[keys[j]] - expectedFreq) / text.length;
    sumSq += deviation * deviation;
  }

  return Math.sqrt(sumSq / keys.length);
}

function _secretLikeCharCount(value) {
  var text = String(value || '');
  var count = 0;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if ((ch >= '0' && ch <= '9') || ch === '+' || ch === '/' || ch === '=' || ch === '_' || ch === '-') {
      count++;
    }
  }

  return count;
}

function _windowedEntropyGradient(value) {
  var text = String(value || '');
  var windows = [];
  var maxDelta = 0;
  var maxEntropy = 0;

  if (text.length < WINDOW_SIZE * 2) {
    return {
      active: false,
      maxDelta: 0,
      maxEntropy: 0,
    };
  }

  for (var i = 0; i <= text.length - WINDOW_SIZE; i++) {
    windows.push(charFreq._entropy(text.slice(i, i + WINDOW_SIZE)));
  }

  for (var j = 1; j < windows.length; j++) {
    var delta = windows[j] - windows[j - 1];
    if (delta > maxDelta) maxDelta = delta;
    if (windows[j] > maxEntropy) maxEntropy = windows[j];
  }

  return {
    active: maxDelta >= MIN_GRADIENT_DELTA && maxEntropy >= MIN_SPIKE_ENTROPY,
    maxDelta: maxDelta,
    maxEntropy: maxEntropy,
  };
}

function _gradientPipelineBoost(gradient) {
  if (!gradient || !gradient.active) return 0;

  return Math.min(MAX_PIPELINE_BOOST, 0.03 + Math.max(0, gradient.maxDelta - MIN_GRADIENT_DELTA) * 0.05);
}

function _windowedUniformBlock(value) {
  var text = String(value || '');
  var bestEntropy = 0;
  var bestStdDev = 1;
  var bestSecretChars = 0;
  var active = false;

  if (text.length < UNIFORM_WINDOW_SIZE * 2) {
    return {
      active: false,
      maxEntropy: 0,
      minStdDev: 1,
      secretLikeChars: 0,
    };
  }

  for (var i = 0; i <= text.length - UNIFORM_WINDOW_SIZE; i++) {
    var window = text.slice(i, i + UNIFORM_WINDOW_SIZE);
    var entropy = charFreq._entropy(window);
    var stdDev = _uniformityStdDev(window);
    var secretChars = _secretLikeCharCount(window);

    if (entropy > bestEntropy || (entropy === bestEntropy && stdDev < bestStdDev)) {
      bestEntropy = entropy;
      bestStdDev = stdDev;
      bestSecretChars = secretChars;
    }

    if (entropy >= MIN_BLOCK_ENTROPY && stdDev <= MAX_BLOCK_STDDEV && secretChars >= MIN_BLOCK_SECRET_CHARS) {
      active = true;
      if (entropy >= bestEntropy) {
        bestEntropy = entropy;
        bestStdDev = stdDev;
        bestSecretChars = secretChars;
      }
    }
  }

  return {
    active: active,
    maxEntropy: bestEntropy,
    minStdDev: bestStdDev,
    secretLikeChars: bestSecretChars,
  };
}

function _uniformBlockPipelineBoost(block) {
  if (!block || !block.active) return 0;

  return Math.min(
    MAX_BLOCK_PIPELINE_BOOST,
    0.1 + Math.max(0, block.maxEntropy - MIN_BLOCK_ENTROPY) * 0.08 + Math.max(0, MAX_BLOCK_STDDEV - block.minStdDev) * 0.5
  );
}

function _augmentSignalSet(item) {
  var gradient;
  var block;
  var boost;

  if (!item || !item.candidate || !item.signals) return item;

  gradient = _windowedEntropyGradient(item.candidate.value || '');
  block = _windowedUniformBlock(item.candidate.value || '');
  boost = Math.max(_gradientPipelineBoost(gradient), _uniformBlockPipelineBoost(block));

  item.signals.windowEgsDelta = gradient.maxDelta;
  item.signals.windowEgsEntropy = gradient.maxEntropy;
  item.signals.windowEgsSpike = gradient.active;
  item.signals.windowUniformEntropy = block.maxEntropy;
  item.signals.windowUniformStdDev = block.minStdDev;
  item.signals.windowUniformSecretChars = block.secretLikeChars;
  item.signals.windowUniformBlock = block.active;
  item.signals.maxPipelineScore = Math.min(1, (item.signals.maxPipelineScore || 0) + boost);

  return item;
}

function deepAnalysis(escalatedCandidates) {
  var results = BaseDeep.deepAnalysis(escalatedCandidates);

  for (var i = 0; i < results.length; i++) {
    _augmentSignalSet(results[i]);
  }

  return results;
}

module.exports = {
  deepAnalysis: deepAnalysis,
  _windowedEntropyGradient: _windowedEntropyGradient,
  _gradientPipelineBoost: _gradientPipelineBoost,
  _windowedUniformBlock: _windowedUniformBlock,
  _uniformBlockPipelineBoost: _uniformBlockPipelineBoost,
};