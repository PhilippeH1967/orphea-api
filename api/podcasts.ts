import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * API publique pour récupérer les épisodes de podcast publiés
 */

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

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
  status: string
  publishedAt?: number
  createdAt: number
  links: {
    spotify?: string
    apple?: string
    youtube?: string
    rss?: string
  }
}

// Default episodes (fallback if Redis is empty)
const DEFAULT_EPISODES: PodcastEpisode[] = [
  {
    id: 'default-3',
    slug: 'shadow-ai-menace-opportunite',
    title: 'Shadow AI : menace ou opportunité ?',
    description: 'Comment transformer les usages non contrôlés de ChatGPT en levier de transformation.',
    episodeNumber: 3,
    duration: '32 min',
    topics: ['shadow ai', 'gouvernance'],
    status: 'draft',
    createdAt: Date.now(),
    links: {},
  },
  {
    id: 'default-2',
    slug: 'loi-25-ia-guide-pratique',
    title: 'Loi 25 et IA : le guide pratique',
    description: 'Tout ce qu\'il faut savoir pour rester conforme tout en innovant.',
    episodeNumber: 2,
    duration: '28 min',
    topics: ['loi 25', 'conformité'],
    status: 'draft',
    createdAt: Date.now(),
    links: {},
  },
  {
    id: 'default-1',
    slug: 'par-ou-commencer-ia',
    title: 'Par où commencer avec l\'IA ?',
    description: 'Les 3 questions à se poser avant de lancer un projet IA dans votre PME.',
    episodeNumber: 1,
    duration: '25 min',
    topics: ['démarrage', 'stratégie'],
    status: 'draft',
    createdAt: Date.now(),
    links: {},
  },
]

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate')
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return false
  }
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cors(req, res)) return

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { slug } = req.query

  try {
    const redis = await getRedis()
    let episodes: PodcastEpisode[] = []

    if (redis) {
      const episodeIds = await redis.lrange('podcasts:list', 0, -1) as string[]

      for (const episodeId of episodeIds) {
        const episode = await redis.get<PodcastEpisode>(`podcast:${episodeId}`)
        if (episode && episode.status === 'published') {
          episodes.push(episode)
        }
      }
    }

    // Use defaults if no episodes in Redis (but mark as upcoming)
    if (episodes.length === 0) {
      episodes = DEFAULT_EPISODES
    }

    // Sort by episode number (newest first)
    episodes.sort((a, b) => b.episodeNumber - a.episodeNumber)

    // If slug provided, return single episode
    if (slug && typeof slug === 'string') {
      const episode = episodes.find(e => e.slug === slug)
      if (!episode) {
        return res.status(404).json({ error: 'Episode not found' })
      }
      return res.status(200).json({ success: true, episode })
    }

    // Return all episodes (separate published and upcoming)
    const published = episodes.filter(e => e.status === 'published')
    const upcoming = episodes.filter(e => e.status !== 'published')

    return res.status(200).json({
      success: true,
      episodes: published,
      upcoming,
      count: published.length,
    })

  } catch (error) {
    console.error('Podcasts API error:', error)
    return res.status(200).json({
      success: true,
      episodes: [],
      upcoming: DEFAULT_EPISODES,
      count: 0,
    })
  }
}
