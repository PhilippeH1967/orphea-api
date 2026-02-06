import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * API publique pour récupérer les articles publiés
 */

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

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
  status: string
  publishedAt?: number
  createdAt: number
  readTime?: string
}

// Default articles (fallback if Redis is empty)
const DEFAULT_ARTICLES: BlogArticle[] = [
  {
    id: 'default-1',
    slug: 'gouvernance-ia-pme',
    title: 'Gouvernance IA : par où commencer pour une PME ?',
    excerpt: 'Les 5 règles essentielles à mettre en place avant de déployer l\'IA dans votre entreprise.',
    content: '## Introduction\n\nL\'intelligence artificielle...',
    category: 'Gouvernance',
    tags: ['gouvernance', 'pme'],
    author: 'Philippe Haumesser',
    status: 'published',
    publishedAt: Date.parse('2024-01-15'),
    createdAt: Date.parse('2024-01-15'),
    readTime: '5 min',
  },
  {
    id: 'default-2',
    slug: 'loi-25-ia',
    title: 'Loi 25 et IA : ce que les PME doivent savoir',
    excerpt: 'Comment la Loi 25 impacte vos projets d\'intelligence artificielle et comment rester conforme.',
    content: '## La Loi 25\n\n...',
    category: 'Conformité',
    tags: ['loi 25', 'conformité'],
    author: 'Philippe Haumesser',
    status: 'published',
    publishedAt: Date.parse('2024-01-08'),
    createdAt: Date.parse('2024-01-08'),
    readTime: '7 min',
  },
  {
    id: 'default-3',
    slug: 'shadow-ai-risques',
    title: 'Shadow AI : les risques cachés de ChatGPT en entreprise',
    excerpt: 'Vos employés utilisent déjà l\'IA. Voici comment encadrer ces usages sans bloquer l\'innovation.',
    content: '## Le Shadow AI\n\n...',
    category: 'Risques',
    tags: ['shadow ai', 'risques'],
    author: 'Philippe Haumesser',
    status: 'published',
    publishedAt: Date.parse('2024-01-02'),
    createdAt: Date.parse('2024-01-02'),
    readTime: '6 min',
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
    let articles: BlogArticle[] = []

    if (redis) {
      const articleIds = await redis.lrange('articles:list', 0, -1) as string[]

      for (const articleId of articleIds) {
        const article = await redis.get<BlogArticle>(`article:${articleId}`)
        if (article && article.status === 'published') {
          articles.push(article)
        }
      }
    }

    // Use defaults if no articles in Redis
    if (articles.length === 0) {
      articles = DEFAULT_ARTICLES
    }

    // Sort by date (newest first)
    articles.sort((a, b) => (b.publishedAt || b.createdAt) - (a.publishedAt || a.createdAt))

    // If slug provided, return single article
    if (slug && typeof slug === 'string') {
      const article = articles.find(a => a.slug === slug)
      if (!article) {
        return res.status(404).json({ error: 'Article not found' })
      }
      return res.status(200).json({ success: true, article })
    }

    // Return all articles (for list view, exclude content)
    const articleList = articles.map(({ content, ...rest }) => rest)

    return res.status(200).json({
      success: true,
      articles: articleList,
      count: articleList.length,
    })

  } catch (error) {
    console.error('Articles API error:', error)
    // Return defaults on error
    return res.status(200).json({
      success: true,
      articles: DEFAULT_ARTICLES.map(({ content, ...rest }) => rest),
      count: DEFAULT_ARTICLES.length,
    })
  }
}
