import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'

/**
 * API Admin pour la gestion des épisodes de podcast
 * Sprint 2 - EPIC-03: Gestion Podcast
 */

// Configuration
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-admin-key'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

// Types
interface PodcastEpisode {
  id: string
  slug: string
  title: string
  description: string
  episodeNumber: number
  seasonNumber?: number
  duration: string
  coverImage?: string
  guests?: string[]
  topics: string[]
  transcript?: string
  status: 'draft' | 'published'
  publishedAt?: number
  createdAt: number
  updatedAt: number
  links: {
    spotify?: string
    apple?: string
    youtube?: string
    rss?: string
  }
}

// Validation schema
const EpisodeSchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  slug: z.string().min(1, 'Slug requis'),
  description: z.string().min(1, 'Description requise'),
  episodeNumber: z.number().min(1),
  seasonNumber: z.number().optional(),
  duration: z.string().min(1, 'Durée requise'),
  coverImage: z.string().optional(),
  guests: z.array(z.string()).optional(),
  topics: z.array(z.string()).default([]),
  transcript: z.string().optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  links: z.object({
    spotify: z.string().optional(),
    apple: z.string().optional(),
    youtube: z.string().optional(),
    rss: z.string().optional(),
  }).default({}),
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

// GET - List or single episode
async function getEpisodes(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id } = req.query

  try {
    // Single episode
    if (id && typeof id === 'string') {
      const episode = await redis.get<PodcastEpisode>(`podcast:${id}`)
      if (!episode) {
        return res.status(404).json({ error: 'Episode not found' })
      }
      return res.status(200).json({ success: true, episode })
    }

    // List all episodes
    const episodeIds = await redis.lrange('podcasts:list', 0, -1) as string[]
    const episodes: PodcastEpisode[] = []

    for (const episodeId of episodeIds) {
      const episode = await redis.get<PodcastEpisode>(`podcast:${episodeId}`)
      if (episode) {
        episodes.push(episode)
      }
    }

    // Sort by episode number (newest first)
    episodes.sort((a, b) => b.episodeNumber - a.episodeNumber)

    return res.status(200).json({
      success: true,
      episodes,
      count: episodes.length,
    })
  } catch (error) {
    console.error('Get episodes error:', error)
    return res.status(500).json({ error: 'Failed to fetch episodes' })
  }
}

// POST - Create episode
async function createEpisode(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  try {
    const validation = EpisodeSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten(),
      })
    }

    const data = validation.data
    const id = `ep-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    const episode: PodcastEpisode = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
      publishedAt: data.status === 'published' ? now : undefined,
    }

    // Save episode
    await redis.set(`podcast:${id}`, episode, { ex: 86400 * 365 * 2 }) // 2 years
    await redis.lpush('podcasts:list', id)

    return res.status(201).json({
      success: true,
      message: 'Episode created',
      episode,
    })
  } catch (error) {
    console.error('Create episode error:', error)
    return res.status(500).json({ error: 'Failed to create episode' })
  }
}

// PUT - Update episode
async function updateEpisode(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Episode ID required' })
  }

  try {
    const existing = await redis.get<PodcastEpisode>(`podcast:${id}`)
    if (!existing) {
      return res.status(404).json({ error: 'Episode not found' })
    }

    const validation = EpisodeSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten(),
      })
    }

    const data = validation.data
    const wasPublished = existing.status === 'published'
    const isNowPublished = data.status === 'published'

    const episode: PodcastEpisode = {
      ...existing,
      ...data,
      id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      publishedAt: isNowPublished && !wasPublished ? Date.now() : existing.publishedAt,
    }

    await redis.set(`podcast:${id}`, episode, { ex: 86400 * 365 * 2 })

    return res.status(200).json({
      success: true,
      message: 'Episode updated',
      episode,
    })
  } catch (error) {
    console.error('Update episode error:', error)
    return res.status(500).json({ error: 'Failed to update episode' })
  }
}

// DELETE - Delete episode
async function deleteEpisode(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis()
  if (!redis) {
    return res.status(500).json({ error: 'Redis not configured' })
  }

  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Episode ID required' })
  }

  try {
    await redis.del(`podcast:${id}`)
    await redis.lrem('podcasts:list', 1, id)

    return res.status(200).json({
      success: true,
      message: 'Episode deleted',
    })
  } catch (error) {
    console.error('Delete episode error:', error)
    return res.status(500).json({ error: 'Failed to delete episode' })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cors(req, res)) return

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  switch (req.method) {
    case 'GET':
      return getEpisodes(req, res)
    case 'POST':
      return createEpisode(req, res)
    case 'PUT':
      return updateEpisode(req, res)
    case 'DELETE':
      return deleteEpisode(req, res)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}
