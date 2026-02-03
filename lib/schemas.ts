import { z } from 'zod'
import { SECTORS } from './config'

// Schéma pour démarrer un diagnostic
export const startDiagnosticSchema = z.object({
  firstName: z
    .string()
    .min(2, 'Le prénom doit contenir au moins 2 caractères')
    .max(50, 'Le prénom ne peut pas dépasser 50 caractères')
    .transform(s => s.trim()),

  email: z
    .string()
    .email('Adresse email invalide')
    .max(254, 'Email trop long')
    .transform(s => s.toLowerCase().trim()),

  company: z
    .string()
    .max(100, 'Nom d\'entreprise trop long')
    .optional()
    .transform(s => s?.trim()),

  sector: z.enum(SECTORS, {
    errorMap: () => ({ message: 'Secteur invalide' }),
  }),

  // reCAPTCHA token
  recaptchaToken: z.string().optional(),

  // Honeypot field (doit être vide)
  website: z.string().max(0, 'Champ invalide').optional(),
})

export type StartDiagnosticInput = z.infer<typeof startDiagnosticSchema>

// Schéma pour envoyer un message au chat
export const chatMessageSchema = z.object({
  sessionId: z.string().uuid('Session invalide'),
  message: z
    .string()
    .min(1, 'Message requis')
    .max(2000, 'Message trop long')
    .transform(s => s.trim()),
})

export type ChatMessageInput = z.infer<typeof chatMessageSchema>

// Schéma pour compléter un diagnostic
export const completeDiagnosticSchema = z.object({
  sessionId: z.string().uuid('Session invalide'),
})

export type CompleteDiagnosticInput = z.infer<typeof completeDiagnosticSchema>
