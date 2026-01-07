'use client'

import { useState } from 'react'

import { ExternalLink,File, FileText, Loader2 } from 'lucide-react'

import type { DocumentSource } from '@/lib/types/documents'

interface DocumentSourceCardProps {
  source: DocumentSource
  index: number
}

export function DocumentSourceCard({ source, index }: DocumentSourceCardProps) {
  const [isLoading, setIsLoading] = useState(false)
  const isPdf = source.type === 'pdf'
  const Icon = isPdf ? FileText : File
  const iconColor = isPdf ? 'text-red-500' : 'text-blue-500'
  const bgColor = isPdf ? 'bg-red-50 dark:bg-red-950/20' : 'bg-blue-50 dark:bg-blue-950/20'

  // Handle click to fetch signed URL and open PDF
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()

    if (!source.document_id) {
      console.error('No document_id available')
      return
    }

    setIsLoading(true)

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://energy-search-backend-1045208302994.us-central1.run.app'
      const response = await fetch(
        `${backendUrl}/documents/${source.document_id}/signed-url?page=${source.page_number || 1}`
      )

      if (response.ok) {
        const data = await response.json()
        window.open(data.url, '_blank')
      } else {
        console.error('Failed to get signed URL:', await response.text())
      }
    } catch (error) {
      console.error('Error fetching signed URL:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Only PDFs are clickable (with signed URL fetch)
  const isClickable = isPdf && source.document_id

  return (
    <div
      onClick={isClickable ? handleClick : undefined}
      className={`group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all ${
        isClickable ? 'cursor-pointer hover:border-primary/50 hover:shadow-md' : ''
      } ${isLoading ? 'opacity-50' : ''}`}
    >
      {/* Icon Header */}
      <div className={`relative flex items-center justify-center p-8 ${bgColor}`}>
        {isLoading ? (
          <Loader2 className={`h-16 w-16 ${iconColor} animate-spin`} />
        ) : (
          <Icon className={`h-16 w-16 ${iconColor}`} />
        )}

        {/* Source number */}
        <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {index + 1}
        </div>

        {/* Page badge */}
        <div className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs font-medium text-white">
          Page {source.page_number}
        </div>

        {/* File type badge */}
        <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium uppercase text-white">
          {source.type}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-tight text-foreground group-hover:text-primary">
          {source.title}
        </h3>

        {source.section_heading && (
          <p className="mt-1 text-xs italic text-muted-foreground">
            {source.section_heading}
          </p>
        )}

        {source.snippet && (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
            {source.snippet}
          </p>
        )}

        <div className="mt-auto flex items-center gap-1 pt-2 text-xs text-muted-foreground">
          {isPdf ? (
            <>
              <ExternalLink className="h-3 w-3" />
              <span>Open PDF at page {source.page_number}</span>
            </>
          ) : (
            <span>Page {source.page_number} reference</span>
          )}
        </div>
      </div>
    </div>
  )
}
