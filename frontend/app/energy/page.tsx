'use client'

import { useState } from 'react'

import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Loader2,
  Search,
  Upload,
  Zap
} from 'lucide-react'

import type { AIModeCitation, AIModeResponse } from '@/lib/types/documents'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

import { DocumentUpload } from '@/components/document-upload'

// Helper to render answer with clickable inline citations
function CitedAnswer({
  answer,
  citations,
  onCitationClick
}: {
  answer: string
  citations: AIModeCitation[]
  onCitationClick: (citation: AIModeCitation) => void
}) {
  // Parse [N] patterns and replace with clickable elements
  const parts = answer.split(/(\[\d+\])/g)

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      {parts.map((part, index) => {
        const match = part.match(/^\[(\d+)\]$/)
        if (match) {
          const citationNum = parseInt(match[1], 10)
          const citation = citations.find((c) => c.citationNumber === citationNum)
          if (citation) {
            return (
              <button
                key={index}
                onClick={() => onCitationClick(citation)}
                className="mx-0.5 inline-flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-xs font-medium text-primary hover:bg-primary/20"
                title={`${citation.title}${citation.sourceType === 'youtube' ? ' (Video)' : ` (${citation.sourceType.toUpperCase()}, Page ${citation.pageNumber})`}`}
              >
                {citationNum}
              </button>
            )
          }
        }
        return <span key={index}>{part}</span>
      })}
    </div>
  )
}

// Citation card component
function CitationCard({ citation }: { citation: AIModeCitation }) {
  const isYouTube = citation.sourceType === 'youtube'

  const getUrl = () => {
    if (isYouTube && citation.videoId) {
      const time = citation.timestamp || 0
      return `https://youtube.com/watch?v=${citation.videoId}&t=${time}s`
    }
    return citation.deepLink || '#'
  }

  return (
    <a
      href={getUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg border bg-card p-4 transition-colors hover:border-primary/50"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-xs font-medium text-primary">
            {citation.citationNumber}
          </span>
          {isYouTube ? (
            <Zap className="h-4 w-4 text-yellow-500" />
          ) : (
            <FileText className="h-4 w-4 text-blue-500" />
          )}
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <h3 className="mb-1 line-clamp-2 text-sm font-medium">{citation.title}</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        {isYouTube ? (
          <>Video @ {formatTimestamp(citation.timestamp || 0)}</>
        ) : (
          <>
            {citation.sourceType.toUpperCase()} - Page {citation.pageNumber}
          </>
        )}
      </p>
      <p className="line-clamp-3 text-xs text-muted-foreground">
        {citation.snippet}
      </p>
    </a>
  )
}

// Format seconds to MM:SS
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function EnergySearchPage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<AIModeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/energy-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: query.trim() })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Search failed')
      }

      const data: AIModeResponse = await response.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search. Please try again.')
      console.error('Search error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCitationClick = (citation: AIModeCitation) => {
    if (citation.sourceType === 'youtube' && citation.videoId) {
      const time = citation.timestamp || 0
      window.open(
        `https://youtube.com/watch?v=${citation.videoId}&t=${time}s`,
        '_blank'
      )
    } else if (citation.deepLink) {
      window.open(citation.deepLink, '_blank')
    }
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mb-4 flex items-center justify-center gap-2">
          <Zap className="h-8 w-8 text-yellow-500" />
          <h1 className="text-3xl font-bold">Energy Search</h1>
        </div>
        <p className="text-muted-foreground">
          AI-powered search with citations from Spencer&apos;s Limitless Potential
          Technologies videos and documents.
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Ask about pulse motors, Bedini SSG, radiant energy..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
              disabled={loading}
            />
          </div>
          <Button type="submit" disabled={loading || !query.trim()}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              'Search'
            )}
          </Button>
        </div>
      </form>

      {/* Document Upload Section */}
      <div className="mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowUpload(!showUpload)}
          className="mb-4"
        >
          <Upload className="mr-2 h-4 w-4" />
          Upload Document
          {showUpload ? (
            <ChevronUp className="ml-2 h-4 w-4" />
          ) : (
            <ChevronDown className="ml-2 h-4 w-4" />
          )}
        </Button>

        {showUpload && (
          <DocumentUpload
            onUploadComplete={(result) => {
              console.log('Document uploaded:', result)
            }}
          />
        )}
      </div>

      {/* Error State */}
      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="p-4 text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* AI Answer with Inline Citations */}
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 text-lg font-semibold">Answer</h2>
              <CitedAnswer
                answer={result.answer}
                citations={result.citations}
                onCitationClick={handleCitationClick}
              />
            </CardContent>
          </Card>

          {/* Citations Grid */}
          {result.citations.length > 0 && (
            <div>
              <h2 className="mb-4 text-lg font-semibold">Sources</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {result.citations.map((citation) => (
                  <CitationCard key={citation.citationNumber} citation={citation} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!result && !loading && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Zap className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>Enter a question to search Spencer&apos;s video library</p>
            <p className="mt-2 text-sm">
              Try: &quot;What is a pulse motor?&quot; or &quot;How does radiant
              energy work?&quot;
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
