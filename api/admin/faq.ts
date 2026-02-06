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

// POST - Approve/Reject FAQ or Create new FAQ
async function handlePost(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id, action, question, answer, category, agent, editedQuestion, editedAnswer } = req.body

  // If action is provided, it's an approve/reject request
  if (action) {
    if (!id) {
      return res.status(400).json({ error: 'Missing id' })
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be approve or reject' })
    }

    try {
      const faq = await redis.get<FAQEntry>(`faq:pending:${id}`)
      if (!faq) {
        return res.status(404).json({ error: 'FAQ not found' })
      }

      if (action === 'approve') {
        const approvedFAQ: FAQEntry = {
          ...faq,
          question: editedQuestion || faq.question,
          answer: editedAnswer || faq.answer,
          status: 'approved',
          approvedAt: Date.now(),
          approvedBy: 'admin',
        }

        await redis.set(`faq:approved:${id}`, approvedFAQ, { ex: 86400 * 365 })
        await redis.lpush('faq:approved:list', id)
        await redis.del(`faq:pending:${id}`)
        await redis.lrem('faq:pending:list', 1, id)

        return res.status(200).json({
          success: true,
          message: 'FAQ approved',
          faq: approvedFAQ,
        })
      } else {
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

  // Otherwise, it's a create request
  if (!question || !answer || !category || !agent) {
    return res.status(400).json({ error: 'Missing required fields: question, answer, category, agent' })
  }

  try {
    const faqId = `faq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    const newFAQ: FAQEntry = {
      id: faqId,
      question,
      answer,
      category,
      agent,
      frequency: 0,
      status: 'approved',
      createdAt: now,
      approvedAt: now,
      approvedBy: 'admin',
    }

    await redis.set(`faq:approved:${faqId}`, newFAQ, { ex: 86400 * 365 })
    await redis.lpush('faq:approved:list', faqId)

    return res.status(201).json({
      success: true,
      message: 'FAQ created',
      faq: newFAQ,
    })
  } catch (error) {
    console.error('Create FAQ error:', error)
    return res.status(500).json({ error: 'Failed to create FAQ' })
  }
}

// PUT - Update existing FAQ
async function updateFAQ(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing FAQ id' })
  }

  const { question, answer, category, agent } = req.body

  try {
    const existing = await redis.get<FAQEntry>(`faq:approved:${id}`)
    if (!existing) {
      return res.status(404).json({ error: 'FAQ not found' })
    }

    const updatedFAQ: FAQEntry = {
      ...existing,
      question: question || existing.question,
      answer: answer || existing.answer,
      category: category || existing.category,
      agent: agent || existing.agent,
    }

    await redis.set(`faq:approved:${id}`, updatedFAQ, { ex: 86400 * 365 })

    return res.status(200).json({
      success: true,
      message: 'FAQ updated',
      faq: updatedFAQ,
    })
  } catch (error) {
    console.error('Update FAQ error:', error)
    return res.status(500).json({ error: 'Failed to update FAQ' })
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
      return handlePost(req, res)
    case 'PUT':
      return updateFAQ(req, res)
    case 'DELETE':
      return deleteFAQ(req, res)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}
