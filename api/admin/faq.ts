import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * API Endpoint pour gérer les FAQ (CRUD + validation)
 * Sprint 4 - US-29 : Validation des FAQ par admin
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
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

// GET - List FAQs
async function listFAQs(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const status = (req.query.status as string) || 'all'

  try {
    let faqs: FAQEntry[] = []

    if (status === 'pending' || status === 'all') {
      const pendingIds = await redis.lrange('faq:pending:list', 0, -1) as string[]
      for (const id of pendingIds) {
        const faq = await redis.get<FAQEntry>(`faq:pending:${id}`)
        if (faq) faqs.push(faq)
      }
    }

    if (status === 'approved' || status === 'all') {
      const approvedIds = await redis.lrange('faq:approved:list', 0, -1) as string[]
      for (const id of approvedIds) {
        const faq = await redis.get<FAQEntry>(`faq:approved:${id}`)
        if (faq) faqs.push(faq)
      }
    }

    // Sort by creation date (newest first)
    faqs.sort((a, b) => b.createdAt - a.createdAt)

    return res.status(200).json({
      success: true,
      faqs,
      count: faqs.length,
    })
  } catch (error) {
    console.error('List FAQs error:', error)
    return res.status(500).json({ error: 'Failed to list FAQs' })
  }
}

// POST - Approve or Reject FAQ
async function updateFAQStatus(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id, action, editedQuestion, editedAnswer } = req.body

  if (!id || !action) {
    return res.status(400).json({ error: 'Missing id or action' })
  }

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Action must be approve or reject' })
  }

  try {
    // Get the FAQ from pending
    const faq = await redis.get<FAQEntry>(`faq:pending:${id}`)
    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found' })
    }

    if (action === 'approve') {
      // Update FAQ
      const approvedFAQ: FAQEntry = {
        ...faq,
        question: editedQuestion || faq.question,
        answer: editedAnswer || faq.answer,
        status: 'approved',
        approvedAt: Date.now(),
        approvedBy: 'admin',
      }

      // Move to approved
      await redis.set(`faq:approved:${id}`, approvedFAQ, { ex: 86400 * 365 }) // 1 year
      await redis.lpush('faq:approved:list', id)

      // Remove from pending
      await redis.del(`faq:pending:${id}`)
      await redis.lrem('faq:pending:list', 1, id)

      return res.status(200).json({
        success: true,
        message: 'FAQ approved',
        faq: approvedFAQ,
      })
    } else {
      // Reject - just remove from pending
      await redis.del(`faq:pending:${id}`)
      await redis.lrem('faq:pending:list', 1, id)

      return res.status(200).json({
        success: true,
        message: 'FAQ rejected',
      })
    }
  } catch (error) {
    console.error('Update FAQ status error:', error)
    return res.status(500).json({ error: 'Failed to update FAQ status' })
  }
}

// DELETE - Remove approved FAQ
async function deleteFAQ(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id } = req.query

  if (!id) {
    return res.status(400).json({ error: 'Missing FAQ id' })
  }

  try {
    await redis.del(`faq:approved:${id}`)
    await redis.lrem('faq:approved:list', 1, id as string)

    return res.status(200).json({
      success: true,
      message: 'FAQ deleted',
    })
  } catch (error) {
    console.error('Delete FAQ error:', error)
    return res.status(500).json({ error: 'Failed to delete FAQ' })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (!cors(req, res)) return

  // Auth check
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  switch (req.method) {
    case 'GET':
      return listFAQs(req, res)
    case 'POST':
      return updateFAQStatus(req, res)
    case 'DELETE':
      return deleteFAQ(req, res)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}
