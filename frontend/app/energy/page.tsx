'use client'

import { useState } from 'react'

import { Loader2, Search, Zap } from 'lucide-react'

import { YouTubeSourceGrid } from '@/components/youtube-source-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface Source {
  title: string
  url: string
  video_id: string
  timestamp: number
  snippet: string
}

interface SearchResult {
  answer: string
  sources: Source[]
  query: string
}

export default function EnergySearchPage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        throw new Error('Search failed')
      }

      const data = await response.json()
      setResult(data)
    } catch (err) {
      setError('Failed to search. Please try again.')
      console.error('Search error:', err)
    } finally {
      setLoading(false)
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
          Search Spencer&apos;s Limitless Potential Technologies videos for
          answers about pulse motors, radiant energy, and free energy concepts.
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-8">
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

      {/* Error State */}
      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="p-4 text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* YouTube Sources */}
          {result.sources.length > 0 && (
            <YouTubeSourceGrid sources={result.sources} />
          )}

          {/* AI Answer */}
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 text-lg font-semibold">Answer</h2>
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                {result.answer}
              </div>
            </CardContent>
          </Card>
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
