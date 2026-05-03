'use strict';

var VERIFY_TIMEOUT_MS = 2000;
var VERIFY_STARTUP_WARNING = '--verify may contact live providers and can trigger honeypot alerts; use only on credentials you own';
var VERIFY_ALLOW_NETWORK_WARNING = '--verify requires --allow-network — showing math-only results';

function _collectConfirmedCandidates(registry) {
  var candidates = [];

  for (var i = 0; i < registry.length; i++) {
    var record = registry[i];
    var findings = record.findings || [];
    for (var j = 0; j < findings.length; j++) {
      candidates.push({
        value: findings[j].value,
        confidence: findings[j].confidence,
        file: record.relativePath || record.path,
        line: (findings[j].lineIndex || 0) + 1,
        shape: findings[j].shape || 'mixed',
      });
    }
  }

  return candidates;
}

function verifySecrets(registry, opts) {
  var result = {
    enabled: !!(opts && opts.verify),
    allowNetwork: !!(opts && opts.allowNetwork),
    timeoutMs: VERIFY_TIMEOUT_MS,
    startupWarning: null,
    warning: null,
    attempted: false,
    findings: [],
  };
  var verifyHandler;
  var candidates;

  if (!result.enabled) return result;

  result.startupWarning = VERIFY_STARTUP_WARNING;
  if (!result.allowNetwork) {
    result.warning = VERIFY_ALLOW_NETWORK_WARNING;
    return result;
  }

  verifyHandler = opts && opts.verifyHandler;
  if (typeof verifyHandler !== 'function') return result;

  candidates = _collectConfirmedCandidates(registry || []);
  for (var i = 0; i < candidates.length; i++) {
    var outcome;
    result.attempted = true;

    try {
      outcome = verifyHandler(candidates[i], { timeoutMs: VERIFY_TIMEOUT_MS });
    } catch (_err) {
      continue;
    }

    if (!outcome || outcome.verified !== true) continue;

    result.findings.push({
      provider: outcome.provider || 'credential',
      confidence: 'HIGH',
      file: candidates[i].file,
      line: candidates[i].line,
      fix: outcome.fix || 'Rotate the credential and replace it with secure configuration.',
    });
  }

  return result;
}

module.exports = {
  VERIFY_TIMEOUT_MS: VERIFY_TIMEOUT_MS,
  VERIFY_STARTUP_WARNING: VERIFY_STARTUP_WARNING,
  VERIFY_ALLOW_NETWORK_WARNING: VERIFY_ALLOW_NETWORK_WARNING,
  verifySecrets: verifySecrets,
};