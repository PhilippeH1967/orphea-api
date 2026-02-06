import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * API Endpoint pour extraire les FAQ depuis les conversations
 * Sprint 4 - US-28 : Script d'extraction des questions fréquentes
 *
 * Sécurisé par clé API admin
 */

// Configuration
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-admin-key'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

// Types
interface FAQEntry {
  id: string
  question: string
  answer: string
  category: 'strategie' | 'technique' | 'projet' | 'offres' | 'general'
  agent: 'lea' | 'marc' | 'sophie'
  frequency: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  approvedAt?: number
  approvedBy?: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  agent?: string
}

interface ConversationState {
  sessionId: string
  messages: Message[]
  currentAgent: string
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

// Anthropic initialization
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

// CORS middleware
function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || ''
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed || allowed === '*')

  if (isAllowed || process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return false
  }
  return true
}

// Auth middleware
function checkAuth(req: VercelRequest): boolean {
  const apiKey = req.headers['x-admin-key'] as string
  return apiKey === ADMIN_API_KEY
}

// Extract Q&A pairs from conversations
function extractQAPairs(conversations: ConversationState[]): Array<{ question: string; answer: string; agent: string }> {
  const pairs: Array<{ question: string; answer: string; agent: string }> = []

  for (const conv of conversations) {
    const messages = conv.messages

    for (let i = 0; i < messages.length - 1; i++) {
      const current = messages[i]
      const next = messages[i + 1]

      // Find user question followed by assistant answer
      if (current.role === 'user' && next.role === 'assistant') {
        // Filter out greetings and very short messages
        if (current.content.length > 15 && !isGreeting(current.content)) {
          pairs.push({
            question: current.content,
            answer: next.content,
            agent: next.agent || 'lea',
          })
        }
      }
    }
  }

  return pairs
}

function isGreeting(text: string): boolean {
  const greetings = /^(bonjour|salut|hello|hi|coucou|hey|bonsoir|merci|ok|d'accord|super|parfait)[\s!?.]*$/i
  return greetings.test(text.trim())
}

// Group similar questions
function groupSimilarQuestions(pairs: Array<{ question: string; answer: string; agent: string }>): Map<string, typeof pairs> {
  const groups = new Map<string, typeof pairs>()

  for (const pair of pairs) {
    // Simplified grouping by key phrases
    const normalized = pair.question.toLowerCase()
      .replace(/[?!.,]/g, '')
      .trim()

    // Extract key phrase (first 50 chars)
    const key = normalized.substring(0, 50)

    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(pair)
  }

  return groups
}

// Use LLM to synthesize FAQ entry from similar questions
async function synthesizeFAQ(
  questions: Array<{ question: string; answer: string; agent: string }>
): Promise<Omit<FAQEntry, 'id' | 'createdAt' | 'status'> | null> {
  const client = await getAnthropic()
  if (!client) return null

  const questionsText = questions.map(q => `Q: ${q.question}\nR: ${q.answer}`).join('\n\n')

  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      system: `Tu es un assistant qui crée des entrées FAQ à partir de questions similaires posées par des visiteurs.

Tu dois produire une question FAQ claire et sa réponse synthétisée.

Règles :
- La question doit être formulée de façon générique et professionnelle
- La réponse doit être concise (2-4 phrases max)
- Catégorie parmi : strategie, technique, projet, offres, general
- Agent parmi : lea (stratégie/business), marc (technique), sophie (projet/méthodologie)

Réponds en JSON avec ce format exact :
{
  "question": "La question FAQ",
  "answer": "La réponse synthétisée",
  "category": "strategie|technique|projet|offres|general",
  "agent": "lea|marc|sophie"
}`,
      messages: [{
        role: 'user',
        content: `Voici ${questions.length} question(s) similaire(s) posées par des visiteurs. Crée une entrée FAQ synthétisée :\n\n${questionsText}`,
      }],
    })

    const textBlock = response.content.find(block => block.type === 'text')
    if (!textBlock?.text) return null

    // Parse JSON response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    return {
      question: parsed.question,
      answer: parsed.answer,
      category: parsed.category || 'general',
      agent: parsed.agent || questions[0].agent,
      frequency: questions.length,
    }
  } catch (error) {
    console.error('FAQ synthesis error:', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (!cors(req, res)) return

  // Auth check
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // POST only
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const redis = await getRedis()
    if (!redis) {
      return res.status(500).json({ error: 'Redis not configured' })
    }

    // Get all team conversation keys
    const keys = await redis.keys('team:*')
    console.log(`Found ${keys.length} conversations`)

    if (keys.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No conversations found',
        faqsGenerated: 0,
      })
    }

    // Fetch conversations (limit to last 100 for performance)
    const conversationKeys = keys.slice(-100)
    const conversations: ConversationState[] = []

    for (const key of conversationKeys) {
      const data = await redis.get<ConversationState>(key)
      if (data && data.messages && data.messages.length > 2) {
        conversations.push(data)
      }
    }

    console.log(`Processing ${conversations.length} conversations with content`)

    // Extract Q&A pairs
    const qaPairs = extractQAPairs(conversations)
    console.log(`Extracted ${qaPairs.length} Q&A pairs`)

    if (qaPairs.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No Q&A pairs found',
        faqsGenerated: 0,
      })
    }

    // Group similar questions
    const groups = groupSimilarQuestions(qaPairs)
    console.log(`Grouped into ${groups.size} clusters`)

    // Filter groups with at least 2 similar questions (or 1 in dev mode)
    const minFrequency = process.env.NODE_ENV === 'production' ? 2 : 1
    const frequentGroups = Array.from(groups.entries())
      .filter(([, pairs]) => pairs.length >= minFrequency)
      .slice(0, 10) // Limit to top 10 for API costs

    console.log(`${frequentGroups.length} groups meet frequency threshold`)

    // Synthesize FAQ entries
    const newFAQs: FAQEntry[] = []

    for (const [, pairs] of frequentGroups) {
      const synthesized = await synthesizeFAQ(pairs)
      if (synthesized) {
        const faqEntry: FAQEntry = {
          id: `faq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          ...synthesized,
          status: 'pending',
          createdAt: Date.now(),
        }
        newFAQs.push(faqEntry)

        // Store in Redis
        await redis.set(`faq:pending:${faqEntry.id}`, faqEntry, { ex: 86400 * 30 }) // 30 days
      }
    }

    // Also add to a list of all pending FAQs
    const existingPendingIds = await redis.lrange('faq:pending:list', 0, -1) as string[]
    for (const faq of newFAQs) {
      if (!existingPendingIds.includes(faq.id)) {
        await redis.lpush('faq:pending:list', faq.id)
      }
    }

    return res.status(200).json({
      success: true,
      message: `Extracted ${newFAQs.length} FAQ entries`,
      faqsGenerated: newFAQs.length,
      faqs: newFAQs,
      stats: {
        conversationsProcessed: conversations.length,
        qaPairsFound: qaPairs.length,
        clustersFound: groups.size,
        frequentClusters: frequentGroups.length,
      },
    })

  } catch (error) {
    console.error('FAQ extraction error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return res.status(500).json({
      error: 'FAQ extraction failed',
      details: errorMessage,
    })
  }
}
