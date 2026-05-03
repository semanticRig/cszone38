'use strict';

// Layer 1 — C# file role classification
// Mutates fileRecord.role in place and returns it.

var path = require('path');

var BACKEND_SIGNALS = [
  'controllers', 'services', 'repositories', 'middleware', 'handlers',
  'workers', 'jobs', 'migrations', 'data', 'infrastructure', 'persistence',
  'consumers', 'subscribers',
];

var FRONTEND_SIGNALS = [
  'views', 'pages', 'components', 'blazor', 'razor', 'wwwroot', 'viewmodels',
];

var CONFIG_SIGNALS = [
  'appsettings', 'config', 'options', 'settings', 'startup', 'program',
];

var LOGIC_SIGNALS = [
  'helpers', 'utils', 'extensions', 'core', 'engine', 'validators',
  'mappers', 'transforms', 'parsers', 'builders', 'factories',
];

var GENERATED_SEGMENTS = ['obj', 'bin', 'generated', 'migrations'];
var GENERATED_BASENAMES = ['assemblyinfo.cs', 'globalusings.cs'];

function _normalize(relPath) {
  return String(relPath || '').replace(/\\/g, '/').toLowerCase();
}

function _segments(relPath) {
  var normalized = _normalize(relPath);
  if (!normalized) return [];
  return normalized.split('/').filter(Boolean);
}

function _stem(base) {
  return base.replace(/\.[^.]+$/, '');
}

function _hasSignal(relPath, signals) {
  var normalized = _normalize(relPath);
  var segments = _segments(relPath);
  var base = path.basename(normalized);
  var stem = _stem(base);

  for (var i = 0; i < signals.length; i++) {
    var signal = signals[i];

    for (var j = 0; j < segments.length; j++) {
      if (segments[j] === signal) return true;
    }

    if (stem === signal) return true;
    if (stem.indexOf(signal + '.') === 0) return true;
  }

  return false;
}

function _isGenerated(relPath) {
  var normalized = _normalize(relPath);
  var segments = _segments(relPath);
  var base = path.basename(normalized);

  if (base.endsWith('.g.cs') || base.endsWith('.designer.cs')) return true;

  for (var i = 0; i < GENERATED_BASENAMES.length; i++) {
    if (base === GENERATED_BASENAMES[i]) return true;
  }

  for (var j = 0; j < segments.length; j++) {
    for (var k = 0; k < GENERATED_SEGMENTS.length; k++) {
      if (segments[j] === GENERATED_SEGMENTS[k]) return true;
    }
  }

  return false;
}

function _isTestFile(fileRecord) {
  var relPath = _normalize(fileRecord.relativePath);
  var base = path.basename(relPath);

  return fileRecord.territory === 'test' ||
         relPath.indexOf('/test/') !== -1 ||
         relPath.indexOf('/tests/') !== -1 ||
         /(^|[._-])(test|tests|spec|specs)([._-]|$)/.test(base) ||
         /(^|[._-])(unittests|integrationtests)([._-]|$)/.test(base);
}

function classifyRole(fileRecord) {
  var relPath = fileRecord.relativePath || '';
  var normalized = _normalize(relPath);
  var ext = String(fileRecord.ext || path.extname(normalized) || '').toLowerCase();
  var isBackend = _hasSignal(relPath, BACKEND_SIGNALS);
  var isFrontend = ext === '.razor' || _hasSignal(relPath, FRONTEND_SIGNALS);
  var isGenerated = _isGenerated(relPath);
  var isTest = _isTestFile(fileRecord);

  var contextType;
  if (isBackend && !isFrontend) contextType = 'backend';
  else if (isFrontend && !isBackend) contextType = 'frontend';
  else contextType = 'isomorphic';

  var fileType;
  if (_hasSignal(relPath, CONFIG_SIGNALS)) {
    fileType = 'config';
  } else if (_hasSignal(relPath, LOGIC_SIGNALS)) {
    fileType = 'logic';
  } else {
    fileType = 'general';
  }

  var role = {
    contextType: contextType,
    fileType: fileType,
    isTest: isTest,
    isDeclaration: false,
    isGenerated: isGenerated,
    isBackend: isBackend,
    isFrontend: isFrontend,
  };

  fileRecord.role = role;
  return role;
}

module.exports = {
  classifyRole: classifyRole,
  _hasSignal: _hasSignal,
  _isGenerated: _isGenerated,
  _isTestFile: _isTestFile,
};