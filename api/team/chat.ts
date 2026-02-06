import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z, ZodError } from 'zod'
import { getAgent, AgentId, AGENTS, ROUTING_RULES, ROUTER_SYSTEM_PROMPT } from '../../lib/team-prompts'
import { findRelevantArticles, formatArticleCitation } from '../../lib/articles-index'

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
  agent: z.enum(['lea', 'marc', 'sophie', 'auto']),
  message: z.string().min(1).max(2000).transform(s => s.trim()),
  isReturningUser: z.boolean().optional(), // Pour personnaliser l'accueil
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

// Route question to the best agent using keyword matching (fast, no API call)
function routeByKeywords(message: string): AgentId {
  const lowerMessage = message.toLowerCase()

  const scores: Record<AgentId, number> = { lea: 0, marc: 0, sophie: 0 }

  for (const [agentId, rules] of Object.entries(ROUTING_RULES)) {
    for (const keyword of rules.keywords) {
      if (lowerMessage.includes(keyword)) {
        scores[agentId as AgentId] += 1
      }
    }
  }

  // Find agent with highest score
  const maxScore = Math.max(...Object.values(scores))
  if (maxScore === 0) {
    return 'lea' // Default to Léa for ambiguous questions
  }

  const bestAgent = Object.entries(scores).find(([, score]) => score === maxScore)
  return (bestAgent?.[0] as AgentId) || 'lea'
}

// Route question using Claude (more accurate but costs API call)
async function routeByLLM(message: string): Promise<AgentId> {
  const client = await getAnthropic()

  if (!client) {
    // Fallback to keyword routing in dev mode
    return routeByKeywords(message)
  }

  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 10,
      system: ROUTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
    })

    const textBlock = response.content.find(block => block.type === 'text')
    const agentName = textBlock?.text?.toLowerCase().trim() || 'lea'

    if (agentName === 'lea' || agentName === 'marc' || agentName === 'sophie') {
      return agentName as AgentId
    }
    return 'lea'
  } catch (error) {
    console.error('Router LLM error:', error)
    return routeByKeywords(message)
  }
}

// Smart router: uses keywords first, LLM for ambiguous cases
async function smartRoute(message: string): Promise<AgentId> {
  const keywordResult = routeByKeywords(message)

  // If keywords give a clear answer (score > 1), use it
  const lowerMessage = message.toLowerCase()
  let maxScore = 0
  for (const rules of Object.values(ROUTING_RULES)) {
    let score = 0
    for (const keyword of rules.keywords) {
      if (lowerMessage.includes(keyword)) score++
    }
    if (score > maxScore) maxScore = score
  }

  // Clear match with keywords
  if (maxScore >= 2) {
    return keywordResult
  }

  // Ambiguous: use LLM
  return routeByLLM(message)
}

