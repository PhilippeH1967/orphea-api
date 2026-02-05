import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z, ZodError } from 'zod'
import { generateDiagnosticPDF } from '../../lib/pdf-generator'

// Types
interface DiagnosticScores {
  vision: number
  competences: number
  gouvernance: number
  processus: number
  data: number
  outils: number
}

interface ConversationState {
  sessionId: string
  firstName: string
  email: string
  sector: string
  messages: { role: string; content: string }[]
  questionCount: number
  isComplete: boolean
  scores?: DiagnosticScores
  grade?: string
  summary?: string
  recommendations?: string[]
  pack?: string
}

// Configuration
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orphea-conseil.com,http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',').map(s => s.trim())

// Lazy Redis initialization
async function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) {
    console.log('Redis env vars missing')
    return null
  }
  try {
    const { Redis } = await import('@upstash/redis')
    return new Redis({ url, token })
  } catch (e) {
    console.error('Redis init error:', e)
    return null
  }
}

// Lazy Resend initialization
async function getResend() {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.log('Resend API key missing')
    return null
  }
  try {
    const { Resend } = await import('resend')
    return new Resend(apiKey)
  } catch (e) {
    console.error('Resend init error:', e)
    return null
  }
}

// CORS middleware
function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || ''
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed || allowed === '*')

  if (isAllowed || process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return false
  }
  return true
}

// Input validation
const reportSchema = z.object({
  sessionId: z.string().uuid(),
  sendEmail: z.boolean().optional().default(true),
})

// Get conversation from Redis
async function getConversation(sessionId: string): Promise<ConversationState | null> {
  const client = await getRedis()
  if (!client) return null
  try {
    return await client.get<ConversationState>(`diagnostic:${sessionId}`)
  } catch (e) {
    console.error('Redis get error:', e)
    return null
  }
}

// Generate PDF using pdf-lib
async function generatePDF(data: {
  firstName: string
  company?: string
  sector: string
  scores: DiagnosticScores
  grade: string
  summary: string
  recommendations: string[]
  pack: string
}): Promise<Buffer> {
  console.log('Starting PDF generation for:', data.firstName)
  const pdfBytes = await generateDiagnosticPDF(data)
  console.log('PDF generated, size:', pdfBytes.length)
  return Buffer.from(pdfBytes)
}

// Send email with PDF
async function sendReportEmail(
  email: string,
  firstName: string,
  pdfBuffer: Buffer,
  grade: string
): Promise<boolean> {
  const resend = await getResend()
  if (!resend) {
    console.log('[DEV] Would send email to:', email)
    return true
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || 'onboarding@resend.dev'

  try {
    await resend.emails.send({
      from: `ORPHEA Conseil <${fromEmail}>`,
      to: email,
      subject: `Votre rapport de diagnostic IA - Note ${grade}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0077B6;">Bonjour ${firstName},</h1>

          <p>Merci d'avoir realise notre diagnostic de maturite IA !</p>

          <p>Vous trouverez en piece jointe votre rapport personnalise avec :</p>
          <ul>
            <li>Votre score global et par dimension</li>
            <li>Nos recommandations prioritaires</li>
            <li>L'accompagnement adapte a votre situation</li>
          </ul>

          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #0077B6; margin-top: 0;">Prochaine etape</h2>
            <p>Prenez rendez-vous pour un appel decouverte de 30 minutes avec notre expert IA.</p>
            <a href="https://orphea-conseil.com/rendez-vous"
               style="display: inline-block; background-color: #00B4D8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
              Prendre rendez-vous
            </a>
          </div>

          <p style="color: #666; font-size: 14px;">
            A bientot,<br>
            L'equipe ORPHEA Conseil
          </p>

          <hr style="border: none; border-top: 1px solid #e9ecef; margin: 30px 0;">

          <p style="color: #999; font-size: 12px;">
            ORPHEA Conseil - Accelerateur de transformation IA pour PME<br>
            <a href="https://orphea-conseil.com" style="color: #0077B6;">orphea-conseil.com</a>
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `diagnostic-ia-orphea-${firstName.toLowerCase()}.pdf`,
          content: pdfBuffer,
        },
      ],
    })
    return true
  } catch (error) {
    console.error('Email send error:', error)
    return false
  }
}

// Update Notion with report sent status
async function updateNotionStatus(sessionId: string): Promise<void> {
  const apiKey = process.env.NOTION_API_KEY
  const databaseId = process.env.NOTION_DATABASE_ID

  if (!apiKey || !databaseId) return

  try {
    // Search for the page by session ID
    const searchResponse = await fetch('https://api.notion.com/v1/databases/' + databaseId + '/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        filter: {
          property: 'Session ID',
          title: { equals: sessionId },
        },
      }),
    })

    const searchData = await searchResponse.json()
    if (searchData.results && searchData.results.length > 0) {
      const pageId = searchData.results[0].id

      // Update the status
      await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          properties: {
            'Statut': { select: { name: 'report_sent' } },
          },
        }),
      })
    }
  } catch (error) {
    console.error('Notion update error:', error)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (!cors(req, res)) return

  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const input = reportSchema.parse(req.body)

    // Get conversation data
    const state = await getConversation(input.sessionId)
    if (!state) {
      return res.status(404).json({
        error: 'Session non trouvee',
        code: 'SESSION_NOT_FOUND',
      })
    }

    if (!state.isComplete || !state.scores) {
      return res.status(400).json({
        error: 'Le diagnostic n\'est pas termine',
        code: 'DIAGNOSTIC_INCOMPLETE',
      })
    }

    // Generate PDF
    const pdfBuffer = await generatePDF({
      firstName: state.firstName,
      sector: state.sector,
      scores: state.scores,
      grade: state.grade || 'C',
      summary: state.summary || '',
      recommendations: state.recommendations || [],
      pack: state.pack || 'Pack 1',
    })

    // Send email if requested
    let emailSent = false
    if (input.sendEmail) {
      emailSent = await sendReportEmail(
        state.email,
        state.firstName,
        pdfBuffer,
        state.grade || 'C'
      )

      if (emailSent) {
        await updateNotionStatus(input.sessionId)
      }
    }

    // Return PDF as base64 for download
    return res.status(200).json({
      success: true,
      emailSent,
      pdf: pdfBuffer.toString('base64'),
      filename: `diagnostic-ia-orphea-${state.firstName.toLowerCase()}.pdf`,
    })

  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Donnees invalides',
        details: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      })
    }

    console.error('Report error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return res.status(500).json({
      error: 'Une erreur est survenue',
      code: 'INTERNAL_ERROR',
      details: errorMessage,
    })
  }
}
