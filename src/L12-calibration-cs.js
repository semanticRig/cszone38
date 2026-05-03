'use strict';

var BaseCalibration = require('zone38/src/pipeline/L12-calibration.js');
var L08 = require('zone38/src/pipeline/L08-arbitration.js');

var GLOBAL_FLOOR = L08.UNCERTAIN_FLOOR;
var POISON_TRIGGER_MULTIPLIER = 1.5;
var MIN_POISONED_REGISTRY = 3;
var NORMAL_LOCAL_MAD_WEIGHT = 1.0;
var NORMAL_GLOBAL_FLOOR_WEIGHT = 0.0;
var POISONED_LOCAL_MAD_WEIGHT = 0.3;
var POISONED_GLOBAL_FLOOR_WEIGHT = 0.7;

function _applyBlendedEntropyCalibration(registry, entropyMedian, blendedEntropyMAD) {
  var lowerBound = entropyMedian - blendedEntropyMAD;
  var upperBound = entropyMedian + blendedEntropyMAD;

  for (var i = 0; i < registry.length; i++) {
    var findings = registry[i].findings || [];
    for (var j = 0; j < findings.length; j++) {
      var finding = findings[j];
      var score = finding.pipelineScore;
      var originalConfidence;

      if (typeof score !== 'number') continue;
      if (score < lowerBound || score > upperBound) continue;

      originalConfidence = finding.confidence;

      if (finding.confidence === 'HIGH') {
        finding.confidence = 'MEDIUM';
      } else if (finding.confidence === 'MEDIUM') {
        finding.confidence = 'UNCERTAIN';
      }

      if (finding.confidence !== originalConfidence) {
        finding.calibrated = true;
        finding.blendedCalibrated = true;
      }
    }
  }
}

function calibrate(registry) {
  var calibration = BaseCalibration.calibrate(registry);
  var entropyMedian = calibration.entropyMedian || 0;
  var entropyMAD = calibration.entropyMAD || 0;
  var poisoned = Array.isArray(registry) && registry.length >= MIN_POISONED_REGISTRY &&
    entropyMedian > (GLOBAL_FLOOR * POISON_TRIGGER_MULTIPLIER);
  var localMADWeight = poisoned ? POISONED_LOCAL_MAD_WEIGHT : NORMAL_LOCAL_MAD_WEIGHT;
  var globalFloorWeight = poisoned ? POISONED_GLOBAL_FLOOR_WEIGHT : NORMAL_GLOBAL_FLOOR_WEIGHT;
  var blendedEntropyMAD = (localMADWeight * entropyMAD) + (globalFloorWeight * GLOBAL_FLOOR);

  if (poisoned) {
    _applyBlendedEntropyCalibration(registry, entropyMedian, blendedEntropyMAD);
  }

  calibration.poisoned = poisoned;
  calibration.globalFloor = GLOBAL_FLOOR;
  calibration.localMADWeight = localMADWeight;
  calibration.globalFloorWeight = globalFloorWeight;
  calibration.blendedEntropyMAD = blendedEntropyMAD;
  calibration.warning = poisoned
    ? 'project entropy median exceeded the global floor; blended MAD calibration applied'
    : null;

  return calibration;
}

module.exports = {
  calibrate: calibrate,
  _applyBlendedEntropyCalibration: _applyBlendedEntropyCalibration,
  GLOBAL_FLOOR: GLOBAL_FLOOR,
  POISON_TRIGGER_MULTIPLIER: POISON_TRIGGER_MULTIPLIER,
  MIN_POISONED_REGISTRY: MIN_POISONED_REGISTRY,
  NORMAL_LOCAL_MAD_WEIGHT: NORMAL_LOCAL_MAD_WEIGHT,
  NORMAL_GLOBAL_FLOOR_WEIGHT: NORMAL_GLOBAL_FLOOR_WEIGHT,
  POISONED_LOCAL_MAD_WEIGHT: POISONED_LOCAL_MAD_WEIGHT,
  POISONED_GLOBAL_FLOOR_WEIGHT: POISONED_GLOBAL_FLOOR_WEIGHT,
};