// Check if message should be redirected to another agent (mid-conversation re-routing)
function shouldRedirect(message: string, currentAgent: AgentId): AgentId | null {
  const lowerMessage = message.toLowerCase()

  // Technical keywords that should ALWAYS go to Marc
  const technicalKeywords = [
    'rag', 'llm', 'api', 'intégration', 'integration', 'installer', 'installation',
    'technique', 'techniquement', 'outil', 'outils', 'code', 'développer', 'chatgpt',
    'copilot', 'claude', 'erp', 'crm', 'sharepoint', 'automatisation', 'workflow',
    'fine-tuning', 'fine tuning', 'prompt', 'embedding', 'vector', 'elasticsearch',
    'architecture technique', 'connecteur', 'indexer', 'indexation', 'configurer'
  ]

  // Strategy keywords that should go to Léa
  const strategyKeywords = [
    'stratégie', 'strategie', 'roi', 'retour sur investissement', 'budget',
    'prioriser', 'priorité', 'priorite', 'business', 'valeur ajoutée',
    'pertinent', 'pertinence', 'commencer', 'débuter', 'par où',
    'investir', 'investissement', 'rentable', 'rentabilité', 'objectif business'
  ]

  // Project/methodology keywords that should go to Sophie
  const projectKeywords = [
    'planning', 'durée', 'duree', 'combien de temps', 'délai', 'delai',
    'méthodologie', 'methodologie', 'gouvernance', 'loi 25', 'rgpd',
    'formation', 'accompagnement', 'livrable', 'étapes du projet', 'déroulement'
  ]

  // Calculate scores for each agent
  const techScore = technicalKeywords.filter(kw => lowerMessage.includes(kw)).length
  const strategyScore = strategyKeywords.filter(kw => lowerMessage.includes(kw)).length
  const projectScore = projectKeywords.filter(kw => lowerMessage.includes(kw)).length

  // Find the best agent based on keyword matches
  const scores = [
    { agent: 'marc' as AgentId, score: techScore },
    { agent: 'lea' as AgentId, score: strategyScore },
    { agent: 'sophie' as AgentId, score: projectScore },
  ]

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score)

  // Only redirect if:
  // 1. Best agent is different from current
  // 2. Best agent has a score >= 1
  // 3. Best agent score is clearly higher than current agent's score
  const bestMatch = scores[0]
  const currentScore = scores.find(s => s.agent === currentAgent)?.score || 0

  if (bestMatch.agent !== currentAgent && bestMatch.score >= 1 && bestMatch.score > currentScore) {
    return bestMatch.agent
  }

  return null // No redirect needed
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
    max_tokens: 1000,
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

    // Determine the agent to use
    let targetAgent: AgentId
    let wasAutoRouted = false

    if (input.agent === 'auto') {
      // Smart routing based on the message
      targetAgent = await smartRoute(sanitizedMessage)
      wasAutoRouted = true
    } else {
      targetAgent = input.agent as AgentId
    }

    const agentConfig = getAgent(targetAgent)
    if (!agentConfig) {
      return res.status(400).json({ error: 'Agent inconnu' })
    }

    // Get or create conversation
    let state = await getConversation(input.sessionId)

    if (!state) {
      // New conversation
      const isReturning = input.isReturningUser === true
      state = initConversation(input.sessionId, targetAgent)

      if (isReturning) {
        state.messages[0].content = `Rebonjour ! Je suis ${agentConfig.name}. Ravi de te revoir ! Comment puis-je t'aider aujourd'hui ?`
      }

      // In auto mode with a real question (not just greeting), process the question immediately
      const isGreetingOnly = /^(bonjour|salut|hello|hi|coucou|hey)[\s!?.]*$/i.test(sanitizedMessage)

      if (wasAutoRouted && !isGreetingOnly) {
        // Add user message and get response directly (skip greeting-only response)
        state.messages.push({ role: 'user', content: sanitizedMessage })
        let agentResponse = await callClaude(state.messages, targetAgent)

        // Add relevant article citations if applicable
        const relevantArticles = findRelevantArticles(sanitizedMessage, targetAgent)
        const articleCitation = formatArticleCitation(relevantArticles)
        if (articleCitation) {
          agentResponse += articleCitation
        }

        state.messages.push({ role: 'assistant', content: agentResponse, agent: targetAgent })
        await saveConversation(state)

        return res.status(200).json({
          success: true,
          message: agentResponse,
          agent: targetAgent,
          agentName: agentConfig.name,
          agentRole: agentConfig.role,
          isGreeting: false,
          wasAutoRouted,
          messageCount: state.messages.length,
          articlesCited: relevantArticles.map(a => a.slug),
        })
      }

      // Normal mode or greeting: return greeting first
      await saveConversation(state)
      return res.status(200).json({
        success: true,
        message: state.messages[0].content,
        agent: targetAgent,
        agentName: agentConfig.name,
        agentRole: agentConfig.role,
        isGreeting: true,
        wasAutoRouted,
      })
    }

    // Mid-conversation re-routing: check if message should go to a different agent
    const redirectAgent = shouldRedirect(sanitizedMessage, targetAgent)
    if (redirectAgent && redirectAgent !== targetAgent) {
      targetAgent = redirectAgent
    }

    // Check if agent changed (either by user choice, auto-routing, or mid-conversation redirect)
    const agentChanged = state.currentAgent !== targetAgent
    if (agentChanged) {
      // Add switch context message
      const switchMessage = buildSwitchContext(state.messages, targetAgent)
      state.messages.push({ role: 'assistant', content: switchMessage, agent: targetAgent })
      state.currentAgent = targetAgent
    }

    // Add user message
    state.messages.push({ role: 'user', content: sanitizedMessage })

    // Get agent response
    let agentResponse = await callClaude(state.messages, targetAgent)

    // Add relevant article citations if applicable
    const relevantArticles = findRelevantArticles(sanitizedMessage, targetAgent)
    const articleCitation = formatArticleCitation(relevantArticles)
    if (articleCitation) {
      agentResponse += articleCitation
    }

    // Add agent response
    state.messages.push({ role: 'assistant', content: agentResponse, agent: targetAgent })

    // Save state
    await saveConversation(state)

    return res.status(200).json({
      success: true,
      message: agentResponse,
      agent: targetAgent,
      agentName: agentConfig.name,
      agentRole: agentConfig.role,
      messageCount: state.messages.length,
      agentChanged,
      wasAutoRouted,
      articlesCited: relevantArticles.map(a => a.slug),
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
