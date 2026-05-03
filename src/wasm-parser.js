'use strict';

// Singleton wrapper around web-tree-sitter + tree-sitter-c-sharp.
// The only async boundary for parser setup is initialize().
// Once initialized, parse() stays synchronous for the file pipeline.

var fs = require('fs');
var path = require('path');
var TreeSitter = require('web-tree-sitter');

var Parser = TreeSitter.Parser;
var Language = TreeSitter.Language;

var cachedParserBundle = null;
var pendingInitialization = null;

function resolveCSharpWasmPath() {
  return path.join(__dirname, '..', 'node_modules', 'tree-sitter-c-sharp', 'tree-sitter-c_sharp.wasm');
}

async function initialize() {
  if (cachedParserBundle) return cachedParserBundle;
  if (pendingInitialization) return pendingInitialization;

  pendingInitialization = (async function () {
    var wasmPath = resolveCSharpWasmPath();
    var wasmBytes = fs.readFileSync(wasmPath);

    await Parser.init();

    var csharp = await Language.load(wasmBytes);
    var parser = new Parser();
    parser.setLanguage(csharp);

    cachedParserBundle = {
      parser: parser,
      CSharp: csharp,
    };

    return cachedParserBundle;
  })();

  try {
    return await pendingInitialization;
  } catch (err) {
    pendingInitialization = null;
    throw err;
  }
}

function parse(parser, content) {
  if (!parser || typeof parser.parse !== 'function') {
    throw new Error('cszone38: invalid parser passed to wasm-parser.parse()');
  }

  return parser.parse(content);
}

module.exports = {
  initialize: initialize,
  parse: parse,
};
