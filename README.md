<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="https://raw.githubusercontent.com/semanticRig/cszone38/main/assets/cszone38-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/semanticRig/cszone38/main/assets/cszone38-logo-light.svg">
  <img src="https://raw.githubusercontent.com/semanticRig/cszone38/main/assets/cszone38-logo-dark.svg" alt="cszone38" width="720"/>
</picture>

<br/>
<br/>

<p>
  <img src="https://img.shields.io/badge/version-0.1.0-0a0a0f?style=flat-square&labelColor=0a0a0f&color=6366f1" alt="version">
  <img src="https://img.shields.io/badge/license-BUSL--1.1-c0392b?style=flat-square&labelColor=0a0a0f" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-slate?style=flat-square&labelColor=0a0a0f&color=475569" alt="node">
  <img src="https://img.shields.io/badge/.cs%20%7C%20.csx%20%7C%20.razor-C%23-7c3aed?style=flat-square&labelColor=0a0a0f" alt="csharp files">
  <img src="https://img.shields.io/badge/network-offline%20by%20default-22c55e?style=flat-square&labelColor=0a0a0f" alt="offline">
</p>

**Three-axis static analysis for C# codebases.**  
Below IC 0.038, nothing is innocent. Not even C#.

</div>

---

## What It Is

cszone38 scans `.cs`, `.csx`, and `.razor` files and scores every file and the whole project across three independent axes:

| Axis | Name | What it catches |
|------|------|-----------------|
| **A** | Slop | Structural over-engineering, AI-style verbosity, low-signal patterns |
| **B** | Security | Hardcoded credentials, suspicious strings, exposure risk |
| **C** | Quality | Debug residue, weak error handling, maintenance debt |

Point it at a project. It tells you what deserves attention.

---

## Why 0.038

The name comes from the **Index of Coincidence** — a classic cryptanalysis measurement.

Human language is uneven. Letters cluster. Patterns repeat. Natural text drifts toward an IC around **0.065**. Random-looking credential material drifts toward **0.038**.

That lower number is the boundary this tool guards. When a string crosses into that zone, it stops behaving like ordinary source text and starts behaving like something mathematically foreign.

---

## The Math

cszone38 is a user tool, but its story is math, not magic.

### Signal 1 — Shannon Entropy

```
H(X) = -∑ p(xᵢ) · log₂ p(xᵢ)
```

Measures how evenly characters are distributed. Low entropy means predictable text. High entropy means the string looks random. Real credentials push upward here.

### Signal 2 — Index of Coincidence

```
IC = ∑ nᵢ(nᵢ - 1) / N(N - 1)
```

Measures repetition patterns. Human language repeats familiar symbols. Secrets flatten toward uniformity. The closer something gets to **0.038**, the less it behaves like ordinary code.

### Signal 3 — Normalized Compression Distance

```
NCD(x, y) = ( C(xy) - min(C(x), C(y)) ) / max(C(x), C(y))
```

Measures how structurally strange a value is compared with the code around it. A normal config label often resembles its file. A leaked credential usually does not.

cszone38 does not rely on one fragile clue. Three independent mathematical signals triangulate the truth.

---

## Quick Start

```bash
npx cszone38 .
```

```bash
npx cszone38 ./src --verbose
```

```bash
npx cszone38 ./Auth.cs --no-slop --json
```

```bash
npm install -g cszone38
cszone38 .
```

---

## Thresholds and Exit Codes

Exit code `0` means every axis passed. Exit code `1` means at least one axis crossed its threshold.

| Axis | Default threshold |
|------|------------------|
| A — Slop | ≤ 50 |
| B — Security | ≤ 25 |
| C — Quality | ≤ 100 |

---

## Command Reference

### Pick the right command

| Goal | Command |
|------|---------|
| First pass on any repo | `npx cszone38 .` |
| Understand why files were flagged | `npx cszone38 . --verbose` |
| Security only, pre-release | `npx cszone38 . --axis=B --verbose` |
| Scan a single file | `npx cszone38 ./Auth.cs` |
| Review only changed files | `npx cszone38 . --since=origin/main --json` |
| Investigate one flagged line | `npx cszone38 ./Auth.cs --explain=84` |
| Machine-readable output for CI | `npx cszone38 . --json` |
| Skip slop for speed | `npx cszone38 ./Auth.cs --no-slop` |
| Clean obvious noise then rescan | `npx cszone38 . --fix --verbose` |
| Check deep mode readiness | `cszone38 doctor` |
| Enable optional deep analysis | `cszone38 setup deep` then `cszone38 . --deep` |
| Verify live credentials you own | `cszone38 . --verify --allow-network` |

