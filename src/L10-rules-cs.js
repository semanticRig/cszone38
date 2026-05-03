'use strict';

var fs = require('fs');
var path = require('path');

var AstGrep = null;
try {
  AstGrep = require('@ast-grep/napi');
} catch (_err) {
}

var AST_RULES_DIR = path.join(__dirname, 'rules');
var astRuleCache = null;

function _trim(line) {
  return (line || '').trim();
}

function _isCommentLine(line) {
  var trimmed = _trim(line);
  return trimmed.indexOf('//') === 0 || trimmed.indexOf('/*') === 0 || trimmed.indexOf('*') === 0;
}

function _nextNonEmptyIndex(lines, startIndex) {
  for (var i = startIndex; i < lines.length; i++) {
    if (_trim(lines[i]) !== '') return i;
  }
  return -1;
}

function _prevNonEmptyLines(lines, startIndex, limit) {
  var result = [];
  for (var i = startIndex; i >= 0 && result.length < limit; i--) {
    if (_trim(lines[i]) !== '') result.push(lines[i]);
  }
  return result;
}

function _countConsecutiveXmlDocLines(lines, startIndex) {
  var count = 0;
  for (var i = startIndex; i < lines.length; i++) {
    if (_trim(lines[i]).indexOf('///') === 0) count++;
    else break;
  }
  return count;
}

function _countNullGuardLines(lines) {
  var count = 0;
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*if\s*\(\s*\w+\s*==\s*null\s*\)\s*throw\s+new\s+ArgumentNullException\s*\(\s*nameof\s*\(\s*\w+\s*\)\s*\)\s*;?\s*$/.test(lines[i])) {
      count++;
    }
  }
  return count;
}

