"""
PDF document parser using PyPDF2.
Extracts text with page numbers for deep-linking.
"""

from typing import List, Tuple
from io import BytesIO

from PyPDF2 import PdfReader


class PDFParser:
    """Parse PDF documents and extract text with page information."""

    def parse(self, file_content: bytes, filename: str) -> List[Tuple[int, str, str]]:
        """
        Parse PDF and extract text with page numbers.

        Args:
            file_content: Raw PDF file bytes
            filename: Original filename (for logging)

        Returns:
            List of tuples: (page_number, section_heading, text_content)
            Note: section_heading is empty for PDFs as we can't reliably detect headings
        """
        reader = PdfReader(BytesIO(file_content))
        pages = []

        for page_num, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            text = text.strip()

            if text:  # Only include pages with content
                pages.append((page_num, "", text))

        return pages

    def get_page_count(self, file_content: bytes) -> int:
        """Return total page count of the PDF."""
        reader = PdfReader(BytesIO(file_content))
        return len(reader.pages)
