# Psychotronics Research Vault - Architecture Analysis

**Date:** January 6, 2026
**Status:** Analysis & Recommendations

---

## Executive Summary

This document analyzes the proposed "Psychotronics Research Vault" architecture using Vertex AI Vision Warehouse and Vertex AI Search Enterprise Edition, comparing it against the current implementation and identifying issues, limitations, and recommendations.

---

## Current System Architecture

The existing `bedini-answer-bot` system is well-architected:

| Component | Technology | Status |
|-----------|------------|--------|
| Search Engine | Vertex AI Discovery Engine | Production |
| YouTube Transcripts | `youtube-transcript-api` | Production |
| Document Parsing | PyPDF2 / python-docx | Production |
| Answer Generation | Gemini 2.0 Flash | Production |
| Storage | `gs://spencer-knowledge-vault/` | Production |
| Database | Firestore | Production |

**Data Flow:**
1. YouTube videos → Caption extraction → JSONL chunks → Vertex AI Search
2. PDF/Word docs → Text extraction → JSONL chunks → Vertex AI Search
3. User query → Vertex AI Search → Gemini answer generation → Response with sources

---

## Proposed Architecture Analysis

### The Proposal

1. **Video Setup:** Vertex AI Vision Warehouse with Speech-to-Text and Visual Analysis toggles
2. **PDF Setup:** Vertex AI Unstructured Search with Gemini Layout Parser
3. **Search:** Blended Search App combining both data sources

### Issue #1: Vision Warehouse ≠ Automatic Speech-to-Text

**Claim:** Vision Warehouse has a simple "Speech-to-Text toggle" that indexes everything said in videos.

**Reality:**
- Vision Warehouse focuses on **visual analysis** (object detection, person detection, OCR on screens)
- Speech-to-Text is a **separate Google Cloud service** requiring explicit integration
- There's no built-in "toggle" that automatically transcribes all audio content for semantic search

**What's Required:**
1. Run videos through Speech-to-Text API separately
2. Store transcriptions as annotations in Vision Warehouse
3. Build custom integration between STT output and Vision Warehouse search

**Verdict:** The current approach using `youtube-transcript-api` for YouTube captions is more practical.

