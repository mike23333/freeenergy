import { NextRequest, NextResponse } from 'next/server'

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'bedini-answer-bot'
const DATASTORE_ID = process.env.VERTEX_AI_DATASTORE_ID || 'spencer-transcripts'
const LOCATION = process.env.VERTEX_AI_LOCATION || 'global'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

// Vertex AI can return both YouTube and Document sources
interface VertexStructData {
  // Common fields
  title: string
  transcript?: string // Content text (used by both YouTube and documents)
  // YouTube fields
  video_id?: string
  timestamp_start?: number
  timestamp_end?: number
  channel?: string
  youtube_url?: string
  // Document fields
  source_type?: 'pdf' | 'docx'
  document_id?: string
  filename?: string
  page_number?: number
  section_heading?: string
  chunk_index?: number
  document_url?: string
}

interface VertexSearchResult {
  document: {
    id: string
    structData: VertexStructData
    content?: {
      rawBytes: string
    }
  }
  relevanceScore?: number
}

interface VertexSearchResponse {
  results?: VertexSearchResult[]
}

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{
        text: string
      }>
    }
  }>
}

// YouTube source
interface YouTubeSource {
  type: 'youtube'
  title: string
  url: string
  video_id: string
  timestamp: number
  snippet: string
}

// Document source
interface DocumentSource {
  type: 'pdf' | 'docx'
  document_id: string
  title: string
  filename: string
  page_number: number
  section_heading?: string
  snippet: string
  deep_link?: string
}

type UnifiedSource = YouTubeSource | DocumentSource

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

// Step 1: Search Vertex AI Search for relevant content
async function searchVertexAI(query: string): Promise<UnifiedSource[]> {
  const searchUrl = `https://discoveryengine.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection/dataStores/${DATASTORE_ID}/servingConfigs/default_search:search`

  // Use gcloud to get access token
  const { exec } = require('child_process')
  const accessToken = await new Promise<string>((resolve, reject) => {
    exec('gcloud auth print-access-token', (error: Error | null, stdout: string) => {
      if (error) reject(error)
      else resolve(stdout.trim())
    })
  })

  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Goog-User-Project': PROJECT_ID
    },
    body: JSON.stringify({
      query: query,
      pageSize: 5,
      queryExpansionSpec: {
        condition: 'AUTO'
      },
      spellCorrectionSpec: {
        mode: 'AUTO'
      }
      // Note: contentSearchSpec requires Enterprise edition
      // Content comes from rawBytes in the document
    })
  })

  if (!response.ok) {
    console.error('Vertex AI Search error:', await response.text())
    return []
  }

  const data: VertexSearchResponse = await response.json()

  if (!data.results) {
    return []
  }

  // Process results and fetch signed URLs for documents
  const sources: UnifiedSource[] = await Promise.all(
    data.results.map(async (result) => {
      const doc = result.document
      const structData = doc.structData
      // derivedStructData is at the result level, not document level
      const derivedData = (result as any).derivedStructData || {}

      // Get content from multiple possible sources
      // Priority: transcript (standard edition) > extractive segments > snippets > rawBytes
      let content = ''
      if (structData.transcript) {
        content = structData.transcript
      } else if (derivedData.extractive_segments?.length > 0) {
        content = derivedData.extractive_segments[0].content || ''
      } else if (derivedData.snippets?.length > 0) {
        content = derivedData.snippets[0].snippet || ''
      } else if (doc.content?.rawBytes) {
        content = Buffer.from(doc.content.rawBytes, 'base64').toString('utf-8')
      }

      // Check if this is a document source
      if (structData.source_type && structData.document_id) {
        // Get signed URL for PDF deep-linking
        let deepLink: string | undefined
        if (structData.source_type === 'pdf' && structData.page_number) {
          deepLink = await getDocumentSignedUrl(
            structData.document_id,
            structData.page_number
          )
        }

        return {
          type: structData.source_type,
          document_id: structData.document_id,
          title: structData.title,
          filename: structData.filename || 'document',
          page_number: structData.page_number || 1,
          section_heading: structData.section_heading,
          snippet: content,
          deep_link: deepLink
        } as DocumentSource
      }

      // Default to YouTube source
      return {
        type: 'youtube' as const,
        title: structData.title,
        url: structData.youtube_url || '',
        video_id: structData.video_id || '',
        timestamp: structData.timestamp_start || 0,
        snippet: content
      } as YouTubeSource
    })
  )

  return sources
}

// Helper to format source for context
function formatSourceForContext(source: UnifiedSource, index: number): string {
  if (source.type === 'youtube') {
    return `[Source ${index + 1}] ${source.title} (Video)\n${source.snippet}`
  } else {
    const pageInfo = `Page ${source.page_number}${source.section_heading ? ` - ${source.section_heading}` : ''}`
    return `[Source ${index + 1}] ${source.title} (${source.type.toUpperCase()}, ${pageInfo})\n${source.snippet}`
  }
}

// Step 2: Generate answer with Gemini using search results as context
async function generateAnswer(
  query: string,
  sources: UnifiedSource[]
): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  if (!apiKey) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not configured')
  }

  // Build context from search results
  const context = sources
    .map((s, i) => formatSourceForContext(s, i))
    .join('\n\n')

  const systemPrompt = `You are Energy Search, an expert assistant for Spencer's "Limitless Potential Technologies" content library.

Answer questions using ONLY the provided sources from Spencer's videos and uploaded documents. If the sources don't contain relevant information, say so.

When citing sources, use the format [Source N] and include the source title. Mention if the source is from a video or a document.

Format your responses clearly using markdown.`

  const userPrompt = `Question: ${query}

Sources from Spencer's content library:
${context}

Please answer the question based on these sources.`

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

  const response = await fetch(geminiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048
      }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Gemini API error:', errorText)
    throw new Error('Failed to generate answer')
  }

  const data: GeminiResponse = await response.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json()

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Step 1: Search for relevant content
    console.log('Searching Vertex AI for:', query)
    const sources = await searchVertexAI(query)
    console.log('Found sources:', sources.length)

    // Step 2: Generate answer using sources
    let answer = ''
    if (sources.length > 0) {
      answer = await generateAnswer(query, sources)
    } else {
      answer =
        "I couldn't find relevant information in Spencer's content library for your question. Please try rephrasing or ask about pulse motors, radiant energy, or free energy concepts. You can also upload documents to expand the knowledge base."
    }

    return NextResponse.json({
      answer,
      sources,
      query
    })
  } catch (error) {
    console.error('Energy Search API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
