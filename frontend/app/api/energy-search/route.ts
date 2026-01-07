import { NextRequest, NextResponse } from 'next/server'

import type {
  AIModeCitation,
  AIModeResponse,
  VertexStructData
} from '@/lib/types/documents'

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'bedini-answer-bot'
const ENGINE_ID = process.env.VERTEX_AI_ENGINE_ID || 'bedini-search-app'
const LOCATION = process.env.VERTEX_AI_LOCATION || 'global'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

// Vertex AI Answer API response types
interface VertexAnswerResponse {
  answer: {
    answerText: string
    citations?: VertexCitationInfo[]
    references?: VertexReference[]
    state: 'STATE_UNSPECIFIED' | 'IN_PROGRESS' | 'FAILED' | 'SUCCEEDED'
    answerSkippedReasons?: string[]
  }
  session?: {
    name: string
  }
}

interface VertexCitationInfo {
  startIndex: string
  endIndex: string
  sources: Array<{
    referenceIndex: string
  }>
}

interface VertexReference {
  chunkInfo: {
    chunk: string
    content: string
    documentMetadata: {
      uri: string
      title: string
      structData?: VertexStructData
    }
  }
}

// Fetch signed URL for a document from backend
async function getDocumentSignedUrl(
  documentId: string,
  pageNumber: number
): Promise<string | undefined> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/documents/${documentId}/signed-url?page=${pageNumber}`
    )
    if (response.ok) {
      const data = await response.json()
      return data.url
    }
  } catch (error) {
    console.error('Failed to get signed URL:', error)
  }
  return undefined
}

// Get access token using gcloud CLI
async function getAccessToken(): Promise<string> {
  const { exec } = require('child_process')
  return new Promise<string>((resolve, reject) => {
    exec(
      'gcloud auth print-access-token',
      (error: Error | null, stdout: string) => {
        if (error) reject(error)
        else resolve(stdout.trim())
      }
    )
  })
}

// Transform Vertex AI references to AIModeCitation format
async function transformReferences(
  references: VertexReference[]
): Promise<AIModeCitation[]> {
  const citations: AIModeCitation[] = []

  for (let i = 0; i < references.length; i++) {
    const ref = references[i]
    const structData = ref.chunkInfo.documentMetadata.structData
    const content = ref.chunkInfo.content

    if (!structData) {
      // Fallback for references without structData
      citations.push({
        citationNumber: i + 1,
        sourceType: 'youtube',
        title: ref.chunkInfo.documentMetadata.title || 'Unknown',
        snippet: content
      })
      continue
    }

    // Check if this is a document source
    if (structData.source_type && structData.document_id) {
      let deepLink: string | undefined
      if (structData.source_type === 'pdf' && structData.page_number) {
        deepLink = await getDocumentSignedUrl(
          structData.document_id,
          structData.page_number
        )
      }

      citations.push({
        citationNumber: i + 1,
        sourceType: structData.source_type,
        documentId: structData.document_id,
        title: structData.title,
        pageNumber: structData.page_number || 1,
        snippet: content || structData.transcript || '',
        deepLink
      })
    } else {
      // YouTube source
      citations.push({
        citationNumber: i + 1,
        sourceType: 'youtube',
        videoId: structData.video_id,
        title: structData.title,
        timestamp: structData.timestamp_start || 0,
        snippet: content || structData.transcript || ''
      })
    }
  }

  return citations
}

// Call Vertex AI Search answerQuery API (AI Mode)
async function queryAIMode(query: string): Promise<AIModeResponse> {
  const answerUrl = `https://discoveryengine.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection/engines/${ENGINE_ID}/servingConfigs/default_search:answer`

  const accessToken = await getAccessToken()

  const requestBody = {
    query: {
      text: query
    },
    answerGenerationSpec: {
      includeCitations: true,
      ignoreAdversarialQuery: false,
      ignoreNonAnswerSeekingQuery: false
    },
    searchSpec: {
      searchParams: {
        maxReturnResults: 5
      }
    }
  }

  const response = await fetch(answerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Goog-User-Project': PROJECT_ID
    },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Vertex AI Answer API error:', errorText)
    throw new Error(`AI Mode request failed: ${response.status}`)
  }

  const data: VertexAnswerResponse = await response.json()

  // Check answer state
  if (data.answer.state === 'FAILED') {
    const reasons = data.answer.answerSkippedReasons?.join(', ') || 'Unknown'
    throw new Error(`AI Mode failed: ${reasons}`)
  }

  // Transform references to citations
  const citations = data.answer.references
    ? await transformReferences(data.answer.references)
    : []

  // Remap citation numbers in the answer text to match our 1-N numbering
  // Vertex AI may use non-sequential numbers like [1] [6] [11]
  let answer = data.answer.answerText || ''

  // Find all unique citation numbers in the answer text
  const citationMatches = answer.match(/\[(\d+)\]/g) || []
  const uniqueNumbers = [...new Set(citationMatches.map(m => parseInt(m.slice(1, -1))))]
  uniqueNumbers.sort((a, b) => a - b)

  // Create a mapping from old numbers to new sequential numbers
  const numberMap = new Map<number, number>()
  uniqueNumbers.forEach((oldNum, idx) => {
    numberMap.set(oldNum, idx + 1)
  })

  // Replace citation numbers in the answer text (replace highest first to avoid conflicts)
  const sortedOldNumbers = [...uniqueNumbers].sort((a, b) => b - a)
  for (const oldNum of sortedOldNumbers) {
    const newNum = numberMap.get(oldNum)!
    answer = answer.replace(new RegExp(`\\[${oldNum}\\]`, 'g'), `[${newNum}]`)
  }

  // Also update citation numbers in the citations array to match
  citations.forEach((c, idx) => {
    c.citationNumber = idx + 1
  })

  return {
    answer,
    citations,
    query
  }
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json()

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    console.log('AI Mode query:', query)

    // Call Vertex AI Search AI Mode (answerQuery)
    const result = await queryAIMode(query)

    console.log('AI Mode response - citations:', result.citations.length)

    // Handle empty results
    if (!result.answer) {
      return NextResponse.json({
        answer:
          "I couldn't find relevant information in Spencer's content library for your question. Please try rephrasing or ask about pulse motors, radiant energy, or free energy concepts.",
        citations: [],
        query
      } as AIModeResponse)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Energy Search API error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}