**Reference:** [Vision Warehouse Overview](https://docs.cloud.google.com/vision-ai/docs/warehouse-overview)

---

### Issue #2: Blended Search Limitations

**Claim:** Query videos + PDFs together with natural language like *"Show me the video where Bedini demonstrates the circuit from page 40."*

**Reality:**
- Vertex AI Search **does support blended search** across multiple data stores
- However, **Vision Warehouse and Vertex AI Search are separate products** - they don't automatically blend
- Media data stores in Vertex AI Search use **structured metadata** (title, URI, duration, categories) - not raw video analysis
- Cannot simply "blend" Vision Warehouse visual analysis with PDF layout parsing in one query

**Current System Advantage:** Already blends YouTube transcripts + documents in a single Vertex AI Search datastore.

**Reference:** [About apps and data stores](https://docs.cloud.google.com/generative-ai-app-builder/docs/create-datastore-ingest)

---

### Issue #3: JSON Configuration Has Multiple Errors

**Proposed Configuration (WITH ERRORS MARKED):**
```json
{
  "documentProcessingConfig": {
    "defaultParsingConfig": {
      "layoutParsingConfig": {
        "enable_gemini_enhancement": true   // ❌ NOT AN API FIELD
      }
    },
    "chunkingConfig": {
      "layout_based_chunking_config": {     // ❌ WRONG: should be camelCase
        "chunk_size": 1024,                 // ❌ WRONG: max is 500
        "include_ancestor_headings": true   // ❌ WRONG: should be camelCase
      }
    }
  }
}
```

**Correct Configuration:**
```json
{
  "documentProcessingConfig": {
    "defaultParsingConfig": {
      "layoutParsingConfig": {}
    },
    "chunkingConfig": {
      "layoutBasedChunkingConfig": {
        "chunkSize": 500,
        "includeAncestorHeadings": true
      }
    }
  }
}
```

**Field-by-Field Analysis:**

| Their Claim | Reality | Verdict |
|-------------|---------|---------|
| `enable_gemini_enhancement` in JSON | **Console-only toggle**, not an API field | ❌ Wrong |
| `chunk_size: 1024` | Max is **500 characters** (valid range: 100-500) | ❌ Wrong |
| `include_ancestor_headings` | Correct concept, wrong case: `includeAncestorHeadings` | ⚠️ Wrong case |
| `layout_based_chunking_config` | Wrong case: `layoutBasedChunkingConfig` | ⚠️ Wrong case |
| Layout parser exists | True - supports PDF, HTML, DOCX, PPTX, XLSX | ✓ True |
| Gemini enhancement exists | True - but **Public Preview** and **Console toggle only** | ✓ True |

**Key Corrections:**

1. **Gemini Enhancement** - Cannot be set via JSON/API. Must enable in Google Cloud Console:
   - Navigate to: Data Store > Document processing options > Layout parser settings
   - Check: "Enable Gemini enhancement"

2. **Chunk Size** - Maximum is 500 characters, not 1024. Default is 500.

3. **Field Names** - Google APIs use camelCase (`chunkSize`, `includeAncestorHeadings`, `layoutBasedChunkingConfig`), not snake_case.

4. **layoutParsingConfig** - The object itself is empty `{}`. Additional options are for HTML filtering only:
   - `excludeHtmlElements`
   - `excludeHtmlClasses`
   - `excludeHtmlIds`

**Console Path:** Document processing options > Layout parser settings > Enable Gemini enhancement

**Reference:** [Parse and chunk documents](https://docs.cloud.google.com/generative-ai-app-builder/docs/parse-chunk-documents)

---

### Issue #4: Video Format Reality Check

**Claim:** Upload raw .mp4 or .mov to Vision Warehouse for automatic indexing of technical content.

**Reality:**
- Vision Warehouse batch video is designed for **surveillance/security footage** and **retail analytics**
- Indexes **visual objects** (people, vehicles, PPE, occupancy) not circuit diagrams semantically
- For technical workshop videos: Returns "person detected at 00:05:23" not "SSG circuit explanation at 00:05:23"

**Better Approaches for Technical Video Content:**
1. Keep using YouTube captions (current approach)
2. For non-YouTube videos: Use Gemini 1.5 Pro's native video understanding (128k context window)
3. Index generated transcripts/summaries in Vertex AI Search

---

### Issue #5: Photo Comparison Use Case is Overpromised

**Claim:**
> "Take a photo of a circuit you just built and ask: 'Did I get the diode polarity right on the 3rd coil?' The AI will search Vision Warehouse, find the PDF diagram, compare both..."

**Reality:**
This requires **multimodal RAG with image reasoning**, not just search configuration:

1. Custom embedding pipeline for circuit diagrams
2. Multimodal embedding model integration
3. Custom application logic for orchestration
4. Image-to-image comparison logic

**Feasibility:** Achievable but requires significant custom development beyond "toggling settings."

**Reference:** [Multimodal embeddings](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings)

---

## Feature Comparison: Claimed vs. Reality

| Claim | Reality | Status |
|-------|---------|--------|
| Vision Warehouse transcribes videos automatically | Requires separate STT integration | ❌ False |
| Blended search across videos + PDFs | Requires same datastore type or custom orchestration | ⚠️ Partial |
| Toggle Speech-to-Text in console | Not a simple toggle for semantic search | ❌ False |
| Layout parser preserves heading ancestry | True - use `includeAncestorHeadings` | ✓ True |
| Gemini enhancement for diagrams | True but Console-only, not API field | ✓ True |
| Compare photo to indexed diagrams | Possible but requires custom development | ⚠️ Partial |
| `enable_gemini_enhancement` JSON field | Does not exist - Console toggle only | ❌ False |
| `chunk_size: 1024` | Max chunk size is 500 characters | ❌ False |
| JSON uses snake_case fields | Google API uses camelCase | ❌ False |

---

## Recommendations

### Keep Current Implementation

| Component | Current Approach | Recommendation |
|-----------|------------------|----------------|
| YouTube transcripts | `youtube-transcript-api` | ✓ Keep - works well |
| PDF parsing | PyPDF2 + chunking | Upgrade to layout parser |
| Search | Vertex AI Discovery Engine | ✓ Keep |
| Answer generation | Gemini 2.0 Flash | ✓ Keep |

### Recommended Upgrades

#### 1. Enable Layout Parser with Gemini Enhancement

Update data store configuration for better PDF processing:

**API Configuration:**
```json
{
  "documentProcessingConfig": {
    "defaultParsingConfig": {
      "layoutParsingConfig": {}
    },
    "chunkingConfig": {
      "layoutBasedChunkingConfig": {
        "chunkSize": 500,
        "includeAncestorHeadings": true
      }
    }
  }
}
```

**Console Steps for Gemini Enhancement:**
1. Navigate to: Vertex AI Search > Data Stores > [Your Data Store]
2. Go to: Document processing options > Layout parser settings
3. Enable: "Gemini enhancement" checkbox (Public Preview)

**Benefits:**
- Better table recognition in circuit schematics
- Improved reading order for multi-column layouts
- Heading ancestry preserved in chunks
- Gemini-powered diagram understanding (when enabled via Console)

#### 2. Enable Enterprise Edition + Advanced LLM Features

**Features Unlocked:**
- Multi-step queries
- Related questions
- Query simplification
- Better summarization
- Multimodal answers (images/charts in responses)

**Console Path:** Vertex AI Search > App Settings > Enterprise Edition > Enable

**Reference:** [About advanced features](https://docs.cloud.google.com/generative-ai-app-builder/docs/about-advanced-features)

#### 3. Non-YouTube Video Processing

For workshop videos not on YouTube:

```python
# Use Gemini 1.5 Pro for video understanding
import vertexai
from vertexai.generative_models import GenerativeModel, Part

model = GenerativeModel("gemini-1.5-pro")
video = Part.from_uri("gs://bucket/video.mp4", mime_type="video/mp4")

response = model.generate_content([
    video,
    "Generate a detailed transcript with timestamps for this technical workshop video."
])
```

Then index the generated transcript in Vertex AI Search.

#### 4. Future: Circuit Diagram Search (Custom Development)

For image-based circuit comparison:

1. Build multimodal embedding index using Vertex AI Multimodal Embeddings API
2. Create custom retrieval pipeline
3. Integrate with Gemini for reasoning/comparison

**Estimated Complexity:** High - requires custom ML pipeline

---

## Architecture Decision

### Recommended: Enhance Current System

```
┌─────────────────────────────────────────────────────────────────┐
│                    Enhanced Architecture                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   YouTube    │    │  PDF/Word    │    │ Non-YT Video │      │
│  │   Videos     │    │  Documents   │    │   Files      │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Transcript  │    │Layout Parser │    │ Gemini 1.5   │      │
│  │     API      │    │ + Gemini     │    │  Pro Video   │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         └───────────────────┼───────────────────┘               │
│                             ▼                                   │
│                 ┌───────────────────────┐                       │
│                 │   Vertex AI Search    │                       │
│                 │   (Enterprise + LLM)  │                       │
│                 │   Unified Data Store  │                       │
│                 └───────────┬───────────┘                       │
│                             │                                   │
│                             ▼                                   │
│                 ┌───────────────────────┐                       │
│                 │   Gemini 2.0 Flash    │                       │
│                 │  Answer Generation    │                       │
│                 └───────────────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Not Recommended: Vision Warehouse Approach

- Adds complexity without clear benefits for technical content
- Designed for surveillance/retail, not educational/technical videos
- Requires custom STT integration that current system already handles
- Blending limitations make unified search more difficult

---

## References

- [Vertex AI Search Documentation](https://docs.cloud.google.com/generative-ai-app-builder/docs)
- [Vision Warehouse Overview](https://docs.cloud.google.com/vision-ai/docs/warehouse-overview)
- [Parse and chunk documents](https://docs.cloud.google.com/generative-ai-app-builder/docs/parse-chunk-documents)
- [About advanced features](https://docs.cloud.google.com/generative-ai-app-builder/docs/about-advanced-features)
- [Introduction to media search](https://docs.cloud.google.com/generative-ai-app-builder/docs/about-media)
- [Multimodal embeddings](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings)
- [Blended Search GitHub Example](https://github.com/GoogleCloudPlatform/generative-ai/blob/main/search/search_data_blending_with_gemini_summarization.ipynb)

---

## Conclusion

The proposed "Vision Warehouse + Blended Search" architecture overpromises on capabilities that either don't exist as described or require significant custom development. The current system architecture is sound and should be enhanced with:

1. Layout parser with Gemini enhancement for PDFs
2. Enterprise Edition features for advanced search
3. Gemini 1.5 Pro for non-YouTube video processing

These incremental improvements will deliver better results with less complexity than a full architectural overhaul.




what do change with our system


Use vertex search AI mode instead of gemini and maybe make the design look like ai mode in google search. **Console Path:** Vertex AI Search > App Settings > Enterprise Edition > Enable



Vertex AI Search "AI Mode" (Generative Answers)


1. **Gemini Enhancement** - Cannot be set via JSON/API. Must enable in Google Cloud Console:
   - Navigate to: Data Store > Document processing options > Layout parser settings
   - Check: "Enable Gemini enhancement"

2. **Chunk Size** - Maximum is 500 characters, not 1024. Default is 500.

3. **Field Names** - Google APIs use camelCase (`chunkSize`, `includeAncestorHeadings`, `layoutBasedChunkingConfig`), not snake_case.

4. **layoutParsingConfig** - The object itself is empty `{}`. Additional options are for HTML filtering only:
   - `excludeHtmlElements`
   - `excludeHtmlClasses`
   - `excludeHtmlIds`

**Console Path:** Document processing options > Layout parser settings > Enable Gemini enhancement

**Reference:** [Parse and chunk documents](https://docs.cloud.google.com/generative-ai-app-builder/docs/parse-chunk-documents)

| Layout parser preserves heading ancestry | True - use `includeAncestorHeadings` | ✓ True |


#### 1. Enable Layout Parser with Gemini Enhancement

Update data store configuration for better PDF processing:

**API Configuration:**
```json
{
  "documentProcessingConfig": {
    "defaultParsingConfig": {
      "layoutParsingConfig": {}
    },
    "chunkingConfig": {
      "layoutBasedChunkingConfig": {
        "chunkSize": 500,
        "includeAncestorHeadings": true
      }
    }
  }
}
```

**Console Steps for Gemini Enhancement:**
1. Navigate to: Vertex AI Search > Data Stores > [Your Data Store]
2. Go to: Document processing options > Layout parser settings
3. Enable: "Gemini enhancement" checkbox (Public Preview)

**Benefits:**
- Better table recognition in circuit schematics
- Improved reading order for multi-column layouts
- Heading ancestry preserved in chunks
- Gemini-powered diagram understanding (when enabled via Console)