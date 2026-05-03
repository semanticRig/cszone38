'use strict';

var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var DeepToolchain = require('../src/deep-toolchain-cs');

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

function _relativeInside(rootPath, childPath) {
  var relative = path.relative(rootPath, childPath);

  if (relative === '' || relative === '.') return relative;
  if (relative.indexOf('..') === 0 || path.isAbsolute(relative)) return null;
  return relative;
}

function _platformDotnetName() {
  return process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
}

function _probeEnv(toolchain) {
  var probeEnv = Object.assign({}, process.env);

  if (toolchain.dotnetRoot) probeEnv.DOTNET_ROOT = toolchain.dotnetRoot;
  probeEnv.DOTNET_MULTILEVEL_LOOKUP = '0';
  probeEnv.PATH = [
    path.dirname(toolchain.securityScanPath),
    toolchain.dotnetPath ? path.dirname(toolchain.dotnetPath) : null,
    toolchain.dotnetRoot || null,
    process.env.PATH || '',
  ].filter(Boolean).join(path.delimiter);

  return probeEnv;
}

function _probeSummary(result) {
  var text;
  var lines;

  if (result && result.error && result.error.message) return result.error.message;

  text = [result && result.stderr, result && result.stdout].join('\n');
  lines = String(text || '').split(/\r?\n/).map(function (line) {
    return line.trim();
  }).filter(Boolean);

  if (!lines.length) return 'unknown error';
  if (lines[0] === 'Unhandled exception.' && lines[1]) return lines[1];
  return lines[0];
}

