'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var passed = 0;
var failed = 0;

function assert(condition, label) {
	if (condition) {
		passed++;
		process.stdout.write('  \x1b[32m✓\x1b[0m ' + label + '\n');
	} else {
		failed++;
		process.stderr.write('  \x1b[31m✗\x1b[0m ' + label + '\n');
	}
}

function section(name) {
	process.stdout.write('\n  \x1b[1m' + name + '\x1b[0m\n');
}

function runCli(args) {
	return childProcess.execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cszone38.js')].concat(args), {
		cwd: path.join(__dirname, '..'),
		encoding: 'utf8',
	});
}

function runCliWithEnv(args, env) {
	return childProcess.execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cszone38.js')].concat(args), {
		cwd: path.join(__dirname, '..'),
		encoding: 'utf8',
		env: Object.assign({}, process.env, env || {}),
	});
}

function runCliWithStatus(args) {
	return childProcess.spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cszone38.js')].concat(args), {
		cwd: path.join(__dirname, '..'),
		encoding: 'utf8',
	});
}

function runCliWithStatusAndEnv(args, env) {
	return childProcess.spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cszone38.js')].concat(args), {
		cwd: path.join(__dirname, '..'),
		encoding: 'utf8',
		env: Object.assign({}, process.env, env || {}),
	});
}

