import { config, Sector } from './config'

// Client Notion API
const NOTION_API_URL = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

interface NotionHeaders {
  'Authorization': string
  'Content-Type': string
  'Notion-Version': string
}

function getHeaders(): NotionHeaders | null {
  if (!config.NOTION_API_KEY) return null
  return {
    'Authorization': `Bearer ${config.NOTION_API_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  }
}

// Types pour les leads
export interface Lead {
  sessionId: string
  firstName: string
  email: string
  company?: string
  sector: Sector
  createdAt: string
  status: 'started' | 'in_progress' | 'completed' | 'abandoned'
  score?: string
  conversationHistory?: string
  reportSentAt?: string
}

// Créer un nouveau lead dans Notion
export async function createLead(lead: Omit<Lead, 'createdAt' | 'status'>): Promise<string | null> {
  const headers = getHeaders()

  if (!headers || !config.NOTION_DATABASE_ID) {
    console.log('[DEV] Would create lead:', lead)
    return lead.sessionId
  }

  try {
    const response = await fetch(`${NOTION_API_URL}/pages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parent: { database_id: config.NOTION_DATABASE_ID },
        properties: {
          'Session ID': {
            title: [{ text: { content: lead.sessionId } }],
          },
          'Prénom': {
            rich_text: [{ text: { content: lead.firstName } }],
          },
          'Email': {
            email: lead.email,
          },
          'Entreprise': {
            rich_text: [{ text: { content: lead.company || '' } }],
          },
          'Secteur': {
            select: { name: lead.sector },
          },
          'Statut': {
            select: { name: 'started' },
          },
          'Créé le': {
            date: { start: new Date().toISOString() },
          },
        },
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      console.error('Notion create error:', error)
      return null
    }

    const data = await response.json()
    return data.id
  } catch (error) {
    console.error('Notion create error:', error)
    return null
  }
}

// Trouver un lead par sessionId
async function findLeadBySessionId(sessionId: string): Promise<string | null> {
  const headers = getHeaders()

  if (!headers || !config.NOTION_DATABASE_ID) return null

  try {
    const response = await fetch(`${NOTION_API_URL}/databases/${config.NOTION_DATABASE_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          property: 'Session ID',
          title: { equals: sessionId },
        },
        page_size: 1,
      }),
    })

    if (!response.ok) return null

    const data = await response.json()
    return data.results?.[0]?.id || null
  } catch (error) {
    console.error('Notion query error:', error)
    return null
  }
}

// Mettre à jour le statut d'un lead
export async function updateLeadStatus(
  sessionId: string,
  status: Lead['status'],
  additionalFields?: Partial<{ score: string; conversationHistory: string; reportSentAt: string }>
): Promise<boolean> {
  const headers = getHeaders()

  if (!headers) {
    console.log('[DEV] Would update lead:', sessionId, status, additionalFields)
    return true
  }

  try {
    const pageId = await findLeadBySessionId(sessionId)
    if (!pageId) return false

    const properties: Record<string, any> = {
      'Statut': { select: { name: status } },
    }

    if (additionalFields?.score) {
      properties['Score'] = { rich_text: [{ text: { content: additionalFields.score } }] }
    }
    if (additionalFields?.conversationHistory) {
      properties['Historique'] = { rich_text: [{ text: { content: additionalFields.conversationHistory.slice(0, 2000) } }] }
    }
    if (additionalFields?.reportSentAt) {
      properties['Rapport envoyé le'] = { date: { start: additionalFields.reportSentAt } }
    }

    const response = await fetch(`${NOTION_API_URL}/pages/${pageId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ properties }),
    })

    return response.ok
  } catch (error) {
    console.error('Notion update error:', error)
    return false
  }
}

// Vérifier si un email a déjà fait un diagnostic récemment
export async function hasRecentDiagnostic(email: string): Promise<boolean> {
  const headers = getHeaders()

  if (!headers || !config.NOTION_DATABASE_ID) return false

  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const response = await fetch(`${NOTION_API_URL}/databases/${config.NOTION_DATABASE_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          and: [
            { property: 'Email', email: { equals: email.toLowerCase() } },
            { property: 'Créé le', date: { after: yesterday } },
          ],
        },
        page_size: 1,
      }),
    })

    if (!response.ok) return false

    const data = await response.json()
    return data.results?.length > 0
  } catch (error) {
    console.error('Notion check error:', error)
    return false
  }
}
