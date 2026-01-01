import { NextRequest, NextResponse } from 'next/server'

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'bedini-answer-bot'
const DATASTORE_ID = process.env.VERTEX_AI_DATASTORE_ID || 'spencer-transcripts'
const LOCATION = process.env.VERTEX_AI_LOCATION || 'global'

interface VertexSearchResult {
  document: {
    id: string
    structData: {
      video_id: string
      title: string
      timestamp_start: number
      timestamp_end: number
      channel: string
      youtube_url: string
    }
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

interface Source {
  title: string
  url: string
  video_id: string
  timestamp: number
  snippet: string
}

// Step 1: Search Vertex AI Search for relevant content
async function searchVertexAI(query: string): Promise<Source[]> {
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
    })
  })

  if (!response.ok) {
    console.error('Vertex AI Search error:', await response.text())
    return []
  }

  const data: VertexSearchResponse = await response.json()

  return (
    data.results?.map((result) => {
      const doc = result.document
      const content = doc.content?.rawBytes
        ? Buffer.from(doc.content.rawBytes, 'base64').toString('utf-8')
        : ''

      return {
        title: doc.structData.title,
        url: doc.structData.youtube_url,
        video_id: doc.structData.video_id,
        timestamp: doc.structData.timestamp_start,
        snippet: content
      }
    }) || []
  )
}

// Step 2: Generate answer with Gemini using search results as context
async function generateAnswer(
  query: string,
  sources: Source[]
): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  if (!apiKey) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not configured')
  }

  // Build context from search results
  const context = sources
    .map(
      (s, i) =>
        `[Source ${i + 1}] ${s.title} (${s.url})\n${s.snippet}`
    )
    .join('\n\n')

  const systemPrompt = `You are Energy Search, an expert assistant for Spencer's "Limitless Potential Technologies" YouTube channel.

Answer questions using ONLY the provided sources from Spencer's videos. If the sources don't contain relevant information, say so.

When citing sources, use the format [Source N] and include the video title.

Format your responses clearly using markdown.`

  const userPrompt = `Question: ${query}

Sources from Spencer's videos:
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
        "I couldn't find relevant information in Spencer's videos for your question. Please try rephrasing or ask about pulse motors, radiant energy, or free energy concepts."
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
