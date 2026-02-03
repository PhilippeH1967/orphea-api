import { config } from './config'

// Vérification honeypot (champ invisible que seuls les bots remplissent)
export function checkHoneypot(honeypotValue: string | undefined): boolean {
  // Si le champ honeypot est rempli, c'est un bot
  return !honeypotValue || honeypotValue.trim() === ''
}

// Vérification reCAPTCHA v3
export async function verifyRecaptcha(token: string): Promise<{ success: boolean; score: number }> {
  if (!config.RECAPTCHA_SECRET_KEY) {
    // En dev sans reCAPTCHA configuré, autoriser
    return { success: true, score: 1.0 }
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.RECAPTCHA_SECRET_KEY,
        response: token,
      }),
    })

    const data = await response.json()

    return {
      success: data.success && data.score >= 0.5,
      score: data.score || 0,
    }
  } catch (error) {
    console.error('reCAPTCHA verification error:', error)
    return { success: false, score: 0 }
  }
}

// Vérification délai minimum (anti-bot : rejette si < 30 secondes)
export function checkMinimumTime(startTimestamp: number, minSeconds: number = 30): boolean {
  const elapsed = (Date.now() - startTimestamp) / 1000
  return elapsed >= minSeconds
}

// Sanitization des inputs (protection injection)
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return ''

  return input
    .trim()
    .slice(0, 1000) // Limite à 1000 caractères
    .replace(/[<>]/g, '') // Supprime les balises HTML basiques
}

// Validation email
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email) && email.length <= 254
}

// Génération d'un token de session unique
export function generateSessionToken(): string {
  return crypto.randomUUID()
}
