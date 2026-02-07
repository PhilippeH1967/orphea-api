import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z, ZodError } from 'zod'

/**
 * API CRUD pour les articles de blog
 * Sprint 1 Admin - Gestion Blog
 */

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-admin-key'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

// Types
interface BlogArticle {
  id: string
  slug: string
  title: string
  excerpt: string
  content: string
  category: string
  tags: string[]
  coverImage?: string
  author: string
  status: 'draft' | 'published' | 'archived'
  publishedAt?: number
  createdAt: number
  updatedAt: number
  seo?: {
    metaTitle?: string
    metaDescription?: string
    keywords?: string[]
  }
}

// Validation schemas
const articleSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  excerpt: z.string().min(1).max(500),
  content: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
  coverImage: z.string().nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  seo: z.object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  }).optional(),
})

// Redis
async function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null
  try {
    const { Redis } = await import('@upstash/redis')
    return new Redis({ url, token })
  } catch {
    return null
  }
}

// CORS
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

// Auth
function checkAuth(req: VercelRequest): boolean {
  const apiKey = req.headers['x-admin-key'] as string
  return apiKey === ADMIN_API_KEY
}

// Generate ID
function generateId(): string {
  return `article-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// GET - List or get single article
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id, status, public: isPublic } = req.query

  try {
    if (id) {
      // Get single article
      const article = await redis.get<BlogArticle>(`article:${id}`)
      if (!article) {
        return res.status(404).json({ error: 'Article not found' })
      }
      return res.status(200).json({ success: true, article })
    }

    // List all articles
    const articleIds = await redis.lrange('articles:list', 0, -1) as string[]
    const articles: BlogArticle[] = []

    for (const articleId of articleIds) {
      const article = await redis.get<BlogArticle>(`article:${articleId}`)
      if (article) {
        // Filter by status if specified
        if (status && article.status !== status) continue
        // Public API only shows published articles
        if (isPublic === 'true' && article.status !== 'published') continue
        articles.push(article)
      }
    }

    // Sort by date (newest first)
    articles.sort((a, b) => (b.publishedAt || b.createdAt) - (a.publishedAt || a.createdAt))

    return res.status(200).json({
      success: true,
      articles,
      count: articles.length,
    })
  } catch (error) {
    console.error('Get articles error:', error)
    return res.status(500).json({ error: 'Failed to get articles' })
  }
}

// POST - Create article
async function handlePost(req: VercelRequest, res: VercelResponse) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  try {
    const data = articleSchema.parse(req.body)
    const now = Date.now()

    const article: BlogArticle = {
      id: generateId(),
      ...data,
      author: 'Philippe Haumesser',
      createdAt: now,
      updatedAt: now,
      publishedAt: data.status === 'published' ? now : undefined,
    }

    // Check slug uniqueness
    const existingIds = await redis.lrange('articles:list', 0, -1) as string[]
    for (const existingId of existingIds) {
      const existing = await redis.get<BlogArticle>(`article:${existingId}`)
      if (existing && existing.slug === article.slug) {
        return res.status(400).json({ error: 'Slug already exists' })
      }
    }

    // Save article
    await redis.set(`article:${article.id}`, article)
    await redis.lpush('articles:list', article.id)

    return res.status(201).json({
      success: true,
      article,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      })
    }
    console.error('Create article error:', error)
    return res.status(500).json({ error: 'Failed to create article' })
  }
}

// PUT - Update article
async function handlePut(req: VercelRequest, res: VercelResponse) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing article ID' })
  }

  try {
    const existing = await redis.get<BlogArticle>(`article:${id}`)
    if (!existing) {
      return res.status(404).json({ error: 'Article not found' })
    }

    const data = articleSchema.partial().parse(req.body)
    const now = Date.now()

    // Handle null coverImage (means image was removed)
    const coverImage = data.coverImage === null ? undefined : (data.coverImage ?? existing.coverImage)

    const updated: BlogArticle = {
      ...existing,
      ...data,
      coverImage,
      updatedAt: now,
      // Set publishedAt if newly published
      publishedAt: data.status === 'published' && !existing.publishedAt
        ? now
        : existing.publishedAt,
    }

    await redis.set(`article:${id}`, updated)

    return res.status(200).json({
      success: true,
      article: updated,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors,
      })
    }
    console.error('Update article error:', error)
    return res.status(500).json({ error: 'Failed to update article' })
  }
}

// DELETE - Delete article
async function handleDelete(req: VercelRequest, res: VercelResponse) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing article ID' })
  }

  try {
    await redis.del(`article:${id}`)
    await redis.lrem('articles:list', 1, id)

    return res.status(200).json({
      success: true,
      message: 'Article deleted',
    })
  } catch (error) {
    console.error('Delete article error:', error)
    return res.status(500).json({ error: 'Failed to delete article' })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cors(req, res)) return

  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    case 'PUT':
      return handlePut(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}
