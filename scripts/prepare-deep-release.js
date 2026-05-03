'use strict';

var fs = require('fs');
var path = require('path');
var PackageInfo = require('../package.json');
var DeepToolchain = require('../src/deep-toolchain-cs');

var PLATFORM_METADATA = {
  'linux-x64': {
    os: ['linux'],
    cpu: ['x64'],
  },
  'darwin-x64': {
    os: ['darwin'],
    cpu: ['x64'],
  },
  'win32-x64': {
    os: ['win32'],
    cpu: ['x64'],
  },
};

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

function _readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function _writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function _bundleFlagName(platformTag) {
  return '--bundle-' + platformTag;
}

function _packageConfig(pkg) {
  return pkg && pkg.cszone38 ? pkg.cszone38 : {};
}

function _stagedPublicEntries(pkg) {
  var publicEntries = ['LICENSE', 'README.md', 'package.json'];
  var files = Array.isArray(pkg.files) ? pkg.files : [];

  for (var i = 0; i < files.length; i++) {
    if (publicEntries.indexOf(files[i]) === -1) publicEntries.push(files[i]);
  }

  return publicEntries;
}

function _optionalDependencies(pkg) {
  var config = _packageConfig(pkg);
  var version = config.deepCompanionVersion || pkg.version;
  var dependencies = {};
  var packageNames = config.deepCompanionPackages || {};
  var platformTags = Object.keys(packageNames);

  for (var i = 0; i < platformTags.length; i++) {
    dependencies[packageNames[platformTags[i]]] = version;
  }

  return dependencies;
}

function _validateBundlePath(platformTag, bundlePath) {
  var resolvedBundle = bundlePath ? path.resolve(bundlePath) : null;
  var manifestPath;
  var manifest;
  var validation;

  if (!resolvedBundle) {
    return {
      ok: false,
      reason: _bundleFlagName(platformTag) + ' is required',
    };
  }

  if (!fs.existsSync(resolvedBundle) || !fs.statSync(resolvedBundle).isDirectory()) {
    return {
      ok: false,
      reason: _bundleFlagName(platformTag) + ' must point to an existing bundle directory',
    };
  }

  manifestPath = path.join(resolvedBundle, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      reason: _bundleFlagName(platformTag) + ' is missing manifest.json',
    };
  }

  manifest = _readJson(manifestPath);
  validation = DeepToolchain._validateManifest(manifest, resolvedBundle);
  if (!validation.ok) {
    return {
      ok: false,
      reason: _bundleFlagName(platformTag) + ' is invalid: ' + validation.reason,
    };
  }

  return {
    ok: true,
    resolvedBundle: resolvedBundle,
    manifest: validation.manifest,
  };
}

function _companionPackageJson(pkg, platformTag, bundleManifest) {
  var config = _packageConfig(pkg);
  var platformInfo = PLATFORM_METADATA[platformTag];

  return {
    name: config.deepCompanionPackages[platformTag],
    version: config.deepCompanionVersion || pkg.version,
    description: 'Private deep bundle payload for cszone38 on ' + platformTag + '.',
    license: pkg.license,
    os: platformInfo.os,
    cpu: platformInfo.cpu,
    files: ['bundle/'],
    keywords: ['cszone38', 'deep', platformTag, DeepToolchain.ENGINE],
    cszone38: {
      engine: DeepToolchain.ENGINE,
      engineVersion: bundleManifest.engineVersion || null,
      platformTag: platformTag,
    },
  };
}

function _companionReadme(packageName, platformTag) {
  return [
    '# ' + packageName,
    '',
    'Private deep bundle payload for `cszone38` on `' + platformTag + '`.',
    '',
    'This package is installed as an optional dependency of `cszone38` and is not meant to be used directly.',
    '',
    'If automatic deep setup is unavailable, fall back to `cszone38 setup deep --bundle=/path/to/deep-bundle`.',
    '',
  ].join('\n');
}

