import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * API Endpoint public pour récupérer les FAQ approuvées
 * Sprint 4 - US-30 : Page /faq auto-générée
 */

// Configuration
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

// Types
interface FAQEntry {
  id: string
  question: string
  answer: string
  category: 'strategie' | 'technique' | 'projet' | 'offres' | 'general'
  agent: 'lea' | 'marc' | 'sophie'
}

// Default FAQs if none in database
const DEFAULT_FAQS: FAQEntry[] = [
  {
    id: 'default-1',
    question: "L'IA est-elle pertinente pour mon entreprise de services ?",
    answer: "Absolument ! Les entreprises de services sont parmi les mieux placées pour bénéficier de l'IA. Analyse documentaire, génération de rapports, automatisation des tâches répétitives... Les gains de productivité peuvent atteindre 20-30% sur certaines tâches.",
    category: 'strategie',
    agent: 'lea',
  },
  {
    id: 'default-2',
    question: "Qu'est-ce qu'un RAG et pourquoi est-ce utile ?",
    answer: "RAG (Retrieval-Augmented Generation) permet à l'IA de chercher dans vos documents avant de répondre. C'est comme ChatGPT mais qui connaît vos procédures, contrats et historiques. Idéal pour créer des assistants qui connaissent vraiment votre entreprise.",
    category: 'technique',
    agent: 'marc',
  },
  {
    id: 'default-3',
    question: "Combien de temps prend un projet IA ?",
    answer: "Cela dépend de l'ambition ! Notre Pack 1 (cadrage + gouvernance) prend 3-6 semaines. Pour un pilote en production (Pack 2), comptez 8-15 semaines. On avance par étapes pour minimiser les risques et maximiser l'adoption.",
    category: 'projet',
    agent: 'sophie',
  },
  {
    id: 'default-4',
    question: "Comment gérez-vous la conformité Loi 25 / RGPD ?",
    answer: "La gouvernance est intégrée dès le départ. Nous définissons ensemble les règles d'usage, le périmètre des données, les contrôles d'accès et la traçabilité. Vous recevez une charte IA documentée et conforme.",
    category: 'projet',
    agent: 'sophie',
  },
  {
    id: 'default-5',
    question: "Mes employés utilisent déjà ChatGPT sans contrôle, que faire ?",
    answer: "C'est le 'Shadow AI' - très courant ! Plutôt que d'interdire (inefficace), nous vous aidons à offrir des outils encadrés et sécurisés. Formation, règles d'usage claires, et solutions adaptées permettent de transformer ce risque en opportunité.",
    category: 'strategie',
    agent: 'lea',
  },
]

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

// CORS middleware
function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || ''
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed || allowed === '*')

  if (isAllowed || process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  // Cache for 5 minutes
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return false
  }
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (!cors(req, res)) return

  // GET only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const redis = await getRedis()
    let faqs: FAQEntry[] = []

    if (redis) {
      // Get approved FAQs from Redis
      const approvedIds = await redis.lrange('faq:approved:list', 0, -1) as string[]

      for (const id of approvedIds) {
        const faq = await redis.get<FAQEntry>(`faq:approved:${id}`)
        if (faq) {
          faqs.push({
            id: faq.id,
            question: faq.question,
            answer: faq.answer,
            category: faq.category,
            agent: faq.agent,
          })
        }
      }
    }

    // If no FAQs from database, use defaults
    if (faqs.length === 0) {
      faqs = DEFAULT_FAQS
    }

    // Group by category
    const grouped = faqs.reduce((acc, faq) => {
      if (!acc[faq.category]) {
        acc[faq.category] = []
      }
      acc[faq.category].push(faq)
      return acc
    }, {} as Record<string, FAQEntry[]>)

    return res.status(200).json({
      success: true,
      faqs,
      grouped,
      count: faqs.length,
    })

  } catch (error) {
    console.error('FAQ fetch error:', error)
    // Return defaults on error
    return res.status(200).json({
      success: true,
      faqs: DEFAULT_FAQS,
      grouped: DEFAULT_FAQS.reduce((acc, faq) => {
        if (!acc[faq.category]) {
          acc[faq.category] = []
        }
        acc[faq.category].push(faq)
        return acc
      }, {} as Record<string, FAQEntry[]>),
      count: DEFAULT_FAQS.length,
    })
  }
}
