import { exec } from 'child_process'

import { SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'

interface VertexSearchResult {
  id: string
  structData: {
    video_id: string
    title: string
    timestamp_start: number
    timestamp_end: number
    channel: string
    youtube_url: string
    transcript?: string
  }
  content?: {
    rawBytes: string
  }
}

interface VertexSearchResponse {
  results?: Array<{
    document: VertexSearchResult
    relevanceScore?: number
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
        })
      })

      if (!response.ok) {
        console.error('Vertex AI Search error:', await response.text())
        return this.getEmptyResults(query)
      }

      const data: VertexSearchResponse = await response.json()

      // Transform Vertex AI Search results to SearchResults format
      const results =
        data.results?.map((result) => {
          const doc = result.document
          // Use transcript from structData (always returned) or fall back to content.rawBytes
          const content = doc.structData.transcript ||
            (doc.content?.rawBytes
              ? Buffer.from(doc.content.rawBytes, 'base64').toString('utf-8')
              : '')

          return {
            title: doc.structData.title,
            url: doc.structData.youtube_url,
            content: content,
            score: result.relevanceScore || 0,
            raw_content: content,
            // Custom fields for YouTube sources
            video_id: doc.structData.video_id,
            timestamp_start: doc.structData.timestamp_start,
            timestamp_end: doc.structData.timestamp_end,
            channel: doc.structData.channel
          }
        }) || []

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
