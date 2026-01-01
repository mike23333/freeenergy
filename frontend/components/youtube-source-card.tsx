'use client'

import Image from 'next/image'

import { ExternalLink, Play } from 'lucide-react'

interface YouTubeSource {
  title: string
  url: string
  video_id: string
  timestamp: number
  snippet?: string
}

interface YouTubeSourceCardProps {
  source: YouTubeSource
  index: number
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function getThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
}

export function YouTubeSourceCard({ source, index }: YouTubeSourceCardProps) {
  const thumbnailUrl = getThumbnailUrl(source.video_id)

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/50 hover:shadow-md"
    >
      {/* Thumbnail with play overlay */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        <Image
          src={thumbnailUrl}
          alt={source.title}
          fill
          className="object-cover transition-transform group-hover:scale-105"
          unoptimized
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="rounded-full bg-primary p-3">
            <Play className="h-6 w-6 fill-primary-foreground text-primary-foreground" />
          </div>
        </div>
        {/* Timestamp badge */}
        {source.timestamp > 0 && (
          <div className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs font-medium text-white">
            {formatTimestamp(source.timestamp)}
          </div>
        )}
        {/* Source number */}
        <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {index + 1}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-tight text-foreground group-hover:text-primary">
          {source.title}
        </h3>
        {source.snippet && (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
            {source.snippet}
          </p>
        )}
        <div className="mt-auto flex items-center gap-1 pt-2 text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3" />
          <span>Watch on YouTube</span>
        </div>
      </div>
    </a>
  )
}

interface YouTubeSourceGridProps {
  sources: YouTubeSource[]
}

export function YouTubeSourceGrid({ sources }: YouTubeSourceGridProps) {
  if (!sources || sources.length === 0) {
    return null
  }

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
        Sources from Spencer&apos;s Videos
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {sources.map((source, index) => (
          <YouTubeSourceCard
            key={`${source.video_id}-${source.timestamp}`}
            source={source}
            index={index}
          />
        ))}
      </div>
    </div>
  )
}