function _validateBundleRuntime(manifestPath, spawnSync) {
  var toolchain = DeepToolchain.resolveToolchain({ manifestPath: manifestPath });
  var probeRoot;
  var probeProjectPath;
  var probeSarifPath;
  var probeEnv;
  var restore;
  var scan;

  if (!toolchain.available) {
    return { ok: false, reason: toolchain.reason };
  }

  probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-bundle-probe-'));
  probeProjectPath = path.join(probeRoot, 'BundleProbe.csproj');
  probeSarifPath = path.join(probeRoot, 'BundleProbe.sarif');
  probeEnv = _probeEnv(toolchain);

  try {
    fs.writeFileSync(probeProjectPath, [
      '<Project Sdk="Microsoft.NET.Sdk">',
      '  <PropertyGroup>',
      '    <OutputType>Exe</OutputType>',
      '    <TargetFramework>net6.0</TargetFramework>',
      '  </PropertyGroup>',
      '</Project>',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(probeRoot, 'Program.cs'), [
      'public static class Program',
      '{',
      '  public static void Main() { System.Console.WriteLine("bundle probe"); }',
      '}',
      '',
    ].join('\n'));

    restore = spawnSync(toolchain.dotnetPath, ['restore', probeProjectPath], {
      cwd: probeRoot,
      encoding: 'utf8',
      env: probeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });

    if (restore.error || restore.status !== 0) {
      return {
        ok: false,
        reason: 'bundled dotnet restore validation failed: ' + _probeSummary(restore),
      };
    }

    scan = spawnSync(toolchain.securityScanPath, [
      probeProjectPath,
      '--export=' + probeSarifPath,
      '--cwe',
      '--ignore-msbuild-errors',
      '--no-banner',
      '--sdk-path=' + toolchain.sdkPath,
    ], {
      cwd: probeRoot,
      encoding: 'utf8',
      env: probeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });

    if (scan.error || scan.status !== 0) {
      return {
        ok: false,
        reason: 'bundled security-scan validation failed: ' + _probeSummary(scan),
      };
    }

    return { ok: true };
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

function buildBundle(options) {
  options = options || {};

  var spawnSync = options.spawnSync || childProcess.spawnSync;
  var outputDir = options.outputDir ? path.resolve(options.outputDir) : null;
  var dotnetRoot = options.dotnetRoot ? path.resolve(options.dotnetRoot) : null;
  var dotnetPath = options.dotnetPath ? path.resolve(options.dotnetPath) : (dotnetRoot ? path.join(dotnetRoot, _platformDotnetName()) : null);
  var sdkPath = options.sdkPath ? path.resolve(options.sdkPath) : null;
  var securityScanPath = options.securityScanPath ? path.resolve(options.securityScanPath) : null;
  var toolSourceDir = securityScanPath ? path.dirname(securityScanPath) : null;
  var sdkRelative;
  var bundleDotnetRoot;
  var bundleToolsRoot;
  var manifestPath;
  var manifest;
  var validation;

  if (!outputDir) return { ok: false, reason: '--output-dir is required' };
  if (!dotnetRoot || !fs.existsSync(dotnetRoot)) return { ok: false, reason: '--dotnet-root must exist' };
  if (!dotnetPath || !fs.existsSync(dotnetPath)) return { ok: false, reason: '--dotnet-path must exist' };
  if (!sdkPath || !fs.existsSync(sdkPath)) return { ok: false, reason: '--sdk-path must exist' };
  if (!securityScanPath || !fs.existsSync(securityScanPath)) return { ok: false, reason: '--security-scan-path must exist' };

  sdkRelative = _relativeInside(dotnetRoot, sdkPath);
  if (!sdkRelative) return { ok: false, reason: '--sdk-path must live under --dotnet-root' };

  fs.rmSync(outputDir, { recursive: true, force: true });
  bundleDotnetRoot = path.join(outputDir, 'dotnet');
  bundleToolsRoot = path.join(outputDir, 'tools');
  _copyTree(dotnetRoot, bundleDotnetRoot);
  _copyTree(toolSourceDir, bundleToolsRoot);

  manifest = {
    schemaVersion: DeepToolchain.SCHEMA_VERSION,
    engine: DeepToolchain.ENGINE,
    engineVersion: options.engineVersion || null,
    dotnetRoot: 'dotnet',
    dotnetPath: path.join('dotnet', path.basename(dotnetPath)).replace(/\\/g, '/'),
    sdkPath: path.join('dotnet', sdkRelative).replace(/\\/g, '/'),
    securityScanPath: path.join('tools', path.basename(securityScanPath)).replace(/\\/g, '/'),
  };

  manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  validation = _validateBundleRuntime(manifestPath, spawnSync);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  return {
    ok: true,
    outputDir: outputDir,
    manifestPath: manifestPath,
    engine: manifest.engine,
    engineVersion: manifest.engineVersion,
  };
}

function _parseArgs(argv) {
  var opts = {
    outputDir: null,
    dotnetRoot: null,
    dotnetPath: null,
    sdkPath: null,
    securityScanPath: null,
    engineVersion: null,
    help: false,
  };

  var args = argv.slice(2);
  for (var i = 0; i < args.length; i++) {
    var arg = args[i];
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    if (arg.indexOf('--output-dir=') === 0) { opts.outputDir = arg.slice(13); continue; }
    if (arg === '--output-dir' && args[i + 1]) { opts.outputDir = args[++i]; continue; }
    if (arg.indexOf('--dotnet-root=') === 0) { opts.dotnetRoot = arg.slice(14); continue; }
    if (arg === '--dotnet-root' && args[i + 1]) { opts.dotnetRoot = args[++i]; continue; }
    if (arg.indexOf('--dotnet-path=') === 0) { opts.dotnetPath = arg.slice(14); continue; }
    if (arg === '--dotnet-path' && args[i + 1]) { opts.dotnetPath = args[++i]; continue; }
    if (arg.indexOf('--sdk-path=') === 0) { opts.sdkPath = arg.slice(11); continue; }
    if (arg === '--sdk-path' && args[i + 1]) { opts.sdkPath = args[++i]; continue; }
    if (arg.indexOf('--security-scan-path=') === 0) { opts.securityScanPath = arg.slice(21); continue; }
    if (arg === '--security-scan-path' && args[i + 1]) { opts.securityScanPath = args[++i]; continue; }
    if (arg.indexOf('--engine-version=') === 0) { opts.engineVersion = arg.slice(17); continue; }
    if (arg === '--engine-version' && args[i + 1]) { opts.engineVersion = args[++i]; continue; }
  }

  return opts;
}

function _printHelp() {
  process.stdout.write([
    '',
    '  build-deep-bundle',
    '',
    '  Create a private security-code-scan deep bundle for cszone38 setup.',
    '',
    '  Required',
    '    --output-dir=PATH           Bundle output directory',
    '    --dotnet-root=PATH          Private dotnet root to copy into the bundle',
    '    --sdk-path=PATH             SDK path inside the dotnet root',
    '    --security-scan-path=PATH   security-scan executable to copy into the bundle',
    '',
    '  Optional',
    '    --dotnet-path=PATH          Explicit dotnet executable inside the root',
    '    --engine-version=VALUE      security-scan version to record in the manifest',
    '',
  ].join('\n'));
}

function main() {
  var opts = _parseArgs(process.argv);

  if (opts.help) {
    _printHelp();
    process.exit(0);
  }

  var result = buildBundle(opts);
  if (!result.ok) {
    process.stderr.write('build-deep-bundle: ' + result.reason + '\n');
    process.exit(1);
  }

  process.stdout.write('\n');
  process.stdout.write('  BUILT DEEP BUNDLE\n\n');
  process.stdout.write('    output dir                ' + result.outputDir + '\n');
  process.stdout.write('    manifest                  ' + result.manifestPath + '\n');
  process.stdout.write('    engine                    ' + result.engine + (result.engineVersion ? ' ' + result.engineVersion : '') + '\n\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  buildBundle: buildBundle,
  _validateBundleRuntime: _validateBundleRuntime,
};