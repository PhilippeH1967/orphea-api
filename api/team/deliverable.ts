// API Endpoint pour générer les mini-livrables
// Sprint 2 - EPIC-03 : Génération de Mini-Livrables

import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { AGENTS, AgentId } from '../../lib/team-prompts'

const anthropic = new Anthropic()

// Types de livrables
type DeliverableType = 'prioritization' | 'tool-comparison' | 'project-planning'

interface DeliverableRequest {
  type: DeliverableType
  conversationContext: string
  userName?: string
  companyName?: string
  sector?: string
}

// Prompts de génération pour chaque type de livrable
const DELIVERABLE_PROMPTS: Record<DeliverableType, { agent: AgentId; prompt: string }> = {
  prioritization: {
    agent: 'lea',
    prompt: `Tu es Léa, stratège IA chez ORPHEA Conseil. Génère une fiche de priorisation IA personnalisée basée sur cette conversation.

IMPORTANT : Réponds UNIQUEMENT avec un JSON valide, sans texte avant ou après.

Format attendu :
{
  "title": "Fiche de Priorisation IA - [Nom entreprise ou secteur]",
  "sections": [
    {
      "heading": "Contexte et Objectifs",
      "content": ["Analyse du contexte business", "Objectifs identifiés"]
    },
    {
      "heading": "Top 3 Cas d'Usage Prioritaires",
      "content": [
        "1. [Cas d'usage 1] - [Description claire de l'opportunité et impact attendu : gains de temps, qualité, coûts]",
        "2. [Cas d'usage 2] - [Description et impact]",
        "3. [Cas d'usage 3] - [Description et impact]"
      ]
    },
    {
      "heading": "Critères de Priorisation",
      "content": [
        "• Impact business : [Évaluation 1-5 étoiles avec justification courte]",
        "• Faisabilité technique : [Évaluation 1-5 étoiles]",
        "• Facilité d'adoption : [Évaluation 1-5 étoiles]",
        "• Délai de mise en œuvre : [Estimation]"
      ]
    },
    {
      "heading": "Recommandation ORPHEA",
      "content": ["Pack recommandé (Pack 1, 2 ou 3) avec justification personnalisée"]
    },
    {
      "heading": "Prochaines Étapes",
      "content": [
        "1. [Action concrète immédiate]",
        "2. [Action court terme]",
        "3. [Action moyen terme]"
      ]
    }
  ]
}

Contexte de la conversation :
{context}`,
  },

  'tool-comparison': {
    agent: 'marc',
    prompt: `Tu es Marc, expert technique IA chez ORPHEA Conseil. Génère un comparatif d'outils personnalisé basé sur cette conversation.

IMPORTANT : Réponds UNIQUEMENT avec un JSON valide, sans texte avant ou après.

Format attendu :
{
  "title": "Comparatif Outils IA - [Besoin identifié]",
  "sections": [
    {
      "heading": "Besoin Identifié",
      "content": ["Description précise du besoin technique", "Contraintes identifiées (budget, infrastructure, compétences)"]
    },
    {
      "heading": "Options Analysées",
      "content": [
        "━━━ OPTION 1 : [Nom outil] ━━━",
        "Forces : [liste des avantages]",
        "Limites : [liste des inconvénients]",
        "Coût estimé : [fourchette mensuelle/annuelle]",
        "Idéal pour : [type d'usage]",
        "",
        "━━━ OPTION 2 : [Nom outil] ━━━",
        "Forces : [liste]",
        "Limites : [liste]",
        "Coût estimé : [fourchette]",
        "Idéal pour : [type d'usage]",
        "",
        "━━━ OPTION 3 : [Nom outil] ━━━",
        "Forces : [liste]",
        "Limites : [liste]",
        "Coût estimé : [fourchette]",
        "Idéal pour : [type d'usage]"
      ]
    },
    {
      "heading": "Synthèse Comparative",
      "content": [
        "┌─────────────────┬──────────┬──────────┬──────────┐",
        "│ Critère         │ Option 1 │ Option 2 │ Option 3 │",
        "├─────────────────┼──────────┼──────────┼──────────┤",
        "│ Facilité intég. │ ★★★☆☆   │ ★★★★☆   │ ★★☆☆☆   │",
        "│ Coût            │ €€       │ €€€      │ €        │",
        "│ Sécurité        │ ★★★★☆   │ ★★★☆☆   │ ★★★★★   │",
        "│ Support FR      │ ★★☆☆☆   │ ★★★★☆   │ ★★★☆☆   │",
        "└─────────────────┴──────────┴──────────┴──────────┘"
      ]
    },
    {
      "heading": "Recommandation Technique",
      "content": ["Recommandation personnalisée avec justification technique", "Points d'attention pour l'implémentation"]
    }
  ]
}

Contexte de la conversation :
{context}`,
  },

  'project-planning': {
    agent: 'sophie',
    prompt: `Tu es Sophie, chef de projet IA chez ORPHEA Conseil. Génère un planning type projet personnalisé basé sur cette conversation.

IMPORTANT : Réponds UNIQUEMENT avec un JSON valide, sans texte avant ou après.

Format attendu :
{
  "title": "Planning Projet IA - [Type de projet]",
  "sections": [
    {
      "heading": "Périmètre du Projet",
      "content": ["Description du périmètre et objectifs", "Cas d'usage ciblé"]
    },
    {
      "heading": "Phase 1 : Cadrage (Semaines 1-2)",
      "content": [
        "• Atelier Direction : alignement vision et objectifs",
        "• Atelier Opérations : cartographie des processus actuels",
        "• Atelier TI : audit infrastructure et contraintes",
        "📄 Livrable : Matrice de priorisation Impact/Faisabilité/Risque"
      ]
    },
    {
      "heading": "Phase 2 : Conception (Semaines 3-4)",
      "content": [
        "• Spécification détaillée du cas d'usage pilote",
        "• Architecture technique préliminaire",
        "• Plan de gouvernance (Loi 25 / RGPD)",
        "📄 Livrable : Cahier des charges fonctionnel et technique"
      ]
    },
    {
      "heading": "Phase 3 : Développement (Semaines 5-10)",
      "content": [
        "• Développement itératif (sprints de 2 semaines)",
        "• Tests utilisateurs progressifs",
        "• Ajustements et optimisations",
        "📄 Livrable : Solution fonctionnelle en environnement de test"
      ]
    },
    {
      "heading": "Phase 4 : Déploiement (Semaines 11-12)",
      "content": [
        "• Formation des utilisateurs clés (session de 2h)",
        "• Mise en production pilote (groupe restreint)",
        "• Documentation et procédures",
        "📄 Livrable : Solution en production + équipe formée"
      ]
    },
    {
      "heading": "Équipe Projet Côté Client",
      "content": [
        "• Sponsor Direction : 2h/semaine (décisions, arbitrages)",
        "• Référent Métier : 4h/semaine (spécifications, tests)",
        "• Référent TI : 4h/semaine phases 2-4 (intégrations)",
        "• 2-3 Utilisateurs pilotes : disponibilité ponctuelle pour tests"
      ]
    },
    {
      "heading": "Facteurs Clés de Succès",
      "content": [
        "✓ Engagement visible et actif de la Direction",
        "✓ Périmètre pilote clairement délimité",
        "✓ Ressources internes identifiées et disponibles",
        "✓ Communication régulière avec les équipes impactées"
      ]
    },
    {
      "heading": "Budget et Pack Recommandé",
      "content": ["Recommandation de Pack ORPHEA adaptée au contexte"]
    }
  ]
}

Contexte de la conversation :
{context}`,
  },
}