---

## Flags

### Everyday

**`-v`, `--verbose`** — Shows detailed output for flagged files. Use it when the default summary tells you a file was flagged but not enough about why.

**`-a`, `--all`** — Shows every file, not only the flagged ones. Use it when you want the complete scan ledger.

**`-f`, `--file=NAME`** — Filters output to one file name. Useful in large repos.

### Focus and Filtering

**`-A`, `--axis=A,B,C`** — Limits the scan to selected axes.

```bash
npx cszone38 . --axis=B
npx cszone38 . --axis=A,C
```

**`-s`, `--show=SECTION`** — Shows one output section: `hits`, `secrets`, `review`, `exposure`, or `breakdown`.

```bash
npx cszone38 . --axis=B --show=secrets
```

**`-S`, `--since=REF`** — Scans only files changed since a git ref. Best for pull-request workflows.

```bash
npx cszone38 . --since=origin/main
npx cszone38 . --since=HEAD~1
```

### Output

**`-j`, `--json`** — Machine-readable JSON. Use for CI, scripting, or custom dashboards.

**`-o`, `--open`** — Opens the interactive hit navigator. Lets you step through findings instead of scrolling a wall of text.

**`--explain=LINE`** — Explains the nearest signal around a specific line. Single-file mode only.

```bash
npx cszone38 ./Auth.cs --explain=84
```

**`-t`, `--threshold=A:N`** — Overrides an axis threshold.

```bash
npx cszone38 . --threshold=B:10
npx cszone38 . --threshold=A:40,C:30
```

### Cleanup and Speed

**`--fix`** — Applies small local cleanup fixes before the scan. Useful before a commit.

**`--no-slop`** — Skips Axis A for faster Axis B + C feedback.

### Optional Deep Analysis

**`doctor`** — Shows whether the normal scan is ready and whether optional deep mode is available.

**`setup deep`** — Prepares optional local deep-analysis mode.

Current public deep-bundle release support is **Linux x64 only**. macOS and Windows bundles are planned later.

**Windows via WSL2** — If you are on Windows, you can still use `--deep` through WSL2 by running `cszone38` inside a Linux distro such as Ubuntu. This is Linux support inside WSL, not native Windows deep support.

In an elevated PowerShell window:

```powershell
wsl --install -d Ubuntu
```

After restart, open Ubuntu and run:

```bash
npm install -g cszone38
cszone38 doctor
cszone38 setup deep
cszone38 . --deep
```

Run these commands inside WSL, not in native PowerShell or `cmd.exe`. For best performance, keep the repository inside the WSL filesystem rather than under `/mnt/c/...`.

**`--deep`** — Adds an optional deeper local pass. Requires `setup deep` first. Falls back to normal results if unavailable.

**`--solution=PATH`** — Tells deep mode which `.sln`, `.slnx`, or `.csproj` to use when a repo has multiple options.

### Optional Live Verification

> **Warning:** `--verify --allow-network` may contact real providers. Use only on credentials you own.

```bash
cszone38 . --verify --allow-network
```

---

## Common Workflows

**First pass, safest command:**
```bash
npx cszone38 .
```

**Security focus before a release:**
```bash
npx cszone38 . --axis=B --verbose
```

**Pull-request / branch review:**
```bash
npx cszone38 . --since=origin/main --json
```

**Quick single-file check while coding:**
```bash
npx cszone38 ./AuthService.cs --no-slop
```

**Clean noise then rescan:**
```bash
npx cszone38 . --fix --verbose
```

**Enable the optional deep pass:**
```bash
cszone38 doctor
cszone38 setup deep
cszone38 . --deep
```

---

## CI

```yaml
name: cszone38

on: [pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npx cszone38 . --since=origin/main --json
```

---

## Library Usage

```js
const { run, renderJson, exitCode } = require('cszone38');

const result   = run('./src');
const json     = renderJson(result.report);
const code     = exitCode(result.report.projectSummary.axes);
```

---

## Privacy and Network Behavior

The default scan path is entirely local. No telemetry. No network calls.

`--deep` is optional and still local. `--verify` is the only mode that may use the network, and only when you explicitly add `--allow-network`.

The safe default is the normal math-based scan.

---

## Requirements

- Node.js 18 or later
- macOS, Linux, or Windows
- `.cs`, `.csx`, or `.razor` source files

---

## License

Business Source License 1.1 — see [LICENSE](LICENSE).
