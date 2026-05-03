'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

var ENGINE = 'security-code-scan';
var SCHEMA_VERSION = 1;
var SETUP_HINT = 'download the deep bundle from GitHub Releases, extract it, and run: cszone38 setup deep --bundle=/path/to/cszone38-deep-linux-x64';

function _platformTag(opts) {
  return opts && opts.platformTag ? opts.platformTag : process.platform + '-' + process.arch;
}

function _defaultStoreRoot() {
  if (process.env.CSZONE38_DEEP_STORE_ROOT) return path.resolve(process.env.CSZONE38_DEEP_STORE_ROOT);

  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'cszone38', 'deep');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'cszone38', 'deep');
  }

  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'cszone38', 'deep');
}

function _toolchainRoot(opts) {
  var storeRoot = opts && opts.storeRoot ? path.resolve(opts.storeRoot) : _defaultStoreRoot();
  return path.join(storeRoot, 'toolchains', ENGINE, _platformTag(opts));
}

function _manifestPath(opts) {
  var explicit = opts && opts.manifestPath ? opts.manifestPath : process.env.CSZONE38_DEEP_MANIFEST_PATH;
  return explicit ? path.resolve(explicit) : path.join(_toolchainRoot(opts), 'manifest.json');
}

function _readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

function _resolvePath(baseDir, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(baseDir, value);
}

function _exists(targetPath) {
  return !!targetPath && fs.existsSync(targetPath);
}

function _validateManifest(manifest, manifestDir) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, reason: 'deep manifest is missing or malformed' };
  }

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: 'deep manifest schema is unsupported' };
  }

  if (manifest.engine !== ENGINE) {
    return { ok: false, reason: 'deep manifest engine is unsupported' };
  }

  var resolved = {
    schemaVersion: manifest.schemaVersion,
    engine: manifest.engine,
    engineVersion: manifest.engineVersion || null,
    installSource: manifest.installSource || 'bundle',
    packageName: manifest.packageName || null,
    manifestPath: path.join(manifestDir, 'manifest.json'),
    manifestDir: manifestDir,
    dotnetRoot: _resolvePath(manifestDir, manifest.dotnetRoot),
    dotnetPath: _resolvePath(manifestDir, manifest.dotnetPath),
    sdkPath: _resolvePath(manifestDir, manifest.sdkPath),
    securityScanPath: _resolvePath(manifestDir, manifest.securityScanPath),
  };

  if (!_exists(resolved.dotnetPath)) {
    return { ok: false, reason: 'deep bundle is missing the private dotnet binary' };
  }

  if (!_exists(resolved.sdkPath)) {
    return { ok: false, reason: 'deep bundle is missing the private SDK path' };
  }

  if (!_exists(resolved.securityScanPath)) {
    return { ok: false, reason: 'deep bundle is missing the security-scan binary' };
  }

  if (manifest.dotnetRoot && !_exists(resolved.dotnetRoot)) {
    return { ok: false, reason: 'deep bundle is missing the private DOTNET_ROOT path' };
  }

  return { ok: true, manifest: resolved };
}

function _copyTree(sourcePath, targetPath) {
  var stat = fs.statSync(sourcePath);

  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    var entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      _copyTree(path.join(sourcePath, entries[i].name), path.join(targetPath, entries[i].name));
    }
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function _writeInstallMetadata(targetManifestPath, opts) {
  var targetManifest = _readJson(targetManifestPath);

  if (!targetManifest) return;

  targetManifest.installSource = opts && opts.installSource ? opts.installSource : 'bundle';
  if (opts && opts.packageName) targetManifest.packageName = opts.packageName;
  else delete targetManifest.packageName;

  fs.writeFileSync(targetManifestPath, JSON.stringify(targetManifest, null, 2) + '\n');
}

