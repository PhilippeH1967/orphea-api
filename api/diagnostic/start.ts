import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z, ZodError } from 'zod'

// Configuration inline pour éviter les problèmes d'import
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

// Lazy Redis initialization to avoid module-level errors
let redisClient: InstanceType<typeof import('@upstash/redis').Redis> | null = null

async function getRedis() {
  if (redisClient) return redisClient
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) {
    return null
  }
  try {
    const { Redis } = await import('@upstash/redis')
    redisClient = new Redis({ url, token })
    return redisClient
  } catch (e) {
    console.error('Redis init error:', e)
    return null
  }
}

const SECTORS = [
  'Services professionnels',
  'Finance et assurance',
  'Santé',
  'Technologies',
  'Commerce de détail',
  'Industrie manufacturière',
  'Construction',
  'Transport et logistique',
  'Éducation',
  'Autre',
] as const

// Schéma de validation
const startDiagnosticSchema = z.object({
  firstName: z.string().min(2).max(50).transform(s => s.trim()),
  email: z.string().email().max(254).transform(s => s.toLowerCase().trim()),
  company: z.string().max(100).optional().transform(s => s?.trim()),
  sector: z.enum(SECTORS),
  recaptchaToken: z.string().optional(),
  website: z.string().max(0).optional(), // Honeypot
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

// Notion API
const NOTION_API_URL = 'https://api.notion.com/v1'

async function createLeadInNotion(lead: {
  sessionId: string
  firstName: string
  email: string
  company?: string
  sector: string
}): Promise<boolean> {
  const apiKey = process.env.NOTION_API_KEY
  const databaseId = process.env.NOTION_DATABASE_ID

  if (!apiKey || !databaseId) {
    console.log('[DEV] Would create lead:', lead)
    return true
  }

  try {
    const response = await fetch(`${NOTION_API_URL}/pages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          'Session ID': { title: [{ text: { content: lead.sessionId } }] },
          'Prénom': { rich_text: [{ text: { content: lead.firstName } }] },
          'Email': { email: lead.email },
          'Entreprise': { rich_text: [{ text: { content: lead.company || '' } }] },
          'Secteur': { select: { name: lead.sector } },
          'Statut': { select: { name: 'started' } },
          'Créé le': { date: { start: new Date().toISOString() } },
        },
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      console.error('Notion error:', error)
      return false
    }
    return true
  } catch (error) {
    console.error('Notion error:', error)
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (!cors(req, res)) return

  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Validate input
    const input = startDiagnosticSchema.parse(req.body)

    // Check honeypot
    if (input.website && input.website.trim() !== '') {
      // Bot detected, fake success
      return res.status(200).json({
        success: true,
        sessionId: crypto.randomUUID(),
        message: 'Diagnostic démarré',
      })
    }

    // Generate session
    const sessionId = crypto.randomUUID()

    // Store in Notion
    await createLeadInNotion({
      sessionId,
      firstName: input.firstName,
      email: input.email,
      company: input.company,
      sector: input.sector,
    })

    // Initialize conversation in Redis
    const greeting = `Bonjour ${input.firstName} ! Je suis l'assistant ORPHEA. Je vais vous poser quelques questions pour évaluer la maturité IA de votre entreprise. Cela prendra environ 5 minutes.\n\nCommençons : combien de personnes travaillent dans votre entreprise, et quel est votre rôle ?`

    const conversationState = {
      sessionId,
      firstName: input.firstName,
      email: input.email,
      sector: input.sector,
      messages: [{ role: 'assistant', content: greeting }],
      questionCount: 1,
      isComplete: false,
    }

    const redis = await getRedis()
    if (redis) {
      await redis.set(`diagnostic:${sessionId}`, conversationState, { ex: 86400 }) // 24h TTL
    }

    return res.status(200).json({
      success: true,
      sessionId,
      firstName: input.firstName,
      greeting,
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

    console.error('Error:', error)
    return res.status(500).json({
      error: 'Une erreur est survenue',
      code: 'INTERNAL_ERROR',
    })
  }
}
