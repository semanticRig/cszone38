'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var DEFAULT_CORPUS_DIR = path.join(__dirname, '..', 'corpus');
var CORPUS_CHUNK_LINES = 80;
var GZIP_FRAMING_BYTES = 18;
var _corpusCache = {};

function _round(value) {
  return Math.round(value * 1000) / 1000;
}

function _compressedSize(content) {
  return zlib.gzipSync(Buffer.from(content, 'utf8'), { level: 9 }).length;
}

// Small C# fixtures are short enough that gzip framing noise can dominate the ratio.
function _normalizedCompressedSize(content) {
  return Math.max(_compressedSize(content) - GZIP_FRAMING_BYTES, 0);
}

function selfCompressionRatio(content) {
  if (!content || content.length === 0) return 1;

  var rawSize = Buffer.byteLength(content, 'utf8');
  if (rawSize === 0) return 1;

  return _normalizedCompressedSize(content) / rawSize;
}

function ncd(left, right) {
  if (!left || !right) return 1;

  var zLeft = _normalizedCompressedSize(left);
  var zRight = _normalizedCompressedSize(right);
  var zBoth = _normalizedCompressedSize(left + right);
  var maxZ = Math.max(zLeft, zRight);
  var minZ = Math.min(zLeft, zRight);

  if (maxZ === 0) return 0;
  return (zBoth - minZ) / maxZ;
}

function segmentedCompression(content, windowSize) {
  windowSize = windowSize || 30;

  var lines = String(content || '').split('\n');
  if (lines.length < windowSize) {
    return [{ startLine: 0, endLine: Math.max(lines.length - 1, 0), ratio: selfCompressionRatio(content) }];
  }

  var step = Math.max(1, Math.floor(windowSize / 2));
  var segments = [];

  for (var index = 0; index + windowSize <= lines.length; index += step) {
    var segment = lines.slice(index, index + windowSize).join('\n');
    segments.push({
      startLine: index,
      endLine: index + windowSize - 1,
      ratio: selfCompressionRatio(segment),
    });
  }

  return segments;
}

function _chunkText(content, linesPerChunk) {
  var lines = String(content || '').split('\n');
  var chunks = [];
  var step = Math.max(1, Math.floor(linesPerChunk / 2));

  if (lines.length <= linesPerChunk) {
    return [String(content || '')];
  }

  for (var index = 0; index + linesPerChunk <= lines.length; index += step) {
    chunks.push(lines.slice(index, index + linesPerChunk).join('\n'));
  }

  var tailStart = Math.max(0, lines.length - linesPerChunk);
  var tailChunk = lines.slice(tailStart).join('\n');
  if (chunks.length === 0 || chunks[chunks.length - 1] !== tailChunk) {
    chunks.push(tailChunk);
  }

  return chunks;
}

function _loadCorpusFile(corpusPath) {
  try {
    var compressed = fs.readFileSync(corpusPath);
    return zlib.gunzipSync(compressed).toString('utf8');
  } catch (_err) {
    return null;
  }
}

function _loadCorpusSet(corpusDir) {
  var resolvedDir = path.resolve(corpusDir || DEFAULT_CORPUS_DIR);

  if (_corpusCache[resolvedDir]) {
    return _corpusCache[resolvedDir];
  }

  var corpusSet = {
    human: _loadCorpusFile(path.join(resolvedDir, 'human.cs.gz')),
    ai: _loadCorpusFile(path.join(resolvedDir, 'ai.cs.gz')),
  };

  corpusSet.humanChunks = corpusSet.human ? _chunkText(corpusSet.human, CORPUS_CHUNK_LINES) : [];
  corpusSet.aiChunks = corpusSet.ai ? _chunkText(corpusSet.ai, CORPUS_CHUNK_LINES) : [];

  _corpusCache[resolvedDir] = corpusSet;
  return corpusSet;
}

function _minNcdAgainstChunks(content, chunks) {
  if (!content || !chunks || chunks.length === 0) return null;

  var best = null;

  for (var i = 0; i < chunks.length; i++) {
    var candidate = ncd(content, chunks[i]);
    if (best === null || candidate < best) {
      best = candidate;
    }
  }

  return best;
}

function _ratioScore(selfRatio) {
  if (selfRatio < 0.45) {
    return 70 + ((0.45 - selfRatio) / 0.20) * 30;
  }
  if (selfRatio < 0.65) {
    return ((0.65 - selfRatio) / 0.20) * 70;
  }
  return 0;
}

function _segmentScore(segments) {
  if (!segments || segments.length === 0) return 0;

  var lowestRatio = 1;
  for (var i = 0; i < segments.length; i++) {
    if (segments[i].ratio < lowestRatio) lowestRatio = segments[i].ratio;
  }

  return _ratioScore(lowestRatio);
}

function _ncdScore(ncdHuman, ncdAI) {
  if (ncdHuman === null || ncdAI === null) return 0;

  var divergence = ncdHuman - ncdAI;
  if (divergence <= 0.01) return 0;

  var aiCloseness = Math.max(0, 1 - ncdAI);
  return Math.min(100, Math.round((divergence / 0.15) * 90 + aiCloseness * 10));
}

function compareCorpus(content, corpusDir) {
  var corpora = _loadCorpusSet(corpusDir || DEFAULT_CORPUS_DIR);

  if (!corpora.humanChunks.length || !corpora.aiChunks.length) {
    return { ncdHuman: null, ncdAI: null };
  }

  return {
    ncdHuman: _round(_minNcdAgainstChunks(content, corpora.humanChunks)),
    ncdAI: _round(_minNcdAgainstChunks(content, corpora.aiChunks)),
  };
}

function analyseFile(fileRecord, content, corpusDir) {
  content = String(content || '');

  var selfRatio = selfCompressionRatio(content);
  var segments = segmentedCompression(content, 30);
  var comparison = compareCorpus(content, corpusDir || DEFAULT_CORPUS_DIR);
  var ncdHuman = comparison.ncdHuman;
  var ncdAI = comparison.ncdAI;

  var ratioScore = _ratioScore(selfRatio);
  var segmentScore = _segmentScore(segments);
  var corpusScore = _ncdScore(ncdHuman, ncdAI);
  var compressionScore = Math.min(100, Math.round(ratioScore * 0.35 + segmentScore * 0.20 + corpusScore * 0.45));

  var result = {
    selfRatio: _round(selfRatio),
    ncdHuman: ncdHuman,
    ncdAI: ncdAI,
    segmentScores: segments,
    projectOutlierScore: 0,
    compressionScore: compressionScore,
  };

  if (fileRecord) {
    fileRecord.compression = result;
  }

  return result;
}

_loadCorpusSet(DEFAULT_CORPUS_DIR);

module.exports = {
  selfCompressionRatio: selfCompressionRatio,
  ncd: ncd,
  segmentedCompression: segmentedCompression,
  analyseFile: analyseFile,
  compareCorpus: compareCorpus,
  _loadCorpusSet: _loadCorpusSet,
};