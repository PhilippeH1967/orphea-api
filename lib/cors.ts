import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ALLOWED_ORIGINS } from './config'

export function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || ''

  // Vérifier si l'origine est autorisée
  const isAllowed = ALLOWED_ORIGINS.some(allowed => {
    if (allowed === '*') return true
    return origin === allowed || origin.endsWith(allowed.replace('https://', '.'))
  })

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    // En production, bloquer les origines non autorisées
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ error: 'Origin not allowed' })
      return false
    }
    // En dev, autoriser localhost
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  // Gérer les preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return false
  }

  return true
}