// Fonction principale
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
    const { type, conversationContext, userName, companyName, sector } = req.body as DeliverableRequest

    if (!type || !conversationContext) {
      return res.status(400).json({ error: 'Missing required fields: type and conversationContext' })
    }

    if (!DELIVERABLE_PROMPTS[type]) {
      return res.status(400).json({ error: 'Invalid deliverable type' })
    }

    const { agent, prompt } = DELIVERABLE_PROMPTS[type]
    const agentConfig = AGENTS[agent]

    // Construire le contexte enrichi
    let enrichedContext = conversationContext
    if (userName) enrichedContext += `\nNom du visiteur : ${userName}`
    if (companyName) enrichedContext += `\nEntreprise : ${companyName}`
    if (sector) enrichedContext += `\nSecteur : ${sector}`

    // Générer le contenu avec Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt.replace('{context}', enrichedContext),
        },
      ],
    })

    // Extraire le texte de la réponse
    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    // Parser le JSON de la réponse
    let generatedContent
    try {
      // Nettoyer la réponse (enlever les balises de code markdown si présentes)
      let cleanedResponse = responseText.trim()
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.slice(7)
      }
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.slice(3)
      }
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3)
      }

      generatedContent = JSON.parse(cleanedResponse.trim())
    } catch {
      // Si le parsing échoue, créer un contenu par défaut
      console.error('Failed to parse JSON response:', responseText)
      generatedContent = {
        title: `Livrable ${type} - Génération`,
        sections: [
          {
            heading: 'Contenu généré',
            content: [responseText],
          },
        ],
      }
    }

    return res.status(200).json({
      success: true,
      agent: agent,
      agentName: agentConfig.name,
      deliverableType: type,
      content: generatedContent,
    })
  } catch (error) {
    console.error('Deliverable generation error:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to generate deliverable',
    })
  }
}
