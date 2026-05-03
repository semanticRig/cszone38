'use strict';

// Unit + integration test runner.
// Zero dependencies. Exit 0 on all pass, exit 1 on any failure.
// Tests are added phase by phase. This file grows with the project.

var childProcess = require('child_process');

var passed = 0;
var failed = 0;

function assert(description, condition) {
  if (condition) {
    process.stdout.write('  PASS  ' + description + '\n');
    passed++;
  } else {
    process.stderr.write('  FAIL  ' + description + '\n');
    failed++;
  }
}

function findHit(hits, ruleId) {
  for (var i = 0; i < hits.length; i++) {
    if (hits[i].ruleId === ruleId) return hits[i];
  }
  return null;
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function hasUniformVisibleWidth(frameText) {
  var lines = stripAnsi(frameText).split('\n').filter(Boolean);
  var width;
  var i;

  if (!lines.length) return false;
  width = lines[0].length;

  for (i = 1; i < lines.length; i++) {
    if (lines[i].length !== width) return false;
  }

  return true;
}

function makeSignalSet(value, pipelineScore, extraSignals) {
  var signals = {
    maxPipelineScore: pipelineScore,
    icSignal: false,
    ctfSignal: false,
    egsSpike: false,
    uniformity: false,
  };

  extraSignals = extraSignals || {};
  var keys = Object.keys(extraSignals);
  for (var i = 0; i < keys.length; i++) {
    signals[keys[i]] = extraSignals[keys[i]];
  }

  return {
    candidate: {
      value: value,
      line: 1,
      lineIndex: 0,
      identifierName: 'Candidate',
      callSiteContext: 'test',
      type: 'string',
    },
    signals: signals,
    subResults: [],
  };
}

async function main() {
  // -------------------------------------------------------------------------
  // Phase 1 — Skeleton sanity checks
  // -------------------------------------------------------------------------

  // package.json fields
  var pkg = require('../package.json');
  assert('package.json: name is cszone38',       pkg.name === 'cszone38');
  assert('package.json: version is 0.1.0',       pkg.version === '0.1.0');
  assert('package.json: main is src/index.js',   pkg.main === 'src/index.js');
  assert('package.json: bin entry exists',       pkg.bin && pkg.bin['cszone38'] === 'bin/cszone38.js');
  assert('package.json: engines node >= 18',     pkg.engines && pkg.engines.node === '>=18.0.0');
  assert('package.json: deep bundle build script exists', pkg.scripts
    && pkg.scripts['build:deep-bundle'] === 'node scripts/build-deep-bundle.js');
  assert('package.json: files allowlist locks the public tarball', Array.isArray(pkg.files)
    && pkg.files.length === 4
    && pkg.files[0] === 'bin/'
    && pkg.files[1] === 'corpus/'
    && pkg.files[2] === 'scripts/build-deep-bundle.js'
    && pkg.files[3] === 'src/');
  assert('package.json: release package does not advertise npm deep companions',
    !pkg.cszone38 && !pkg.scripts['prepare:deep-release']);

  // src/index.js exports the right shape
  var api = require('../src/index.js');
  var Deep = require('../src/deep-scan-cs');
  assert('src/index.js: exports run',        typeof api.run === 'function');
  assert('src/index.js: exports renderJson', typeof api.renderJson === 'function');
  assert('src/index.js: exports exitCode',   typeof api.exitCode === 'function');

  var ProgressUi = require('../src/progress-ui-cs');
  var progressPhaseOrder = ProgressUi._phaseOrder({ deep: true, verify: true });
  var progressFrame = ProgressUi._formatFrame({
    version: '0.1.0',
    phaseOrder: progressPhaseOrder,
    phase: 'scan',
    fileCurrent: 3,
    fileTotal: 10,
    currentFile: 'Shell/ShellFeaturesManager.cs',
    note: 'collected 10 files',
    targetPath: '.',
    startedAt: 0,
    now: 1234,
  });
  var completionFrame = ProgressUi._formatCompletion({
    startedAt: 0,
    now: 1234,
  }, {
    fileCount: 82,
    totalLines: 7210,
    finishedAt: 2500,
    deep: {
      requested: true,
      available: true,
      attempted: true,
      findings: [],
      scan_time_ms: 2500,
      engine: 'security-code-scan',
    },
  });
  var partialCompletionFrame = ProgressUi._formatCompletion({
    startedAt: 0,
    now: 1234,
  }, {
    fileCount: 82,
    totalLines: 7210,
    finishedAt: 2500,
    deep: {
      requested: true,
      available: true,
      attempted: true,
      findings: [],
      scan_time_ms: 2500,
      engine: 'security-code-scan',
      warning: Deep.DEEP_PARTIAL_WARNING,
    },
  });
  var longCompletionFrame = ProgressUi._formatCompletion({
    startedAt: 0,
    now: 61500,
  }, {
    fileCount: 160,
    totalLines: 29902,
    finishedAt: 61500,
    deep: {
      requested: true,
      available: true,
      attempted: true,
      findings: [],
      scan_time_ms: 2800,
      engine: 'security-code-scan',
    },
  });
  var narrowCompletionFrame = ProgressUi._formatCompletion({
    startedAt: 0,
    now: 61500,
    maxFrameWidth: 46,
  }, {
    fileCount: 160,
    totalLines: 29902,
    finishedAt: 61500,
    deep: {
      requested: true,
      available: true,
      attempted: true,
      findings: [],
      scan_time_ms: 2800,
      engine: 'security-code-scan',
    },
  });
  assert('progress-ui: phase order includes deep and verify when enabled',
    progressPhaseOrder.join(',') === 'init,scan,deep,verify');
  assert('progress-ui: formatted frame includes pipeline label, phase matrix, cadence, and current target',
    progressFrame.indexOf('ANALYSIS PIPELINE') !== -1 &&
    progressFrame.indexOf('phase matrix') !== -1 &&
    progressFrame.indexOf('cadence') !== -1 &&
    progressFrame.indexOf('30.0%') !== -1 &&
    progressFrame.indexOf('Shell/ShellFeaturesManager.cs') !== -1);
  assert('progress-ui: completion frame includes complete status, totals, and deep runtime summary',
    completionFrame.indexOf('COMPLETE') !== -1 &&
    completionFrame.indexOf('82 files') !== -1 &&
    completionFrame.indexOf('7,210 lines') !== -1 &&
    completionFrame.indexOf('scanned clean') !== -1 &&
    completionFrame.indexOf('runtime 2.5s') !== -1);
  assert('progress-ui: completion frame surfaces partial deep scans',
    partialCompletionFrame.indexOf('partial') !== -1 &&
    partialCompletionFrame.indexOf('project load failures') !== -1);
  assert('progress-ui: long completion frame keeps every row inside the border',
    longCompletionFrame.indexOf('29,902 lines') !== -1 &&
    longCompletionFrame.indexOf('security-code-scan') !== -1 &&
    hasUniformVisibleWidth(longCompletionFrame));
  assert('progress-ui: narrow completion frame truncates cleanly inside the border',
    narrowCompletionFrame.indexOf('...') !== -1 &&
    hasUniformVisibleWidth(narrowCompletionFrame));

  // bin/cszone38.js exists and is readable
  var fs = require('fs');
  var path = require('path');
  var publishWorkflowText = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'publish.yml'), 'utf8');
  assert('bin/cszone38.js: file exists',
    fs.existsSync(path.join(__dirname, '..', 'bin', 'cszone38.js')));
  assert('publish workflow: stages deep release packages before publishing',
    publishWorkflowText.indexOf('runs-on: [self-hosted, linux, x64]') !== -1 &&
    publishWorkflowText.indexOf('CSZONE38_DEEP_BUNDLE_LINUX_X64') !== -1 &&
    publishWorkflowText.indexOf('npm run prepare:deep-release --') === -1 &&
    publishWorkflowText.indexOf('release-manifest.json') === -1 &&
    publishWorkflowText.indexOf('softprops/action-gh-release@v2') !== -1 &&
    publishWorkflowText.indexOf('cszone38-deep-linux-x64.tar.gz') !== -1 &&
    publishWorkflowText.indexOf('- name: Publish npm package') !== -1);

  // -------------------------------------------------------------------------
  // Phase 2 — WASM parser singleton
  // -------------------------------------------------------------------------

  var WasmParser = require('../src/wasm-parser');
  var parserBundle = await WasmParser.initialize();
  var parserBundleAgain = await WasmParser.initialize();
  var sample = [
    'using System;',
    '',
    'namespace Demo;',
    '',
    'public class Example',
    '{',
    '    public string Name => "ok";',
    '}',
    '',
    ''
  ].join('\n');
  var tree = WasmParser.parse(parserBundle.parser, sample);

  assert('wasm-parser: initialize returns parser bundle',
    parserBundle && parserBundle.parser && parserBundle.CSharp);
  assert('wasm-parser: initialize is idempotent', parserBundle === parserBundleAgain);
  assert('wasm-parser: parse returns a tree', tree && tree.rootNode);
  assert('wasm-parser: root node is compilation_unit', tree && tree.rootNode.type === 'compilation_unit');

  // -------------------------------------------------------------------------
  // Phase 3 — C# PDA harvester
  // -------------------------------------------------------------------------

  var L04 = require('../src/L04-harvest-cs');
  var L01b = require('../src/L01b-razor-preprocess');

  function readFixture(relPath) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', relPath), 'utf8');
  }

  function findCandidate(candidates, value) {
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].value === value) return candidates[i];
    }
    return null;
  }

  var standardCandidates = L04.harvestCSharpEntities(readFixture('strings-standard.cs'), {}, parserBundle);
  var interpolatedCandidates = L04.harvestCSharpEntities(readFixture('strings-interpolated.cs'), {}, parserBundle);
  var rawCandidates = L04.harvestCSharpEntities(readFixture('strings-raw.cs'), {}, parserBundle);
  var charCandidates = L04.harvestCSharpEntities(readFixture('false-positives/char-literals.cs'), {}, parserBundle);
  var razorPreprocessed = L01b.preprocessRazorContent([
    '@page "/secret"',
    '',
    '<h1>Hello</h1>',
    '',
    '@code {',
    '    private const string ApiToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12";',
    '    public string Banner => "hello";',
    '}',
  ].join('\n'));
  var razorStatementPreprocessed = L01b.preprocessRazorContent([
    '@page "/statement-secret"',
    '@{',
    '    var apiToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12";',
    '}',
    '<h1>Hello</h1>',
  ].join('\n'));
  var razorExpressionPreprocessed = L01b.preprocessRazorContent([
    '@page "/expr-secret"',
    '<div>@("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12")</div>',
    '<span>@(BuildLabel())</span>',
  ].join('\n'));
  var razorMultilineExpressionPreprocessed = L01b.preprocessRazorContent([
    '@page "/expr-multi"',
    '<div>@(',
    '  "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12"',
    ')</div>',
  ].join('\n'));
  var razorMixedExpressionPreprocessed = L01b.preprocessRazorContent([
    '<div>@("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12") and @(BuildLabel())</div>',
  ].join('\n'));
  var defaultCandidates = L04.harvestCSharpEntities('class Demo { string Value = $"Bearer {token}"; }', {}, null);
  var formatCandidates = L04.harvestCSharpEntities([
    'using System;',
    'public class Demo {',
    '  public string Make(string token) {',
    '    return string.Format("Bearer {0}", token);',
    '  }',
    '}',
  ].join('\n'), {}, parserBundle);
  var fragmentedCandidates = L04.harvestCSharpEntities('var sessionValue = "Bearer " + token;', {}, parserBundle);
  var fragmentedMethodCandidates = L04.harvestCSharpEntities('var sessionValue = "Bearer " + BuildToken();', {}, parserBundle);
  var fragmentedInterpolatedCandidates = L04.harvestCSharpEntities('var sessionValue = $"Bearer {token}";', {}, parserBundle);
  var contextCandidates = L04.harvestCSharpEntities([
    'using System;',
    '[Route("api/test")]',
    'public class Demo {',
    '  private string field = "field-secret";',
    '  private const string ConstValue = "const-secret";',
    '  public void Run() {',
    '    Console.WriteLine("arg-secret");',
    '  }',
    '}',
  ].join('\n'), {}, parserBundle);

  assert('harvest-cs: extracts standard strings',
    !!findCandidate(standardCandidates, 'normal string'));
  assert('harvest-cs: preserves verbatim backslashes',
    !!findCandidate(standardCandidates, 'C:\\Users\\verbatim'));
  assert('harvest-cs: strips interpolation from bearer sample',
    !!findCandidate(interpolatedCandidates, 'Bearer '));
  assert('harvest-cs: strips multiple interpolation holes',
    !!findCandidate(interpolatedCandidates, 'User  logged in at '));
  assert('harvest-cs: keeps escaped braces as literals',
    !!findCandidate(interpolatedCandidates, '{literal braces}'));
  assert('harvest-cs: keeps raw token content verbatim',
    !!findCandidate(rawCandidates, 'eyJhbGciOiJIUzI1NiJ9.payload.signature'));
  assert('harvest-cs: supports multiline raw strings',
    !!findCandidate(rawCandidates, 'alpha\nbeta'));
  assert('harvest-cs: strips raw interpolation holes',
    !!findCandidate(rawCandidates, 'Has  inside'));
  assert('harvest-cs: suppresses char literals', charCandidates.length === 0);
  assert('razor-preprocess: strips markup noise and preserves line count',
    razorPreprocessed.content.split('\n').length === 8 &&
    razorPreprocessed.content.indexOf('/secret') === -1 &&
    razorPreprocessed.content.indexOf('<h1>Hello</h1>') === -1 &&
    razorPreprocessed.content.indexOf('class __RazorComponent1 {') !== -1 &&
    razorPreprocessed.content.indexOf('private const string ApiToken') !== -1);
  assert('razor-preprocess: preserves statement blocks while blanking surrounding markup',
    razorStatementPreprocessed.content.split('\n').length === 5 &&
    razorStatementPreprocessed.content.indexOf('/statement-secret') === -1 &&
    razorStatementPreprocessed.content.indexOf('<h1>Hello</h1>') === -1 &&
    razorStatementPreprocessed.content.indexOf('class __RazorStatements1 { void __RazorRender1() {') !== -1 &&
    razorStatementPreprocessed.content.indexOf('var apiToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12";') !== -1);
  assert('razor-preprocess: preserves inline expressions while blanking surrounding markup',
    razorExpressionPreprocessed.content.split('\n').length === 3 &&
    razorExpressionPreprocessed.content.indexOf('/expr-secret') === -1 &&
    razorExpressionPreprocessed.content.indexOf('<div>') === -1 &&
    razorExpressionPreprocessed.content.indexOf('class __RazorInlineExpression1 { void __RazorRender1() { var __razorValue1_1 = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12"; } }') !== -1 &&
    razorExpressionPreprocessed.content.indexOf('var __razorValue2_1 = BuildLabel();') !== -1);
  assert('razor-preprocess: preserves multiline inline expressions while blanking surrounding markup',
    razorMultilineExpressionPreprocessed.content.split('\n').length === 4 &&
    razorMultilineExpressionPreprocessed.content.indexOf('/expr-multi') === -1 &&
    razorMultilineExpressionPreprocessed.content.indexOf('<div>') === -1 &&
    razorMultilineExpressionPreprocessed.content.indexOf('class __RazorInlineExpression1 { void __RazorRender1() { var __razorValue1_1 = ') !== -1 &&
    razorMultilineExpressionPreprocessed.content.indexOf('  "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12"') !== -1 &&
    razorMultilineExpressionPreprocessed.content.indexOf('; } }') !== -1);
  assert('razor-preprocess: reports preserved Razor regions',
    razorPreprocessed.regions.length === 1 &&
    razorPreprocessed.regions[0].kind === 'code' &&
    razorPreprocessed.regions[0].originalStartLine === 4 &&
    razorPreprocessed.regions[0].originalEndLine === 7 &&
    razorStatementPreprocessed.regions.length === 1 &&
    razorStatementPreprocessed.regions[0].kind === 'statement' &&
    razorStatementPreprocessed.regions[0].originalStartLine === 1 &&
    razorStatementPreprocessed.regions[0].originalEndLine === 3 &&
    razorExpressionPreprocessed.regions.length === 2 &&
    razorExpressionPreprocessed.regions[0].kind === 'expression' &&
    razorExpressionPreprocessed.regions[0].originalStartLine === 1 &&
    razorExpressionPreprocessed.regions[0].expressionCount === 1 &&
    razorExpressionPreprocessed.regions[1].originalStartLine === 2);
  assert('razor-preprocess: tracks mixed-line expression offsets per segment',
    razorMixedExpressionPreprocessed.regions.length === 1 &&
    razorMixedExpressionPreprocessed.regions[0].segments.length === 2 &&
    razorMixedExpressionPreprocessed.regions[0].segments[0].originalStartColumn === 5 &&
    razorMixedExpressionPreprocessed.regions[0].segments[0].originalExpressionStartColumn === 7 &&
    razorMixedExpressionPreprocessed.regions[0].segments[0].originalExpressionEndColumn === 40 &&
    razorMixedExpressionPreprocessed.regions[0].segments[1].originalStartColumn === 47 &&
    razorMixedExpressionPreprocessed.regions[0].segments[1].originalExpressionStartColumn === 49 &&
    razorMixedExpressionPreprocessed.regions[0].segments[1].originalExpressionEndColumn === 60 &&
    razorMixedExpressionPreprocessed.regions[0].segments[0].syntheticExpressionStartColumn < razorMixedExpressionPreprocessed.regions[0].segments[1].syntheticExpressionStartColumn);
  assert('razor-preprocess: builds offset tables for preserved Razor regions',
    razorPreprocessed.regions[0].mappings.length === 3 &&
    razorPreprocessed.regions[0].mappings[0].kind === 'line' &&
    razorPreprocessed.regions[0].mappings[0].originalLine === 5 &&
    razorPreprocessed.regions[0].mappings[0].syntheticLine === 5 &&
    razorStatementPreprocessed.regions[0].mappings.length === 2 &&
    razorStatementPreprocessed.regions[0].mappings[1].originalLine === 3 &&
    razorStatementPreprocessed.regions[0].mappings[1].syntheticEndColumn === 0 &&
    razorExpressionPreprocessed.regions[0].mappings.length === 1 &&
    razorExpressionPreprocessed.regions[0].mappings[0].kind === 'expression' &&
    razorExpressionPreprocessed.regions[0].mappings[0].syntheticStartColumn === razorExpressionPreprocessed.regions[0].segments[0].syntheticExpressionStartColumn &&
    razorMixedExpressionPreprocessed.regions[0].mappings.length === 2 &&
    razorMixedExpressionPreprocessed.regions[0].mappings[1].originalStartColumn === 49);
  assert('razor-preprocess: builds offset tables for multiline inline expressions',
    razorMultilineExpressionPreprocessed.regions.length === 1 &&
    razorMultilineExpressionPreprocessed.regions[0].mappings.length === 1 &&
    razorMultilineExpressionPreprocessed.regions[0].mappings[0].originalLine === 2 &&
    razorMultilineExpressionPreprocessed.regions[0].mappings[0].syntheticLine === 2 &&
    razorMultilineExpressionPreprocessed.regions[0].mappings[0].syntheticStartColumn === 0);
  assert('harvest-cs: marks string.Format template arguments as safe sinks',
    formatCandidates.length === 1 && formatCandidates[0].safeSink === true);
  assert('harvest-cs: tags literal-plus-identifier assignments as fragmented',
    fragmentedCandidates.length === 1 && fragmentedCandidates[0].tags.indexOf('fragmented_assignment') !== -1);
  assert('harvest-cs: does not tag method-call concatenations as fragmented',
    fragmentedMethodCandidates.length === 1 && fragmentedMethodCandidates[0].tags.indexOf('fragmented_assignment') === -1);
  assert('harvest-cs: does not tag interpolated strings as fragmented assignments',
    fragmentedInterpolatedCandidates.length === 1 && fragmentedInterpolatedCandidates[0].tags.indexOf('fragmented_assignment') === -1);
  assert('harvest-cs: defaults structural context without parser',
    defaultCandidates.length === 1 &&
    defaultCandidates[0].structuralContext === 'default' &&
    defaultCandidates[0].contextFactor === 1.0);
  assert('harvest-cs: tags attribute arguments',
    findCandidate(contextCandidates, 'api/test').structuralContext === 'attribute_argument' &&
    findCandidate(contextCandidates, 'api/test').contextFactor === 0.5);
  assert('harvest-cs: tags invocation arguments',
    findCandidate(contextCandidates, 'arg-secret').structuralContext === 'argument' &&
    findCandidate(contextCandidates, 'arg-secret').contextFactor === 0.7);
  assert('harvest-cs: keeps ordinary invocation arguments out of safe-sink suppression',
    findCandidate(contextCandidates, 'arg-secret').safeSink === false);
  assert('harvest-cs: tags field declarations',
    findCandidate(contextCandidates, 'field-secret').structuralContext === 'field_declaration' &&
    findCandidate(contextCandidates, 'field-secret').contextFactor === 1.2);
  assert('harvest-cs: tags const declarations',
    findCandidate(contextCandidates, 'const-secret').structuralContext === 'const_declaration' &&
    findCandidate(contextCandidates, 'const-secret').contextFactor === 1.3);

  // -------------------------------------------------------------------------
  // Phase 4 — C# role classifier
  // -------------------------------------------------------------------------

  var L01 = require('../src/L01-role-cs');

  function makeRoleRecord(relPath, territory) {
    return {
      relativePath: relPath,
      ext: path.extname(relPath).toLowerCase(),
      territory: territory || 'application',
    };
  }

  var controllerRole = L01.classifyRole(makeRoleRecord('test/fixtures/roles/Controllers/HomeController.cs'));
  var pageRole = L01.classifyRole(makeRoleRecord('test/fixtures/roles/Pages/Dashboard/Index.razor'));
  var programRole = L01.classifyRole(makeRoleRecord('test/fixtures/roles/Config/Program.cs'));
  var helperRole = L01.classifyRole(makeRoleRecord('test/fixtures/roles/Helpers/StringParser.cs'));
  var testRole = L01.classifyRole(makeRoleRecord('test/fixtures/roles/Tests/AuthServiceTests.cs'));
  var generatedRole = L01.classifyRole(makeRoleRecord('test/fixtures/roles/Generated/AssemblyInfo.g.cs'));
  var migrationRole = L01.classifyRole(makeRoleRecord('test/fixtures/roles/Migrations/20260430_Initial.cs'));

  assert('role-cs: classifies controller path as backend',
    controllerRole.contextType === 'backend' &&
    controllerRole.isBackend === true &&
    controllerRole.isFrontend === false &&
    controllerRole.fileType === 'general');
  assert('role-cs: classifies razor page path as frontend',
    pageRole.contextType === 'frontend' &&
    pageRole.isFrontend === true &&
    pageRole.isBackend === false);
  assert('role-cs: classifies Program.cs as config',
    programRole.fileType === 'config' &&
    programRole.isGenerated === false);
  assert('role-cs: classifies helper path as logic',
    helperRole.fileType === 'logic' &&
    helperRole.contextType === 'isomorphic');
  assert('role-cs: detects test files from path conventions',
    testRole.isTest === true);
  assert('role-cs: detects generated files by suffix and directory',
    generatedRole.isGenerated === true &&
    generatedRole.isTest === false);
  assert('role-cs: marks migrations as backend and generated',
    migrationRole.isBackend === true &&
    migrationRole.isGenerated === true &&
    migrationRole.contextType === 'backend');

  // -------------------------------------------------------------------------
  // Phase 5 — C# pattern rules
  // -------------------------------------------------------------------------

  var L10 = require('../src/L10-rules-cs');

  function repeatString(value, count) {
    return new Array(count + 1).join(value);
  }

  function buildProviderPrefixFixture() {
    return [
      'public class ProviderPrefixSecrets',
      '{',
      '    private const string AwsAccessKey = "' + ['AKIA', 'A1B2C3D4E5F6G7H8'].join('') + '";',
      '    private const string AwsTemporaryAccessKey = "' + ['ASIA', 'A1B2C3D4E5F6G7H8'].join('') + '";',
      '    private const string GitHubToken = "' + ['ghp_', repeatString('A', 24)].join('') + '";',
      '    private const string GitHubFineGrainedToken = "' + ['github_pat_', repeatString('A', 71)].join('') + '";',
      '    private const string GitLabToken = "' + ['glpat-', repeatString('a', 24)].join('') + '";',
      '    private const string StripeLiveKey = "' + ['sk_', 'live_', repeatString('A', 24)].join('') + '";',
      '    private const string StripeTestKey = "' + ['sk_', 'test_', repeatString('A', 24)].join('') + '";',
      '    private const string SlackToken = "' + ['xox', 'p-', '123456789012-123456789012-', repeatString('a', 18)].join('') + '";',
      '    private const string SlackBotToken = "' + ['xox', 'b-', '123456789012-123456789012-', repeatString('a', 18)].join('') + '";',
      '    private const string JwtToken = "' + ['ey', repeatString('A', 10), '.', repeatString('B', 12), '.', repeatString('C', 12)].join('') + '";',
      '    private const string NpmToken = "' + ['npm_', repeatString('A', 36)].join('') + '";',
      '    private const string LinearApiKey = "' + ['lin_api_', repeatString('a1', 20)].join('') + '";',
      '    private const string ShopifyAccessToken = "' + ['shpat_', repeatString('ab', 16)].join('') + '";',
      '    private const string SquareAccessToken = "' + ['sq0atp-', repeatString('Ab1_', 6)].join('').slice(0, 29) + '";',
      '    private const string DatabricksToken = "' + ['dapi', repeatString('ab', 16)].join('') + '";',
      '    private const string DigitalOceanToken = "' + ['dop_v1_', repeatString('ab', 32)].join('') + '";',
      '    private const string SendGridToken = "' + ['SG.', repeatString('A', 30), '.', repeatString('B', 30)].join('') + '";',
      '    private const string OpenAiProjectKey = "' + ['sk-proj-', repeatString('A1_', 16)].join('') + '";',
      '    private const string AnthropicApiKey = "' + ['sk-ant-api03-', repeatString('A1_', 17)].join('') + '";',
      '    private const string PrivateKeyHeader = "' + ['-----BEGIN', 'PRIVATE KEY-----'].join(' ') + '";',
      '',
      '    public string Read()',
      '    {',
      '        return AwsAccessKey + AwsTemporaryAccessKey + GitHubToken + GitHubFineGrainedToken + GitLabToken + StripeLiveKey + StripeTestKey + SlackToken + SlackBotToken + JwtToken + NpmToken + LinearApiKey + ShopifyAccessToken + SquareAccessToken + DatabricksToken + DigitalOceanToken + SendGridToken + OpenAiProjectKey + AnthropicApiKey + PrivateKeyHeader;',
      '    }',
      '}',
      '',
    ].join('\n');
  }

  function scanRuleContent(content, relPath) {
    var filePath = path.join(__dirname, 'fixtures', relPath);
    var record = {
      path: filePath,
      relativePath: relPath,
      ext: path.extname(relPath || '').toLowerCase() || '.cs',
      territory: relPath.indexOf('/Tests/') !== -1 ? 'test' : 'application',
    };
    L01.classifyRole(record);
    return L10.applyRules(content, record);
  }

  function scanRuleFixture(relPath) {
    var absPath = path.join(__dirname, 'fixtures', relPath);
    var content = fs.readFileSync(absPath, 'utf8');
    return scanRuleContent(content, relPath);
  }

  var providerPrefixFixture = {
    relativePath: 'slop/ProviderPrefixSecrets.generated.cs',
    content: buildProviderPrefixFixture(),
  };

  var ruleFixtures = {
    'console-writeline-debug': 'slop/ConsoleWriteLineDebugService.cs',
    'debug-writeline-leftover': 'slop/DebugWriteLineLeftoverService.cs',
    'trace-writeline-leftover': 'slop/TraceWriteLineLeftoverService.cs',
    'debugger-break-leftover': 'slop/DebuggerBreakLeftoverService.cs',
    'empty-catch-block': 'slop/EmptyCatchBlockService.cs',
    'swallowed-task-exception': 'slop/SwallowedTaskExceptionService.cs',
    'pragma-warning-suppress': 'slop/PragmaWarningSuppressService.cs',
    'todo-fixme-comment': 'slop/TodoFixmeCommentService.cs',
    'commented-out-code': 'slop/CommentedOutCodeService.cs',
    'throw-not-implemented': 'slop/ThrowNotImplementedService.cs',
    'empty-interface-body': 'slop/EmptyInterface.cs',
    'factory-builder-inflation': 'slop/OrderFactory.cs',
    'pass-through-service': 'slop/PassThroughService.cs',
    'async-void-method': 'slop/AsyncVoidMethodService.cs',
    'excessive-xml-doc': 'slop/ExcessiveXmlDocService.cs',
    'verbose-null-guard': 'slop/VerboseNullGuardService.cs',
    'task-result-blocking': 'slop/TaskResultBlockingService.cs',
    'task-wait-blocking': 'slop/TaskWaitBlockingService.cs',
    'aws-access-key-prefix': providerPrefixFixture,
    'aws-temporary-access-key-prefix': providerPrefixFixture,
    'github-token-prefix': providerPrefixFixture,
    'github-fine-grained-token-prefix': providerPrefixFixture,
    'gitlab-token-prefix': providerPrefixFixture,
    'stripe-live-key-prefix': providerPrefixFixture,
    'stripe-test-key-prefix': providerPrefixFixture,
    'slack-token-prefix': providerPrefixFixture,
    'slack-bot-token-prefix': providerPrefixFixture,
    'jwt-provider-prefix': providerPrefixFixture,
    'npm-token-prefix': providerPrefixFixture,
    'linear-api-key-prefix': providerPrefixFixture,
    'shopify-access-token-prefix': providerPrefixFixture,
    'square-access-token-prefix': providerPrefixFixture,
    'databricks-token-prefix': providerPrefixFixture,
    'digitalocean-token-prefix': providerPrefixFixture,
    'sendgrid-token-prefix': providerPrefixFixture,
    'openai-project-key-prefix': providerPrefixFixture,
    'anthropic-api-key-prefix': providerPrefixFixture,
    'private-key-begin-prefix': providerPrefixFixture,
    'hardcoded-connection-string': 'slop/HardcodedConnectionStringService.cs',
    'string-format-sql': 'slop/StringFormatSqlService.cs',
  };

  assert('rules-cs: exports 40 rules', L10.rules.length === 40);
  assert('rules-cs: every rule has a fixture', Object.keys(ruleFixtures).length === L10.rules.length);

  var cleanHits = scanRuleFixture('clean/CleanService.cs');
  var commentedBlockHits = scanRuleFixture('slop/CommentedOutCodeBlockContinuationService.cs')
    .filter(function (hit) { return hit.ruleId === 'commented-out-code'; });
  var commentedStructuralHits = scanRuleFixture('slop/CommentedOutCodeStructuralSignalsService.cs')
    .filter(function (hit) { return hit.ruleId === 'commented-out-code'; });
  var commentedFalsePositiveHits = scanRuleFixture('false-positives/CommentedOutCodeFalsePositiveService.cs')
    .filter(function (hit) { return hit.ruleId === 'commented-out-code'; });
  var nonEmptyCatchHits = scanRuleFixture('false-positives/NonEmptyCatchBlock.cs')
    .filter(function (hit) { return hit.ruleId === 'empty-catch-block'; });
  var nonEmptyInterfaceHits = scanRuleFixture('false-positives/NonEmptyInterface.cs')
    .filter(function (hit) { return hit.ruleId === 'empty-interface-body'; });
  assert('rules-cs: clean fixture triggers zero rules', cleanHits.length === 0);
  assert('rules-cs: commented-out-code fires on every line of a continued comment block',
    commentedBlockHits.length === 3 &&
    commentedBlockHits[0].lineIndex === 4 &&
    commentedBlockHits[1].lineIndex === 5 &&
    commentedBlockHits[2].lineIndex === 6);
  assert('rules-cs: commented-out-code fires on structural assignment, control-flow, and new-expression lines',
    commentedStructuralHits.length === 4 &&
    commentedStructuralHits[0].lineIndex === 4 &&
    commentedStructuralHits[1].lineIndex === 5 &&
    commentedStructuralHits[2].lineIndex === 6 &&
    commentedStructuralHits[3].lineIndex === 7);
  assert('rules-cs: commented-out-code ignores file headers and prose comments',
    commentedFalsePositiveHits.length === 0);
  assert('rules-cs: empty-catch-block stays silent on non-empty catch bodies',
    nonEmptyCatchHits.length === 0);
  assert('rules-cs: empty-interface-body stays silent on non-empty interfaces',
    nonEmptyInterfaceHits.length === 0);
  var jwtBase64Hits = L10.applyRules([
    'public class EncodedAsset',
    '{',
    '    private const string Encoded = "data:image/png;base64,eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXRhaWw";',
    '}',
  ].join('\n'), {
    path: 'EncodedAsset.cs',
    relativePath: 'EncodedAsset.cs',
    territory: 'application',
    role: { isTest: false },
  });
  var sqlCommentHits = L10.applyRules([
    'public class CommentOnly',
    '{',
    '    // var sql = $"SELECT * FROM Users WHERE Id = {userId}";',
    '}',
  ].join('\n'), {
    path: 'CommentOnly.cs',
    relativePath: 'CommentOnly.cs',
    territory: 'application',
    role: { isTest: false },
  });
  var connectionStringCommentHits = L10.applyRules([
    'public class CommentOnly',
    '{',
    '    // public string ConnectionString = "Server=db;Database=App;User Id=app;Password=secret;";',
    '}',
  ].join('\n'), {
    path: 'CommentOnlyConnection.cs',
    relativePath: 'CommentOnlyConnection.cs',
    territory: 'application',
    role: { isTest: false },
  });
  var passThroughWorkHits = L10.applyRules([
    'using Microsoft.Extensions.Logging;',
    'public class Demo',
    '{',
    '    private readonly Inner _inner;',
    '    private readonly ILogger<Demo> _logger;',
    '    public int Run()',
    '    {',
    '        _logger.LogInformation("before");',
    '        return _inner.Run();',
    '    }',
    '}',
  ].join('\n'), {
    path: 'PassThroughWithWork.cs',
    relativePath: 'PassThroughWithWork.cs',
    territory: 'application',
    role: { isTest: false },
  });
  assert('rules-cs: jwt provider prefix ignores nearby base64 marker',
    !findHit(jwtBase64Hits, 'jwt-provider-prefix'));
  assert('rules-cs: string-format-sql ignores SQL-looking comments',
    !findHit(sqlCommentHits, 'string-format-sql'));
  assert('rules-cs: hardcoded-connection-string ignores commented declarations',
    !findHit(connectionStringCommentHits, 'hardcoded-connection-string'));
  assert('rules-cs: pass-through-service ignores methods that do real work before delegation',
    !findHit(passThroughWorkHits, 'pass-through-service'));

  var ruleIds = Object.keys(ruleFixtures);
  for (var ri = 0; ri < ruleIds.length; ri++) {
    var ruleId = ruleIds[ri];
    var fixture = ruleFixtures[ruleId];
    var hits = typeof fixture === 'string'
      ? scanRuleFixture(fixture)
      : scanRuleContent(fixture.content, fixture.relativePath);
    var found = false;
    for (var hi = 0; hi < hits.length; hi++) {
      if (hits[hi].ruleId === ruleId) {
        found = true;
        break;
      }
    }
    assert('rules-cs: fixture fires ' + ruleId, found);
  }

  // -------------------------------------------------------------------------
  // Phase 6 — C# pipeline orchestrator
  // -------------------------------------------------------------------------

  var L05 = require('../src/L05-preflight-cs');
  var runner = require('../src/runner-cs');

  function scanPipelineFixture(relPath) {
    var absPath = path.join(__dirname, 'fixtures', relPath);
    return runner.scanCSharpFile(absPath, parserBundle, { relativePath: relPath });
  }

  var shortPreflightCandidates = L05.preflight([
    {
      value: 'name',
      line: 'return "name";',
      col: 7,
      lineIndex: 0,
      type: 'string',
      priority: 'normal',
    },
    {
      value: 'password',
      line: 'return "password";',
      col: 7,
      lineIndex: 1,
      type: 'string',
      priority: 'normal',
    },
  ], {});
  var safeSinkPreflightCandidates = L05.preflight(formatCandidates, {});
  var cleanControllerRecord = scanPipelineFixture('false-positives/CleanController.cs');
  var interpolationRecord = scanPipelineFixture('false-positives/ServiceWithInterpolation.cs');
  var shortStringsRecord = scanPipelineFixture('false-positives/ShortStringsDoNotSurface.cs');
  var hardcodedSecretsRecord = scanPipelineFixture('secrets/HardcodedSecrets.cs');
  var razorMarkupRecord = scanPipelineFixture('roles/Pages/Dashboard/Index.razor');
  var razorSecretRecord = scanPipelineFixture('roles/Pages/Dashboard/SecretPanel.razor');
  var razorStatementRecord = scanPipelineFixture('roles/Pages/Dashboard/StatementPanel.razor');
  var razorExpressionRecord = scanPipelineFixture('roles/Pages/Dashboard/ExpressionPanel.razor');
  var razorMultilineExpressionRecord = scanPipelineFixture('roles/Pages/Dashboard/MultilineExpressionPanel.razor');
  var razorSecretHit = findHit(razorSecretRecord.patternHits, 'github-token-prefix');
  var razorStatementHit = findHit(razorStatementRecord.patternHits, 'github-token-prefix');
  var razorExpressionHit = findHit(razorExpressionRecord.patternHits, 'github-token-prefix');
  var razorMultilineExpressionHit = findHit(razorMultilineExpressionRecord.patternHits, 'github-token-prefix');

  assert('preflight-cs: discards candidates shorter than 8 before pipeline',
    shortPreflightCandidates.length === 1 && shortPreflightCandidates[0].value === 'password');
  assert('preflight-cs: drops string.Format template safe sinks before pipeline',
    safeSinkPreflightCandidates.length === 0);
  assert('runner-cs: CleanController has zero confirmed secrets', cleanControllerRecord.findings.length === 0);
  assert('runner-cs: ServiceWithInterpolation has zero confirmed secrets', interpolationRecord.findings.length === 0);
  assert('runner-cs: short-string false-positive fixture produces zero pipeline candidates', shortStringsRecord.candidates.length === 0);
  assert('runner-cs: short-string false-positive fixture produces zero review entries', shortStringsRecord.review.length === 0);
  assert('runner-cs: HardcodedSecrets confirms at least two secrets', hardcodedSecretsRecord.findings.length >= 2);
  assert('runner-cs: HardcodedSecrets includes provider prefix pattern support',
    !!findHit(hardcodedSecretsRecord.patternHits, 'github-token-prefix'));
  assert('runner-cs: markup-only razor fixture produces zero candidates and zero pattern hits',
    razorMarkupRecord.candidates.length === 0 && razorMarkupRecord.patternHits.length === 0);
  assert('runner-cs: razor code block preserves secret detection without surfacing route markup',
    !findCandidate(razorSecretRecord.candidates, '/secret') && !!razorSecretHit && razorSecretHit.lineIndex === 5);
  assert('runner-cs: razor statement block preserves secret detection without surfacing route markup',
    !findCandidate(razorStatementRecord.candidates, '/statement-secret') && !!razorStatementHit && razorStatementHit.lineIndex === 2);
  assert('runner-cs: razor inline expression preserves secret detection without surfacing route markup',
    !findCandidate(razorExpressionRecord.candidates, '/expr-secret') && !!razorExpressionHit && razorExpressionHit.lineIndex === 1);
  assert('runner-cs: razor multiline inline expression preserves secret detection without surfacing route markup',
    !findCandidate(razorMultilineExpressionRecord.candidates, '/expr-multi') && !!razorMultilineExpressionHit && razorMultilineExpressionHit.lineIndex === 2);
  assert('runner-cs: razor preprocessing metadata stays attached to Razor records',
    razorSecretRecord.razorPreprocess.regions.length === 1 &&
    razorSecretRecord.razorPreprocess.regions[0].kind === 'code' &&
    razorStatementRecord.razorPreprocess.regions[0].kind === 'statement' &&
    razorExpressionRecord.razorPreprocess.regions.length === 2 &&
    razorExpressionRecord.razorPreprocess.regions[1].originalStartLine === 2);
  assert('runner-cs: razor expression metadata retains segment offsets',
    razorExpressionRecord.razorPreprocess.regions[0].segments.length === 1 &&
    razorExpressionRecord.razorPreprocess.regions[0].segments[0].originalStartColumn === 5 &&
    razorExpressionRecord.razorPreprocess.regions[0].segments[0].syntheticExpressionStartColumn >= 0);
  assert('runner-cs: razor metadata exposes offset tables',
    razorSecretRecord.razorPreprocess.regions[0].mappings.length === 3 &&
    razorStatementRecord.razorPreprocess.regions[0].mappings.length === 2 &&
    razorExpressionRecord.razorPreprocess.regions[0].mappings[0].kind === 'expression');
  assert('runner-cs: razor multiline metadata exposes offset tables',
    razorMultilineExpressionRecord.razorPreprocess.regions.length === 1 &&
    razorMultilineExpressionRecord.razorPreprocess.regions[0].mappings.length === 1 &&
    razorMultilineExpressionRecord.razorPreprocess.regions[0].mappings[0].originalLine === 2);

  // -------------------------------------------------------------------------
  // Phase 7 — file walker and CLI wiring
  // -------------------------------------------------------------------------

  var fileWalker = require('../src/file-walker-cs');
  var os = require('os');

  var walkedRoleFixtures = fileWalker.collectCSharpFiles(path.join(__dirname, 'fixtures', 'roles'));
  var walkedRolePaths = walkedRoleFixtures.map(function (entry) { return entry.relativePath.replace(/\\/g, '/'); });
  var reportResult = api.run(path.join(__dirname, 'fixtures'), { parser: parserBundle });
  var noSlopResult = api.run(path.join(__dirname, 'fixtures', 'false-positives', 'ServiceWithInterpolation.cs'), { noSlop: true });
  var singleFileSecretResult = api.run(path.join(__dirname, 'fixtures', 'secrets', 'HardcodedSecrets.cs'), { parser: parserBundle });
  var renderedJson = api.renderJson(reportResult.report);
  var parsedJson = JSON.parse(renderedJson);
  var BuildDeepBundle = require('../scripts/build-deep-bundle.js');
  var DeepToolchain = require('../src/deep-toolchain-cs');
  var Verify = require('../src/verify-cs');
  var tmpRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-since-'));
  var tmpDeepStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-deep-store-'));
  var tmpDeepMissingStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-deep-missing-store-'));
  var tmpDeepBundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-deep-bundle-'));
  var tmpBundleSourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-deep-source-'));
  var tmpBuiltBundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-built-bundle-'));
  var tmpBrokenBundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cszone38-broken-bundle-'));
  var previousCwd = process.cwd();
  var sinceFixtures;
  var invalidSinceFixtures;
  var deepBundleManifestPath = path.join(tmpDeepBundleRoot, 'manifest.json');
  var deepDotnetRoot = path.join(tmpDeepBundleRoot, 'dotnet');
  var deepDotnetPath = path.join(deepDotnetRoot, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  var deepSdkPath = path.join(deepDotnetRoot, 'sdk', '8.0.100');
  var deepToolPath = path.join(tmpDeepBundleRoot, 'tools', process.platform === 'win32' ? 'security-scan.exe' : 'security-scan');
  var bundleSourceDotnetRoot = path.join(tmpBundleSourceRoot, 'dotnet-root');
  var bundleSourceDotnetPath = path.join(bundleSourceDotnetRoot, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  var bundleSourceSdkPath = path.join(bundleSourceDotnetRoot, 'sdk', '8.0.222');
  var bundleSourceToolDir = path.join(tmpBundleSourceRoot, 'security-tool');
  var bundleSourceToolPath = path.join(bundleSourceToolDir, process.platform === 'win32' ? 'security-scan.exe' : 'security-scan');
  var deepToolchainInstall;
  var deepToolchainDoctor;
  var deepToolchainUnavailable;
  var builtBundle;
  var brokenBundle;
  var builtBundleManifest;
  var deepNoSolution;
  var deepSlnxPath;
  var deepMissingFlag = Deep.runDeepScan(path.join(__dirname, 'fixtures', 'clean'), {
    deep: true,
    deepManifestPath: path.join(__dirname, 'fixtures', '.missing-deep-manifest'),
  });
  var deepRuntimeUnavailable;
  var deepTimedOut;
  var deepFailed;
  var deepPartial;
  var deepParsed;
  var deepIntegratedResult;
  var deepIntegratedJson;
  var verifyBlocked;
  var verifyAllowed;


  fs.writeFileSync(path.join(tmpRepoRoot, 'Alpha.cs'), 'public class Alpha { }\n');
  fs.writeFileSync(path.join(tmpRepoRoot, 'Beta.cs'), 'public class Beta { }\n');
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: tmpRepoRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Copilot Test'], { cwd: tmpRepoRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.email', 'copilot@example.com'], { cwd: tmpRepoRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['add', 'Alpha.cs', 'Beta.cs'], { cwd: tmpRepoRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmpRepoRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpRepoRoot, 'Beta.cs'), 'public class Beta { public string Token => "changed"; }\n');
  fs.mkdirSync(bundleSourceSdkPath, { recursive: true });
  fs.mkdirSync(bundleSourceToolDir, { recursive: true });
  fs.writeFileSync(bundleSourceDotnetPath, '');
  fs.writeFileSync(bundleSourceToolPath, '');
  builtBundle = BuildDeepBundle.buildBundle({
    outputDir: tmpBuiltBundleRoot,
    dotnetRoot: bundleSourceDotnetRoot,
    sdkPath: bundleSourceSdkPath,
    securityScanPath: bundleSourceToolPath,
    engineVersion: '5.6.7',
    spawnSync: function (command, args) {
      if (args[0] === 'restore') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
        };
      }

      return {
        status: 0,
        stdout: '',
        stderr: '',
      };
    },
  });
  brokenBundle = BuildDeepBundle.buildBundle({
    outputDir: tmpBrokenBundleRoot,
    dotnetRoot: bundleSourceDotnetRoot,
    sdkPath: bundleSourceSdkPath,
    securityScanPath: bundleSourceToolPath,
    engineVersion: '5.6.7',
    spawnSync: function (_command, args) {
      if (args[0] === 'restore') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
        };
      }

      return {
        status: 1,
        stdout: '',
        stderr: 'Could not load file or assembly System.Runtime, Version=8.0.0.0',
      };
    },
  });
  builtBundleManifest = JSON.parse(fs.readFileSync(path.join(tmpBuiltBundleRoot, 'manifest.json'), 'utf8'));
  fs.mkdirSync(path.dirname(deepToolPath), { recursive: true });
  fs.mkdirSync(deepSdkPath, { recursive: true });
  fs.writeFileSync(deepDotnetPath, '');
  fs.writeFileSync(deepToolPath, '');
  fs.writeFileSync(deepBundleManifestPath, JSON.stringify({
    schemaVersion: DeepToolchain.SCHEMA_VERSION,
    engine: DeepToolchain.ENGINE,
    engineVersion: '5.6.7',
    dotnetRoot: 'dotnet',
    dotnetPath: process.platform === 'win32' ? 'dotnet/dotnet.exe' : 'dotnet/dotnet',
    sdkPath: 'dotnet/sdk/8.0.100',
    securityScanPath: process.platform === 'win32' ? 'tools/security-scan.exe' : 'tools/security-scan',
  }, null, 2));
  deepToolchainInstall = DeepToolchain.installBundle(tmpDeepBundleRoot, { storeRoot: tmpDeepStoreRoot });
  deepToolchainDoctor = DeepToolchain.doctor({ storeRoot: tmpDeepStoreRoot });
  deepToolchainUnavailable = DeepToolchain.resolveToolchain({ storeRoot: tmpDeepMissingStoreRoot });
  deepNoSolution = Deep.runDeepScan(tmpRepoRoot, {
    deep: true,
    deepManifestPath: deepToolchainInstall.manifestPath,
  });
  fs.writeFileSync(path.join(tmpRepoRoot, 'Demo.slnx'), '<Solution />\n');
  deepSlnxPath = Deep._findSolutionPath(tmpRepoRoot, null);
  fs.writeFileSync(path.join(tmpRepoRoot, 'Demo.sln'), 'Microsoft Visual Studio Solution File\n');
  deepRuntimeUnavailable = Deep.runDeepScan(tmpRepoRoot, {
    deep: true,
    deepManifestPath: deepToolchainInstall.manifestPath,
    spawnSync: function (command, args) {
      return {
        status: 150,
        stdout: '',
        stderr: 'You must install or update .NET to run this application.',
      };
    },
  });
  deepTimedOut = Deep.runDeepScan(tmpRepoRoot, {
    deep: true,
    deepManifestPath: deepToolchainInstall.manifestPath,
    spawnSync: function () {
      return {
        error: { code: 'ETIMEDOUT' },
        signal: 'SIGTERM',
      };
    },
  });
  deepFailed = Deep.runDeepScan(tmpRepoRoot, {
    deep: true,
    deepManifestPath: deepToolchainInstall.manifestPath,
    spawnSync: function () {
      return {
        status: 1,
        stdout: '',
        stderr: 'restore failed',
      };
    },
  });
  deepPartial = Deep.runDeepScan(tmpRepoRoot, {
    deep: true,
    deepManifestPath: deepToolchainInstall.manifestPath,
    spawnSync: function (_command, args) {
      var exportPath = null;
      for (var i = 0; i < args.length; i++) {
        if (args[i].indexOf('--export=') === 0) {
          exportPath = args[i].slice(9);
          break;
        }
      }

      if (exportPath) {
        fs.writeFileSync(exportPath, JSON.stringify({ runs: [] }));
      }

      return {
        status: 0,
        stdout: '',
        stderr: 'Msbuild failed when processing the file \'/tmp/Demo.Web.csproj\' with message: missing targets',
      };
    },
  });
  deepParsed = Deep.runDeepScan(tmpRepoRoot, {
    deep: true,
    deepManifestPath: deepToolchainInstall.manifestPath,
    spawnSync: function (_command, args) {
      var exportPath = null;
      for (var i = 0; i < args.length; i++) {
        if (args[i].indexOf('--export=') === 0) {
          exportPath = args[i].slice(9);
          break;
        }
      }

      if (exportPath) {
        fs.writeFileSync(exportPath, JSON.stringify({
          runs: [{
            tool: {
              driver: {
                rules: [{
                  id: 'SCS0002',
                  properties: { tags: ['CWE-89'] },
                }],
              },
            },
            results: [{
              ruleId: 'SCS0002',
              level: 'error',
              message: { text: 'Possible SQL injection via SqlCommand' },
              locations: [{
                physicalLocation: {
                  artifactLocation: { uri: 'Controllers/UserController.cs' },
                  region: { startLine: 42 },
                },
              }],
            }],
          }],
        }));
      }

      return {
        status: 0,
        stdout: '',
      };
    },
  });

  try {
    process.chdir(os.tmpdir());
    sinceFixtures = fileWalker.collectCSharpFiles(tmpRepoRoot, { since: 'HEAD' });
    invalidSinceFixtures = fileWalker.collectCSharpFiles(tmpRepoRoot, { since: 'not-a-real-ref' });
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmpRepoRoot, { recursive: true, force: true });
    fs.rmSync(tmpDeepStoreRoot, { recursive: true, force: true });
    fs.rmSync(tmpDeepMissingStoreRoot, { recursive: true, force: true });
    fs.rmSync(tmpDeepBundleRoot, { recursive: true, force: true });
    fs.rmSync(tmpBundleSourceRoot, { recursive: true, force: true });
    fs.rmSync(tmpBuiltBundleRoot, { recursive: true, force: true });
    fs.rmSync(tmpBrokenBundleRoot, { recursive: true, force: true });
  }

  deepIntegratedResult = api.run(path.join(__dirname, 'fixtures', 'clean', 'CleanService.cs'), {
    parser: parserBundle,
    deep: true,
    deepRunner: function () {
      return {
        available: true,
        engine: 'security-code-scan',
        scanTimeMs: 12,
        findings: [{
          type: 'taint',
          rule: 'sql-injection',
          confidence: 'HIGH',
          file: 'CleanService.cs',
          line: 2,
          sink: 'SqlCommand',
          source: null,
          path: null,
          fix: 'Use parameterized queries.',
        }],
        scoreContribution: 15,
        warning: null,
      };
    },
  });
  deepIntegratedJson = JSON.parse(api.renderJson(deepIntegratedResult.report));
  verifyBlocked = Verify.verifySecrets(singleFileSecretResult.registry, { verify: true, allowNetwork: false });
  verifyAllowed = Verify.verifySecrets(singleFileSecretResult.registry, {
    verify: true,
    allowNetwork: true,
    verifyHandler: function () {
      return {
        verified: true,
        provider: 'GitHub',
        fix: 'Rotate the credential and replace it with secure configuration.',
      };
    },
  });

  assert('file-walker-cs: includes .cs files', walkedRolePaths.indexOf('Controllers/HomeController.cs') !== -1);
  assert('file-walker-cs: includes .razor files', walkedRolePaths.indexOf('Pages/Dashboard/Index.razor') !== -1);
  assert('file-walker-cs: excludes generated .g.cs files', walkedRolePaths.indexOf('Generated/AssemblyInfo.g.cs') === -1);
  assert('file-walker-cs: since filters changed files even outside repo cwd',
    sinceFixtures.length === 1 && sinceFixtures[0].relativePath === 'Beta.cs');
  assert('file-walker-cs: invalid since ref falls back to full scan',
    invalidSinceFixtures.length === 2);
  assert('build-deep-bundle: writes a valid deep manifest and bundle layout',
    builtBundle.ok === true &&
    builtBundleManifest.engine === DeepToolchain.ENGINE &&
    builtBundleManifest.dotnetRoot === 'dotnet' &&
    builtBundleManifest.sdkPath.indexOf('dotnet/sdk/') === 0 &&
    builtBundleManifest.securityScanPath.indexOf('tools/') === 0);
  assert('build-deep-bundle: fails fast when bundled security-scan cannot scan with the bundled sdk path',
    brokenBundle.ok === false &&
    brokenBundle.reason.indexOf('bundled security-scan validation failed') !== -1);
  assert('deep-toolchain: installs a private deep bundle into the user-local store',
    deepToolchainInstall.ok === true && deepToolchainInstall.engine === DeepToolchain.ENGINE);
  assert('deep-toolchain: doctor reports ready once a private bundle is installed',
    deepToolchainDoctor.deep.available === true && deepToolchainDoctor.deep.engine === DeepToolchain.ENGINE);
  assert('deep-toolchain: missing bundle reports a clear manual setup hint',
    deepToolchainUnavailable.available === false &&
    deepToolchainUnavailable.reason.indexOf('GitHub Releases') !== -1 &&
    deepToolchainUnavailable.reason.indexOf('setup deep --bundle=') !== -1);
  assert('deep-cs: missing toolchain warns and returns no findings',
    deepMissingFlag.warning === Deep.DEEP_UNAVAILABLE_WARNING && deepMissingFlag.findings.length === 0);
  assert('deep-cs: missing solution warns gracefully',
    deepNoSolution.warning === Deep.DEEP_NO_SOLUTION_WARNING && deepNoSolution.findings.length === 0);
  assert('deep-cs: auto-discovers .slnx roots when no --solution is provided',
    deepSlnxPath === path.join(tmpRepoRoot, 'Demo.slnx'));
  assert('deep-cs: runtime-unavailable scan warns gracefully',
    deepRuntimeUnavailable.warning === Deep.DEEP_UNAVAILABLE_WARNING && deepRuntimeUnavailable.findings.length === 0);
  assert('deep-cs: timeout falls back to math-only output',
    deepTimedOut.warning === Deep.DEEP_TIMEOUT_WARNING && deepTimedOut.findings.length === 0);
  assert('deep-cs: non-zero scan falls back to math-only output',
    deepFailed.warning === Deep.DEEP_FAILED_WARNING && deepFailed.findings.length === 0);
  assert('deep-cs: project-load failures mark the deep scan incomplete',
    deepPartial.warning === Deep.DEEP_PARTIAL_WARNING && deepPartial.findings.length === 0);
  assert('deep-cs: parses SARIF and computes contribution',
    deepParsed.available === true &&
    deepParsed.findings.length === 1 &&
    deepParsed.findings[0].rule === 'sql-injection' &&
    deepParsed.scoreContribution === 15);
  assert('index.run: returns report with projectSummary', !!(reportResult.report && reportResult.report.projectSummary));
  assert('index.run: returns per-file entries', Array.isArray(reportResult.report.perFile) && reportResult.report.perFile.length > 1);
  assert('index.run: renderJson returns valid JSON', !!(parsedJson.projectSummary && parsedJson.projectSummary.axes));
  assert('index.run: no-slop path still scans a file', parsedJson.projectSummary.fileCount > 0 && noSlopResult.report.projectSummary.fileCount === 1);
  assert('index.run: single-file scans do not emit poisoned-repo warnings',
    singleFileSecretResult.calibration.poisoned === false &&
    !singleFileSecretResult.report.projectSummary.calibrationWarning);
  assert('index.run: deep findings raise Axis B and appear in JSON',
    deepIntegratedResult.report.projectSummary.axes.B >= 15 &&
    deepIntegratedJson.deep &&
    deepIntegratedJson.deep.findings.length === 1 &&
    deepIntegratedJson.deep.findings[0].rule === 'sql-injection');
  assert('verify-cs: requires allow-network and surfaces warning',
    verifyBlocked.warning === Verify.VERIFY_ALLOW_NETWORK_WARNING &&
    verifyBlocked.startupWarning === Verify.VERIFY_STARTUP_WARNING &&
    verifyBlocked.findings.length === 0);
  assert('verify-cs: verifies confirmed hits with injected handler',
    verifyAllowed.findings.length >= 1 && verifyAllowed.timeoutMs === Verify.VERIFY_TIMEOUT_MS);
  assert('index.exitCode: returns 0 under thresholds', api.exitCode({ A: 0, B: 0, C: 0 }, { A: 50, B: 25, C: 100 }) === 0);
  assert('index.exitCode: returns 1 over thresholds', api.exitCode({ A: 0, B: 26, C: 0 }, { A: 50, B: 25, C: 100 }) === 1);

  // -------------------------------------------------------------------------
  // Phase 8 — corpus analysis and Axis A activation
  // -------------------------------------------------------------------------

  var L03 = require('../src/L03-corpus-cs');
  var Fixer = require('../src/fix-cs');

  var cleanCorpusPath = path.join(__dirname, '..', 'corpus', 'human.cs.gz');
  var aiCorpusPath = path.join(__dirname, '..', 'corpus', 'ai.cs.gz');
  var cleanCompression = L03.analyseFile(null, readFixture('clean/CleanService.cs'));
  var slopCompression = L03.analyseFile(null, readFixture('slop/PassThroughService.cs'));
  var cleanAxisResult = api.run(path.join(__dirname, 'fixtures', 'clean'), { parser: parserBundle });
  var slopAxisResult = api.run(path.join(__dirname, 'fixtures', 'slop'), { parser: parserBundle });

  assert('L03 corpus: human corpus archive exists', fs.existsSync(cleanCorpusPath));
  assert('L03 corpus: AI corpus archive exists', fs.existsSync(aiCorpusPath));
  assert('L03 corpus: analysis returns human and AI NCD values',
    cleanCompression.ncdHuman !== null && cleanCompression.ncdAI !== null &&
    slopCompression.ncdHuman !== null && slopCompression.ncdAI !== null);
  assert('L03 corpus: slop compression score exceeds clean compression score',
    slopCompression.compressionScore > cleanCompression.compressionScore);
  assert('Axis A: slop fixtures score above 30', slopAxisResult.report.projectSummary.axes.A > 30);
  assert('Axis A: clean fixtures score below 15', cleanAxisResult.report.projectSummary.axes.A < 15);

  // -------------------------------------------------------------------------
  // Phase 9 — full test suite completion
  // -------------------------------------------------------------------------

  var L07cs = require('../src/L07-deep-cs');
  var L12cs = require('../src/L12-calibration-cs');
  var BaseL07 = require('zone38/src/pipeline/L07-deep.js');
  var L08 = require('zone38/src/pipeline/L08-arbitration.js');
  var L13 = require('zone38/src/pipeline/L13-scoring.js');
  var Renderer = require('../src/L15-output-cs');

  var highNeedsOthers = L08.arbitrate([
    makeSignalSet('ABCDEFGHIJKL', 0.90, { icSignal: true })
  ]);
  var singleSignalReview = L08.arbitrate([
    makeSignalSet('ABCDEFGHIJKL', 0.15, { ctfSignal: true })
  ]);
  var shortStringUncertain = L08.arbitrate([
    makeSignalSet('ABCDEF', 0.90, { icSignal: true, ctfSignal: true })
  ]);
  var identifierBoostFindingSet = makeSignalSet('A1b2C3d4E5f6G7h8J9k0', 0.90, { icSignal: true });
  var identifierBoostReviewSet = makeSignalSet('short-safe', 0.10, {});
  var identifierNoBoostSet = makeSignalSet('A1b2C3d4E5f6G7h8J9k0', 0.90, { icSignal: true });
  var fragmentedBoostFindingSet = makeSignalSet('A1b2C3d4E5f6G7h8J9k0', 0.90, { icSignal: true });
  var fragmentedNoBoostSet = makeSignalSet('A1b2C3d4E5f6G7h8J9k0', 0.90, { icSignal: true });

  identifierBoostFindingSet.candidate.identifierName = 'ApiKey';
  identifierBoostReviewSet.candidate.identifierName = 'BearerToken';
  identifierNoBoostSet.candidate.identifierName = 'DisplayName';
  fragmentedBoostFindingSet.candidate.identifierName = 'SessionValue';
  fragmentedBoostFindingSet.candidate.tags = ['fragmented_assignment'];
  fragmentedNoBoostSet.candidate.identifierName = 'SessionValue';
  fragmentedNoBoostSet.candidate.tags = [];

  var identifierBoostFinding = runner.arbitrateSignalSets([identifierBoostFindingSet]);
  var identifierBoostReview = runner.arbitrateSignalSets([identifierBoostReviewSet]);
  var identifierNoBoost = runner.arbitrateSignalSets([identifierNoBoostSet]);
  var fragmentedBoostFinding = runner.arbitrateSignalSets([fragmentedBoostFindingSet]);
  var fragmentedNoBoost = runner.arbitrateSignalSets([fragmentedNoBoostSet]);
  var wrappedGradientCandidate = {
    value: 'prefix text that looks natural and boring before the actual token QWxhZGRpbjpPcGVuU2VzYW1lU2VjcmV0VG9rZW5NYXRlcmlhbDEyMzQ1Njc4OTA= with trailing explanation text',
    line: 1,
    lineIndex: 0,
    identifierName: 'WrappedValue',
    callSiteContext: 'test',
    type: 'string',
  };
  var baseWrappedGradientSet = BaseL07.deepAnalysis([wrappedGradientCandidate])[0];
  var csWrappedGradientSet = L07cs.deepAnalysis([wrappedGradientCandidate])[0];
  var baseWrappedGradientResult = runner.arbitrateSignalSets([baseWrappedGradientSet]);
  var csWrappedGradientResult = runner.arbitrateSignalSets([csWrappedGradientSet]);
  var wrappedUniformCandidate = {
    value: 'This configuration paragraph explains the connection behavior for the service and should look mostly ordinary to readers before the token block appears. 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef After the block there is more normal prose describing retry behavior and tracing semantics for the surrounding code path.',
    line: 1,
    lineIndex: 0,
    identifierName: 'ApiToken',
    callSiteContext: 'test',
    type: 'string',
  };
  var baseWrappedUniformSet = BaseL07.deepAnalysis([wrappedUniformCandidate])[0];
  var csWrappedUniformSet = L07cs.deepAnalysis([wrappedUniformCandidate])[0];
  var baseWrappedUniformResult = runner.arbitrateSignalSets([baseWrappedUniformSet]);
  var csWrappedUniformResult = runner.arbitrateSignalSets([csWrappedUniformSet]);

  assert('L08: HIGH/MEDIUM require at least two other signals',
    highNeedsOthers.findings.length === 0 && highNeedsOthers.review.length === 1 &&
    highNeedsOthers.review[0].confidence === 'UNCERTAIN');
  assert('L08: single-signal candidates route to REVIEW',
    singleSignalReview.findings.length === 0 && singleSignalReview.review.length === 1 &&
    singleSignalReview.review[0].confidence === 'UNCERTAIN');
  assert('L08: HIGH/MEDIUM use effectivePipeline while UNCERTAIN uses raw pipeline',
    shortStringUncertain.findings.length === 0 && shortStringUncertain.review.length === 1 &&
    shortStringUncertain.review[0].pipelineScore === 0.9);
  assert('runner arbitration: identifier context boosts sensitive names into confirmed findings',
    identifierBoostFinding.findings.length === 1 &&
    identifierBoostFinding.findings[0].confidence === 'HIGH' &&
    identifierBoostFinding.findings[0].signalCount === 2);
  assert('runner arbitration: identifier context can surface otherwise safe candidates into review',
    identifierBoostReview.findings.length === 0 &&
    identifierBoostReview.review.length === 1 &&
    identifierBoostReview.review[0].confidence === 'UNCERTAIN' &&
    identifierBoostReview.review[0].signalCount === 1);
  assert('runner arbitration: non-sensitive identifiers receive no boost',
    identifierNoBoost.findings.length === 0 &&
    identifierNoBoost.review.length === 1 &&
    identifierNoBoost.review[0].confidence === 'UNCERTAIN' &&
    identifierNoBoost.review[0].signalCount === 1);
  assert('runner arbitration: fragmented assignments add a positive-only boost',
    fragmentedBoostFinding.findings.length === 1 &&
    fragmentedBoostFinding.findings[0].confidence === 'HIGH' &&
    fragmentedBoostFinding.findings[0].signalCount === 2);
  assert('runner arbitration: candidates without fragmented tags receive no fragmented boost',
    fragmentedNoBoost.findings.length === 0 &&
    fragmentedNoBoost.review.length === 1 &&
    fragmentedNoBoost.review[0].confidence === 'UNCERTAIN' &&
    fragmentedNoBoost.review[0].signalCount === 1);
  assert('deep-cs: sliding window spike upgrades wrapped secrets that base L07 leaves in review',
    baseWrappedGradientResult.findings.length === 0 &&
    baseWrappedGradientResult.review.length === 1 &&
    csWrappedGradientSet.signals.windowEgsSpike === true &&
    csWrappedGradientSet.signals.maxPipelineScore > baseWrappedGradientSet.signals.maxPipelineScore &&
    csWrappedGradientResult.findings.length === 1 &&
    csWrappedGradientResult.findings[0].confidence === 'MEDIUM');
  assert('deep-cs: uniform block overlay upgrades wrapped blocks that base L07 leaves in review',
    baseWrappedUniformResult.findings.length === 0 &&
    baseWrappedUniformResult.review.length === 1 &&
    csWrappedUniformSet.signals.windowUniformBlock === true &&
    csWrappedUniformSet.signals.maxPipelineScore > baseWrappedUniformSet.signals.maxPipelineScore &&
    csWrappedUniformResult.findings.length === 1 &&
    csWrappedUniformResult.findings[0].confidence === 'MEDIUM');

  var attributeRecord = {
    candidates: [{
      value: 'attribute-secret',
      lineIndex: 0,
      type: 'string',
      identifierName: 'RouteValue',
      callSiteContext: 'attribute',
      structuralContext: 'attribute_argument',
      contextFactor: 0.5,
    }],
    findings: [{
      value: 'attribute-secret',
      lineIndex: 0,
      type: 'string',
      identifierName: 'RouteValue',
      callSiteContext: 'attribute',
      pipelineScore: 0.8,
      confidence: 'MEDIUM',
    }],
    review: [],
  };

  var preservedReviewRecord = {
    candidates: [{
      value: 'const-secret',
      lineIndex: 1,
      type: 'string',
      identifierName: 'ConstValue',
      callSiteContext: 'field',
      structuralContext: 'const_declaration',
      contextFactor: 1.3,
    }],
    findings: [],
    review: [{
      value: 'const-secret',
      lineIndex: 1,
      type: 'string',
      identifierName: 'ConstValue',
      callSiteContext: 'field',
      pipelineScore: 0.45,
      confidence: 'UNCERTAIN',
    }],
  };

  runner.applyContextMultipliers(attributeRecord);
  runner.applyContextMultipliers(preservedReviewRecord);

  assert('context multiplier: attribute_argument factor reduces score post-arbitration',
    attributeRecord.findings.length === 0 &&
    attributeRecord.review.length === 1 &&
    attributeRecord.review[0].structuralContext === 'attribute_argument' &&
    attributeRecord.review[0].adjustedPipelineScore === 0.4);
  assert('context multiplier: multipliers never upgrade REVIEW to CONFIRMED',
    preservedReviewRecord.findings.length === 0 &&
    preservedReviewRecord.review.length === 1 &&
    preservedReviewRecord.review[0].adjustedPipelineScore === 0.585);

  var poisonedRegistry = [
    {
      findings: [{ pipelineScore: 0.2, confidence: 'HIGH' }],
      compression: { selfRatio: 0.2 },
      patternHits: [],
    },
    {
      findings: [{ pipelineScore: 0.72, confidence: 'HIGH' }],
      compression: { selfRatio: 0.5 },
      patternHits: [],
    },
    {
      findings: [{ pipelineScore: 0.74, confidence: 'HIGH' }],
      compression: { selfRatio: 0.52 },
      patternHits: [],
    },
    {
      findings: [{ pipelineScore: 0.76, confidence: 'MEDIUM' }],
      compression: { selfRatio: 0.54 },
      patternHits: [],
    },
  ];
  var poisonedCalibration = L12cs.calibrate(poisonedRegistry);

  assert('calibration-cs: detects poisoned repos and applies blended MAD weights',
    poisonedCalibration.poisoned === true &&
    poisonedCalibration.globalFloor === L08.UNCERTAIN_FLOOR &&
    poisonedCalibration.localMADWeight === 0.3 &&
    poisonedCalibration.globalFloorWeight === 0.7 &&
    poisonedCalibration.blendedEntropyMAD > poisonedCalibration.entropyMAD);
  assert('calibration-cs: blended calibration downgrades in-band poisoned findings only',
    poisonedRegistry[0].findings[0].confidence === 'HIGH' &&
    poisonedRegistry[1].findings[0].confidence === 'MEDIUM' &&
    poisonedRegistry[2].findings[0].confidence === 'MEDIUM' &&
    poisonedRegistry[3].findings[0].confidence === 'UNCERTAIN' &&
    poisonedRegistry[3].findings[0].blendedCalibrated === true);

  var generatedScan = runner.scanCSharpFile(
    path.join(__dirname, 'fixtures', 'roles', 'Generated', 'AssemblyInfo.g.cs'),
    parserBundle,
    { relativePath: 'roles/Generated/AssemblyInfo.g.cs' }
  );
  var generatedDirectory = api.run(path.join(__dirname, 'fixtures', 'roles', 'Generated'), { parser: parserBundle });
  var generatedScore = L13._scoreFile(generatedScan, { confidenceMultipliers: {} });

  assert('generated files: direct generated scan produces zero SECRETS',
    generatedScan.findings.length === 0 && generatedScan.review.length === 0 && generatedScan.patternHits.length === 0);
  assert('generated files: generated paths contribute zero Axis A after discovery',
    generatedDirectory.report.projectSummary.fileCount === 0 && generatedDirectory.report.projectSummary.axes.A === 0 && generatedScore.axes.A === 0);

  var abstractThrowHits = L10.applyRules([
    'public abstract class AbstractWorker',
    '{',
    '    public abstract void Run();',
    '}',
    '',
    'public class ConcreteWorker : AbstractWorker',
    '{',
    '    public override void Run()',
    '    {',
    '        throw new NotImplementedException();',
    '    }',
    '}',
  ].join('\n'), {
    path: 'AbstractWorker.cs',
    relativePath: 'AbstractWorker.cs',
    territory: 'application',
    role: { isTest: false },
  });

  var eventHandlerHits = L10.applyRules([
    'using System;',
    'public class DemoComponent',
    '{',
    '    public async void SubmitButton_Click(object sender, EventArgs args)',
    '    {',
    '        await System.Threading.Tasks.Task.Delay(1);',
    '    }',
    '}',
  ].join('\n'), {
    path: 'DemoComponent.cs',
    relativePath: 'DemoComponent.cs',
    territory: 'application',
    role: { isTest: false },
  });

  assert('rule: throw-not-implemented stays silent in abstract declarations and fires in concrete code',
    abstractThrowHits.length === 1 && !!findHit(abstractThrowHits, 'throw-not-implemented'));
  assert('rule: async-void-method does not fire on event handlers',
    !findHit(eventHandlerHits, 'async-void-method'));

  var richFactoryHits = L10.applyRules([
    'public class RichFactory',
    '{',
    '    public RichFactory() {}',
    '    public Order Create() { return new Order(); }',
    '    public Order CreateDefault() { return new Order(); }',
    '}',
    '',
    'public class Order',
    '{',
    '}',
  ].join('\n'), {
    path: 'RichFactory.cs',
    relativePath: 'RichFactory.cs',
    territory: 'application',
    role: { isTest: false },
  });

  assert('rule: factory-builder-inflation stays silent once a factory has three executable members',
    !findHit(richFactoryHits, 'factory-builder-inflation'));

  var consoleFix = Fixer.applyFixesToContent(readFixture('slop/ConsoleWriteLineDebugService.cs'), { isTest: false });
  var todoFix = Fixer.applyFixesToContent(readFixture('slop/TodoFixmeCommentService.cs'), { isTest: false });
  var catchFix = Fixer.applyFixesToContent(readFixture('slop/EmptyCatchBlockService.cs'), { isTest: false });

  assert('fix-cs: removes whole-line Console.WriteLine debug calls',
    consoleFix.changed === true && consoleFix.content.indexOf('Console.WriteLine') === -1);
  assert('fix-cs: resolves TODO markers while preserving comment text',
    todoFix.changed === true && todoFix.content.indexOf('TODO') === -1 && todoFix.content.indexOf('// remove this before shipping') !== -1);
  assert('fix-cs: replaces empty catch blocks with logged rethrow',
    catchFix.changed === true && catchFix.content.indexOf('System.Diagnostics.Trace.TraceError(ex.ToString());') !== -1 && catchFix.content.indexOf('throw;') !== -1);

  var reviewTierItems = [
    { file: 'false-positives/CleanController.cs', lineNumber: 5, pipelineScore: 0.81, valueLength: 24, charFreqSignal: 0.9, bigramSignal: 0.8 },
    { file: 'false-positives/ServiceWithInterpolation.cs', lineNumber: 6, pipelineScore: 0.72, valueLength: 17, charFreqSignal: 0.8, bigramSignal: 0.7 },
    { file: 'false-positives/CleanController.cs', lineNumber: 9, pipelineScore: 0.68, valueLength: 15, charFreqSignal: 0.6, bigramSignal: 0.6 },
    { file: 'false-positives/ShortStringsDoNotSurface.cs', lineNumber: 4, pipelineScore: 0.55, valueLength: 13, charFreqSignal: 0.5, bigramSignal: 0.5 },
    { file: 'false-positives/ServiceWithInterpolation.cs', lineNumber: 10, pipelineScore: 0.54, valueLength: 21, charFreqSignal: 0.4, bigramSignal: 0.4 },
    { file: 'false-positives/ShortStringsDoNotSurface.cs', lineNumber: 6, pipelineScore: 0.75, valueLength: 8, charFreqSignal: 0.7, bigramSignal: 0.7 },
  ];
  var reviewTierSplit = Renderer._splitReviewHierarchy(reviewTierItems);
  var defaultReviewOutput = Renderer._renderReview(reviewTierItems, null, { all: false }).join('\n');
  var allReviewOutput = Renderer._renderReview(reviewTierItems, null, { all: true }).join('\n');
  var calibrationWarningOutput = Renderer.renderCli({
    projectSummary: {
      axes: { A: 12, B: 3, C: 4 },
      verdicts: { A: 'Some issues', B: 'Minimal', C: 'Minimal' },
      totalLines: 10,
      fileCount: 1,
      calibrationWarning: 'project entropy median exceeded the global floor; blended MAD calibration applied',
    },
    perFile: [{ path: 'Demo.cs', lineCount: 10, axes: { A: 12, B: 3, C: 4 } }],
    patternHits: [],
    secrets: [],
    exposure: [],
    review: [],
    slopBreakdown: [],
    mcpFindings: [],
    cleanFiles: [],
  }, { targetPath: 'Demo.cs' });
  var deepCleanOutput = Renderer.renderCli({
    projectSummary: {
      axes: { A: 0, B: 0, C: 0 },
      verdicts: { A: 'Clean', B: 'Clean', C: 'Clean' },
      totalLines: 12,
      fileCount: 1,
    },
    perFile: [{ path: 'Demo.cs', lineCount: 12, axes: { A: 0, B: 0, C: 0 } }],
    patternHits: [],
    secrets: [],
    exposure: [],
    review: [],
    slopBreakdown: [],
    deep: {
      requested: true,
      available: true,
      attempted: true,
      engine: 'security-code-scan',
      solution: '/tmp/Demo.csproj',
      scan_time_ms: 1411,
      warning: null,
      findings: [],
    },
    verify: {
      enabled: false,
      allowNetwork: false,
      timeout_ms: Verify.VERIFY_TIMEOUT_MS,
      findings: [],
      startupWarning: null,
      warning: null,
    },
    mcpFindings: [],
    cleanFiles: [],
  }, { targetPath: 'Demo.cs' });
  var deepSkippedOutput = Renderer.renderCli({
    projectSummary: {
      axes: { A: 0, B: 0, C: 0 },
      verdicts: { A: 'Clean', B: 'Clean', C: 'Clean' },
      totalLines: 12,
      fileCount: 1,
    },
    perFile: [{ path: 'Demo.cs', lineCount: 12, axes: { A: 0, B: 0, C: 0 } }],
    patternHits: [],
    secrets: [],
    exposure: [],
    review: [],
    slopBreakdown: [],
    deep: {
      requested: true,
      available: true,
      attempted: false,
      engine: 'security-code-scan',
      solution: null,
      scan_time_ms: 0,
      warning: '--deep requires a .sln, .slnx, or .csproj — pass --solution=path/to/file.slnx',
      findings: [],
    },
    verify: {
      enabled: false,
      allowNetwork: false,
      timeout_ms: Verify.VERIFY_TIMEOUT_MS,
      findings: [],
      startupWarning: null,
      warning: null,
    },
    mcpFindings: [],
    cleanFiles: [],
  }, { targetPath: 'Demo.cs' });
  var deepOutput = Renderer.renderCli({
    projectSummary: {
      axes: { A: 0, B: 22, C: 0 },
      verdicts: { A: 'Clean', B: 'Some issues', C: 'Clean' },
      totalLines: 12,
      fileCount: 1,
    },
    perFile: [{ path: 'Demo.cs', lineCount: 12, axes: { A: 0, B: 22, C: 0 } }],
    patternHits: [],
    secrets: [],
    exposure: [],
    review: [],
    slopBreakdown: [],
    deep: {
      requested: true,
      available: true,
      attempted: true,
      engine: 'security-code-scan',
      solution: '/tmp/Demo.csproj',
      scan_time_ms: 10,
      warning: null,
      findings: [{
        rule: 'sql-injection',
        confidence: 'HIGH',
        file: 'Demo.cs',
        line: 2,
        sink: 'SqlCommand',
        source: null,
        path: null,
        fix: 'Use parameterized queries.',
      }],
    },
    verify: {
      enabled: true,
      allowNetwork: false,
      timeout_ms: Verify.VERIFY_TIMEOUT_MS,
      findings: [],
      startupWarning: Verify.VERIFY_STARTUP_WARNING,
      warning: Verify.VERIFY_ALLOW_NETWORK_WARNING,
    },
    mcpFindings: [],
    cleanFiles: [],
  }, { targetPath: 'Demo.cs' });
  var deepPartialOutput = Renderer.renderCli({
    projectSummary: {
      axes: { A: 0, B: 0, C: 0 },
      verdicts: { A: 'Clean', B: 'Clean', C: 'Clean' },
      totalLines: 12,
      fileCount: 1,
    },
    perFile: [{ path: 'Demo.cs', lineCount: 12, axes: { A: 0, B: 0, C: 0 } }],
    patternHits: [],
    secrets: [],
    exposure: [],
    review: [],
    slopBreakdown: [],
    deep: {
      requested: true,
      available: true,
      attempted: true,
      engine: 'security-code-scan',
      solution: '/tmp/Demo.sln',
      scan_time_ms: 10,
      warning: Deep.DEEP_PARTIAL_WARNING,
      findings: [],
    },
    verify: {
      enabled: false,
      allowNetwork: false,
      timeout_ms: Verify.VERIFY_TIMEOUT_MS,
      findings: [],
      startupWarning: null,
      warning: null,
    },
    mcpFindings: [],
    cleanFiles: [],
  }, { targetPath: 'Demo.cs' });

  assert('renderer-cs: splits review items into ACT, LOOK, and LOG tiers on known fixture paths',
    reviewTierSplit.act.length === 2 && reviewTierSplit.look.length === 2 && reviewTierSplit.log.length === 2);
  assert('renderer-cs: default review output hides LOG tier counts but shows ACT and LOOK counts',
    defaultReviewOutput.indexOf('[ACT]  2 candidates') !== -1 &&
    defaultReviewOutput.indexOf('[LOOK]  2 candidates') !== -1 &&
    defaultReviewOutput.indexOf('[LOG]  2 low-signal items hidden (--all to show)') !== -1);
  assert('renderer-cs: --all review output reveals LOG tier items',
    allReviewOutput.indexOf('[LOG]  2 low-signal items') !== -1 &&
    allReviewOutput.indexOf('L10') !== -1 &&
    allReviewOutput.indexOf('L6') !== -1);
  assert('renderer-cs: project summary surfaces calibration warnings',
    calibrationWarningOutput.indexOf('CALIBRATION WARNING') !== -1 &&
    calibrationWarningOutput.indexOf('blended MAD calibration applied') !== -1);
  assert('renderer-cs: deep summary renders even when the deep scan returns zero findings',
    deepCleanOutput.indexOf('DEEP ANALYSIS (--deep)') !== -1 &&
    deepCleanOutput.indexOf('scanned clean') !== -1 &&
    deepCleanOutput.indexOf('Demo.csproj') !== -1 &&
    deepCleanOutput.indexOf('no taint findings') !== -1);
  assert('renderer-cs: deep summary aligns skipped runs with warning-driven wording',
    deepSkippedOutput.indexOf('DEEP ANALYSIS (--deep)') !== -1 &&
    deepSkippedOutput.indexOf('skipped') !== -1 &&
    deepSkippedOutput.indexOf('not run') !== -1 &&
    deepSkippedOutput.indexOf('runtime     0ms') === -1 &&
    deepSkippedOutput.indexOf('DEEP WARNING') !== -1);
  assert('renderer-cs: deep summary marks incomplete scans as partial coverage',
    deepPartialOutput.indexOf('DEEP ANALYSIS (--deep)') !== -1 &&
    deepPartialOutput.indexOf('partial') !== -1 &&
    deepPartialOutput.indexOf('no taint findings in loaded projects') !== -1 &&
    deepPartialOutput.indexOf('DEEP WARNING') !== -1);
  assert('renderer-cs: deep findings and verify warnings render in CLI output',
    deepOutput.indexOf('DEEP ANALYSIS (--deep)') !== -1 &&
    deepOutput.indexOf('scanned 1 taint finding') !== -1 &&
    deepOutput.indexOf('TAINT ANALYSIS (--deep)') !== -1 &&
    deepOutput.indexOf('SQL INJECTION') !== -1 &&
    deepOutput.indexOf(Verify.VERIFY_ALLOW_NETWORK_WARNING) !== -1);

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  process.stdout.write('\n  ' + passed + ' passed, ' + failed + ' failed\n\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) {
  process.stderr.write('  FAIL  test runner crashed: ' + err.message + '\n\n');
  process.exit(1);
});
