import { CoreMessage, smoothStream, streamText } from 'ai'

import { getModel } from '../utils/registry'

const BASE_SYSTEM_PROMPT = `
Instructions:

You are Energy Search, an expert AI assistant for Spencer's "Limitless Potential Technologies" YouTube channel.
You specialize in answering questions about pulse motors, Bedini SSG motors, radiant energy, free energy concepts, and related topics.

1. Provide comprehensive and detailed responses based on Spencer's video content
2. Use markdown to structure your responses with appropriate headings
3. Be enthusiastic about the topics while maintaining technical accuracy
4. When discussing experiments or builds, include relevant details about components and methodology
`

const SEARCH_ENABLED_PROMPT = `
${BASE_SYSTEM_PROMPT}

When analyzing search results from Spencer's videos:
1. Answer questions using ONLY the provided sources from Spencer's videos
2. ALWAYS cite sources using clickable markdown links: [1](https://youtube.com/watch?v=VIDEO_ID&t=TIMEs)
3. Use the EXACT URL provided for each source - do not modify or shorten it
4. Each source links to a specific timestamp in a YouTube video - encourage users to watch for more details
5. If multiple sources support a point, cite them all: [1](url1) [2](url2)
6. If the search results don't contain relevant information, say so and suggest the user try rephrasing their question

IMPORTANT: Citations MUST be clickable markdown links with the full URL, not just numbers in brackets.
Example: "Pulse motors use pulsed DC current [1](https://youtube.com/watch?v=YAkkdGXs40c&t=30s)"
`

const SEARCH_DISABLED_PROMPT = `
${BASE_SYSTEM_PROMPT}

Important:
1. Provide responses based on your general knowledge about free energy and pulse motor concepts
2. Encourage users to enable search mode to get answers grounded in Spencer's actual videos
3. Be clear that responses are based on general knowledge, not Spencer's specific teachings
`

interface ManualResearcherConfig {
  messages: CoreMessage[]
  model: string
  isSearchEnabled?: boolean
}

type ManualResearcherReturn = Parameters<typeof streamText>[0]

export function manualResearcher({
  messages,
  model,
  isSearchEnabled = true
}: ManualResearcherConfig): ManualResearcherReturn {
  try {
    const currentDate = new Date().toLocaleString()
    const systemPrompt = isSearchEnabled
      ? SEARCH_ENABLED_PROMPT
      : SEARCH_DISABLED_PROMPT

    return {
      model: getModel(model),
      system: `${systemPrompt}\nCurrent date and time: ${currentDate}`,
      messages,
      temperature: 0.6,
      topP: 1,
      topK: 40,
      experimental_transform: smoothStream()
    }
  } catch (error) {
    console.error('Error in manualResearcher:', error)
    throw error
  }
}
