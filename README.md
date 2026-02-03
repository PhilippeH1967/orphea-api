# ORPHEA API

API serverless pour l'agent de diagnostic IA ORPHEA Conseil.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORPHEA Site (Hostinger)                       │
│                         orphea-conseil.com                       │
└────────────────────────────┬────────────────────────────────────┘
                             │ fetch
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ORPHEA API (Vercel)                          │
│                      api.orphea-conseil.com                      │
│                                                                  │
│   /api/diagnostic/start    → Créer session + lead               │
│   /api/diagnostic/chat     → Conversation avec l'agent          │
│   /api/diagnostic/complete → Générer rapport                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
     Claude API         Airtable            Resend
     (LLM)              (Leads)            (Emails)
```

## Stack

- **Runtime**: Vercel Serverless Functions
- **Language**: TypeScript
- **LLM**: Claude API (Anthropic)
- **Rate Limiting**: Upstash Redis
- **Database**: Airtable
- **Email**: Resend

## Développement

```bash
# Installer les dépendances
npm install

# Copier et configurer les variables d'environnement
cp .env.example .env

# Lancer en développement
npm run dev
```

## Déploiement

```bash
# Déployer sur Vercel
vercel
```

## Sécurité

- CORS strict (orphea-conseil.com uniquement)
- Rate limiting par IP (3/heure)
- Rate limiting par email (1/24h)
- Quota global journalier (100/jour)
- reCAPTCHA v3
- Honeypot anti-bot
- Protection injection prompt
