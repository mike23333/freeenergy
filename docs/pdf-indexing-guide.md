# PDF Document Indexing Guide

**Date:** January 7, 2026
**Status:** Production

---

## Overview

This guide documents the process for making PDF documents searchable in the Energy Search AI platform using Vertex AI Search.

---

## Architecture

```
PDF Upload Flow:
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   PDF File   │ ──▶ │   Backend    │ ──▶ │     GCS      │ ──▶ │ Vertex AI    │
│              │     │   Parsing    │     │   Storage    │     │   Search     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Firestore   │
                     │  (Metadata)  │
                     └──────────────┘
```

---

## Step-by-Step Process

### 1. PDF Parsing & Chunking (Backend)

The backend (`backend/app/document_engine.py`) handles:

1. **Parse PDF** using PyPDF2 to extract text from each page
2. **Chunk text** into ~400 character segments (matching YouTube transcript chunks)
3. **Create metadata** for each chunk: page number, document ID, title

```python
# Chunk configuration
CHUNK_SIZE = 400  # Characters per chunk
```

### 2. Upload to Google Cloud Storage

Three items are uploaded to GCS:

| Item | Location | Purpose |
|------|----------|---------|
| Original PDF | `gs://spencer-knowledge-vault/documents/originals/{doc_id}/{filename}` | Viewing via signed URL |
| Chunk .txt files | `gs://spencer-knowledge-vault/documents/chunks/doc_{doc_id}_{index}.txt` | Content for Vertex AI |
| JSONL index | `gs://spencer-knowledge-vault/transcripts/{name}.jsonl` | Document metadata |

### 3. JSONL Format (Critical)

Each chunk must follow this exact format to be searchable:

```json
{
  "id": "doc_{document_id}_{chunk_index}",
  "structData": {
    "source_type": "pdf",
    "document_id": "{document_id}",
    "title": "Document Title",
    "filename": "original-filename.pdf",
    "page_number": 1,
    "section_heading": "",
    "chunk_index": 0,
    "document_url": "gs://spencer-knowledge-vault/documents/originals/{doc_id}/{filename}",
    "transcript": "The actual text content of this chunk..."
  },
  "content": {
    "mimeType": "text/plain",
    "uri": "gs://spencer-knowledge-vault/documents/chunks/doc_{document_id}_{chunk_index}.txt"
  }
}
```

**Key Fields:**
- `id`: Unique identifier for the chunk
- `structData.transcript`: The searchable text content
- `structData.document_id`: Must match Firestore document ID for signed URL generation
- `content.uri`: Points to the .txt file containing the chunk content

### 4. Save Metadata to Firestore

Document metadata is stored in Firestore for signed URL generation:

```python
# Collection: "documents"
{
    "document_id": "uuid",
    "filename": "original.pdf",
    "title": "Document Title",
    "source_type": "pdf",
    "page_count": 8,
    "chunk_count": 69,
    "upload_date": "2026-01-07T...",
    "gcs_original_uri": "gs://bucket/documents/originals/...",
    "gcs_jsonl_uri": "gs://bucket/documents/jsonl/..."
}
```

### 5. Import to Vertex AI Search

Trigger the import via REST API:

```bash
curl -X POST \
  "https://discoveryengine.googleapis.com/v1/projects/{PROJECT_ID}/locations/global/collections/default_collection/dataStores/{DATASTORE_ID}/branches/default_branch/documents:import" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "gcsSource": {
      "inputUris": ["gs://spencer-knowledge-vault/transcripts/*.jsonl"],
      "dataSchema": "document"
    },
    "reconciliationMode": "INCREMENTAL"
  }'
```

**Reconciliation Modes:**
- `INCREMENTAL`: Adds new documents, updates existing (recommended for adding new PDFs)
- `FULL`: Replaces all documents (use when restructuring)

---

## PDF Citation Deep-Linking

When a user clicks a PDF citation, the system:

1. **Frontend** requests signed URL from backend with page number
2. **Backend** looks up document in Firestore by `document_id`
3. **Backend** generates signed URL for the original PDF in GCS
4. **Backend** appends `#page=N` fragment for deep-linking
5. **Browser** opens PDF directly to the cited page

```
GET /documents/{document_id}/signed-url?page=4

Response:
{
  "url": "https://storage.googleapis.com/...#page=4",
  "expires_in_minutes": 60
}
```

---

## Troubleshooting

