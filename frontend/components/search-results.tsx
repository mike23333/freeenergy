'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FileText, FileIcon, Play } from 'lucide-react'

import { SearchResultItem } from '@/lib/types'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export interface SearchResultsProps {
  results: SearchResultItem[]
  displayMode?: 'grid' | 'list'
}

// Safe URL parser that handles empty/invalid URLs
function safeUrl(url: string): URL | null {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function getHostname(url: string): string {
  const parsed = safeUrl(url)
  return parsed?.hostname || 'document'
}

// Check if result is a document source
function isDocumentSource(result: SearchResultItem): boolean {
  return result.source_type === 'pdf' || result.source_type === 'docx'
}

// Check if result is a YouTube source
function isYouTubeSource(result: SearchResultItem): boolean {
  return !!result.video_id
}

// Get icon for result type
function ResultIcon({ result }: { result: SearchResultItem }) {
  if (result.source_type === 'pdf') {
    return (
      <div className="h-4 w-4 flex items-center justify-center bg-red-100 dark:bg-red-900/30 rounded">
        <FileText className="h-3 w-3 text-red-600 dark:text-red-400" />
      </div>
    )
  }
  if (result.source_type === 'docx') {
    return (
      <div className="h-4 w-4 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 rounded">
        <FileIcon className="h-3 w-3 text-blue-600 dark:text-blue-400" />
      </div>
    )
  }
  if (result.video_id) {
    return (
      <div className="h-4 w-4 flex items-center justify-center bg-red-100 dark:bg-red-900/30 rounded">
        <Play className="h-3 w-3 text-red-600 dark:text-red-400" />
      </div>
    )
  }
  return (
    <Avatar className="h-4 w-4">
      <AvatarImage
        src={`https://www.google.com/s2/favicons?domain=${getHostname(result.url)}`}
        alt={getHostname(result.url)}
      />
      <AvatarFallback className="text-xs">
        {result.url ? getHostname(result.url)[0] : 'D'}
      </AvatarFallback>
    </Avatar>
  )
}

// Get display label for result
function getResultLabel(result: SearchResultItem, index: number): string {
  if (result.source_type === 'pdf') {
    return `PDF - Page ${result.page_number || 1}`
  }
  if (result.source_type === 'docx') {
    return `Word - Page ${result.page_number || 1}`
  }
  if (result.video_id) {
    const timestamp = result.timestamp_start || 0
    const mins = Math.floor(timestamp / 60)
    const secs = timestamp % 60
    return `Video - ${mins}:${secs.toString().padStart(2, '0')}`
  }
  return `${getHostname(result.url)} - ${index + 1}`
}

// Document card with signed URL fetching
function DocumentResultCard({
  result,
  index,
  displayMode
}: {
  result: SearchResultItem
  index: number
  displayMode: 'grid' | 'list'
}) {
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // Fetch signed URL from backend
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://energy-search-backend-1045208302994.us-central1.run.app'
      const response = await fetch(
        `${backendUrl}/documents/${result.document_id}/signed-url?page=${result.page_number || 1}`
      )

      if (response.ok) {
        const data = await response.json()
        window.open(data.url, '_blank')
      } else {
        console.error('Failed to get signed URL')
      }
    } catch (error) {
      console.error('Error fetching signed URL:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (displayMode === 'list') {
    return (
      <Card
        className={`w-full hover:bg-muted/50 transition-colors cursor-pointer ${isLoading ? 'opacity-50' : ''}`}
        onClick={handleClick}
      >
        <CardContent className="p-2 flex items-start space-x-2">
          <div className="mt-1 flex-shrink-0">
            <ResultIcon result={result} />
          </div>
          <div className="flex-grow overflow-hidden space-y-0.5">
            <p className="text-sm font-medium line-clamp-1">
              {result.title}
              {result.section_heading && (
                <span className="text-muted-foreground"> - {result.section_heading}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {result.content}
            </p>
            <div className="text-xs text-muted-foreground/80 mt-1">
              {getResultLabel(result, index)}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Grid mode
  return (
    <Card
      className={`flex-1 h-full hover:bg-muted/50 transition-colors cursor-pointer ${isLoading ? 'opacity-50' : ''}`}
      onClick={handleClick}
    >
      <CardContent className="p-2 flex flex-col justify-between h-full">
        <p className="text-xs line-clamp-2 min-h-[2rem]">
          {result.title}
        </p>
        <div className="mt-2 flex items-center space-x-1">
          <ResultIcon result={result} />
          <div className="text-xs opacity-60 truncate">
            {getResultLabel(result, index)}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SearchResults({
  results,
  displayMode = 'grid'
}: SearchResultsProps) {
  const [showAllResults, setShowAllResults] = useState(false)

  const handleViewMore = () => {
    setShowAllResults(true)
  }

  // Separate results by type
  const documentResults = results.filter(isDocumentSource)
  const youtubeResults = results.filter(isYouTubeSource)
  const webResults = results.filter(r => !isDocumentSource(r) && !isYouTubeSource(r) && r.url && safeUrl(r.url))

  // Combine all valid results
  const allResults = [...documentResults, ...youtubeResults, ...webResults]

  // Logic for grid mode
  const displayedGridResults = showAllResults
    ? allResults
    : allResults.slice(0, 4)
  const additionalResultsCount =
    allResults.length > 4 ? allResults.length - 4 : 0

  // --- List Mode Rendering ---
  if (displayMode === 'list') {
    return (
      <div className="flex flex-col gap-2">
        {/* Document Sources */}
        {documentResults.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Documents</p>
            {documentResults.map((result, index) => (
              <DocumentResultCard
                key={`doc-${result.document_id}-${result.page_number}-${index}`}
                result={result}
                index={index}
                displayMode="list"
              />
            ))}
          </div>
        )}

        {/* YouTube Sources */}
        {youtubeResults.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Videos</p>
            {youtubeResults.map((result, index) => (
              <Link
                href={result.url}
                key={`yt-${result.video_id}-${index}`}
                passHref
                target="_blank"
                className="block"
              >
                <Card className="w-full hover:bg-muted/50 transition-colors">
                  <CardContent className="p-2 flex items-start space-x-2">
                    <div className="mt-1 flex-shrink-0">
                      <ResultIcon result={result} />
                    </div>
                    <div className="flex-grow overflow-hidden space-y-0.5">
                      <p className="text-sm font-medium line-clamp-1">
                        {result.title}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {result.content}
                      </p>
                      <div className="text-xs text-muted-foreground/80 mt-1">
                        {getResultLabel(result, index)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* Web Sources */}
        {webResults.length > 0 && (
          <div className="space-y-2">
            {(documentResults.length > 0 || youtubeResults.length > 0) && (
              <p className="text-xs font-semibold text-muted-foreground">Web</p>
            )}
            {webResults.map((result, index) => (
              <Link
                href={result.url}
                key={`web-${index}`}
                passHref
                target="_blank"
                className="block"
              >
                <Card className="w-full hover:bg-muted/50 transition-colors">
                  <CardContent className="p-2 flex items-start space-x-2">
                    <div className="mt-1 flex-shrink-0">
                      <ResultIcon result={result} />
                    </div>
                    <div className="flex-grow overflow-hidden space-y-0.5">
                      <p className="text-sm font-medium line-clamp-1">
                        {result.title || safeUrl(result.url)?.pathname || 'Document'}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {result.content}
                      </p>
                      <div className="text-xs text-muted-foreground/80 mt-1 truncate">
                        <span className="underline">{getHostname(result.url)}</span>{' '}
                        - {index + 1}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  // --- Grid Mode Rendering ---
  return (
    <div className="flex flex-wrap -m-1">
      {displayedGridResults.map((result, index) => (
        <div className="w-1/2 md:w-1/4 p-1" key={`grid-${index}`}>
          {isDocumentSource(result) ? (
            <DocumentResultCard result={result} index={index} displayMode="grid" />
          ) : (
            <Link href={result.url || '#'} passHref target="_blank">
              <Card className="flex-1 h-full hover:bg-muted/50 transition-colors">
                <CardContent className="p-2 flex flex-col justify-between h-full">
                  <p className="text-xs line-clamp-2 min-h-[2rem]">
                    {result.title || result.content}
                  </p>
                  <div className="mt-2 flex items-center space-x-1">
                    <ResultIcon result={result} />
                    <div className="text-xs opacity-60 truncate">
                      {getResultLabel(result, index)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
        </div>
      ))}
      {!showAllResults && additionalResultsCount > 0 && (
        <div className="w-1/2 md:w-1/4 p-1">
          <Card className="flex-1 flex h-full items-center justify-center">
            <CardContent className="p-2">
              <Button
                variant={'link'}
                className="text-muted-foreground"
                onClick={handleViewMore}
              >
                View {additionalResultsCount} more
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