function _installIntoStore(bundlePath, opts) {
  var resolvedBundle = path.resolve(bundlePath);
  var sourceManifestPath = path.join(resolvedBundle, 'manifest.json');
  var sourceManifest = _readJson(sourceManifestPath);
  var sourceValidation;
  var targetRoot;
  var targetManifestPath;
  var resolved;

  if (!fs.existsSync(resolvedBundle) || !fs.statSync(resolvedBundle).isDirectory()) {
    return { ok: false, reason: 'deep bundle path does not exist: ' + resolvedBundle };
  }

  sourceValidation = _validateManifest(sourceManifest, resolvedBundle);
  if (!sourceValidation.ok) {
    return { ok: false, reason: sourceValidation.reason };
  }

  targetRoot = _toolchainRoot(opts);
  fs.rmSync(targetRoot, { recursive: true, force: true });
  _copyTree(resolvedBundle, targetRoot);

  targetManifestPath = path.join(targetRoot, 'manifest.json');
  _writeInstallMetadata(targetManifestPath, opts);
  resolved = resolveToolchain({
    manifestPath: targetManifestPath,
    storeRoot: opts && opts.storeRoot,
    platformTag: opts && opts.platformTag,
  });
  if (!resolved.available) {
    return { ok: false, reason: resolved.reason };
  }

  return {
    ok: true,
    engine: resolved.engine,
    engineVersion: resolved.engineVersion,
    installSource: resolved.installSource,
    packageName: resolved.packageName,
    manifestPath: resolved.manifestPath,
    storeRoot: resolved.storeRoot,
    dotnetPath: resolved.dotnetPath,
    sdkPath: resolved.sdkPath,
    securityScanPath: resolved.securityScanPath,
  };
}

function resolveToolchain(opts) {
  var manifestPath = _manifestPath(opts);
  var manifestDir = path.dirname(manifestPath);
  var manifest = _readJson(manifestPath);
  var validation;

  if (!fs.existsSync(manifestPath)) {
    return {
      available: false,
      reason: 'deep toolchain is not installed — ' + SETUP_HINT,
      manifestPath: manifestPath,
      storeRoot: _toolchainRoot(opts),
    };
  }

  validation = _validateManifest(manifest, manifestDir);
  if (!validation.ok) {
    return {
      available: false,
      reason: validation.reason,
      manifestPath: manifestPath,
      storeRoot: _toolchainRoot(opts),
    };
  }

  validation.manifest.available = true;
  validation.manifest.storeRoot = _toolchainRoot(opts);
  validation.manifest.setupHint = SETUP_HINT;
  return validation.manifest;
}

function installBundle(bundlePath, opts) {
  return _installIntoStore(bundlePath, {
    storeRoot: opts && opts.storeRoot,
    platformTag: opts && opts.platformTag,
    installSource: 'bundle',
  });
}

function doctor(opts) {
  var deep = resolveToolchain(opts);

  return {
    base: {
      available: true,
      nodeVersion: process.version,
    },
    deep: {
      available: !!deep.available,
      engine: ENGINE,
      engineVersion: deep.engineVersion || null,
      installSource: deep.installSource || null,
      packageName: deep.packageName || null,
      manifestPath: deep.manifestPath,
      storeRoot: deep.storeRoot,
      reason: deep.reason || null,
      dotnetPath: deep.dotnetPath || null,
      sdkPath: deep.sdkPath || null,
      securityScanPath: deep.securityScanPath || null,
      setupHint: SETUP_HINT,
    },
  };
}

module.exports = {
  ENGINE: ENGINE,
  SCHEMA_VERSION: SCHEMA_VERSION,
  SETUP_HINT: SETUP_HINT,
  resolveToolchain: resolveToolchain,
  installBundle: installBundle,
  doctor: doctor,
  _defaultStoreRoot: _defaultStoreRoot,
  _toolchainRoot: _toolchainRoot,
  _manifestPath: _manifestPath,
  _validateManifest: _validateManifest,
};