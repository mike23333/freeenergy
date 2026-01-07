import {
  CoreMessage,
  DataStreamWriter,
  generateId,
  generateText,
  JSONValue
} from 'ai'
import { z } from 'zod'

import { searchSchema } from '../schema/search'
import { search } from '../tools/search'
import { ExtendedCoreMessage } from '../types'
import { getModel } from '../utils/registry'

import { parseToolCallXml } from './parse-tool-call'

interface ToolExecutionResult {
  toolCallDataAnnotation: ExtendedCoreMessage | null
  toolCallMessages: CoreMessage[]
}

export async function executeToolCall(
  coreMessages: CoreMessage[],
  dataStream: DataStreamWriter,
  model: string,
  searchMode: boolean
): Promise<ToolExecutionResult> {
  // If search mode is disabled, return empty tool call
  if (!searchMode) {
    return { toolCallDataAnnotation: null, toolCallMessages: [] }
  }

  // Convert Zod schema to string representation
  const searchSchemaString = Object.entries(searchSchema.shape)
    .map(([key, value]) => {
      const description = value.description
      const isOptional = value instanceof z.ZodOptional
      return `- ${key}${isOptional ? ' (optional)' : ''}: ${description}`
    })
    .join('\n')
  const defaultMaxResults = model?.includes('ollama') ? 5 : 20

  // Generate tool selection using XML format
  const toolSelectionResponse = await generateText({
    model: getModel(model),
    system: `You are an intelligent assistant that analyzes conversations to select the most appropriate tools and their parameters.
            You excel at understanding context to determine when and how to use available tools, including crafting effective search queries.
            Current date: ${new Date().toISOString().split('T')[0]}

            Do not include any other text in your response.
            Respond in XML format with the following structure:
            <tool_call>
              <tool>tool_name</tool>
              <parameters>
                <query>search query text</query>
                <max_results>number - ${defaultMaxResults} by default</max_results>
                <search_depth>basic or advanced</search_depth>
                <include_domains>domain1,domain2</include_domains>
                <exclude_domains>domain1,domain2</exclude_domains>
              </parameters>
            </tool_call>

            Available tools: search

            Search parameters:
            ${searchSchemaString}

            If you don't need a tool, respond with <tool_call><tool></tool></tool_call>`,
    messages: coreMessages
  })

  // Parse the tool selection XML using the search schema
  const toolCall = parseToolCallXml(toolSelectionResponse.text, searchSchema)

  if (!toolCall || toolCall.tool === '') {
    return { toolCallDataAnnotation: null, toolCallMessages: [] }
  }

  const toolCallAnnotation = {
    type: 'tool_call',
    data: {
      state: 'call',
      toolCallId: `call_${generateId()}`,
      toolName: toolCall.tool,
      args: JSON.stringify(toolCall.parameters)
    }
  }
  dataStream.writeData(toolCallAnnotation)

  // Support for search tool only for now
  const searchResults = await search(
    toolCall.parameters?.query ?? '',
    toolCall.parameters?.max_results,
    toolCall.parameters?.search_depth as 'basic' | 'advanced',
    toolCall.parameters?.include_domains ?? [],
    toolCall.parameters?.exclude_domains ?? []
  )

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

    toolCallMessages = [
      {
        role: 'assistant',
        content: `I found ${searchResults.results.length} relevant sources:\n\n${formattedSources}`
      },
      {
        role: 'user',
        content: `Here is a pre-generated answer with citations. Present this answer directly to the user, keeping the citation format exactly as shown:\n\n${answerWithLinks}`
      }
    ]
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
