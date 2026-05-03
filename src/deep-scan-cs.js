'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');
var DeepToolchain = require('./deep-toolchain-cs');

var ENGINE = 'security-code-scan';
var DEEP_UNAVAILABLE_WARNING = '--deep unavailable — ' + DeepToolchain.SETUP_HINT;
var DEEP_NO_SOLUTION_WARNING = '--deep requires a .sln, .slnx, or .csproj — pass --solution=path/to/file.slnx';
var DEEP_TIMEOUT_WARNING = '--deep timed out — showing math-only results';
var DEEP_FAILED_WARNING = '--deep scan failed (NuGet restore may be needed) — showing math-only results';
var DEEP_PARTIAL_WARNING = '--deep scan incomplete — some projects failed to load; findings may be incomplete';
var DEEP_TIMEOUT_MS = 120000;
var DEFAULT_EXCLUDED_PROJECTS = '**/*Test*/**;**/*Tests*/**;**/*Spec*/**;**/*Specs*/**';
var SKIP_DIRECTORIES = {
  '.git': true,
  'node_modules': true,
  'bin': true,
  'obj': true,
};
var CONTRIBUTION_BY_CONFIDENCE = {
  HIGH: 15,
  MEDIUM: 8,
  LOW: 3,
};

function _scanRoot(targetPath) {
  var absPath = path.resolve(targetPath);
  var stat;

  try {
    stat = fs.statSync(absPath);
  } catch (_err) {
    return path.dirname(absPath);
  }

  return stat.isDirectory() ? absPath : path.dirname(absPath);
}

function _rootDir(opts) {
  return path.resolve((opts && opts.rootDir) || path.join(__dirname, '..'));
}

function _securityScanExecutableName() {
  return process.platform === 'win32' ? 'security-scan.exe' : 'security-scan';
}

function _resolveSecurityScanCommand(opts) {
  var explicit = opts && opts.securityScanPath ? opts.securityScanPath : process.env.CSZONE38_SECURITY_SCAN_PATH;
  var homeDir = process.env.DOTNET_CLI_HOME || process.env.HOME || process.env.USERPROFILE || '';
  var installedPath = homeDir ? path.join(homeDir, '.dotnet', 'tools', _securityScanExecutableName()) : null;

  if (explicit) return path.resolve(explicit);
  if (installedPath && fs.existsSync(installedPath)) return installedPath;
  return _securityScanExecutableName();
}

function _resolveDotnetSdkPath(opts, spawnSync) {
  var explicit = opts && opts.sdkPath ? opts.sdkPath : process.env.CSZONE38_DOTNET_SDK_PATH;
  var dotnetPath = opts && opts.dotnetPath ? opts.dotnetPath : process.env.CSZONE38_DOTNET_PATH || 'dotnet';
  var listed;
  var lines;
  var parsed = [];

  if (explicit) return path.resolve(explicit);

  listed = spawnSync(dotnetPath, ['--list-sdks'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (listed.error || listed.status !== 0) return null;

  lines = String(listed.stdout || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var match = lines[i].match(/^([^\s]+)\s+\[(.+)\]$/);
    if (!match) continue;
    parsed.push(path.join(match[2], match[1]));
  }

  return parsed.length ? parsed[parsed.length - 1] : null;
}

function _isRuntimeUnavailable(scan) {
  var text = [scan && scan.stderr, scan && scan.stdout].join('\n');

  return /You must install or update \.NET to run this application\./i.test(text) ||
    /No frameworks were found\./i.test(text);
}

function _hasProjectLoadFailures(scan) {
  var text = [scan && scan.stderr, scan && scan.stdout].join('\n');

  return /Msbuild failed when processing the file/i.test(text) ||
    /project file could not be loaded/i.test(text) ||
    /failed to load project/i.test(text);
}

function _findImmediateSolution(dirPath) {
  var entries;
  var solutions = [];
  var projects = [];

  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_err) {
    return null;
  }

  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isFile()) continue;
    if (/\.slnx?$/i.test(entries[i].name)) solutions.push(path.join(dirPath, entries[i].name));
    if (/\.csproj$/i.test(entries[i].name)) projects.push(path.join(dirPath, entries[i].name));
  }

  solutions.sort();
  projects.sort();
  return solutions[0] || projects[0] || null;
}

