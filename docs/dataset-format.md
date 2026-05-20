# Dataset Format Convention

This document defines the on-disk and object-path layout for trainable datasets
stored in Dataset Warehouse. The convention is intentionally close to Hugging
Face dataset repositories while keeping lakeFS as the source of truth for
versions, commits, tags, and rollback.

## Object Path

Each dataset lives at the top level of the lakeFS repository:

```text
<dataset-name>/
```

Example:

```text
events-extraction/
```

With the default repository and branch, the lakeFS URI is:

```text
lakefs://llm-datasets/main/events-extraction/
```

Do not put owners, namespaces, dates, or versions into the object path unless
they are part of the stable dataset identity. Dataset versions are lakeFS
commits and release tags, not `v1/`, `v2/`, or date directories under the
dataset root.

## Directory Layout

Use this layout for a dataset root:

```text
events-extraction/
  README.md
  LICENSE
  manifest.json
  data/
    default/
      train-00000-of-00001.jsonl
      validation-00000-of-00001.jsonl
      test-00000-of-00001.jsonl
```

Required files:

- `README.md`: human-readable dataset card with YAML front matter.
- `manifest.json`: machine-readable Dataset Warehouse manifest validated by
  the service.
- `data/<config-name>/...`: split files used by training and evaluation jobs.

Optional files:

- `LICENSE`: license or internal-use notice.
- Additional docs such as `CITATION.cff`, `CHANGELOG.md`, or schema notes.

## Config Directories

`data/default/` is the default dataset config. This mirrors the Hugging Face
dataset concept of configs or subsets: one dataset can expose several loadable
views under one stable dataset identity.

For a single-shape dataset, use:

```text
data/default/
```

For multiple shapes, add more config directories:

```text
data/
  default/
  instruction/
  dialogue/
  news/
```

Use cases:

| Config | Intended use |
| --- | --- |
| `default` | Canonical labeled rows. |
| `instruction` | Chat or SFT messages derived from the canonical rows. |
| `dialogue` | Dialogue-specific event extraction rows. |
| `news` | News-specific event extraction rows. |

Keep the config name stable once training jobs depend on it.

## Split Files

Use standard split names when possible:

```text
train
validation
test
```

Shard names should be deterministic:

```text
<split>-00000-of-00001.jsonl
<split>-00000-of-00008.parquet
<split>-00001-of-00008.parquet
```

Preferred formats:

| Format | Use when |
| --- | --- |
| `parquet` | Large tabular or nested datasets. This is the default production preference. |
| `jsonl` | Small fixtures, nested text data, or hand-inspectable examples. |
| `csv` | Small flat tables only. |
| WebDataset `.tar` | Large media streams. |

## README Dataset Card

`README.md` should start with YAML front matter. Declare configs explicitly so
humans and tools can map config names to `data_dir` values.

Example:

```markdown
---
license: internal
language:
- en
task_categories:
- token-classification
- text-generation
configs:
- config_name: default
  default: true
  data_dir: data/default
---

# events-extraction

Dataset for extracting structured events from natural-language documents.
```

The README describes purpose, provenance, schema, split policy, license
constraints, and known limitations. It is not the authoritative validation
manifest; that role belongs to `manifest.json`.

## Manifest Contract

Every trainable dataset root must include `manifest.json`. This is the contract
validated by Dataset Warehouse before commit or promotion.

Example for a small JSONL event-extraction dataset:

```json
{
  "dataset_name": "events-extraction",
  "created_at": "2026-05-20T06:12:38Z",
  "format": "jsonl",
  "schema_version": "events-extraction.v0",
  "tokenizer": "none",
  "sample_count": 5,
  "token_count": 0,
  "sources": ["sample"],
  "license_summary": "internal",
  "pipeline": {
    "name": "manual-sample",
    "git_commit": "unknown"
  },
  "shards": [
    {
      "path": "data/default/train-00000-of-00001.jsonl",
      "bytes": 1131,
      "samples": 3,
      "tokens": 0,
      "sha256": "6f79abb854ee984e37d5d853b7e9b561e6ec7e42a8efd08aee06b2067fe0c8c4"
    },
    {
      "path": "data/default/validation-00000-of-00001.jsonl",
      "bytes": 311,
      "samples": 1,
      "tokens": 0,
      "sha256": "a4c778150964d39e6e036c748e37240ccd0363bdd658d6b511b85cde7c59ff3d"
    },
    {
      "path": "data/default/test-00000-of-00001.jsonl",
      "bytes": 464,
      "samples": 1,
      "tokens": 0,
      "sha256": "f5a24aacc3d833d3d8b3cf987bfa66a4b8a34d30e8a71098ee0055d3b4eb3bfd"
    }
  ]
}
```

Validation rules are documented in [Dataset Usage](dataset-usage.md). Important
points:

- `created_at` is a strict UTC ISO 8601 timestamp.
- `shards[].path` is relative to the dataset root and must stay inside it.
- `sample_count` equals the sum of shard sample counts.
- `token_count` equals the sum of shard token counts.
- Declared bytes and sha256 must match object metadata when available.

## Events Extraction Row Shape

The canonical `events-extraction` sample uses one JSON object per line:

```json
{
  "id": "events-extraction-train-000001",
  "text": "Apple announced on Monday that it will acquire PixelWorks for $2.1 billion, with the deal expected to close in July.",
  "events": [
    {
      "event_type": "acquisition",
      "trigger": "acquire",
      "arguments": {
        "acquirer": "Apple",
        "target": "PixelWorks",
        "amount": "$2.1 billion",
        "expected_close_date": "July"
      }
    }
  ]
}
```

Fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable row identifier. |
| `text` | Source text used as model input. |
| `events` | List of normalized event annotations. |
| `events[].event_type` | Normalized event label. |
| `events[].trigger` | Source span or phrase that evokes the event. |
| `events[].arguments` | Event-specific structured argument map. |

Derived training configs can transform this row shape into chat messages or
instruction-following examples, but those derivatives should live in their own
config directory such as `data/instruction/`.

## Training References

Training jobs must not read mutable refs such as `main`, `dev`, `staging`,
`exp/*`, or `pipeline/*`. A trainable reference records a concrete commit:

```yaml
dataset:
  repo: llm-datasets
  ref: "7f23a9d4c0"
  path: "events-extraction"
  manifest: "events-extraction/manifest.json"
  manifest_sha256: "..."
```

Release tags are allowed only after resolving them to commit IDs. This makes a
training run reproducible even if the dataset is later updated.

## Promotion Checklist

Before merging or tagging a dataset:

- The top-level path is the stable dataset name, for example
  `events-extraction/`.
- `README.md` describes purpose, provenance, schema, split policy, license, and
  limitations.
- `manifest.json` passes Dataset Warehouse validation.
- Every shard path in `manifest.json` exists and is checksummed.
- Training jobs reference commit IDs or resolved release tags, not mutable
  branches.