function _methodCountInClass(lines, startIndex) {
  var methodCount = 0;
  var seenOpenBrace = false;
  var depth = 0;

  for (var i = startIndex; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = _trim(line);

    if (!seenOpenBrace) {
      if (trimmed.indexOf('{') !== -1) {
        seenOpenBrace = true;
      }
    }

    if (seenOpenBrace && /\b(public|private|protected|internal)\b[^;{}]*\b\w+\s*\([^;{}]*\)\s*(\{|=>)/.test(trimmed) &&
        trimmed.indexOf('class ') === -1 && trimmed.indexOf('if ') === -1 && trimmed.indexOf('for ') === -1 &&
        trimmed.indexOf('while ') === -1 && trimmed.indexOf('switch ') === -1 && trimmed.indexOf('catch ') === -1) {
      methodCount++;
    }

    for (var j = 0; j < line.length; j++) {
      if (line[j] === '{') depth++;
      if (line[j] === '}') depth--;
    }

    if (seenOpenBrace && depth <= 0) break;
  }

  return methodCount;
}

function _shortMethodAfterXmlDoc(lines, startIndex) {
  var openBraceLine = -1;
  for (var i = startIndex; i < Math.min(lines.length, startIndex + 20); i++) {
    if (_trim(lines[i]) === '') continue;
    if (/\b(public|private|protected|internal)\b/.test(lines[i]) && lines[i].indexOf('(') !== -1) {
      if (lines[i].indexOf('{') !== -1) {
        openBraceLine = i;
        break;
      }
      var nextIndex = _nextNonEmptyIndex(lines, i + 1);
      if (nextIndex !== -1 && _trim(lines[nextIndex]) === '{') {
        openBraceLine = nextIndex;
        break;
      }
    }
  }

  if (openBraceLine === -1) return false;

  var depth = 0;
  var statementLines = 0;
  for (var j = openBraceLine; j < Math.min(lines.length, openBraceLine + 20); j++) {
    var line = lines[j];
    var trimmed = _trim(line);
    for (var k = 0; k < line.length; k++) {
      if (line[k] === '{') depth++;
      if (line[k] === '}') depth--;
    }
    if (j > openBraceLine && depth > 0 && trimmed !== '') statementLines++;
    if (j > openBraceLine && depth <= 0) break;
  }

  return statementLines <= 5;
}

function _lineWindow(lines, startIndex, count) {
  return lines.slice(startIndex, Math.min(lines.length, startIndex + count)).join('\n');
}

function _stripLineComment(line) {
  return String(line || '').replace(/^\s*\/\/\s?/, '');
}

function _isFileHeader(stripped, lineIndex) {
  if (lineIndex >= 15) return false;
  return /Copyright|License|\(c\)|©|\d{4}\s+\w/.test(stripped);
}

function _looksLikeCommentedCode(line) {
  return /\b\w[\w.]*\s*(?:\+|-|\*|\/|%|\?\?)?\s*=\s*\S/.test(line) ||
         /=>\s*\S/.test(line) ||
         /\w+\?\.[\w(]/.test(line) ||
         /\b(?:if|for|foreach|while|return|throw|await)\s*\(/.test(line) ||
         /\w+\s*\[\s*\w[^\]]*\]\s*=/.test(line) ||
         /\bnew\s+\w[\w.<>]*\s*\(/.test(line);
}

function _looksLikeCommentedContinuation(line) {
  return /=>/.test(line) ||
         /\?\.\w+/.test(line) ||
         /\w+\.\w+\s*\(/.test(line) ||
         /["']/.test(line) ||
         /[;\[\]{}=,+\-*\/%<>]/.test(line);
}

function _isCommentedCodeBlockLine(lines, lineIndex) {
  var line = lines[lineIndex] || '';
  if (!/^\s*\/\//.test(line)) return false;

  var stripped = _stripLineComment(line);
  if (_isFileHeader(stripped, lineIndex)) return false;
  if (_looksLikeCommentedCode(stripped)) return true;

  if (!_looksLikeCommentedContinuation(stripped) || lineIndex === 0) return false;

  var previous = lines[lineIndex - 1] || '';
  if (!/^\s*\/\//.test(previous)) return false;

  return _isCommentedCodeBlockLine(lines, lineIndex - 1);
}

function _hasProviderPrefix(line, regex) {
  if (_isCommentLine(line)) return false;
  regex.lastIndex = 0;
  return regex.test(line);
}

function _hasProviderPrefixWithoutNearbyMarker(line, regex, marker, distance) {
  if (_isCommentLine(line)) return false;

  regex.lastIndex = 0;
  var match;

  while ((match = regex.exec(line)) !== null) {
    var startIndex = Math.max(0, match.index - distance);
    var prefixWindow = line.slice(startIndex, match.index).toLowerCase();
    if (prefixWindow.indexOf(String(marker || '').toLowerCase()) === -1) {
      regex.lastIndex = 0;
      return true;
    }
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }

  regex.lastIndex = 0;
  return false;
}

function _escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _buildSeededProviderRegex(seed) {
  var minLength = seed.minBodyLength;
  var maxLength = seed.maxBodyLength;
  var quantifier;

  if (minLength === maxLength) quantifier = '{' + minLength + '}';
  else quantifier = '{' + minLength + ',' + maxLength + '}';

  return new RegExp(
    '(?:^|[^A-Za-z0-9])' + _escapeRegex(seed.prefix) + seed.bodyPattern + quantifier + '(?![A-Za-z0-9_.-])'
  );
}

function _hasSeededProviderToken(line, seed) {
  if (_isCommentLine(line)) return false;

  if (!seed._regex) {
    seed._regex = _buildSeededProviderRegex(seed);
  }

  seed._regex.lastIndex = 0;
  return seed._regex.test(line);
}

var PROVIDER_SEEDS = [
  {
    id: 'aws-temporary-access-key-prefix',
    name: 'AWS temporary access key prefix literal',
    provider: 'AWS',
    prefix: 'ASIA',
    minBodyLength: 16,
    maxBodyLength: 16,
    bodyPattern: '[A-Z0-9]',
    severity: 8,
    description: 'ASIA-prefixed literals are commonly AWS temporary access keys and should be reviewed as provider-shaped credentials.',
    fix: 'Move the AWS temporary credential to a secret store or environment configuration.',
  },
  {
    id: 'github-fine-grained-token-prefix',
    name: 'GitHub fine-grained token prefix literal',
    provider: 'GitHub',
    prefix: 'github_pat_',
    minBodyLength: 71,
    maxBodyLength: 71,
    bodyPattern: '[A-Za-z0-9_]',
    severity: 8,
    description: 'github_pat_-prefixed literals are commonly GitHub fine-grained tokens and should not be hardcoded.',
    fix: 'Move the GitHub token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'gitlab-token-prefix',
    name: 'GitLab token prefix literal',
    provider: 'GitLab',
    prefix: 'glpat-',
    minBodyLength: 20,
    maxBodyLength: 64,
    bodyPattern: '[A-Za-z0-9_-]',
    severity: 8,
    description: 'glpat--prefixed literals are commonly GitLab personal access tokens and should not be hardcoded.',
    fix: 'Move the GitLab token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'stripe-test-key-prefix',
    name: 'Stripe test key prefix literal',
    provider: 'Stripe',
    prefix: 'sk_test_',
    minBodyLength: 24,
    maxBodyLength: 99,
    bodyPattern: '[A-Za-z0-9]',
    severity: 7,
    description: 'sk_test_-prefixed literals are commonly Stripe test keys and should not live in source.',
    fix: 'Move the Stripe test key to secure configuration instead of hardcoding it.',
  },
  {
    id: 'slack-bot-token-prefix',
    name: 'Slack bot token prefix literal',
    provider: 'Slack',
    prefix: 'xoxb-',
    minBodyLength: 24,
    maxBodyLength: 80,
    bodyPattern: '[A-Za-z0-9-]',
    severity: 8,
    description: 'xoxb--prefixed literals are commonly Slack bot tokens and should not be hardcoded.',
    fix: 'Move the Slack bot token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'npm-token-prefix',
    name: 'npm token prefix literal',
    provider: 'npm',
    prefix: 'npm_',
    minBodyLength: 36,
    maxBodyLength: 36,
    bodyPattern: '[A-Za-z0-9]',
    severity: 8,
    description: 'npm_-prefixed literals are commonly npm automation tokens and should not be hardcoded.',
    fix: 'Move the npm token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'linear-api-key-prefix',
    name: 'Linear API key prefix literal',
    provider: 'Linear',
    prefix: 'lin_api_',
    minBodyLength: 40,
    maxBodyLength: 40,
    bodyPattern: '[a-z0-9]',
    severity: 8,
    description: 'lin_api_-prefixed literals are commonly Linear API keys and should not be hardcoded.',
    fix: 'Move the Linear API key to secure configuration and rotate it if exposed.',
  },
  {
    id: 'shopify-access-token-prefix',
    name: 'Shopify access token prefix literal',
    provider: 'Shopify',
    prefix: 'shpat_',
    minBodyLength: 32,
    maxBodyLength: 32,
    bodyPattern: '[A-Fa-f0-9]',
    severity: 8,
    description: 'shpat_-prefixed literals are commonly Shopify access tokens and should not be hardcoded.',
    fix: 'Move the Shopify access token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'square-access-token-prefix',
    name: 'Square access token prefix literal',
    provider: 'Square',
    prefix: 'sq0atp-',
    minBodyLength: 22,
    maxBodyLength: 60,
    bodyPattern: '[A-Za-z0-9_-]',
    severity: 8,
    description: 'sq0atp--prefixed literals are commonly Square access tokens and should not be hardcoded.',
    fix: 'Move the Square access token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'databricks-token-prefix',
    name: 'Databricks token prefix literal',
    provider: 'Databricks',
    prefix: 'dapi',
    minBodyLength: 32,
    maxBodyLength: 32,
    bodyPattern: '[a-f0-9]',
    severity: 8,
    description: 'dapi-prefixed literals are commonly Databricks personal access tokens and should not be hardcoded.',
    fix: 'Move the Databricks token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'digitalocean-token-prefix',
    name: 'DigitalOcean token prefix literal',
    provider: 'DigitalOcean',
    prefix: 'dop_v1_',
    minBodyLength: 64,
    maxBodyLength: 64,
    bodyPattern: '[a-f0-9]',
    severity: 8,
    description: 'dop_v1_-prefixed literals are commonly DigitalOcean personal access tokens and should not be hardcoded.',
    fix: 'Move the DigitalOcean token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'sendgrid-token-prefix',
    name: 'SendGrid token prefix literal',
    provider: 'SendGrid',
    prefix: 'SG.',
    minBodyLength: 60,
    maxBodyLength: 80,
    bodyPattern: '[A-Za-z0-9_.-]',
    severity: 8,
    description: 'SG.-prefixed literals are commonly SendGrid API keys and should not be hardcoded.',
    fix: 'Move the SendGrid API key to secure configuration and rotate it if exposed.',
  },
  {
    id: 'openai-project-key-prefix',
    name: 'OpenAI project key prefix literal',
    provider: 'OpenAI',
    prefix: 'sk-proj-',
    minBodyLength: 48,
    maxBodyLength: 96,
    bodyPattern: '[A-Za-z0-9_-]',
    severity: 8,
    description: 'sk-proj--prefixed literals are commonly OpenAI project keys and should not be hardcoded.',
    fix: 'Move the OpenAI project key to secure configuration and rotate it if exposed.',
  },
  {
    id: 'anthropic-api-key-prefix',
    name: 'Anthropic API key prefix literal',
    provider: 'Anthropic',
    prefix: 'sk-ant-api03-',
    minBodyLength: 50,
    maxBodyLength: 120,
    bodyPattern: '[A-Za-z0-9_-]',
    severity: 8,
    description: 'sk-ant-api03--prefixed literals are commonly Anthropic API keys and should not be hardcoded.',
    fix: 'Move the Anthropic API key to secure configuration and rotate it if exposed.',
  },
];

function _buildSeededProviderRules() {
  return PROVIDER_SEEDS.map(function (seed) {
    return {
      id: seed.id,
      name: seed.name,
      category: 'security-shape',
      severity: seed.severity,
      description: seed.description,
      test: function (line) {
        return _hasSeededProviderToken(line, seed);
      },
      fix: seed.fix,
    };
  });
}

function _parseYamlValue(raw) {
  var value = String(raw || '').trim();
  if (!value) return '';

  if (value === 'true') return true;
  if (value === 'false') return false;

  if ((value[0] === '"' && value[value.length - 1] === '"') ||
      (value[0] === '\'' && value[value.length - 1] === '\'')) {
    return value.slice(1, -1);
  }

  return value;
}

function _loadAstRules() {
  if (astRuleCache) return astRuleCache;

  astRuleCache = [];

  if (!fs.existsSync(AST_RULES_DIR)) return astRuleCache;

  var files = fs.readdirSync(AST_RULES_DIR).filter(function (name) {
    return /\.ya?ml$/i.test(name);
  }).sort();

  for (var i = 0; i < files.length; i++) {
    astRuleCache.push(_parseAstRuleFile(path.join(AST_RULES_DIR, files[i])));
  }

  return astRuleCache;
}

function _parseAstRuleFile(filePath) {
  var lines = fs.readFileSync(filePath, 'utf8').split('\n');
  var rule = { patterns: [] };
  var section = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    var topLevel;
    var nested;
    var listItem;

    if (!trimmed || trimmed.indexOf('#') === 0) continue;

    if (/^[^\s]/.test(line)) {
      topLevel = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!topLevel) continue;

      section = null;
      if (topLevel[1] === 'patterns') {
        section = 'patterns';
        continue;
      }
      if (topLevel[1] === 'rule') {
        section = 'rule';
        continue;
      }

      rule[topLevel[1]] = _parseYamlValue(topLevel[2]);
      continue;
    }

    if (section === 'rule') {
      nested = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
      if (nested && nested[1] === 'pattern') {
        rule.pattern = _parseYamlValue(nested[2]);
      }
      continue;
    }

    if (section === 'patterns') {
      listItem = line.match(/^\s*-\s*(.*)$/);
      if (listItem) {
        rule.patterns.push(_parseYamlValue(listItem[1]));
      }
    }
  }

  if (rule.pattern && rule.patterns.indexOf(rule.pattern) === -1) {
    rule.patterns.unshift(rule.pattern);
  }

  rule.severity = Number(rule.severity);
  rule.name = rule.name || rule.message || rule.id;
  return rule;
}

function _findNodesByKind(node, kind, matches) {
  if (!node) return matches;

  if (node.kind() === kind) {
    matches.push(node);
  }

  var children = node.children();
  for (var i = 0; i < children.length; i++) {
    _findNodesByKind(children[i], kind, matches);
  }

  return matches;
}

function _hasEmptyBlock(match) {
  var children = match.children();
  var block = children[children.length - 1];
  var blockChildren;
  var significantChildren = [];
  var i;

  if (!block || block.kind() !== 'block') return false;

  blockChildren = block.children();
  for (i = 0; i < blockChildren.length; i++) {
    if (blockChildren[i].kind() !== '{' && blockChildren[i].kind() !== '}') {
      significantChildren.push(blockChildren[i]);
    }
  }

  return significantChildren.length === 0;
}

function _extractDelegatedInvocation(statementNode) {
  var children;
  var expressionNode;

  if (!statementNode) return null;

  if (statementNode.kind() === 'return_statement') {
    children = statementNode.children();
    if (children.length < 2) return null;
    expressionNode = children[1];
  } else if (statementNode.kind() === 'expression_statement') {
    children = statementNode.children();
    if (children.length < 1) return null;
    expressionNode = children[0];
  } else {
    return null;
  }

  if (!expressionNode) return null;
  if (expressionNode.kind() === 'await_expression') {
    children = expressionNode.children();
    if (children.length < 2) return null;
    expressionNode = children[1];
  }

  if (expressionNode.kind() !== 'invocation_expression') return null;
  return expressionNode;
}

function _isPassThroughMethod(match) {
  var methodChildren = match.children();
  var block = methodChildren[methodChildren.length - 1];
  var blockChildren;
  var significantChildren = [];
  var invocation;
  var invocationChildren;
  var memberAccess;
  var memberChildren;
  var i;

  if (!block || block.kind() !== 'block') return false;

  blockChildren = block.children();
  for (i = 0; i < blockChildren.length; i++) {
    if (blockChildren[i].kind() !== '{' && blockChildren[i].kind() !== '}') {
      significantChildren.push(blockChildren[i]);
    }
  }

  if (significantChildren.length !== 1) return false;

  invocation = _extractDelegatedInvocation(significantChildren[0]);
  if (!invocation) return false;

  invocationChildren = invocation.children();
  if (invocationChildren.length < 1) return false;
  memberAccess = invocationChildren[0];
  if (!memberAccess || memberAccess.kind() !== 'member_access_expression') return false;

  memberChildren = memberAccess.children();
  if (memberChildren.length < 3) return false;

  return memberChildren[0].kind() === 'identifier' && /^_[A-Za-z0-9_]+$/.test(memberChildren[0].text());
}

function _countDirectClassExecutableMembers(match) {
  var classChildren = match.children();
  var declarationList = classChildren[classChildren.length - 1];
  var declarationChildren;
  var memberCount = 0;
  var i;

  if (!declarationList || declarationList.kind() !== 'declaration_list') return 0;

  declarationChildren = declarationList.children();
  for (i = 0; i < declarationChildren.length; i++) {
    if (declarationChildren[i].kind() === 'method_declaration' || declarationChildren[i].kind() === 'constructor_declaration') {
      memberCount++;
    }
  }

  return memberCount;
}

function _applyAstRules(content, fileRecord) {
  var astRules = _loadAstRules();
  var lines = content.split('\n');
  var hits = [];
  var seen = {};
  var sg;

  if (!AstGrep || !AstGrep.parse || !AstGrep.Lang || astRules.length === 0) {
    return hits;
  }

  sg = AstGrep.parse(AstGrep.Lang.CSharp, content);

  for (var i = 0; i < astRules.length; i++) {
    var rule = astRules[i];
    var patterns = rule.patterns || [];
    var kindMatches = [];

    if (rule.language && rule.language !== 'CSharp') continue;

    if (rule.kind) {
      kindMatches = _findNodesByKind(sg.root(), rule.kind, []);
      for (var km = 0; km < kindMatches.length; km++) {
        var kindMatch = kindMatches[km];
        var kindRange = kindMatch.range();
        var kindKey = [rule.id, kindRange.start.line, kindRange.start.column, kindMatch.text()].join('|');

        if (!_matchAstRuleFilters(rule, kindMatch)) continue;
        if (seen[kindKey]) continue;
        seen[kindKey] = true;

        hits.push({
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          severity: rule.severity,
          line: lines[kindRange.start.line] || kindMatch.text(),
          lineIndex: kindRange.start.line,
          fix: rule.fix,
          filePath: fileRecord && (fileRecord.path || fileRecord.relativePath),
        });
      }
    }

    for (var p = 0; p < patterns.length; p++) {
      var matches;

      try {
        matches = sg.root().findAll(patterns[p]);
      } catch (_err) {
        continue;
      }

      for (var m = 0; m < matches.length; m++) {
        var match = matches[m];
        var range = match.range();
        var key = [rule.id, range.start.line, range.start.column, match.text()].join('|');

        if (!_matchAstRuleFilters(rule, match)) continue;
        if (seen[key]) continue;
        seen[key] = true;

        hits.push({
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          severity: rule.severity,
          line: lines[range.start.line] || match.text(),
          lineIndex: range.start.line,
          fix: rule.fix,
          filePath: fileRecord && (fileRecord.path || fileRecord.relativePath),
        });
      }
    }
  }

  return hits;
}

function _matchAstRuleFilters(rule, match) {
  var capture;
  var children;
  var childTexts;
  var identifierNode;
  var i;

  if (rule.emptyBlock && !_hasEmptyBlock(match)) return false;
  if (rule.delegateOnly && !_isPassThroughMethod(match)) return false;
  if (rule.maxClassMemberCount !== undefined && _countDirectClassExecutableMembers(match) > Number(rule.maxClassMemberCount)) return false;
  if (rule.textRegex && !(new RegExp(rule.textRegex, rule.textRegexFlags || '').test(match.text()))) return false;

  if (rule.requiredChildTexts) {
    children = match.children();
    childTexts = [];

    for (i = 0; i < children.length; i++) {
      childTexts.push(children[i].text());
      if (!identifierNode && children[i].kind() === 'identifier') {
        identifierNode = children[i];
      }
    }

    for (i = 0; i < rule.requiredChildTexts.split('|').length; i++) {
      if (childTexts.indexOf(rule.requiredChildTexts.split('|')[i]) === -1) {
        return false;
      }
    }
  }

  if (rule.identifierRegex || rule.identifierNotRegex) {
    if (!identifierNode) {
      children = children || match.children();
      for (i = 0; i < children.length; i++) {
        if (children[i].kind() === 'identifier') {
          identifierNode = children[i];
          break;
        }
      }
    }

    if (!identifierNode) return false;
    if (rule.identifierRegex && !(new RegExp(rule.identifierRegex).test(identifierNode.text()))) return false;
    if (rule.identifierNotRegex && new RegExp(rule.identifierNotRegex).test(identifierNode.text())) return false;
  }

  if (!rule.captureRegex) return true;
  if (!rule.capture || !match.getMatch) return false;

  capture = match.getMatch(rule.capture);
  if (!capture) return false;

  return new RegExp(rule.captureRegex).test(capture.text());
}

var inlineRules = [
  {
    id: 'console-writeline-debug',
    name: 'Console.WriteLine left in code',
    category: 'debug-pollution',
    severity: 4,
    description: 'Console.WriteLine calls left in non-test code are debugging residue.',
    test: function (line, ctx) {
      if (ctx.isTest || _isCommentLine(line)) return false;
      return /\bConsole\.WriteLine\s*\(/.test(line);
    },
    fix: 'Remove Console.WriteLine or replace it with structured logging.',
  },
  {
    id: 'debug-writeline-leftover',
    name: 'Debug.WriteLine or Debug.Print left in code',
    category: 'debug-pollution',
    severity: 4,
    description: 'Debug output should not remain in shipped code.',
    test: function (line) {
      if (_isCommentLine(line)) return false;
      return /\bDebug\.(WriteLine|Print)\s*\(/.test(line);
    },
    fix: 'Remove Debug.WriteLine and Debug.Print calls.',
  },
  {
    id: 'trace-writeline-leftover',
    name: 'Trace.WriteLine left in code',
    category: 'debug-pollution',
    severity: 4,
    description: 'Trace.WriteLine is often leftover instrumentation.',
    test: function (line) {
      if (_isCommentLine(line)) return false;
      return /\bTrace\.WriteLine\s*\(/.test(line);
    },
    fix: 'Remove Trace.WriteLine or route it through production logging.',
  },
  {
    id: 'debugger-break-leftover',
    name: 'Debugger break/launch left in code',
    category: 'debug-pollution',
    severity: 6,
    description: 'Debugger.Break and Debugger.Launch pause or disrupt execution.',
    test: function (line) {
      if (_isCommentLine(line)) return false;
      return /\bDebugger\.(Break|Launch)\s*\(/.test(line);
    },
    fix: 'Remove Debugger.Break and Debugger.Launch before shipping.',
  },
  {
    id: 'swallowed-task-exception',
    name: 'ContinueWith without fault handling',
    category: 'error-silencing',
    severity: 6,
    description: 'Task continuations without fault handling often discard exceptions.',
    test: function (line, ctx) {
      if (_isCommentLine(line) || line.indexOf('.ContinueWith(') === -1) return false;
      var window = _lineWindow(ctx.lines, ctx.lineIndex, 6);
      if (/\.Exception\b|\.IsFaulted\b|OnlyOnFaulted|TaskContinuationOptions/.test(window)) return false;
      return true;
    },
    fix: 'Inspect task.Exception or use await/try-catch instead of a blind continuation.',
  },
  {
    id: 'pragma-warning-suppress',
    name: 'Broad pragma warning disable',
    category: 'suppression-abuse',
    severity: 6,
    description: 'Disabling warnings without naming specific codes hides real issues.',
    test: function (line) {
      if (!/^\s*#pragma\s+warning\s+disable\b/.test(line)) return false;
      return !/\b(?:CS|IDE|CA|SA)\d+\b/.test(line);
    },
    fix: 'Disable only the specific warning codes that are justified.',
  },
  {
    id: 'todo-fixme-comment',
    name: 'TODO/FIXME/HACK comment',
    category: 'dead-code',
    severity: 4,
    description: 'Unresolved TODO markers are unfinished code debt.',
    test: function (line) {
      return /\/\/\s*(TODO|FIXME|HACK)\b/i.test(line);
    },
    fix: 'Resolve or remove the TODO before shipping.',
  },
  {
    id: 'commented-out-code',
    name: 'Commented-out code',
    category: 'dead-code',
    severity: 3,
    description: 'Commented-out code should be removed instead of left inline.',
    test: function (_line, ctx) {
      return _isCommentedCodeBlockLine(ctx.lines, ctx.lineIndex);
    },
    fix: 'Delete commented-out code and rely on version control history.',
  },
  {
    id: 'excessive-xml-doc',
    name: 'Excessive XML documentation for short method',
    category: 'verbosity',
    severity: 3,
    description: 'Long XML docs on trivial methods are a common AI verbosity smell.',
    test: function (line, ctx) {
      if (_trim(line).indexOf('/// <summary>') !== 0) return false;
      return _countConsecutiveXmlDocLines(ctx.lines, ctx.lineIndex) > 8 && _shortMethodAfterXmlDoc(ctx.lines, ctx.lineIndex);
    },
    fix: 'Trim XML comments to the useful minimum or let the method name carry the meaning.',
  },
  {
    id: 'verbose-null-guard',
    name: 'Repeated verbose null guards',
    category: 'verbosity',
    severity: 3,
    description: 'Repeating the same explicit null guard many times is noisy and mechanical.',
    test: function (line, ctx) {
      if (!/^\s*if\s*\(\s*\w+\s*==\s*null\s*\)\s*throw\s+new\s+ArgumentNullException\s*\(\s*nameof\s*\(\s*\w+\s*\)\s*\)\s*;?\s*$/.test(line)) {
        return false;
      }
      return _countNullGuardLines(ctx.lines) > 3;
    },
    fix: 'Use a shared guard helper or coalesce the null checks into a smaller pattern.',
  },
  {
    id: 'task-result-blocking',
    name: 'Blocking on Task.Result',
    category: 'async-abuse',
    severity: 7,
    description: 'Task.Result blocks threads and can deadlock async code paths.',
    test: function (line) {
      if (_isCommentLine(line)) return false;
      return /\.[Rr]esult\b/.test(line);
    },
    fix: 'Await the task instead of reading Result synchronously.',
  },
  {
    id: 'task-wait-blocking',
    name: 'Blocking on Task.Wait()',
    category: 'async-abuse',
    severity: 7,
    description: 'Task.Wait blocks threads and defeats async flow.',
    test: function (line) {
      if (_isCommentLine(line)) return false;
      return /\.[Ww]ait\s*\(/.test(line);
    },
    fix: 'Await the task instead of calling Wait().',
  },
  {
    id: 'aws-access-key-prefix',
    name: 'AWS access key prefix literal',
    category: 'security-shape',
    severity: 8,
    description: 'AKIA-prefixed literals are commonly AWS access keys and should be reviewed as provider-shaped credentials.',
    test: function (line) {
      return _hasProviderPrefix(line, /\bAKIA[0-9A-Z]{16}\b/);
    },
    fix: 'Move the AWS credential to a secret store or environment configuration.',
  },
  {
    id: 'github-token-prefix',
    name: 'GitHub token prefix literal',
    category: 'security-shape',
    severity: 8,
    description: 'ghp_-prefixed literals are commonly GitHub personal access tokens and should not be hardcoded.',
    test: function (line) {
      return _hasProviderPrefix(line, /\bghp_[A-Za-z0-9]{16,}\b/);
    },
    fix: 'Move the GitHub token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'stripe-live-key-prefix',
    name: 'Stripe live key prefix literal',
    category: 'security-shape',
    severity: 8,
    description: 'sk_live_-prefixed literals are commonly Stripe live keys and should not live in source.',
    test: function (line) {
      return _hasProviderPrefix(line, /\bsk_live_[A-Za-z0-9]{12,}\b/);
    },
    fix: 'Move the Stripe live key to a secret manager and rotate it if exposed.',
  },
  {
    id: 'slack-token-prefix',
    name: 'Slack token prefix literal',
    category: 'security-shape',
    severity: 8,
    description: 'xoxp--prefixed literals are commonly Slack user tokens and should not be hardcoded.',
    test: function (line) {
      return _hasProviderPrefix(line, /\bxoxp-[A-Za-z0-9-]{15,}\b/);
    },
    fix: 'Move the Slack token to secure configuration and rotate it if exposed.',
  },
  {
    id: 'jwt-provider-prefix',
    name: 'JWT bearer-shaped literal',
    category: 'security-shape',
    severity: 8,
    description: 'Long ey-prefixed bearer-shaped literals are often JWTs and should be reviewed when they are not embedded in nearby base64 data.',
    test: function (line) {
      return _hasProviderPrefixWithoutNearbyMarker(
        line,
        /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
        'base64,',
        20
      );
    },
    fix: 'Do not hardcode JWTs in source; inject them at runtime or derive them securely.',
  },
  {
    id: 'private-key-begin-prefix',
    name: 'Private key header literal',
    category: 'security-shape',
    severity: 8,
    description: 'BEGIN ... PRIVATE KEY headers indicate private key material and should never be stored in source control.',
    test: function (line) {
      return _hasProviderPrefix(line, /-----BEGIN [A-Z ]{8,}-----/);
    },
    fix: 'Remove the embedded private key from source control and load it from secure storage.',
  },
];

var providerSeedRules = _buildSeededProviderRules();
var lineRules = inlineRules.concat(providerSeedRules);

var rules = lineRules.concat(_loadAstRules());

function _buildCtx(fileRecord, lines) {
  var role = fileRecord.role || {};
  return {
    filePath: fileRecord.path || fileRecord.filePath || fileRecord.relativePath || '',
    lineIndex: 0,
    lines: lines,
    isBackend: !!role.isBackend || fileRecord.isBackend || role.contextType === 'backend',
    isFrontend: !!role.isFrontend || fileRecord.isFrontend || role.contextType === 'frontend',
    isGenerated: !!role.isGenerated || fileRecord.isGenerated,
    isTest: !!role.isTest || fileRecord.isTest,
  };
}

function applyRules(content, fileRecord) {
  if (typeof content !== 'string' || !content) return [];

  var lines = content.split('\n');
  var ctx = _buildCtx(fileRecord || {}, lines);
  var hits = [];

  for (var i = 0; i < lines.length; i++) {
    ctx.lineIndex = i;
    var line = lines[i];
    for (var r = 0; r < lineRules.length; r++) {
      var rule = lineRules[r];
      try {
        if (rule.test(line, ctx)) {
          hits.push({
            ruleId: rule.id,
            ruleName: rule.name,
            category: rule.category,
            severity: rule.severity,
            line: line,
            lineIndex: i,
            fix: rule.fix,
          });
        }
      } catch (_err) {
      }
    }
  }

  return hits.concat(_applyAstRules(content, fileRecord));
}

module.exports = {
  rules: rules,
  applyRules: applyRules,
  _applyAstRules: _applyAstRules,
  _loadAstRules: _loadAstRules,
  _isPassThroughMethod: _isPassThroughMethod,
  _buildCtx: _buildCtx,
  _countNullGuardLines: _countNullGuardLines,
  _countConsecutiveXmlDocLines: _countConsecutiveXmlDocLines,
  _methodCountInClass: _methodCountInClass,
};