function stageRelease(options) {
  options = options || {};

  var rootDir = options.rootDir ? path.resolve(options.rootDir) : path.resolve(path.join(__dirname, '..'));
  var pkg = options.packageJson || PackageInfo;
  var config = _packageConfig(pkg);
  var packageNames = config.deepCompanionPackages || {};
  var platformTags = Object.keys(packageNames);
  var outputDir = options.outputDir ? path.resolve(options.outputDir) : null;
  var bundlePaths = options.bundlePaths || {};
  var validatedBundles = {};
  var mainPackageDir;
  var stagedPackageJson;
  var companionPackageDirs = {};
  var releaseManifest;
  var i;

  if (!outputDir) {
    return { ok: false, reason: '--output-dir is required' };
  }

  for (i = 0; i < platformTags.length; i++) {
    var platformTag = platformTags[i];
    var platformInfo = PLATFORM_METADATA[platformTag];
    var bundleValidation;

    if (!platformInfo) {
      return { ok: false, reason: 'unsupported deep companion platform: ' + platformTag };
    }

    bundleValidation = _validateBundlePath(platformTag, bundlePaths[platformTag]);
    if (!bundleValidation.ok) return bundleValidation;
    validatedBundles[platformTag] = bundleValidation;
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  mainPackageDir = path.join(outputDir, 'packages', pkg.name);

  var publicEntries = _stagedPublicEntries(pkg);
  for (i = 0; i < publicEntries.length; i++) {
    var sourcePath = path.join(rootDir, publicEntries[i]);
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, reason: 'public package entry is missing: ' + publicEntries[i] };
    }
    _copyTree(sourcePath, path.join(mainPackageDir, publicEntries[i]));
  }

  stagedPackageJson = _readJson(path.join(mainPackageDir, 'package.json'));
  stagedPackageJson.optionalDependencies = _optionalDependencies(pkg);
  _writeJson(path.join(mainPackageDir, 'package.json'), stagedPackageJson);

  for (i = 0; i < platformTags.length; i++) {
    var currentPlatformTag = platformTags[i];
    var companionPackageName = packageNames[currentPlatformTag];
    var companionPackageDir = path.join(outputDir, 'packages', companionPackageName);
    var companionBundleDir = path.join(companionPackageDir, 'bundle');

    _copyTree(validatedBundles[currentPlatformTag].resolvedBundle, companionBundleDir);
    _writeJson(path.join(companionPackageDir, 'package.json'), _companionPackageJson(pkg, currentPlatformTag, validatedBundles[currentPlatformTag].manifest));
    fs.writeFileSync(path.join(companionPackageDir, 'README.md'), _companionReadme(companionPackageName, currentPlatformTag));
    companionPackageDirs[currentPlatformTag] = companionPackageDir;
  }

  releaseManifest = {
    schemaVersion: 1,
    packageVersion: pkg.version,
    mainPackageDir: mainPackageDir,
    companionPackageDirs: companionPackageDirs,
    optionalDependencies: stagedPackageJson.optionalDependencies,
    publishOrder: platformTags.map(function (platformTag) {
      return packageNames[platformTag];
    }).concat(pkg.name),
  };
  _writeJson(path.join(outputDir, 'release-manifest.json'), releaseManifest);

  return {
    ok: true,
    outputDir: outputDir,
    mainPackageDir: mainPackageDir,
    companionPackageDirs: companionPackageDirs,
    releaseManifestPath: path.join(outputDir, 'release-manifest.json'),
  };
}

function _parseArgs(argv) {
  var options = {
    outputDir: null,
    bundlePaths: {},
    help: false,
  };
  var args = argv.slice(2);
  var platformTags = Object.keys(_packageConfig(PackageInfo).deepCompanionPackages || {});

  for (var i = 0; i < args.length; i++) {
    var arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.indexOf('--output-dir=') === 0) {
      options.outputDir = arg.slice(13);
      continue;
    }
    if (arg === '--output-dir' && args[i + 1]) {
      options.outputDir = args[++i];
      continue;
    }

    for (var j = 0; j < platformTags.length; j++) {
      var platformTag = platformTags[j];
      var flag = _bundleFlagName(platformTag);
      if (arg.indexOf(flag + '=') === 0) {
        options.bundlePaths[platformTag] = arg.slice(flag.length + 1);
        break;
      }
      if (arg === flag && args[i + 1]) {
        options.bundlePaths[platformTag] = args[++i];
        break;
      }
    }
  }

  return options;
}

function _printHelp() {
  var lines = [
    '',
    '  prepare-deep-release',
    '',
    '  Stage the main cszone38 package and the supported x64 deep companion packages for publish.',
    '',
    '  Required',
    '    --output-dir=PATH              Staging directory for the release packages',
  ];
  var packageNames = _packageConfig(PackageInfo).deepCompanionPackages || {};
  var platformTags = Object.keys(packageNames);

  for (var i = 0; i < platformTags.length; i++) {
    lines.push('    ' + _bundleFlagName(platformTags[i]) + '=PATH' + ' '.repeat(Math.max(1, 24 - _bundleFlagName(platformTags[i]).length)) + 'Built deep bundle for ' + platformTags[i]);
  }

  lines.push('');
  lines.push('  Output');
  lines.push('    packages/cszone38                 Main package with companion optionalDependencies');
  for (var j = 0; j < platformTags.length; j++) {
    lines.push('    packages/' + packageNames[platformTags[j]] + '  Companion package with bundle payload');
  }
  lines.push('    release-manifest.json             Publish order and staged package paths');
  lines.push('');

  process.stdout.write(lines.join('\n'));
}

function main() {
  var options = _parseArgs(process.argv);
  var result;
  var manifest;

  if (options.help) {
    _printHelp();
    process.exit(0);
  }

  result = stageRelease(options);
  if (!result.ok) {
    process.stderr.write('prepare-deep-release: ' + result.reason + '\n');
    process.exit(1);
  }

  manifest = _readJson(result.releaseManifestPath);
  process.stdout.write('\n');
  process.stdout.write('  STAGED DEEP RELEASE\n\n');
  process.stdout.write('    output dir                ' + result.outputDir + '\n');
  process.stdout.write('    main package              ' + result.mainPackageDir + '\n');
  process.stdout.write('    publish order             ' + manifest.publishOrder.join(' -> ') + '\n\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  stageRelease: stageRelease,
};