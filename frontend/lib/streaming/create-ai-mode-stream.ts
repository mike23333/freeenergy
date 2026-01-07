import type { AIModeCitation, AIModeResponse } from '@/lib/types/documents'

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'bedini-answer-bot'
const ENGINE_ID = process.env.VERTEX_AI_ENGINE_ID || 'bedini-search-app'
const LOCATION = process.env.VERTEX_AI_LOCATION || 'global'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

interface VertexAnswerResponse {
  answer: {
    answerText: string
    references?: Array<{
      chunkInfo: {
        chunk: string
        content: string
        documentMetadata: {
          uri: string
          title: string
          structData?: {
            title: string
            transcript?: string
            video_id?: string
            timestamp_start?: number
            source_type?: 'pdf' | 'docx'
            document_id?: string
            page_number?: number
          }
        }
      }
    }>
    state: string
    answerSkippedReasons?: string[]
  }
}

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

async function transformReferences(
  references: VertexAnswerResponse['answer']['references']
): Promise<AIModeCitation[]> {
  if (!references) return []

  const citations: AIModeCitation[] = []

  for (let i = 0; i < references.length; i++) {
    const ref = references[i]
    const structData = ref.chunkInfo.documentMetadata.structData
    const content = ref.chunkInfo.content

    if (!structData) {
      citations.push({
        citationNumber: i + 1,
        sourceType: 'youtube',
        title: ref.chunkInfo.documentMetadata.title || 'Unknown',
        snippet: content
      })
      continue
    }

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

async function queryAIMode(query: string): Promise<AIModeResponse> {
  const answerUrl = `https://discoveryengine.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection/engines/${ENGINE_ID}/servingConfigs/default_search:answer`

  const accessToken = await getAccessToken()

  const response = await fetch(answerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Goog-User-Project': PROJECT_ID
    },
    body: JSON.stringify({
      query: { text: query },
      answerGenerationSpec: {
        includeCitations: true,
        ignoreAdversarialQuery: false,
        ignoreNonAnswerSeekingQuery: false
      },
      searchSpec: {
        searchParams: { maxReturnResults: 5 }
      }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Vertex AI Answer API error:', errorText)
    throw new Error(`AI Mode request failed: ${response.status}`)
  }

  const data: VertexAnswerResponse = await response.json()

  if (data.answer.state === 'FAILED') {
    const reasons = data.answer.answerSkippedReasons?.join(', ') || 'Unknown'
    throw new Error(`AI Mode failed: ${reasons}`)
  }

  const citations = await transformReferences(data.answer.references)

  return {
    answer: data.answer.answerText || '',
    citations,
    query
  }
}

function formatSourcesMarkdown(citations: AIModeCitation[]): string {
  if (citations.length === 0) return ''

  let markdown = '\n\n---\n\n**Sources:**\n\n'

  for (const citation of citations) {
    if (citation.sourceType === 'youtube' && citation.videoId) {
      const url = `https://youtube.com/watch?v=${citation.videoId}&t=${citation.timestamp || 0}s`
      const mins = Math.floor((citation.timestamp || 0) / 60)
      const secs = String((citation.timestamp || 0) % 60).padStart(2, '0')
      markdown += `${citation.citationNumber}. [${citation.title}](${url}) - Video @ ${mins}:${secs}\n`
    } else {
      const url = citation.deepLink || '#'
      markdown += `${citation.citationNumber}. [${citation.title}](${url}) - ${citation.sourceType.toUpperCase()} Page ${citation.pageNumber}\n`
    }
  }

  return markdown
}

// Create a streaming text response compatible with useChat
function createTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      // Stream text in chunks to simulate typing
      const words = text.split(' ')
      for (let i = 0; i < words.length; i++) {
        const word = words[i] + (i < words.length - 1 ? ' ' : '')
        // Format as AI SDK text stream protocol
        controller.enqueue(encoder.encode(`0:"${word.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"\n`))
        // Small delay between words
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      // Send finish message
      controller.enqueue(encoder.encode('d:{"finishReason":"stop"}\n'))
      controller.close()
    }
  })
}

export function createAIModeStreamResponse({
  messages
}: {
  messages: Array<{ role: string; content: string }>
  chatId: string
}) {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
  const query = lastUserMessage?.content || ''

  if (!query) {
    return new Response(createTextStream('Please provide a search query.'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Vercel-AI-Data-Stream': 'v1'
      }
    })
  }

  // Create an async response
  const responsePromise = (async () => {
    try {
      console.log('AI Mode query:', query)

      const aiModeResult = await queryAIMode(query)
      console.log('AI Mode response - citations:', aiModeResult.citations.length)

      const fullResponse =
        aiModeResult.answer + formatSourcesMarkdown(aiModeResult.citations)

      return new Response(createTextStream(fullResponse), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Vercel-AI-Data-Stream': 'v1'
        }
      })
    } catch (error) {
      console.error('AI Mode error:', error)
      const errorMessage =
        error instanceof Error ? error.message : 'An error occurred'
      return new Response(createTextStream(`Error: ${errorMessage}`), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Vercel-AI-Data-Stream': 'v1'
        }
      })
    }
  })()

  // Return the promise-based response
  return responsePromise
}
