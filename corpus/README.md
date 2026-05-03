# Corpus

`human.cs.gz` and `ai.cs.gz` are the Layer 3 reference corpora used for C# compression and NCD scoring.

These archives are generated from original local templates rather than vendored third-party source. The human corpus biases toward concise, idiomatic service, parser, validator, and utility code. The AI corpus biases toward verbose XML docs, pass-through services, repository/unit-of-work scaffolding, factory inflation, and repetitive guard patterns.

The files are stored as gzip archives because `src/L03-corpus-cs.js` loads them directly at startup.