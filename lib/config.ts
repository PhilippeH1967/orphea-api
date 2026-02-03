// Configuration centralisée avec validation
import { z } from 'zod'

const envSchema = z.object({
  // Domaines autorisés pour CORS
  ALLOWED_ORIGINS: z.string().default('https://orphea-conseil.com,http://localhost:3000'),

  // Upstash Redis pour rate limiting
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Notion
  NOTION_API_KEY: z.string().optional(),
  NOTION_DATABASE_ID: z.string().optional(),

  // Anthropic Claude
  ANTHROPIC_API_KEY: z.string().optional(),

  // Resend
  RESEND_API_KEY: z.string().optional(),

  // reCAPTCHA
  RECAPTCHA_SECRET_KEY: z.string().optional(),

  // Quotas
  DAILY_QUOTA: z.coerce.number().default(100),
  RATE_LIMIT_IP_MAX: z.coerce.number().default(3),
  RATE_LIMIT_IP_WINDOW: z.string().default('1h'),
  RATE_LIMIT_EMAIL_MAX: z.coerce.number().default(1),
  RATE_LIMIT_EMAIL_WINDOW: z.string().default('24h'),
})

export const config = envSchema.parse(process.env)

export const ALLOWED_ORIGINS = config.ALLOWED_ORIGINS.split(',').map(s => s.trim())

// Secteurs d'activité disponibles
export const SECTORS = [
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

export type Sector = typeof SECTORS[number]
