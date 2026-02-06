/**
 * Index des articles de blog pour les citations par les agents
 * Sprint 4 - Base de connaissances & FAQ
 */

import type { AgentId } from './team-prompts'

export interface ArticleIndex {
  slug: string
  title: string
  // Mots-clés pour le matching avec les questions utilisateurs
  keywords: string[]
  // Agent(s) qui peuvent citer cet article
  relevantAgents: AgentId[]
  // Résumé court pour les citations (max 2 phrases)
  citationSummary: string
}

export const ARTICLES_INDEX: ArticleIndex[] = [
  {
    slug: 'gouvernance-ia-pme',
    title: 'Gouvernance IA : par où commencer pour une PME ?',
    keywords: [
      'gouvernance', 'règles', 'politique', 'encadrement', 'charte',
      'déploiement', 'commencer', 'débuter', 'premier pas', 'pme',
      'organisation', 'cadre', 'bonnes pratiques'
    ],
    relevantAgents: ['lea', 'sophie'],
    citationSummary: 'Cet article présente les 5 règles fondamentales de gouvernance IA : définir un périmètre clair, nommer un référent, établir des règles d\'usage, former les équipes et mesurer l\'adoption.',
  },
  {
    slug: 'loi-25-ia',
    title: 'Loi 25 et IA : ce que les PME doivent savoir',
    keywords: [
      'loi 25', 'loi25', 'rgpd', 'conformité', 'données personnelles',
      'vie privée', 'consentement', 'québec', 'légal', 'juridique',
      'protection', 'confidentialité', 'réglementation'
    ],
    relevantAgents: ['lea', 'sophie'],
    citationSummary: 'La Loi 25 impose aux entreprises de documenter leurs usages IA, d\'informer les utilisateurs et de protéger les données personnelles.',
  },
  {
    slug: 'shadow-ai-risques',
    title: 'Shadow AI : les risques cachés de ChatGPT en entreprise',
    keywords: [
      'shadow ai', 'chatgpt', 'risque', 'risques', 'employés', 'usage',
      'non contrôlé', 'encadrer', 'bloquer', 'sécurité', 'fuite',
      'données', 'confidentialité', 'copilot', 'claude'
    ],
    relevantAgents: ['lea', 'marc'],
    citationSummary: 'Le Shadow AI représente un risque majeur : fuite de données, non-conformité, hallucinations non détectées. La solution : offrir des outils encadrés plutôt qu\'interdire.',
  },
]

/**
 * Trouve les articles pertinents pour une question donnée
 * @param question La question de l'utilisateur
 * @param agentId L'agent qui pose la question (pour filtrer par pertinence)
 * @param maxResults Nombre max d'articles à retourner
 */
export function findRelevantArticles(
  question: string,
  agentId?: AgentId,
  maxResults: number = 1
): ArticleIndex[] {
  const lowerQuestion = question.toLowerCase()

  // Score chaque article basé sur les mots-clés matchés
  const scoredArticles = ARTICLES_INDEX.map(article => {
    let score = 0

    // Bonus si l'agent est pertinent pour cet article
    if (agentId && article.relevantAgents.includes(agentId)) {
      score += 1
    }

    // Score basé sur les mots-clés
    for (const keyword of article.keywords) {
      if (lowerQuestion.includes(keyword.toLowerCase())) {
        score += 2
      }
    }

    return { article, score }
  })

  // Filtrer et trier par score
  return scoredArticles
    .filter(item => item.score >= 3) // Au moins 1 keyword match + agent pertinent
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(item => item.article)
}

/**
 * Génère un bloc de citation à ajouter à la réponse de l'agent
 */
export function formatArticleCitation(articles: ArticleIndex[]): string {
  if (articles.length === 0) return ''

  const citations = articles.map(article =>
    `Pour en savoir plus, consulte notre article "${article.title}" sur notre blog (/blog/${article.slug}).`
  )

  return '\n\n' + citations.join('\n')
}