function stripAnsi(text) {
	return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function makeFixFixtureDir() {
	var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-fix-'));
	var fixtureNames = [
		'ConsoleWriteLineDebugService.cs',
		'TodoFixmeCommentService.cs',
		'EmptyCatchBlockService.cs',
	];

	for (var i = 0; i < fixtureNames.length; i++) {
		fs.copyFileSync(
			path.join(__dirname, 'fixtures', 'slop', fixtureNames[i]),
			path.join(dir, fixtureNames[i])
		);
	}

	return dir;
}

var fixturesDir = path.join(__dirname, 'fixtures');

section('CLI self scan');

var selfScan = runCliWithStatus(['.', '--json']);
var selfReport = JSON.parse(selfScan.stdout);

assert(selfScan.status === 0, 'CLI self-scan exits 0');
assert(selfReport.projectSummary && selfReport.projectSummary.axes.B < 25, 'CLI self-scan keeps Axis B below 25');

section('CLI JSON output');

var jsonOutput = runCli([fixturesDir, '--json']);
var parsedReport = JSON.parse(jsonOutput);
var secretsJson = JSON.parse(runCli([path.join(fixturesDir, 'secrets', 'HardcodedSecrets.cs'), '--json']));

assert(parsedReport && typeof parsedReport === 'object', 'CLI --json returns a JSON object');
assert(parsedReport.projectSummary && parsedReport.projectSummary.axes, 'CLI JSON includes projectSummary.axes');
assert(Array.isArray(parsedReport.perFile) && parsedReport.perFile.length > 1, 'CLI JSON includes per-file results');
assert(secretsJson.secrets.some(function (item) { return item.value === 'A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S7t8U9v0W1x2Y3z4A5b6C7d8E9f0G1h2'; }),
	'CLI --json preserves raw confirmed secret values for exact triage');
assert(secretsJson.secrets.every(function (item) { return item.value.indexOf('*') === -1; }),
	'CLI --json does not redact confirmed secret values with asterisks');

section('CLI result summary');

var cleanSummaryOutput = runCli([path.join(fixturesDir, 'clean')]);
var slopSummaryOutput = runCli([path.join(fixturesDir, 'slop')]);
var secretsSummaryOutput = runCli([path.join(fixturesDir, 'secrets', 'HardcodedSecrets.cs')]);
var cleanSummaryText = stripAnsi(cleanSummaryOutput);
var slopSummaryText = stripAnsi(slopSummaryOutput);
var secretsSummaryText = stripAnsi(secretsSummaryOutput);

assert(cleanSummaryText.indexOf('Act on this') !== -1 && cleanSummaryText.indexOf('Worth a look') !== -1,
	'CLI default output includes the current action-first summary block when no issues are present');
assert(cleanSummaryText.indexOf('ANALYSIS PIPELINE') === -1,
	'CLI non-interactive output does not leak the live progress display into normal output');
assert(cleanSummaryText.indexOf('Act on this    0 high-signal findings') !== -1,
	'CLI clean summary reports zero high-signal findings in the action line');
assert(slopSummaryText.indexOf('Act on this') !== -1 && slopSummaryText.indexOf('TOP OFFENDERS') !== -1,
	'CLI default output marks rule-hit scans with the current action summary and offender table');
assert(slopSummaryText.indexOf('SLOP BREAKDOWN') !== -1,
	'CLI actionable summary still includes the slop breakdown section');
assert(secretsSummaryText.indexOf('Act on this    2 high-signal findings') !== -1,
	'CLI default output reports confirmed secrets in the action summary line');
assert(secretsSummaryText.indexOf('FLAGGED  (2 high-signal findings)') !== -1,
	'CLI urgent summary still shows the flagged confirmed secret section');

section('CLI detail and explain flags');

var shortFileOutput = runCli([path.join(fixturesDir, 'slop'), '-f=WorkflowFacadeBuilder.cs']);
var explainOutput = runCli([path.join(fixturesDir, 'secrets', 'HardcodedSecrets.cs'), '--explain=3']);

assert(shortFileOutput.indexOf('WorkflowFacadeBuilder.cs') !== -1 && shortFileOutput.indexOf('PATTERN HITS') !== -1,
	'CLI -f=NAME selects the requested file detail');
assert(explainOutput.indexOf('-- explain  L3') !== -1, 'CLI --explain prints an explain block for the nearest hit');
assert(explainOutput.indexOf('candidate value') !== -1 && explainOutput.indexOf('A1b2C3d4') !== -1,
	'CLI --explain shows the raw candidate value from the matched finding');
assert(explainOutput.indexOf('pipeline score') !== -1,
	'CLI --explain shows pipeline score for a secret finding');
assert(explainOutput.indexOf('entropy') !== -1 && explainOutput.indexOf('IC') !== -1,
	'CLI --explain shows entropy and IC for a secret finding');
assert(explainOutput.indexOf('tier') !== -1 && explainOutput.indexOf('HIGH') !== -1,
	'CLI --explain shows the arbitration tier for a secret finding');

section('CLI help output');

var helpOutput = runCli(['--help']);
var versionOutput = runCli(['--version']);
assert(helpOutput.indexOf('cszone38  v0.1.0') !== -1, 'CLI --help shows the tool version in the header');
assert(helpOutput.indexOf('Quick start') !== -1, 'CLI --help includes a quick-start section for new users');
assert(helpOutput.indexOf('--open') !== -1, 'CLI --help advertises --open after implementation');
assert(helpOutput.indexOf('--fix') !== -1, 'CLI --help advertises --fix');
assert(helpOutput.indexOf('--deep') !== -1, 'CLI --help advertises --deep');
assert(helpOutput.indexOf('--verify') !== -1, 'CLI --help advertises --verify');
assert(helpOutput.indexOf('--allow-network') !== -1, 'CLI --help advertises --allow-network');
assert(helpOutput.indexOf('--version') !== -1, 'CLI --help advertises --version');
assert(helpOutput.indexOf('setup deep') !== -1, 'CLI --help advertises setup deep');
assert(helpOutput.indexOf('doctor') !== -1, 'CLI --help advertises doctor');
assert(helpOutput.indexOf('--explain=LINE') !== -1, 'CLI --help still advertises --explain');
assert(helpOutput.indexOf('--explain-line=LINE') === -1, 'CLI --help does not advertise a wrong explain flag name');
assert(versionOutput.trim() === 'cszone38 0.1.0', 'CLI --version prints the current cszone38 version');

section('CLI open mode');

// --open tests must always use execFileSync or pipe stdin.
// Never probe interactive flags from a raw TTY — the navigator
// will wait for keypresses and the command will never exit.
var openOutput = runCli([path.join(fixturesDir, 'slop'), '--open']);
assert(openOutput.indexOf('Categories (requires interactive terminal for navigation):') !== -1,
	'CLI --open falls back to category listing when no interactive terminal is available');
assert(openOutput.indexOf('over-engineering') !== -1,
	'CLI --open includes category names in non-interactive mode');

section('CLI fix mode');

var fixDir = makeFixFixtureDir();
var fixOutput = runCli([fixDir, '--fix']);
var fixedConsole = fs.readFileSync(path.join(fixDir, 'ConsoleWriteLineDebugService.cs'), 'utf8');
var fixedTodo = fs.readFileSync(path.join(fixDir, 'TodoFixmeCommentService.cs'), 'utf8');
var fixedCatch = fs.readFileSync(path.join(fixDir, 'EmptyCatchBlockService.cs'), 'utf8');
var postFixReport = JSON.parse(runCli([fixDir, '--json']));
var remainingRuleIds = postFixReport.patternHits.map(function (hit) { return hit.ruleId; });

assert(fixOutput.indexOf('FIX MODE') !== -1, 'CLI --fix prints a fix summary');
assert(fixedConsole.indexOf('Console.WriteLine') === -1,
	'CLI --fix removes Console.WriteLine debug lines');
assert(fixedTodo.indexOf('TODO') === -1 && fixedTodo.indexOf('// remove this before shipping') !== -1,
	'CLI --fix resolves TODO markers without deleting the comment text');
assert(fixedCatch.indexOf('System.Diagnostics.Trace.TraceError(ex.ToString());') !== -1 && fixedCatch.indexOf('throw;') !== -1,
	'CLI --fix replaces empty catch blocks with a logged rethrow');
assert(remainingRuleIds.indexOf('console-writeline-debug') === -1 &&
	remainingRuleIds.indexOf('todo-fixme-comment') === -1 &&
	remainingRuleIds.indexOf('empty-catch-block') === -1,
	'CLI --fix removes the targeted rule hits from a follow-up scan');

fs.rmSync(fixDir, { recursive: true, force: true });

section('CLI no-slop security mode');

var noSlopOutput = runCli([fixturesDir, '--axis=B', '--no-slop']);
assert(typeof noSlopOutput === 'string' && noSlopOutput.length > 0, 'CLI --axis=B --no-slop produces output');

var noSlopProbe = childProcess.spawnSync(process.execPath, ['-e', [
	"const path = require('path');",
	"const wasmPath = path.resolve(process.cwd(), 'src/wasm-parser.js');",
	"require.cache[wasmPath] = {",
	"  id: wasmPath,",
	"  filename: wasmPath,",
	"  loaded: true,",
	"  exports: { initialize: function () { throw new Error('WASM init called'); }, parse: function () { throw new Error('parse called'); } }",
	"};",
	"process.argv = ['node', path.resolve(process.cwd(), 'bin/cszone38.js'), '.', '--axis=B', '--no-slop'];",
	"require(path.resolve(process.cwd(), 'bin/cszone38.js'));"
].join(' ')], {
	cwd: path.join(__dirname, '..'),
	encoding: 'utf8',
});

assert(noSlopProbe.status === 0, 'CLI --no-slop does not initialize WASM');

section('CLI deep and verify guards');

var omittedOptionalStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-deep-omitted-store-'));
var deepGuard = runCliWithStatusAndEnv([path.join(fixturesDir, 'clean', 'CleanService.cs'), '--deep'], {
	CSZONE38_DEEP_STORE_ROOT: omittedOptionalStoreRoot,
});
var deepGuardJson = JSON.parse(runCliWithEnv([path.join(fixturesDir, 'clean', 'CleanService.cs'), '--deep', '--json'], {
	CSZONE38_DEEP_STORE_ROOT: omittedOptionalStoreRoot,
}));
var verifyGuard = runCliWithStatus([path.join(fixturesDir, 'clean', 'CleanService.cs'), '--verify']);
var deepGuardText = stripAnsi(deepGuard.stdout);
var verifyGuardText = stripAnsi(verifyGuard.stdout);

assert(deepGuard.status === 0, 'CLI --deep without a private deep toolchain exits 0 on a clean fixture');
assert(deepGuardText.indexOf('--deep unavailable') !== -1,
	'CLI --deep without a private deep toolchain prints the graceful warning');
assert(deepGuardText.indexOf('GitHub Releases') !== -1 && deepGuardText.indexOf('setup deep --bundle=') !== -1,
	'CLI --deep unavailable warning points to the release asset and manual bundle setup');
assert(deepGuardJson.deep && deepGuardJson.deep.warning && deepGuardJson.deep.warning.indexOf('--deep unavailable') !== -1,
	'CLI --json includes deep warning metadata when the private deep toolchain is unavailable');
assert(verifyGuard.status === 0, 'CLI --verify without --allow-network exits 0 on a clean fixture');
assert(verifyGuardText.indexOf('--verify may contact live providers') !== -1,
	'CLI --verify prints the startup honeypot warning');
assert(verifyGuardText.indexOf('--verify requires --allow-network') !== -1,
	'CLI --verify without --allow-network prints the guard warning');

fs.rmSync(omittedOptionalStoreRoot, { recursive: true, force: true });

section('CLI deep setup and doctor');

var setupWithoutBundle = runCliWithStatus(['setup', 'deep']);

assert(setupWithoutBundle.status === 1 && stripAnsi(setupWithoutBundle.stderr).indexOf('setup deep requires --bundle=PATH') !== -1,
	'CLI setup deep without --bundle fails with a clear manual bundle requirement');

var deepStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-e2e-deep-store-'));
var deepBundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-e2e-deep-bundle-'));
var e2eDotnetRoot = path.join(deepBundleRoot, 'dotnet');
var e2eDotnetPath = path.join(e2eDotnetRoot, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
var e2eSdkPath = path.join(e2eDotnetRoot, 'sdk', '8.0.100');
var e2eToolPath = path.join(deepBundleRoot, 'tools', process.platform === 'win32' ? 'security-scan.exe' : 'security-scan');
fs.mkdirSync(path.dirname(e2eToolPath), { recursive: true });
fs.mkdirSync(e2eSdkPath, { recursive: true });
fs.writeFileSync(e2eDotnetPath, '');
fs.writeFileSync(e2eToolPath, '');
fs.writeFileSync(path.join(deepBundleRoot, 'manifest.json'), JSON.stringify({
	schemaVersion: 1,
	engine: 'security-code-scan',
	engineVersion: '5.6.7',
	dotnetRoot: 'dotnet',
	dotnetPath: process.platform === 'win32' ? 'dotnet/dotnet.exe' : 'dotnet/dotnet',
	sdkPath: 'dotnet/sdk/8.0.100',
	securityScanPath: process.platform === 'win32' ? 'tools/security-scan.exe' : 'tools/security-scan',
}, null, 2));

var setupDeep = runCliWithStatusAndEnv(['setup', 'deep', '--bundle=' + deepBundleRoot], {
	CSZONE38_DEEP_STORE_ROOT: deepStoreRoot,
});
var doctorOutput = stripAnsi(runCliWithEnv(['doctor'], {
	CSZONE38_DEEP_STORE_ROOT: deepStoreRoot,
}));
var doctorJson = JSON.parse(runCliWithEnv(['doctor', '--json'], {
	CSZONE38_DEEP_STORE_ROOT: deepStoreRoot,
}));

assert(setupDeep.status === 0 && stripAnsi(setupDeep.stdout).indexOf('DEEP SETUP') !== -1,
	'CLI setup deep installs a private deep bundle');
assert(doctorJson.deep && doctorJson.deep.available === true && doctorJson.deep.engine === 'security-code-scan',
	'CLI doctor reports the private deep toolchain as ready');
assert(doctorOutput.indexOf('deep source') !== -1 && doctorOutput.indexOf('bundle') !== -1,
	'CLI doctor prints the deep install source in human-readable output');
assert(doctorJson.deep && doctorJson.deep.installSource === 'bundle',
	'CLI doctor JSON reports the deep install source');

fs.rmSync(deepStoreRoot, { recursive: true, force: true });
fs.rmSync(deepBundleRoot, { recursive: true, force: true });

section('CLI secrets benchmark');

var secretsJson = JSON.parse(runCli([path.join(fixturesDir, 'secrets', 'HardcodedSecrets.cs'), '--json']));
assert(Array.isArray(secretsJson.secrets) && secretsJson.secrets.length >= 2, 'CLI secrets benchmark reports at least two secrets');

process.stdout.write('\n');
if (failed === 0) {
	process.stdout.write('  \x1b[32m\x1b[1m' + passed + ' passed\x1b[0m\n\n');
} else {
	process.stdout.write('  \x1b[32m' + passed + ' passed\x1b[0m  \x1b[31m\x1b[1m' + failed + ' failed\x1b[0m\n\n');
	process.exit(1);
}
