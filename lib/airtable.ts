import Airtable from 'airtable'
import { config, Sector } from './config'

// Configuration Airtable
let base: Airtable.Base | null = null

if (config.AIRTABLE_API_KEY && config.AIRTABLE_BASE_ID) {
  Airtable.configure({ apiKey: config.AIRTABLE_API_KEY })
  base = Airtable.base(config.AIRTABLE_BASE_ID)
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

// Créer un nouveau lead
export async function createLead(lead: Omit<Lead, 'createdAt' | 'status'>): Promise<string | null> {
  if (!base) {
    console.log('[DEV] Would create lead:', lead)
    return lead.sessionId
  }

  try {
    const record = await base('Leads').create({
      'Session ID': lead.sessionId,
      'Prénom': lead.firstName,
      'Email': lead.email,
      'Entreprise': lead.company || '',
      'Secteur': lead.sector,
      'Créé le': new Date().toISOString(),
      'Statut': 'started',
    })
    return record.id
  } catch (error) {
    console.error('Airtable create error:', error)
    return null
  }
}

// Mettre à jour le statut d'un lead
export async function updateLeadStatus(
  sessionId: string,
  status: Lead['status'],
  additionalFields?: Partial<{ score: string; conversationHistory: string; reportSentAt: string }>
): Promise<boolean> {
  if (!base) {
    console.log('[DEV] Would update lead:', sessionId, status, additionalFields)
    return true
  }

  try {
    // Trouver le record par sessionId
    const records = await base('Leads')
      .select({
        filterByFormula: `{Session ID} = '${sessionId}'`,
        maxRecords: 1,
      })
      .firstPage()

    if (records.length === 0) return false

    const updateData: Record<string, string> = { 'Statut': status }

    if (additionalFields?.score) {
      updateData['Score'] = additionalFields.score
    }
    if (additionalFields?.conversationHistory) {
      updateData['Historique conversation'] = additionalFields.conversationHistory
    }
    if (additionalFields?.reportSentAt) {
      updateData['Rapport envoyé le'] = additionalFields.reportSentAt
    }

    await base('Leads').update(records[0].id, updateData)
    return true
  } catch (error) {
    console.error('Airtable update error:', error)
    return false
  }
}

// Vérifier si un email a déjà fait un diagnostic récemment
export async function hasRecentDiagnostic(email: string): Promise<boolean> {
  if (!base) return false

  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const records = await base('Leads')
      .select({
        filterByFormula: `AND({Email} = '${email.toLowerCase()}', {Créé le} >= '${yesterday}')`,
        maxRecords: 1,
      })
      .firstPage()

    return records.length > 0
  } catch (error) {
    console.error('Airtable check error:', error)
    return false
  }
}
