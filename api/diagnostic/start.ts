import type { VercelRequest, VercelResponse } from '@vercel/node'
import { cors } from '../../lib/cors'
import { checkIPRateLimit, checkEmailRateLimit, checkDailyQuota } from '../../lib/rate-limit'
import { checkHoneypot, verifyRecaptcha, generateSessionToken, isValidEmail } from '../../lib/security'
import { createLead, hasRecentDiagnostic } from '../../lib/airtable'
import { startDiagnosticSchema } from '../../lib/schemas'
import { ZodError } from 'zod'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS check
  if (!cors(req, res)) return

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // 1. Check daily quota
    const quota = await checkDailyQuota()
    if (!quota.allowed) {
      return res.status(429).json({
        error: 'Service temporairement indisponible',
        code: 'QUOTA_EXCEEDED',
      })
    }

    // 2. Check IP rate limit
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown'
    const ipLimit = await checkIPRateLimit(ip)
    if (!ipLimit.success) {
      return res.status(429).json({
        error: 'Trop de tentatives. Réessayez dans une heure.',
        code: 'IP_RATE_LIMITED',
        remaining: ipLimit.remaining,
      })
    }

    // 3. Validate input
    const input = startDiagnosticSchema.parse(req.body)

    // 4. Check honeypot
    if (!checkHoneypot(input.website)) {
      // Silently reject bots
      return res.status(200).json({
        success: true,
        sessionId: generateSessionToken(),
        message: 'Diagnostic démarré',
      })
    }

    // 5. Verify reCAPTCHA (if token provided)
    if (input.recaptchaToken) {
      const recaptcha = await verifyRecaptcha(input.recaptchaToken)
      if (!recaptcha.success) {
        return res.status(400).json({
          error: 'Vérification de sécurité échouée',
          code: 'RECAPTCHA_FAILED',
        })
      }
    }

    // 6. Check email rate limit
    const emailLimit = await checkEmailRateLimit(input.email)
    if (!emailLimit.success) {
      // Check Airtable as backup
      const hasRecent = await hasRecentDiagnostic(input.email)
      if (hasRecent) {
        return res.status(429).json({
          error: 'Vous avez déjà effectué un diagnostic récemment. Réessayez dans 24h.',
          code: 'EMAIL_RATE_LIMITED',
        })
      }
    }

    // 7. Generate session token
    const sessionId = generateSessionToken()

    // 8. Store lead in Airtable
    await createLead({
      sessionId,
      firstName: input.firstName,
      email: input.email,
      company: input.company,
      sector: input.sector,
    })

    // 9. Return success
    return res.status(200).json({
      success: true,
      sessionId,
      message: `Bienvenue ${input.firstName} ! Votre diagnostic va commencer.`,
    })

  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Données invalides',
        details: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      })
    }

    console.error('Start diagnostic error:', error)
    return res.status(500).json({
      error: 'Une erreur est survenue. Veuillez réessayer.',
      code: 'INTERNAL_ERROR',
    })
  }
}
