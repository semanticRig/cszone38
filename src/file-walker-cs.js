'use strict';

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var INCLUDED_EXTENSIONS = {
  '.cs': true,
  '.csx': true,
  '.razor': true,
};

var SKIP_DIRECTORIES = {
  '.git': true,
  'node_modules': true,
  'bin': true,
  'obj': true,
};

function _normalize(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function _isIncludedExtension(filePath) {
  return INCLUDED_EXTENSIONS[path.extname(filePath).toLowerCase()] === true;
}

function _isExcludedGeneratedFile(filePath) {
  var lower = _normalize(filePath).toLowerCase();
  return lower.endsWith('.g.cs') || lower.endsWith('.designer.cs');
}

function _shouldIncludeFile(filePath) {
  return _isIncludedExtension(filePath) && !_isExcludedGeneratedFile(filePath);
}

function _scanRoot(basePath) {
  var absPath = path.resolve(basePath);
  var stat;

  try {
    stat = fs.statSync(absPath);
  } catch (_err) {
    return path.dirname(absPath);
  }

  return stat.isDirectory() ? absPath : path.dirname(absPath);
}

function _resolveGitRepoRoot(basePath) {
  var scanRoot = _scanRoot(basePath);

  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: scanRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (_err) {
    return null;
  }
}

function _resolveChangedFiles(sinceRef, basePath) {
  var repoRoot = _resolveGitRepoRoot(basePath);
  var absBasePath = path.resolve(basePath);
  var repoRelativeTarget;
  var output;

  if (!repoRoot) return null;

  repoRelativeTarget = path.relative(repoRoot, absBasePath) || '.';

  try {
    output = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=d', sinceRef, '--', repoRelativeTarget],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (_err) {
    return null;
  }

  var changedFiles = {};
  var lines = output.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var file = lines[i].trim();
    if (!file) continue;
    if (!_shouldIncludeFile(file)) continue;
    changedFiles[_normalize(path.resolve(repoRoot, file))] = true;
  }

  return changedFiles;
}

function collectCSharpFiles(targetPath, opts) {
  opts = opts || {};

  var absTarget = path.resolve(targetPath);
  var stat;
  var changedFiles = null;
  var results = [];

  try {
    stat = fs.statSync(absTarget);
  } catch (_err) {
    return results;
  }

  if (opts.since) {
    changedFiles = _resolveChangedFiles(opts.since, absTarget);
  }

  function pushFile(absFilePath, rootPath) {
    var normalized = _normalize(path.resolve(absFilePath));
    if (!_shouldIncludeFile(absFilePath)) return;
    if (changedFiles && !changedFiles[normalized]) return;

    results.push({
      path: path.resolve(absFilePath),
      relativePath: path.relative(rootPath, absFilePath),
    });
  }

  function walk(absDirPath, rootPath) {
    var entries = fs.readdirSync(absDirPath, { withFileTypes: true });

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var childPath = path.join(absDirPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES[entry.name]) continue;
        walk(childPath, rootPath);
        continue;
      }

      if (entry.isFile()) {
        pushFile(childPath, rootPath);
      }
    }
  }

  if (stat.isFile()) {
    if (!changedFiles || changedFiles[_normalize(absTarget)]) {
      pushFile(absTarget, path.dirname(absTarget));
    }
    return results;
  }

  walk(absTarget, absTarget);
  results.sort(function (left, right) {
    return left.relativePath.localeCompare(right.relativePath);
  });
  return results;
}

module.exports = {
  collectCSharpFiles: collectCSharpFiles,
  _isExcludedGeneratedFile: _isExcludedGeneratedFile,
  _resolveGitRepoRoot: _resolveGitRepoRoot,
  _resolveChangedFiles: _resolveChangedFiles,
  _shouldIncludeFile: _shouldIncludeFile,
};