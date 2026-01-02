'use client'

import { FileText, File, ExternalLink } from 'lucide-react'

import type { DocumentSource } from '@/lib/types/documents'

interface DocumentSourceCardProps {
  source: DocumentSource
  index: number
}

export function DocumentSourceCard({ source, index }: DocumentSourceCardProps) {
  const isPdf = source.type === 'pdf'
  const Icon = isPdf ? FileText : File
  const iconColor = isPdf ? 'text-red-500' : 'text-blue-500'
  const bgColor = isPdf ? 'bg-red-50 dark:bg-red-950/20' : 'bg-blue-50 dark:bg-blue-950/20'

  // For PDFs, we can deep link. For DOCX, just show reference.
  const linkUrl = isPdf && source.deep_link ? source.deep_link : undefined

  const CardWrapper = linkUrl ? 'a' : 'div'
  const wrapperProps = linkUrl
    ? {
        href: linkUrl,
        target: '_blank',
        rel: 'noopener noreferrer'
      }
    : {}

  return (
    <CardWrapper
      {...wrapperProps}
      className={`group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all ${
        linkUrl ? 'cursor-pointer hover:border-primary/50 hover:shadow-md' : ''
      }`}
    >
      {/* Icon Header */}
      <div className={`relative flex items-center justify-center p-8 ${bgColor}`}>
        <Icon className={`h-16 w-16 ${iconColor}`} />

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
    </CardWrapper>
  )
}
