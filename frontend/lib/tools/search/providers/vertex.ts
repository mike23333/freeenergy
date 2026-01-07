import { exec } from 'child_process'

import { SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

interface VertexStructData {
  title: string
  video_id?: string
  timestamp_start?: number
  timestamp_end?: number
  channel?: string
  youtube_url?: string
  transcript?: string
  source_type?: 'pdf' | 'docx'
  document_id?: string
  filename?: string
  page_number?: number
  section_heading?: string
}

interface VertexCitation {
  startIndex: string
  endIndex: string
  sources: Array<{
    referenceIndex?: string
    referenceId?: string
    uri?: string
    title?: string
  }>
}

interface VertexAnswerResponse {
  answer: {
    answerText: string
    citations?: VertexCitation[]
    references?: Array<{
      chunkInfo: {
        chunk: string
        content: string
        documentMetadata: {
          uri: string
          title: string
          structData?: VertexStructData
        }
      }
    }>
    state: string
    answerSkippedReasons?: string[]
  }
}

export class VertexSearchProvider extends BaseSearchProvider {
  private projectId: string
  private engineId: string
  private location: string

  constructor() {
    super()
    this.projectId = process.env.GCP_PROJECT_ID || 'bedini-answer-bot'
    this.engineId = process.env.VERTEX_AI_ENGINE_ID || 'bedini-search-app'
    this.location = process.env.VERTEX_AI_LOCATION || 'global'
  }

  private async getAccessToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      exec('gcloud auth print-access-token', (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout.trim())
      })
    })
  }

  async search(query: string, maxResults: number = 5): Promise<SearchResults> {
    try {
      // Use AI Mode (answerQuery) endpoint for better results with citations
      const answerUrl = `https://discoveryengine.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/collections/default_collection/engines/${this.engineId}/servingConfigs/default_search:answer`

      const accessToken = await this.getAccessToken()

      // Custom preamble for psychotronics/alternative energy research audience
      const preamble = `You are a knowledgeable research assistant for the Psychotronics Association, specializing in alternative energy, radionics, scalar electromagnetics, and the works of researchers like John Bedini, Tom Bearden, Nikola Tesla, and other pioneers in these fields.

When answering questions:
- Provide technically detailed yet accessible explanations
- Treat all research topics with respect and scientific curiosity
- When citing video sources, mention the specific topic or concept discussed at that point
- Connect related concepts across different sources when relevant
- For practical/build questions, include specific details like component values, circuit configurations, or experimental procedures when available
- Acknowledge when topics are theoretical or experimental in nature
- Be helpful to both newcomers learning the basics and experienced researchers seeking deeper insights

Always cite your sources using [1], [2], etc. to help users find the original material.`

      const response = await fetch(answerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Goog-User-Project': this.projectId
        },
        body: JSON.stringify({
          query: { text: query },
          answerGenerationSpec: {
            includeCitations: true,
            ignoreAdversarialQuery: false,
            ignoreNonAnswerSeekingQuery: false,
            promptSpec: {
              preamble: preamble
            }
          },
          searchSpec: {
            searchParams: { maxReturnResults: maxResults }
          }
        })
      })

      if (!response.ok) {
        console.error('Vertex AI Mode error:', await response.text())
        return this.getEmptyResults(query)
      }

      const data: VertexAnswerResponse = await response.json()

      if (data.answer.state === 'FAILED') {
        console.error('AI Mode failed:', data.answer.answerSkippedReasons)
        return this.getEmptyResults(query)
      }

      // Transform AI Mode references to SearchResults format
      const results = await Promise.all(
        data.answer.references?.map(async (ref, index) => {
          const structData = ref.chunkInfo.documentMetadata.structData
          const content = ref.chunkInfo.content

          if (!structData) {
            return {
              title: ref.chunkInfo.documentMetadata.title || 'Unknown',
              url: '',
              content: content,
              score: 1 - index * 0.1,
              raw_content: content
            }
          }

          // Document source
          if (structData.source_type && structData.document_id) {
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
              content: content || structData.transcript || '',
              score: 1 - index * 0.1,
              raw_content: content,
              source_type: structData.source_type,
              document_id: structData.document_id,
              page_number: structData.page_number,
              section_heading: structData.section_heading
            }
          }

          // YouTube source
          const timestamp = structData.timestamp_start || 0
          const youtubeUrl = structData.video_id
            ? `https://youtube.com/watch?v=${structData.video_id}&t=${timestamp}s`
            : ''

          return {
            title: structData.title,
            url: youtubeUrl,
            content: content || structData.transcript || '',
            score: 1 - index * 0.1,
            raw_content: content,
            video_id: structData.video_id,
            timestamp_start: structData.timestamp_start,
            timestamp_end: structData.timestamp_end,
            channel: structData.channel
          }
        }) || []
      )

      // Insert citation markers based on the citations metadata
      // Citations have startIndex/endIndex in UTF-8 bytes
      let aiModeAnswer = data.answer.answerText || ''
      if (data.answer.citations && data.answer.citations.length > 0) {
        // Sort citations by endIndex in ASCENDING order so we can track offset
        const sortedCitations = [...data.answer.citations].sort(
          (a, b) => parseInt(a.endIndex) - parseInt(b.endIndex)
        )

        // Track which byte positions we've already marked to avoid duplicates
        const markedPositions = new Set<number>()
        let offsetAdjustment = 0

        for (const citation of sortedCitations) {
          const originalEndIndex = parseInt(citation.endIndex)

          // Skip if we already marked this position
          if (markedPositions.has(originalEndIndex)) continue
          markedPositions.add(originalEndIndex)

          // Get unique reference indices for this citation
          // Handle both referenceIndex and referenceId formats
          const refIndices = citation.sources
            .map(s => {
              const idx = s.referenceIndex ?? s.referenceId
              return idx !== undefined ? parseInt(idx) : NaN
            })
            .filter(idx => !isNaN(idx))
          const uniqueRefs = [...new Set(refIndices)]

          // Skip if no valid reference indices
          if (uniqueRefs.length === 0) continue

          // Create marker like [1] or [1][2] for multiple sources
          const marker = uniqueRefs.map(idx => `[${idx + 1}]`).join('')

          // Adjust position for previous insertions
          const adjustedEndIndex = originalEndIndex + offsetAdjustment

          // Convert current answer to buffer, insert marker, convert back
          const textBuffer = Buffer.from(aiModeAnswer, 'utf-8')
          const before = textBuffer.subarray(0, adjustedEndIndex)
          const after = textBuffer.subarray(adjustedEndIndex)
          aiModeAnswer = Buffer.concat([before, Buffer.from(marker, 'utf-8'), after]).toString('utf-8')

          // Update offset for next iteration
          offsetAdjustment += Buffer.from(marker, 'utf-8').length
        }
      }

      return {
        results: results,
        query: query,
        images: [],
        number_of_results: results.length,
        // Include the AI Mode generated answer for reference
        ai_mode_answer: aiModeAnswer
      } as SearchResults & { ai_mode_answer?: string }
    } catch (error) {
      console.error('Vertex AI Mode error:', error)
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
