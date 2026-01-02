"""
Pydantic models for document upload and processing.
"""

from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel


class DocumentChunk(BaseModel):
    """A single chunk of document content for indexing."""
    id: str
    source_type: Literal["pdf", "docx"]
    document_id: str
    title: str
    filename: str
    page_number: int
    section_heading: Optional[str] = None
    chunk_index: int
    content: str


class DocumentUploadResponse(BaseModel):
    """Response from document upload endpoint."""
    success: bool
    document_id: str
    filename: str
    chunks_created: int
    gcs_uri: str
    error: Optional[str] = None


class DocumentMetadata(BaseModel):
    """Document metadata stored in Firestore."""
    document_id: str
    filename: str
    title: str
    source_type: Literal["pdf", "docx"]
    page_count: int
    chunk_count: int
    upload_date: datetime
    gcs_original_uri: str
    gcs_jsonl_uri: str
