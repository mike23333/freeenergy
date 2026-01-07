import { CoreMessage, DataStreamWriter, generateId, JSONValue } from 'ai'

import { search } from '../tools/search'
import { ExtendedCoreMessage } from '../types'

interface ToolExecutionResult {
  toolCallDataAnnotation: ExtendedCoreMessage | null
  toolCallMessages: CoreMessage[]
  directAnswer?: string // AI Mode answer to stream directly, bypassing LLM
}

export async function executeToolCall(
  coreMessages: CoreMessage[],
  dataStream: DataStreamWriter,
  _model: string,
  searchMode: boolean
): Promise<ToolExecutionResult> {
  // If search mode is disabled, return empty tool call
  if (!searchMode) {
    return { toolCallDataAnnotation: null, toolCallMessages: [] }
  }

  // Extract the user's query directly from the last user message
  const lastUserMessage = [...coreMessages]
    .reverse()
    .find(m => m.role === 'user')

  // Handle both string content and array content (multipart messages)
  let query = ''
  if (typeof lastUserMessage?.content === 'string') {
    query = lastUserMessage.content
  } else if (Array.isArray(lastUserMessage?.content)) {
    // Extract text from content array
    const textPart = lastUserMessage.content.find(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part !== null && 'type' in part && part.type === 'text'
    )
    query = textPart?.text || ''
  }

  console.log('Tool execution - query:', query?.substring(0, 100), 'searchMode:', searchMode)

  if (!query) {
    console.log('Tool execution - empty query, skipping search')
    return { toolCallDataAnnotation: null, toolCallMessages: [] }
  }

  const toolCallAnnotation = {
    type: 'tool_call',
    data: {
      state: 'call',
      toolCallId: `call_${generateId()}`,
      toolName: 'search',
      args: JSON.stringify({ query, max_results: 10 })
    }
  }
  dataStream.writeData(toolCallAnnotation)

  // Send query directly to Vertex AI Search (AI Mode)
  const searchResults = await search(query, 10, 'basic', [], [])

  const updatedToolCallAnnotation = {
    ...toolCallAnnotation,
    data: {
      ...toolCallAnnotation.data,
      result: JSON.stringify(searchResults),
      state: 'result'
    }
  }
  dataStream.writeMessageAnnotation(updatedToolCallAnnotation)

  const toolCallDataAnnotation: ExtendedCoreMessage = {
    role: 'data',
    content: {
      type: 'tool_call',
      data: updatedToolCallAnnotation.data
    } as JSONValue
  }

  // Format search results with numbered sources for better citation
  // For PDF documents, use clean document reference URLs instead of full signed URLs
  const formattedSources = searchResults.results
    .map((result, index) => {
      const num = index + 1
      const extendedResult = result as { document_id?: string; page_number?: number; source_type?: string }
      let displayUrl = result.url
      if (extendedResult.source_type === 'pdf' && extendedResult.document_id) {
        displayUrl = `/api/documents/${extendedResult.document_id}/view?page=${extendedResult.page_number || 1}`
      }
      return `[${num}] "${result.title}"
URL: ${displayUrl}
Content: ${result.content || result.raw_content || 'No content available'}`
    })
    .join('\n\n')

  // Check if we have an AI Mode answer from Vertex AI Search
  const aiModeAnswer = (searchResults as { ai_mode_answer?: string }).ai_mode_answer

  let toolCallMessages: CoreMessage[]

  if (aiModeAnswer) {
    // Use the pre-generated answer from Vertex AI Mode - it has proper citations
    // Convert [1], [2] citations to clickable markdown links
    let answerWithLinks = aiModeAnswer
    searchResults.results.forEach((result, index) => {
      const num = index + 1
      // Replace [N] with [N](url) for clickable citations
      const citationRegex = new RegExp(`\\[${num}\\](?!\\()`, 'g')

      // For PDF documents, use a document reference URL instead of the full signed URL
      // The frontend will intercept this and fetch the signed URL on click
      let citationUrl = result.url
      const extendedResult = result as { document_id?: string; page_number?: number; source_type?: string }
      if (extendedResult.source_type === 'pdf' && extendedResult.document_id) {
        citationUrl = `/api/documents/${extendedResult.document_id}/view?page=${extendedResult.page_number || 1}`
      }

      answerWithLinks = answerWithLinks.replace(citationRegex, `[${num}](${citationUrl})`)
    })

    // Return the AI Mode answer directly - don't pass through Gemini LLM
    // This preserves the citation links exactly as we formatted them
    return {
      toolCallDataAnnotation,
      toolCallMessages: [],
      directAnswer: answerWithLinks
    }
  } else {
    // Fallback: Let the model generate the answer
    toolCallMessages = [
      {
        role: 'assistant',
        content: `I found ${searchResults.results.length} relevant sources:\n\n${formattedSources}`
      },
      {
        role: 'user',
        content: `Answer using these sources with inline citations. Use format [N](URL) where N is the source number.`
      }
    ]
  }

  return { toolCallDataAnnotation, toolCallMessages }
}
