import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * API Admin pour les statistiques du dashboard
 * Sprint 3 - US-03: Dashboard avec statistiques
 */

// Configuration
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-admin-key'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cors(req, res)) return

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const redis = await getRedis()

    // Default stats
    let stats = {
      blog: 3,
      blogPublished: 3,
      blogDraft: 0,
      podcast: 0,
      podcastPublished: 0,
      podcastDraft: 0,
      faq: 0,
      pendingFaq: 0,
      recentActivity: [] as Array<{ type: string; action: string; time: string; timestamp: number }>,
    }

    if (redis) {
      // Count articles
      const articleIds = await redis.lrange('articles:list', 0, -1) as string[]
      let publishedArticles = 0
      let draftArticles = 0
      const articleActivity: Array<{ type: string; action: string; time: string; timestamp: number }> = []

      for (const id of articleIds) {
        const article = await redis.get<{ status: string; title: string; updatedAt?: number; createdAt: number }>(`article:${id}`)
        if (article) {
          if (article.status === 'published') publishedArticles++
          else draftArticles++

          // Track recent activity
          const ts = article.updatedAt || article.createdAt
          if (ts) {
            articleActivity.push({
              type: 'blog',
              action: `Article "${article.title?.substring(0, 30)}..." modifié`,
              time: formatTimeAgo(ts),
              timestamp: ts,
            })
          }
        }
      }
      stats.blog = articleIds.length || 3
      stats.blogPublished = publishedArticles || 3
      stats.blogDraft = draftArticles

      // Count podcasts
      const podcastIds = await redis.lrange('podcasts:list', 0, -1) as string[]
      let publishedPodcasts = 0
      let draftPodcasts = 0

      for (const id of podcastIds) {
        const episode = await redis.get<{ status: string; title: string; updatedAt?: number; createdAt: number }>(`podcast:${id}`)
        if (episode) {
          if (episode.status === 'published') publishedPodcasts++
          else draftPodcasts++

          // Track recent activity
          const ts = episode.updatedAt || episode.createdAt
          if (ts) {
            articleActivity.push({
              type: 'podcast',
              action: `Épisode "${episode.title?.substring(0, 30)}..." modifié`,
              time: formatTimeAgo(ts),
              timestamp: ts,
            })
          }
        }
      }
      stats.podcast = podcastIds.length
      stats.podcastPublished = publishedPodcasts
      stats.podcastDraft = draftPodcasts

      // Count FAQs
      const approvedFaqIds = await redis.lrange('faq:approved:list', 0, -1) as string[]
      const pendingFaqIds = await redis.lrange('faq:pending:list', 0, -1) as string[]

      stats.faq = approvedFaqIds.length
      stats.pendingFaq = pendingFaqIds.length

      // Add pending FAQ to activity
      if (pendingFaqIds.length > 0) {
        for (const id of pendingFaqIds.slice(0, 3)) {
          const faq = await redis.get<{ question: string; createdAt: number }>(`faq:pending:${id}`)
          if (faq) {
            articleActivity.push({
              type: 'faq',
              action: `FAQ "${faq.question?.substring(0, 30)}..." en attente`,
              time: formatTimeAgo(faq.createdAt),
              timestamp: faq.createdAt,
            })
          }
        }
      }

      // Sort by timestamp and take recent 5
      stats.recentActivity = articleActivity
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5)
    }

    return res.status(200).json(stats)

  } catch (error) {
    console.error('Stats API error:', error)
    return res.status(500).json({ error: 'Failed to fetch stats' })
  }
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'à l\'instant'
  if (minutes < 60) return `il y a ${minutes} min`
  if (hours < 24) return `il y a ${hours}h`
  if (days < 7) return `il y a ${days}j`
  return new Date(timestamp).toLocaleDateString('fr-FR')
}