### Issue: PDF not appearing in search results

**Cause:** Document not imported to Vertex AI Search datastore

**Solution:** Trigger import via API:
```bash
curl -X POST ".../documents:import" \
  -d '{"gcsSource": {"inputUris": ["gs://bucket/transcripts/*.jsonl"]}}'
```

### Issue: Citation link doesn't open PDF

**Cause:** `document_id` in search results doesn't match Firestore

**Solution:** Ensure JSONL `structData.document_id` matches Firestore document ID

### Issue: PDF opens but not to correct page

**Cause:** `#page=N` fragment not being added

**Solution:** Check backend `generate_signed_url()` is appending page fragment

---

## File Locations

| Component | Path |
|-----------|------|
| Document Engine | `backend/app/document_engine.py` |
| PDF Parser | `backend/app/parsers/pdf_parser.py` |
| Vertex Provider | `frontend/lib/tools/search/providers/vertex.ts` |
| Search Results | `frontend/components/search-results.tsx` |
| Document Source Card | `frontend/components/document-source-card.tsx` |
| Source Grid | `frontend/components/source-grid.tsx` |
| Upload Endpoint | `POST /documents/upload` |
| Signed URL Endpoint | `GET /documents/{id}/signed-url` |

---

## Configuration

### Environment Variables

```bash
# GCP Project
GCP_PROJECT_ID=bedini-answer-bot

# Storage
GCS_BUCKET=spencer-knowledge-vault
DOCUMENTS_PREFIX=documents

# Vertex AI Search
VERTEX_AI_ENGINE_ID=bedini-search-app
VERTEX_AI_DATASTORE_ID=spencer-transcripts
VERTEX_AI_LOCATION=global
```

### GCS Bucket Structure

```
gs://spencer-knowledge-vault/
├── documents/
│   ├── originals/
│   │   └── {document_id}/
│   │       └── {filename}.pdf
│   ├── chunks/
│   │   └── doc_{document_id}_{index}.txt
│   └── jsonl/
│       └── {document_id}.jsonl
└── transcripts/
    ├── {video_id}.jsonl
    ├── {video_id}_{timestamp}.txt
    └── spencer-transcripts-v2.jsonl  (master file)
```

---

## Adding a New PDF

### Via UI (Frontend)
1. Go to `/energy` page
2. Use document upload component
3. Wait for processing to complete
4. Trigger Vertex AI import (see below)

### Via CLI
```bash
# 1. Upload PDF via backend API
curl -X POST "https://energy-search-backend.../documents/upload" \
  -F "file=@document.pdf" \
  -F "title=Document Title"

# 2. Copy JSONL to transcripts folder (for unified search)
gsutil cp gs://spencer-knowledge-vault/documents/jsonl/{doc_id}.jsonl \
          gs://spencer-knowledge-vault/transcripts/{name}.jsonl

# 3. Trigger Vertex AI import
curl -X POST ".../documents:import" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -d '{
    "gcsSource": {"inputUris": ["gs://spencer-knowledge-vault/transcripts/*.jsonl"]},
    "reconciliationMode": "INCREMENTAL"
  }'
```

---

## Example: Pete Radatti PDF

Successfully indexed PDF from USPA Masterclass 40:

| Property | Value |
|----------|-------|
| Document ID | `ded59b01-3f85-4571-8f46-da421394a632` |
| Title | Pete Radatti - Radionics Q&A from USPA Masterclass 40 (April 2023) |
| Pages | 8 |
| Chunks Created | 69 |
| Original PDF | `gs://spencer-knowledge-vault/documents/originals/ded59b01.../` |
| JSONL | `gs://spencer-knowledge-vault/transcripts/spencer-transcripts-v2.jsonl` |

**Sample Searchable Topics:**
- Potentizing water and media
- Witness usage (photos as witnesses)
- Reverse phase techniques
- Cold scanning vs rate lookup
- GV (General Vitality) interpretation
- Cell phone radionic broadcasting
- IF and LOOP programming statements

---

## References

- [Vertex AI Search - Prepare Data](https://docs.cloud.google.com/generative-ai-app-builder/docs/prepare-data)
- [Vertex AI Search - Refresh Data](https://docs.cloud.google.com/generative-ai-app-builder/docs/refresh-data)
- [Parse and Chunk Documents](https://docs.cloud.google.com/generative-ai-app-builder/docs/parse-chunk-documents)
