'use client'

import type {
  isDocumentSource,
  isYouTubeSource,
  UnifiedSource} from '@/lib/types/documents'

import { DocumentSourceCard } from './document-source-card'
import { YouTubeSourceCard } from './youtube-source-card'

interface SourceGridProps {
  sources: UnifiedSource[]
}

export function SourceGrid({ sources }: SourceGridProps) {
  if (!sources || sources.length === 0) {
    return null
  }

  // Separate sources by type for potential grouping
  const youtubeSources = sources.filter(
    (s): s is UnifiedSource & { type: 'youtube' } => s.type === 'youtube'
  )
  const documentSources = sources.filter(
    (s): s is UnifiedSource & { type: 'pdf' | 'docx' } =>
      s.type === 'pdf' || s.type === 'docx'
  )

  return (
    <div className="mb-6 space-y-6">
      {/* YouTube Sources */}
      {youtubeSources.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            Video Sources
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {youtubeSources.map((source, index) => (
              <YouTubeSourceCard
                key={`yt-${source.video_id}-${source.timestamp}`}
                source={{
                  title: source.title,
                  url: source.url,
                  video_id: source.video_id,
                  timestamp: source.timestamp,
                  snippet: source.snippet
                }}
                index={index}
              />
            ))}
          </div>
        </div>
      )}

      {/* Document Sources */}
      {documentSources.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            Document Sources
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {documentSources.map((source, index) => (
              <DocumentSourceCard
                key={`doc-${source.document_id}-${source.page_number}`}
                source={{
                  type: source.type,
                  document_id: source.document_id,
                  title: source.title,
                  filename: source.filename,
                  page_number: source.page_number,
                  section_heading: source.section_heading,
                  snippet: source.snippet,
                  deep_link: source.deep_link
                }}
                index={youtubeSources.length + index}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
