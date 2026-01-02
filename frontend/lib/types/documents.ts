/**
 * Document upload and display types
 */

export interface DocumentUploadResponse {
  success: boolean
  document_id: string
  filename: string
  chunks_created: number
  gcs_uri: string
  error?: string
}

export interface DocumentMetadata {
  document_id: string
  filename: string
  title: string
  source_type: 'pdf' | 'docx'
  page_count: number
  chunk_count: number
  upload_date: string
  gcs_original_uri: string
  gcs_jsonl_uri: string
}

export interface DocumentSource {
  type: 'pdf' | 'docx'
  document_id: string
  title: string
  filename: string
  page_number: number
  section_heading?: string
  snippet: string
  deep_link?: string
}

export interface YouTubeSource {
  type: 'youtube'
  title: string
  url: string
  video_id: string
  timestamp: number
  snippet: string
}

// Union type for all source types
export type UnifiedSource = YouTubeSource | DocumentSource

// Type guard for YouTube sources
export function isYouTubeSource(source: UnifiedSource): source is YouTubeSource {
  return source.type === 'youtube'
}

// Type guard for document sources
export function isDocumentSource(source: UnifiedSource): source is DocumentSource {
  return source.type === 'pdf' || source.type === 'docx'
}
