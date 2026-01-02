import { exec } from 'child_process'

import { SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

interface VertexStructData {
  // Common
  title: string
  // YouTube fields
  video_id?: string
  timestamp_start?: number
  timestamp_end?: number
  channel?: string
  youtube_url?: string
  transcript?: string
  // Document fields
  source_type?: 'pdf' | 'docx'
  document_id?: string
  filename?: string
  page_number?: number
  section_heading?: string
  document_url?: string
}

interface VertexSearchResult {
  id: string
  structData: VertexStructData
  content?: {
    rawBytes: string
  }
}

interface VertexSearchResponse {
  results?: Array<{
    document: VertexSearchResult
    relevanceScore?: number
    derivedStructData?: {
      extractive_segments?: Array<{ content: string }>
      snippets?: Array<{ snippet: string }>
      [key: string]: unknown
    }
  }>
}

export class VertexSearchProvider extends BaseSearchProvider {
  private projectId: string
  private datastoreId: string
  private location: string

  constructor() {
    super()
    this.projectId = process.env.GCP_PROJECT_ID || 'bedini-answer-bot'
    this.datastoreId = process.env.VERTEX_AI_DATASTORE_ID || 'spencer-transcripts'
    this.location = process.env.VERTEX_AI_LOCATION || 'global'

    if (!this.projectId || !this.datastoreId) {
      console.warn(
        'GCP_PROJECT_ID or VERTEX_AI_DATASTORE_ID not set. Vertex AI Search will not work.'
      )
    }
  }

  private async getAccessToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      exec('gcloud auth print-access-token', (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout.trim())
      })
    })
  }

  async search(
    query: string,
    maxResults: number = 10
  ): Promise<SearchResults> {
    try {
      // Use the Discovery Engine API to search
      const searchUrl = `https://discoveryengine.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/collections/default_collection/dataStores/${this.datastoreId}/servingConfigs/default_search:search`

      // Get fresh access token from gcloud CLI
      const accessToken = await this.getAccessToken()

      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Goog-User-Project': this.projectId
        },
        body: JSON.stringify({
          query: query,
          pageSize: maxResults,
          queryExpansionSpec: {
            condition: 'AUTO'
          },
          spellCorrectionSpec: {
            mode: 'AUTO'
          }
          // Note: contentSearchSpec with extractive content requires Enterprise edition
          // Content will come from rawBytes in the document instead
        })
      })

      if (!response.ok) {
        console.error('Vertex AI Search error:', await response.text())
        return this.getEmptyResults(query)
      }

      const data: VertexSearchResponse = await response.json()

      // Transform Vertex AI Search results to SearchResults format
      const results = await Promise.all(
        data.results?.map(async (result) => {
          const doc = result.document
          const structData = doc.structData
          // derivedStructData is at the result level, not document level
          const derivedData = result.derivedStructData || {}

          // Get content from multiple possible sources:
          // 1. transcript field in structData (works in standard edition)
          // 2. Extractive segments (Enterprise edition only)
          // 3. Snippets (Enterprise edition only)
          // 4. rawBytes (may not be returned in standard edition)
          let content = ''

          // Check for transcript in structData (standard edition compatible)
          if (structData.transcript) {
            content = structData.transcript
          }
          // Check for extractive segments (Enterprise only)
          else if (derivedData.extractive_segments?.length > 0) {
            content = derivedData.extractive_segments[0].content || ''
          }
          // Check for snippets (Enterprise only)
          else if (derivedData.snippets?.length > 0) {
            content = derivedData.snippets[0].snippet || ''
          }
          // Fall back to rawBytes
          else if (doc.content?.rawBytes) {
            content = Buffer.from(doc.content.rawBytes, 'base64').toString('utf-8')
          }

          // Check if this is a document source
          if (structData.source_type && structData.document_id) {
            // Get signed URL for PDF deep-linking
            let url = ''
            if (structData.source_type === 'pdf' && structData.page_number) {
              try {
                const signedUrlRes = await fetch(
                  `${BACKEND_URL}/documents/${structData.document_id}/signed-url?page=${structData.page_number}`
                )
                if (signedUrlRes.ok) {
                  const signedData = await signedUrlRes.json()
                  url = signedData.url
                }
              } catch (e) {
                console.error('Failed to get signed URL:', e)
              }
            }

            return {
              title: `${structData.title} (${structData.source_type.toUpperCase()}, Page ${structData.page_number || 1})`,
              url: url,
              content: content,
              score: result.relevanceScore || 0,
              raw_content: content,
              // Document-specific fields
              source_type: structData.source_type,
              document_id: structData.document_id,
              page_number: structData.page_number,
              section_heading: structData.section_heading
            }
          }

          // Default: YouTube source
          return {
            title: structData.title,
            url: structData.youtube_url || '',
            content: content,
            score: result.relevanceScore || 0,
            raw_content: content,
            // YouTube-specific fields
            video_id: structData.video_id,
            timestamp_start: structData.timestamp_start,
            timestamp_end: structData.timestamp_end,
            channel: structData.channel
          }
        }) || []
      )

      return {
        results: results,
        query: query,
        images: [],
        number_of_results: results.length
      }
    } catch (error) {
      console.error('Vertex AI Search error:', error)
      return this.getEmptyResults(query)
    }
  }

  private getEmptyResults(query: string): SearchResults {
    return {
      results: [],
      query: query,
      images: [],
      number_of_results: 0
    }
  }
}