function _findNestedSolution(dirPath) {
  var direct = _findImmediateSolution(dirPath);
  var entries;

  if (direct) return direct;

  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_err) {
    return null;
  }

  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory()) continue;
    if (SKIP_DIRECTORIES[entries[i].name]) continue;
    var nested = _findNestedSolution(path.join(dirPath, entries[i].name));
    if (nested) return nested;
  }

  return null;
}

function _findSolutionPath(targetPath, explicitSolution) {
  var configured = explicitSolution || process.env.CSZONE38_DEEP_SOLUTION;
  var scanRoot;
  var current;
  var parent;
  var direct;

  if (configured) {
    var resolved = path.resolve(configured);
    return fs.existsSync(resolved) ? resolved : null;
  }

  scanRoot = _scanRoot(targetPath);
  current = scanRoot;

  while (true) {
    direct = _findImmediateSolution(current);
    if (direct) return direct;
    parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return _findNestedSolution(scanRoot);
}

function _cweFromText(text) {
  var match = String(text || '').match(/CWE[-\s:]?(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function _buildRuleMap(document) {
  var runs = document && Array.isArray(document.runs) ? document.runs : [];
  var map = {};

  for (var i = 0; i < runs.length; i++) {
    var rules = runs[i] && runs[i].tool && runs[i].tool.driver && runs[i].tool.driver.rules;
    if (!Array.isArray(rules)) continue;
    for (var j = 0; j < rules.length; j++) {
      if (rules[j] && rules[j].id) map[rules[j].id] = rules[j];
    }
  }

  return map;
}

function _extractCwe(result, ruleInfo) {
  var sources = [];
  var tags;

  if (result && result.ruleId) sources.push(result.ruleId);
  if (result && result.message && result.message.text) sources.push(result.message.text);
  if (ruleInfo && ruleInfo.help && ruleInfo.help.text) sources.push(ruleInfo.help.text);
  if (ruleInfo && ruleInfo.helpUri) sources.push(ruleInfo.helpUri);

  if (ruleInfo && ruleInfo.properties && Array.isArray(ruleInfo.properties.tags)) {
    tags = ruleInfo.properties.tags;
    for (var i = 0; i < tags.length; i++) sources.push(tags[i]);
  }

  if (result && result.properties && Array.isArray(result.properties.tags)) {
    tags = result.properties.tags;
    for (var j = 0; j < tags.length; j++) sources.push(tags[j]);
  }

  for (var k = 0; k < sources.length; k++) {
    var cwe = _cweFromText(sources[k]);
    if (cwe != null) return cwe;
  }

  return null;
}

function _slugForFinding(cwe, ruleId, messageText) {
  var text = [ruleId, messageText].join(' ').toLowerCase();

  if (cwe === 89 || text.indexOf('sql') !== -1) return 'sql-injection';
  if (cwe === 78 || text.indexOf('command') !== -1 || text.indexOf('process.start') !== -1) return 'cmd-injection';
  if (cwe === 798 || text.indexOf('credential') !== -1 || text.indexOf('password') !== -1) return 'hardcoded-credential';
  if (cwe === 20 || text.indexOf('input validation') !== -1) return 'improper-input-validation';
  return String(ruleId || 'taint-finding').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'taint-finding';
}

function _confidenceForLevel(level) {
  if (level === 'error') return 'HIGH';
  if (level === 'warning') return 'MEDIUM';
  return 'LOW';
}

function _fixForSlug(slug) {
  if (slug === 'sql-injection') return 'Use parameterized queries and bind user input via SqlParameter.';
  if (slug === 'cmd-injection') return 'Validate and whitelist input before passing it to process execution APIs.';
  if (slug === 'hardcoded-credential') return 'Move the credential to secure configuration or a secret manager.';
  if (slug === 'improper-input-validation') return 'Validate and constrain user-controlled input before it reaches the sink.';
  return 'Review the taint path and remove unsafe data flow from source to sink.';
}

function _sinkForSlug(slug, messageText) {
  var text = String(messageText || '');

  if (slug === 'sql-injection') return text.indexOf('SqlCommand') !== -1 ? 'SqlCommand' : 'SQL sink';
  if (slug === 'cmd-injection') return text.indexOf('Process.Start') !== -1 ? 'Process.Start' : 'process execution';
  if (slug === 'hardcoded-credential') return 'credential sink';
  return null;
}

function _relativeFile(baseDir, uri) {
  var candidate = String(uri || '').replace(/\\/g, '/');
  var resolved;
  if (!candidate) return '';
  if (/^[A-Za-z]:\//.test(candidate) || candidate[0] === '/') {
    resolved = path.resolve(candidate);
    return path.relative(baseDir, resolved).replace(/\\/g, '/');
  }
  return candidate.replace(/^\.\//, '');
}

function parseSarif(text, baseDir) {
  var document;
  var results = [];
  var runs;
  var ruleMap;

  try {
    document = JSON.parse(text);
  } catch (_err) {
    return results;
  }

  runs = Array.isArray(document.runs) ? document.runs : [];
  ruleMap = _buildRuleMap(document);

  for (var i = 0; i < runs.length; i++) {
    var runResults = runs[i] && Array.isArray(runs[i].results) ? runs[i].results : [];
    for (var j = 0; j < runResults.length; j++) {
      var item = runResults[j] || {};
      var location = item.locations && item.locations[0] && item.locations[0].physicalLocation;
      var uri = location && location.artifactLocation ? location.artifactLocation.uri : '';
      var line = location && location.region ? location.region.startLine : 0;
      var ruleInfo = item.ruleId ? ruleMap[item.ruleId] : null;
      var messageText = item.message && item.message.text ? item.message.text : '';
      var level = item.level || (ruleInfo && ruleInfo.defaultConfiguration && ruleInfo.defaultConfiguration.level) || 'warning';
      var cwe = _extractCwe(item, ruleInfo);
      var slug = _slugForFinding(cwe, item.ruleId, messageText);

      results.push({
        type: 'taint',
        rule: slug,
        confidence: _confidenceForLevel(level),
        file: _relativeFile(baseDir, uri),
        line: line || 0,
        sink: _sinkForSlug(slug, messageText),
        source: null,
        path: null,
        cwe: cwe,
        fix: _fixForSlug(slug),
      });
    }
  }

  return results;
}

function _scoreContribution(findings) {
  var total = 0;
  for (var i = 0; i < findings.length; i++) {
    total += CONTRIBUTION_BY_CONFIDENCE[findings[i].confidence] || 0;
  }
  return Math.min(50, total);
}

function _defaultResult() {
  return {
    requested: false,
    available: false,
    attempted: false,
    engine: ENGINE,
    solution: null,
    warning: null,
    findings: [],
    scanTimeMs: 0,
    scoreContribution: 0,
  };
}

function runDeepScan(targetPath, opts) {
  var result = _defaultResult();
  var spawnSync = (opts && opts.spawnSync) || childProcess.spawnSync;
  var scanRoot = _scanRoot(targetPath);
  var toolchain;
  var solutionPath;
  var securityScanCommand;
  var sdkPath;
  var tempDir;
  var exportPath;
  var scanArgs;
  var sarifText = '';
  var startedAt;
  var scan;
  var childEnv;

  opts = opts || {};
  result.requested = !!opts.deep;

  if (!opts.deep) return result;

  toolchain = DeepToolchain.resolveToolchain({
    manifestPath: opts.deepManifestPath,
    storeRoot: opts.deepStoreRoot,
  });

  if (!toolchain.available) {
    result.warning = DEEP_UNAVAILABLE_WARNING;
    return result;
  }

  result.available = true;
  solutionPath = _findSolutionPath(targetPath, opts.solution);
  if (!solutionPath) {
    result.warning = DEEP_NO_SOLUTION_WARNING;
    return result;
  }

  result.solution = solutionPath;
  result.attempted = true;
  securityScanCommand = opts.securityScanPath ? path.resolve(opts.securityScanPath) : toolchain.securityScanPath;
  sdkPath = opts.sdkPath ? path.resolve(opts.sdkPath) : toolchain.sdkPath;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-deep-'));
  exportPath = path.join(tempDir, 'security-scan.sarif');
  scanArgs = [
    solutionPath,
    '--export=' + exportPath,
    '--cwe',
    '--ignore-msbuild-errors',
    '--no-banner',
    '--excl-proj=' + DEFAULT_EXCLUDED_PROJECTS,
  ];
  if (sdkPath) scanArgs.push('--sdk-path=' + sdkPath);

  childEnv = Object.assign({}, process.env);
  if (toolchain.dotnetRoot) childEnv.DOTNET_ROOT = toolchain.dotnetRoot;
  childEnv.DOTNET_MULTILEVEL_LOOKUP = '0';
  childEnv.PATH = [
    path.dirname(securityScanCommand),
    toolchain.dotnetPath ? path.dirname(toolchain.dotnetPath) : null,
    toolchain.dotnetRoot || null,
    process.env.PATH || '',
  ].filter(Boolean).join(path.delimiter);

  startedAt = Date.now();
  try {
    scan = spawnSync(securityScanCommand, scanArgs, {
      cwd: path.dirname(solutionPath),
      encoding: 'utf8',
      timeout: DEEP_TIMEOUT_MS,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    result.scanTimeMs = Date.now() - startedAt;

    if ((scan.error && scan.error.code === 'ETIMEDOUT') || scan.signal === 'SIGTERM') {
      result.warning = DEEP_TIMEOUT_WARNING;
      return result;
    }

    if (scan.error && scan.error.code === 'ENOENT') {
      result.warning = DEEP_UNAVAILABLE_WARNING;
      return result;
    }

    if (_isRuntimeUnavailable(scan)) {
      result.warning = DEEP_UNAVAILABLE_WARNING;
      return result;
    }

    if (scan.error || scan.status !== 0) {
      result.warning = DEEP_FAILED_WARNING;
      return result;
    }

    if (fs.existsSync(exportPath)) sarifText = fs.readFileSync(exportPath, 'utf8');
    result.findings = parseSarif(sarifText || scan.stdout || '', scanRoot);
    result.scoreContribution = _scoreContribution(result.findings);
    if (_hasProjectLoadFailures(scan)) result.warning = DEEP_PARTIAL_WARNING;
    return result;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_cleanupErr) {
    }
  }
}

module.exports = {
  ENGINE: ENGINE,
  DEEP_UNAVAILABLE_WARNING: DEEP_UNAVAILABLE_WARNING,
  DEEP_NO_SOLUTION_WARNING: DEEP_NO_SOLUTION_WARNING,
  DEEP_TIMEOUT_WARNING: DEEP_TIMEOUT_WARNING,
  DEEP_FAILED_WARNING: DEEP_FAILED_WARNING,
  DEEP_PARTIAL_WARNING: DEEP_PARTIAL_WARNING,
  DEEP_TIMEOUT_MS: DEEP_TIMEOUT_MS,
  runDeepScan: runDeepScan,
  parseSarif: parseSarif,
  _findSolutionPath: _findSolutionPath,
  _isRuntimeUnavailable: _isRuntimeUnavailable,
  _hasProjectLoadFailures: _hasProjectLoadFailures,
  _scoreContribution: _scoreContribution,
};