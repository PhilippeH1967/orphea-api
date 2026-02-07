import type { VercelRequest, VercelResponse } from '@vercel/node'
import { put, del } from '@vercel/blob'

/**
 * API Admin pour l'upload d'images via Vercel Blob
 * Sprint 3 - US-11: Upload images de couverture
 */

// Configuration
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-admin-key'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

// Allowed file types
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

// CORS
function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || ''
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed || allowed === '*')
  if (isAllowed || process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS')
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

// POST - Upload image
async function uploadImage(req: VercelRequest, res: VercelResponse) {
  try {
    const { filename, contentType, data } = req.body

    if (!filename || !contentType || !data) {
      return res.status(400).json({ error: 'Missing filename, contentType, or data' })
    }

    // Validate content type
    if (!ALLOWED_TYPES.includes(contentType)) {
      return res.status(400).json({
        error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF'
      })
    }

    // Decode base64 data
    const buffer = Buffer.from(data, 'base64')

    // Check file size
    if (buffer.length > MAX_SIZE) {
      return res.status(400).json({
        error: 'File too large. Maximum size: 5MB'
      })
    }

    // Generate unique filename
    const timestamp = Date.now()
    const ext = filename.split('.').pop() || 'jpg'
    const uniqueFilename = `orphea/${timestamp}-${Math.random().toString(36).substr(2, 9)}.${ext}`

    // Upload to Vercel Blob
    const blob = await put(uniqueFilename, buffer, {
      contentType,
      access: 'public',
    })

    return res.status(200).json({
      success: true,
      url: blob.url,
      filename: uniqueFilename,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return res.status(500).json({ error: 'Failed to upload image' })
  }
}

// DELETE - Delete image
async function deleteImage(req: VercelRequest, res: VercelResponse) {
  try {
    const { url } = req.query

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing image URL' })
    }

    await del(url)

    return res.status(200).json({
      success: true,
      message: 'Image deleted',
    })
  } catch (error) {
    console.error('Delete error:', error)
    return res.status(500).json({ error: 'Failed to delete image' })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cors(req, res)) return

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  switch (req.method) {
    case 'POST':
      return uploadImage(req, res)
    case 'DELETE':
      return deleteImage(req, res)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}
