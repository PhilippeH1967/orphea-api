import type { VercelRequest, VercelResponse } from '@vercel/node'
import { v2 as cloudinary } from 'cloudinary'

/**
 * API Admin pour l'upload d'images via Cloudinary
 * Sprint 3 - US-11: Upload images de couverture
 */

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

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
    // Check Cloudinary config
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME
    const apiKey = process.env.CLOUDINARY_API_KEY
    const apiSecret = process.env.CLOUDINARY_API_SECRET

    if (!cloudName || !apiKey || !apiSecret) {
      console.error('Missing Cloudinary config:', { cloudName: !!cloudName, apiKey: !!apiKey, apiSecret: !!apiSecret })
      return res.status(500).json({
        error: 'Cloudinary not configured',
        debug: { cloudName: !!cloudName, apiKey: !!apiKey, apiSecret: !!apiSecret }
      })
    }

    // Configure Cloudinary dynamically
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    })

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

    // Generate unique public_id
    const timestamp = Date.now()
    const publicId = `orphea/${timestamp}-${Math.random().toString(36).substr(2, 9)}`

    // Upload to Cloudinary with eager transformation for resizing
    const result = await new Promise<{ secure_url: string; public_id: string; eager?: Array<{ secure_url: string }> }>((resolve, reject) => {
      cloudinary.uploader.upload(
        `data:${contentType};base64,${data}`,
        {
          public_id: publicId,
          folder: 'orphea-conseil',
          resource_type: 'image',
          eager: [
            {
              width: 1200,
              height: 800,
              crop: 'limit',
              quality: 'auto',
            }
          ],
          eager_async: false,
        },
        (error, result) => {
          if (error) reject(error)
          else resolve(result as { secure_url: string; public_id: string; eager?: Array<{ secure_url: string }> })
        }
      )
    })

    // Use the eager transformed URL if available, otherwise use original
    const imageUrl = result.eager?.[0]?.secure_url || result.secure_url

    return res.status(200).json({
      success: true,
      url: imageUrl,
      publicId: result.public_id,
    })
  } catch (error: unknown) {
    console.error('Upload error:', error)
    let details = 'Unknown error'
    if (error instanceof Error) {
      details = error.message
    } else if (typeof error === 'object' && error !== null) {
      details = JSON.stringify(error)
    }
    return res.status(500).json({
      error: 'Failed to upload image',
      details
    })
  }
}

// DELETE - Delete image
async function deleteImage(req: VercelRequest, res: VercelResponse) {
  try {
    const { url, publicId } = req.query

    // Extract public_id from URL if not provided directly
    let imagePublicId = publicId as string

    if (!imagePublicId && url && typeof url === 'string') {
      // Extract public_id from Cloudinary URL
      // Format: https://res.cloudinary.com/cloud_name/image/upload/v123/folder/filename.ext
      const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/)
      if (match) {
        imagePublicId = match[1]
      }
    }

    if (!imagePublicId) {
      return res.status(400).json({ error: 'Missing image URL or publicId' })
    }

    await new Promise<void>((resolve, reject) => {
      cloudinary.uploader.destroy(imagePublicId, (error, result) => {
        if (error) reject(error)
        else resolve()
      })
    })

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
