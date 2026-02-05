import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z, ZodError } from 'zod'
import { getAgent, AgentId, AGENTS } from '../../lib/team-prompts'

// Configuration
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

// Types
interface Message {
  role: 'user' | 'assistant'
  content: string
  agent?: AgentId
}

interface TeamConversationState {
  sessionId: string
  messages: Message[]
  currentAgent: AgentId
  createdAt: number
}

// Redis initialization
async function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) {
    return null
  }
  try {
    const { Redis } = await import('@upstash/redis')
    return new Redis({ url, token })
  } catch (e) {
    console.error('Redis init error:', e)
    return null
  }
}

// Lazy Anthropic initialization
let anthropic: InstanceType<typeof import('@anthropic-ai/sdk').default> | null = null

async function getAnthropic() {
  if (anthropic) return anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return null
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    anthropic = new Anthropic({ apiKey })
    return anthropic
  } catch (e) {
    console.error('Anthropic init error:', e)
    return null
  }
}

// Schéma de validation
const chatSchema = z.object({
  sessionId: z.string().uuid(),
  agent: z.enum(['lea', 'marc', 'sophie']),
  message: z.string().min(1).max(2000).transform(s => s.trim()),
})

// CORS middleware
function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || ''
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed || allowed === '*')

  if (isAllowed || process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return false
  }
  return true
}

// Sanitize user input
function sanitizeInput(input: string): string {
  return input
    .replace(/\[SYSTEM\]/gi, '')
    .replace(/\[ASSISTANT\]/gi, '')
    .replace(/<\|.*?\|>/g, '')
    .trim()
}

// Get conversation from Redis
async function getConversation(sessionId: string): Promise<TeamConversationState | null> {
  const client = await getRedis()
  if (!client) {
    return null
  }
  try {
    const data = await client.get<TeamConversationState>(`team:${sessionId}`)
    return data
  } catch (e) {
    console.error('Redis get error:', e)
    return null
  }
}

// Save conversation to Redis (24h TTL)
async function saveConversation(state: TeamConversationState): Promise<void> {
  const client = await getRedis()
  if (!client) {
    console.log('[DEV] Would save team conversation:', state.sessionId)
    return
  }
  await client.set(`team:${state.sessionId}`, state, { ex: 86400 })
}

// Initialize conversation
function initConversation(sessionId: string, agent: AgentId): TeamConversationState {
  const agentConfig = getAgent(agent)!
  return {
    sessionId,
    messages: [{ role: 'assistant', content: agentConfig.greeting, agent }],
    currentAgent: agent,
    createdAt: Date.now(),
  }
}

// Build context message when switching agents
function buildSwitchContext(messages: Message[], newAgent: AgentId): string {
  const agentConfig = getAgent(newAgent)!
  const previousMessages = messages.slice(-6) // Last 6 messages for context

  if (previousMessages.length <= 1) {
    return agentConfig.greeting
  }

  // Summarize recent conversation
  const summary = previousMessages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .slice(-2)
    .join(' ')

  const otherAgent = previousMessages.find(m => m.agent && m.agent !== newAgent)?.agent
  const otherAgentName = otherAgent ? AGENTS[otherAgent].name : 'mon collègue'

  return `Salut ! C'est ${agentConfig.name}. Je vois que tu discutais avec ${otherAgentName}. Je peux reprendre sur les aspects ${agentConfig.role.toLowerCase()}. Comment puis-je t'aider ?`
}

// Call Claude API
async function callClaude(messages: Message[], agentId: AgentId): Promise<string> {
  const agentConfig = getAgent(agentId)!
  const client = await getAnthropic()

  if (!client) {
    // Mock responses for development
    const mockResponses: Record<AgentId, string[]> = {
      lea: [
        "C'est une excellente question ! Le conseil est un secteur très prometteur pour l'IA. Quels processus trouvez-vous les plus chronophages dans votre activité ?",
        "Je recommanderais de commencer par un Pack 1 pour bien cadrer vos besoins. Voulez-vous qu'on planifie un appel découverte avec Philippe ?",
      ],
      marc: [
        "Bonne question ! Un RAG (Retrieval-Augmented Generation) permet à l'IA de chercher dans vos documents avant de répondre. C'est idéal pour créer un assistant qui connaît vos procédures internes.",
        "Pour l'intégration avec votre ERP, plusieurs options existent. Quel système utilisez-vous actuellement ?",
      ],
      sophie: [
        "Notre méthodologie suit 5 étapes : Diagnostiquer, Prioriser, Déployer, Mesurer, Étendre. On avance progressivement pour minimiser les risques.",
        "La formation est incluse dans tous nos packs ! Vos équipes sont accompagnées à chaque étape du projet.",
      ],
    }
    const idx = Math.min(messages.filter(m => m.role === 'user').length - 1, mockResponses[agentId].length - 1)
    return mockResponses[agentId][Math.max(0, idx)]
  }

  // Convert messages for Claude API
  const claudeMessages = messages
    .filter(m => m.content) // Skip empty messages
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 500,
    system: agentConfig.systemPrompt,
    messages: claudeMessages,
  })

  const textBlock = response.content.find(block => block.type === 'text')
  return textBlock?.text || 'Une erreur est survenue. Pouvez-vous reformuler ?'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (!cors(req, res)) return

  // POST only
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const input = chatSchema.parse(req.body)
    const sanitizedMessage = sanitizeInput(input.message)
    const agentConfig = getAgent(input.agent)

    if (!agentConfig) {
      return res.status(400).json({ error: 'Agent inconnu' })
    }

    // Get or create conversation
    let state = await getConversation(input.sessionId)

    if (!state) {
      // New conversation - initialize with greeting
      state = initConversation(input.sessionId, input.agent)
      await saveConversation(state)

      // Return the greeting as first message
      return res.status(200).json({
        success: true,
        message: agentConfig.greeting,
        agent: input.agent,
        agentName: agentConfig.name,
        agentRole: agentConfig.role,
        isGreeting: true,
      })
    }

    // Check if agent changed
    const agentChanged = state.currentAgent !== input.agent
    if (agentChanged) {
      // Add switch context message
      const switchMessage = buildSwitchContext(state.messages, input.agent)
      state.messages.push({ role: 'assistant', content: switchMessage, agent: input.agent })
      state.currentAgent = input.agent
    }

    // Add user message
    state.messages.push({ role: 'user', content: sanitizedMessage })

    // Get agent response
    const agentResponse = await callClaude(state.messages, input.agent)

    // Add agent response
    state.messages.push({ role: 'assistant', content: agentResponse, agent: input.agent })

    // Save state
    await saveConversation(state)

    return res.status(200).json({
      success: true,
      message: agentResponse,
      agent: input.agent,
      agentName: agentConfig.name,
      agentRole: agentConfig.role,
      messageCount: state.messages.length,
      agentChanged,
    })

  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Données invalides',
        details: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      })
    }

    console.error('Team chat error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return res.status(500).json({
      error: 'Une erreur est survenue',
      code: 'INTERNAL_ERROR',
      details: errorMessage,
    })
  }
}
