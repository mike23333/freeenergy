"""
Document Processing Engine
Handles PDF and Word document uploads, parsing, chunking, and storage.
"""

import json
import uuid
import logging
import base64
from typing import List, Optional
from datetime import datetime, timedelta

import google.auth
from google.auth import compute_engine
from google.auth.transport import requests
from google.cloud import storage, firestore

from .config import get_settings
from .parsers import PDFParser, DocxParser
from .models.documents import DocumentUploadResponse, DocumentMetadata

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DocumentEngine:
    """Engine for processing and storing uploaded documents."""

    # Match existing YouTube transcript chunk size
    CHUNK_SIZE = 400

    def __init__(self):
        self.settings = get_settings()
        self.storage_client = storage.Client(project=self.settings.gcp_project_id)
        self.bucket = self.storage_client.bucket(self.settings.gcs_bucket)
        self.db = firestore.Client(project=self.settings.gcp_project_id)

        self.parsers = {
            "pdf": PDFParser(),
            "docx": DocxParser(),
        }

    def get_parser(self, filename: str):
        """Get appropriate parser for file type."""
        ext = filename.lower().split(".")[-1]
        if ext == "pdf":
            return self.parsers["pdf"], "pdf"
        elif ext in ("docx", "doc"):
            return self.parsers["docx"], "docx"
        return None, None

    def chunk_text(self, text: str, page_number: int, section: str) -> List[dict]:
        """
        Split text into chunks of ~400 chars while preserving metadata.

        Args:
            text: Text content to chunk
            page_number: Page number this text came from
            section: Section heading (if any)

        Returns:
            List of chunk dictionaries with metadata
        """
        chunks = []
        words = text.split()
        current_chunk = ""
        chunk_index = 0

        for word in words:
            # Check if adding this word would exceed chunk size
            if len(current_chunk) + len(word) + 1 > self.CHUNK_SIZE:
                if current_chunk:
                    chunks.append({
                        "page_number": page_number,
                        "section_heading": section,
                        "content": current_chunk.strip(),
                        "chunk_index": chunk_index,
                    })
                    chunk_index += 1
                current_chunk = word
            else:
                current_chunk += " " + word if current_chunk else word

        # Don't forget remaining content
        if current_chunk.strip():
            chunks.append({
                "page_number": page_number,
                "section_heading": section,
                "content": current_chunk.strip(),
                "chunk_index": chunk_index,
            })

        return chunks

    def create_jsonl_documents(
        self,
        document_id: str,
        title: str,
        filename: str,
        source_type: str,
        pages: List[tuple],
        gcs_document_url: str,
    ) -> List[dict]:
        """
        Create JSONL documents for Vertex AI Search.

        Args:
            document_id: Unique document identifier
            title: Document title
            filename: Original filename
            source_type: 'pdf' or 'docx'
            pages: List of (page_number, section_heading, text_content) tuples
            gcs_document_url: GCS URI for the original document

        Returns:
            List of JSONL document dictionaries
        """
        documents = []
        global_chunk_index = 0

        for page_number, section_heading, text in pages:
            chunks = self.chunk_text(text, page_number, section_heading)

            for chunk in chunks:
                # Base64 encode the content for Vertex AI Search
                content_bytes = chunk["content"].encode("utf-8")
                content_b64 = base64.b64encode(content_bytes).decode("utf-8")

                doc = {
                    "id": f"doc_{document_id}_{global_chunk_index}",
                    "structData": {
                        "source_type": source_type,
                        "document_id": document_id,
                        "title": title,
                        "filename": filename,
                        "page_number": chunk["page_number"],
                        "section_heading": chunk["section_heading"] or "",
                        "chunk_index": global_chunk_index,
                        "document_url": gcs_document_url,
                        # Include content in structData for standard edition (no extractive content)
                        "transcript": chunk["content"],
                    },
                    "content": {
                        "mimeType": "text/plain",
                        "rawBytes": content_b64,
                    },
                }
                documents.append(doc)
                global_chunk_index += 1

        return documents

    def upload_original_to_gcs(
        self, document_id: str, filename: str, content: bytes
    ) -> str:
        """
        Upload original document to GCS.

        Args:
            document_id: Unique document identifier
            filename: Original filename
            content: Raw file bytes

        Returns:
            GCS URI for the uploaded file
        """
        blob_path = f"{self.settings.documents_prefix}/originals/{document_id}/{filename}"
        blob = self.bucket.blob(blob_path)

        # Determine content type
        if filename.lower().endswith(".pdf"):
            content_type = "application/pdf"
        else:
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        blob.upload_from_string(content, content_type=content_type)

        gcs_uri = f"gs://{self.settings.gcs_bucket}/{blob_path}"
        logger.info(f"Uploaded original document to {gcs_uri}")
        return gcs_uri

    def upload_jsonl_to_gcs(self, document_id: str, documents: List[dict]) -> str:
        """
        Upload JSONL documents to GCS for Vertex AI Search.

        Args:
            document_id: Unique document identifier
            documents: List of JSONL document dictionaries

        Returns:
            GCS URI for the uploaded JSONL file
        """
        blob_path = f"{self.settings.documents_prefix}/jsonl/{document_id}.jsonl"
        blob = self.bucket.blob(blob_path)

        jsonl_content = "\n".join(json.dumps(doc) for doc in documents)
        blob.upload_from_string(jsonl_content, content_type="application/jsonl")

        gcs_uri = f"gs://{self.settings.gcs_bucket}/{blob_path}"
        logger.info(f"Uploaded JSONL to {gcs_uri}")
        return gcs_uri

    def save_document_metadata(self, metadata: DocumentMetadata):
        """Save document metadata to Firestore."""
        doc_ref = self.db.collection("documents").document(metadata.document_id)
        doc_ref.set(metadata.model_dump(mode="json"))
        logger.info(f"Saved metadata for document {metadata.document_id}")

    def get_document_metadata(self, document_id: str) -> Optional[dict]:
        """Get document metadata from Firestore."""
        doc_ref = self.db.collection("documents").document(document_id)
        doc = doc_ref.get()
        if doc.exists:
            return doc.to_dict()
        return None

    def generate_signed_url(
        self, document_id: str, page_number: Optional[int] = None, expiration_minutes: int = 60
    ) -> Optional[str]:
        """
        Generate a signed URL for viewing a document.

        Args:
            document_id: Document identifier
            page_number: Optional page number for PDF deep-linking
            expiration_minutes: URL expiration time in minutes

        Returns:
            Signed URL with optional #page=N fragment, or None if document not found
        """
        metadata = self.get_document_metadata(document_id)
        if not metadata:
            return None

        # Extract blob path from GCS URI
        gcs_uri = metadata.get("gcs_original_uri", "")
        if not gcs_uri.startswith("gs://"):
            return None

        # Parse gs://bucket/path format
        path_part = gcs_uri.replace(f"gs://{self.settings.gcs_bucket}/", "")
        blob = self.bucket.blob(path_part)

        try:
            # Get credentials
            credentials, project = google.auth.default()

            # If running on Cloud Run/GCE, use impersonated credentials for signing
            if isinstance(credentials, compute_engine.Credentials):
                from google.auth import impersonated_credentials
                from google.auth.transport import requests as auth_requests

                # Refresh to get service account email
                auth_request = auth_requests.Request()
                credentials.refresh(auth_request)
                sa_email = credentials.service_account_email

                # Create impersonated credentials that can sign
                # This uses IAM SignBlob API behind the scenes
                signing_credentials = impersonated_credentials.Credentials(
                    source_credentials=credentials,
                    target_principal=sa_email,
                    target_scopes=["https://www.googleapis.com/auth/devstorage.read_only"],
                )

                # Generate signed URL with impersonated credentials
                url = blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(minutes=expiration_minutes),
                    method="GET",
                    credentials=signing_credentials,
                )
            else:
                # Local development with service account key
                url = blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(minutes=expiration_minutes),
                    method="GET",
                )

            # Add page fragment for PDFs
            if page_number and metadata.get("source_type") == "pdf":
                url = f"{url}#page={page_number}"

            return url

        except Exception as e:
            logger.error(f"Error generating signed URL: {e}")
            raise

    def process_document(
        self, file_content: bytes, filename: str, title: Optional[str] = None
    ) -> DocumentUploadResponse:
        """
        Main entry point: process and upload a document.

        Args:
            file_content: Raw file bytes
            filename: Original filename
            title: Optional document title (defaults to filename without extension)

        Returns:
            DocumentUploadResponse with success status and details
        """
        parser, source_type = self.get_parser(filename)

        if not parser:
            return DocumentUploadResponse(
                success=False,
                document_id="",
                filename=filename,
                chunks_created=0,
                gcs_uri="",
                error=f"Unsupported file type: {filename}. Supported: PDF, DOCX",
            )

        document_id = str(uuid.uuid4())
        doc_title = title or filename.rsplit(".", 1)[0]

        try:
            # Parse document
            logger.info(f"Parsing {filename} as {source_type}")
            pages = parser.parse(file_content, filename)
            page_count = parser.get_page_count(file_content)

            if not pages:
                return DocumentUploadResponse(
                    success=False,
                    document_id=document_id,
                    filename=filename,
                    chunks_created=0,
                    gcs_uri="",
                    error="No text content could be extracted from the document",
                )

            # Upload original document
            gcs_document_url = self.upload_original_to_gcs(
                document_id, filename, file_content
            )

            # Create JSONL chunks
            jsonl_docs = self.create_jsonl_documents(
                document_id, doc_title, filename, source_type, pages, gcs_document_url
            )

            # Upload JSONL
            gcs_jsonl_uri = self.upload_jsonl_to_gcs(document_id, jsonl_docs)

            # Save metadata
            self.save_document_metadata(
                DocumentMetadata(
                    document_id=document_id,
                    filename=filename,
                    title=doc_title,
                    source_type=source_type,
                    page_count=page_count,
                    chunk_count=len(jsonl_docs),
                    upload_date=datetime.utcnow(),
                    gcs_original_uri=gcs_document_url,
                    gcs_jsonl_uri=gcs_jsonl_uri,
                )
            )

            logger.info(
                f"Successfully processed {filename}: {len(jsonl_docs)} chunks created"
            )

            return DocumentUploadResponse(
                success=True,
                document_id=document_id,
                filename=filename,
                chunks_created=len(jsonl_docs),
                gcs_uri=gcs_jsonl_uri,
            )

        except Exception as e:
            logger.error(f"Error processing document {filename}: {e}")
            return DocumentUploadResponse(
                success=False,
                document_id=document_id,
                filename=filename,
                chunks_created=0,
                gcs_uri="",
                error=str(e),
            )

    def list_documents(self, limit: int = 20) -> List[dict]:
        """List uploaded documents from Firestore."""
        docs = (
            self.db.collection("documents")
            .order_by("upload_date", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        return [doc.to_dict() for doc in docs]
