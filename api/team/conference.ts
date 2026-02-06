// API Endpoint pour le Mode Conférence
// Sprint 3 - EPIC-05 : Mode Conférence (Multi-Agents)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { AGENTS, AgentId, AgentConfig } from '../../lib/team-prompts'

const anthropic = new Anthropic()

interface ConferenceRequest {
  sessionId: string
  message: string
  conversationContext?: string
}

interface AgentResponse {
  agent: AgentId
  agentName: string
  agentRole: string
  message: string
  color: string
}

// Génère une réponse pour un agent en mode conférence
async function getAgentResponse(
  agentConfig: AgentConfig,
  userMessage: string,
  otherResponses: string[],
  conversationContext?: string
): Promise<string> {
  // Construire le contexte pour l'agent
  let contextPrompt = agentConfig.systemPrompt

  // Ajouter le contexte de conversation si disponible
  if (conversationContext) {
    contextPrompt += `\n\n## CONTEXTE DE LA CONVERSATION PRÉCÉDENTE\n${conversationContext}`
  }

  // MODE CONFÉRENCE : override les règles de redirection
  // Chaque agent doit répondre directement depuis son expertise
  const conferenceOverride = `

## MODE CONFÉRENCE - RÈGLES SPÉCIALES (PRIORITAIRES)
Tu es en RÉUNION D'ÉQUIPE avec Léa, Marc et Sophie. Vous répondez ENSEMBLE au client.

RÈGLES CRITIQUES DU MODE CONFÉRENCE :
1. Tu DOIS répondre directement depuis TON expertise - ne redirige JAMAIS vers un collègue
2. Ne dis JAMAIS "Marc pourra t'expliquer" ou "Léa est mieux placée" - TU réponds TOI-MÊME
3. Apporte ta perspective UNIQUE de ${agentConfig.role}
4. Sois concis : 2-3 phrases maximum
5. Parle à la première personne : "Je recommande...", "De mon côté..."

TU NE DOIS PAS :
- Dire "demandez à Marc/Léa/Sophie"
- Dire "mon collègue pourra vous aider"
- Renvoyer vers un autre expert
- Te dérober en disant que ce n'est pas ton domaine

TU DOIS :
- Répondre directement avec ton point de vue d'expert ${agentConfig.role}
- Donner des conseils concrets depuis ton angle
`

  // Ajouter les réponses des autres agents si disponibles
  if (otherResponses.length > 0) {
    contextPrompt += conferenceOverride + `
## CE QUE TES COLLÈGUES ONT DIT :
${otherResponses.join('\n\n')}

Complète leurs propos avec TA perspective unique. Ne répète pas ce qu'ils ont dit.`
  } else {
    contextPrompt += conferenceOverride + `
Tu es le premier à parler. Donne ta perspective de ${agentConfig.role} sur la question.`
  }

  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 400,
    system: contextPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find(block => block.type === 'text')
  return textBlock?.text || 'Je réfléchis...'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { message, conversationContext } = req.body as ConferenceRequest

    if (!message) {
      return res.status(400).json({ error: 'Message required' })
    }

    const agentIds: AgentId[] = ['lea', 'marc', 'sophie']
    const responses: AgentResponse[] = []

    // Ordre de réponse : Léa d'abord (stratège), puis Marc (technique), puis Sophie (projet)
    // Chaque agent voit les réponses précédentes pour éviter les répétitions

    for (const agentId of agentIds) {
      const agentConfig = AGENTS[agentId]

      // Les réponses précédentes pour le contexte
      const previousResponses = responses.map(
        r => `${r.agentName} (${r.agentRole}) : ${r.message}`
      )

      const agentMessage = await getAgentResponse(
        agentConfig,
        message,
        previousResponses,
        conversationContext
      )

      responses.push({
        agent: agentId,
        agentName: agentConfig.name,
        agentRole: agentConfig.role,
        message: agentMessage,
        color: agentConfig.color,
      })
    }

    return res.status(200).json({
      success: true,
      question: message,
      responses,
      mode: 'conference',
    })
  } catch (error) {
    console.error('Conference mode error:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to generate conference responses',
    })
  }
}
