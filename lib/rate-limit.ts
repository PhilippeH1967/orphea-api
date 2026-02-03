import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { config } from './config'

// Client Redis Upstash (ou fallback en mémoire pour dev)
let redis: Redis | null = null

if (config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: config.UPSTASH_REDIS_REST_URL,
    token: config.UPSTASH_REDIS_REST_TOKEN,
  })
}

// Rate limiter par IP (3 requêtes/heure)
export const rateLimitByIP = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.RATE_LIMIT_IP_MAX, config.RATE_LIMIT_IP_WINDOW as any),
      prefix: 'ratelimit:ip',
    })
  : null

// Rate limiter par email (1 diagnostic/24h)
export const rateLimitByEmail = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.RATE_LIMIT_EMAIL_MAX, config.RATE_LIMIT_EMAIL_WINDOW as any),
      prefix: 'ratelimit:email',
    })
  : null

// Compteur global journalier
const DAILY_KEY = 'diagnostic:daily:count'

export async function checkDailyQuota(): Promise<{ allowed: boolean; count: number }> {
  if (!redis) return { allowed: true, count: 0 }

  const today = new Date().toISOString().split('T')[0]
  const key = `${DAILY_KEY}:${today}`

  const count = await redis.incr(key)

  // Expire à minuit UTC
  if (count === 1) {
    await redis.expire(key, 86400)
  }

  return {
    allowed: count <= config.DAILY_QUOTA,
    count,
  }
}

export async function checkIPRateLimit(ip: string): Promise<{ success: boolean; remaining: number }> {
  if (!rateLimitByIP) return { success: true, remaining: 999 }

  const result = await rateLimitByIP.limit(ip)
  return {
    success: result.success,
    remaining: result.remaining,
  }
}

export async function checkEmailRateLimit(email: string): Promise<{ success: boolean; remaining: number }> {
  if (!rateLimitByEmail) return { success: true, remaining: 999 }

  const normalizedEmail = email.toLowerCase().trim()
  const result = await rateLimitByEmail.limit(normalizedEmail)
  return {
    success: result.success,
    remaining: result.remaining,
  }
}
