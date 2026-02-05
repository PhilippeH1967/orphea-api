import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

interface DiagnosticScores {
  vision: number
  competences: number
  gouvernance: number
  processus: number
  data: number
  outils: number
}

interface ReportData {
  firstName: string
  company?: string
  sector: string
  scores: DiagnosticScores
  grade: string
  summary: string
  recommendations: string[]
  pack: string
}

const DIMENSION_LABELS: Record<string, string> = {
  vision: 'Vision strategique',
  competences: 'Competences IA',
  gouvernance: 'Gouvernance',
  processus: 'Processus',
  data: 'Donnees',
  outils: 'Outils techniques',
}

const GRADE_DESCRIPTIONS: Record<string, string> = {
  A: 'Leader IA - Strategie claire, gouvernance mature',
  B: 'Avance - Usages structures, quelques lacunes',
  C: 'Experimentateur - Usages informels, pas de cadre',
  D: 'Debutant - Interet mais peu d\'actions concretes',
  E: 'Non initie - Aucune demarche IA',
}

const PACK_DESCRIPTIONS: Record<string, string> = {
  'Pack 1': 'Sprint IA - Cadrage initial et premiers quick wins',
  'Pack 2': 'Scale IA - Structuration avec gouvernance et formation',
  'Pack 3': 'Transform IA - Transformation complete et industrialisation',
}

export async function generateDiagnosticPDF(data: ReportData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595, 842]) // A4

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const { width, height } = page.getSize()

  // Colors
  const navy = rgb(0, 0.12, 0.25)
  const cyan = rgb(0, 0.71, 0.85)
  const gray = rgb(0.4, 0.4, 0.4)
  const lightGray = rgb(0.9, 0.9, 0.9)

  let y = height - 50

  // Header
  page.drawText('ORPHEA Conseil', {
    x: 50,
    y,
    size: 24,
    font: helveticaBold,
    color: navy,
  })
  y -= 20
  page.drawText('Accelerateur de transformation IA pour PME', {
    x: 50,
    y,
    size: 10,
    font: helvetica,
    color: gray,
  })

  // Line
  y -= 20
  page.drawLine({
    start: { x: 50, y },
    end: { x: width - 50, y },
    thickness: 2,
    color: cyan,
  })

  // Title
  y -= 40
  page.drawText('Rapport de Diagnostic IA', {
    x: 50,
    y,
    size: 20,
    font: helveticaBold,
    color: navy,
  })

  // Info box
  y -= 40
  page.drawRectangle({
    x: 50,
    y: y - 50,
    width: width - 100,
    height: 60,
    color: lightGray,
  })

  y -= 15
  page.drawText(`Realise pour: ${data.firstName}${data.company ? ` - ${data.company}` : ''}`, {
    x: 60,
    y,
    size: 11,
    font: helvetica,
    color: navy,
  })
  y -= 15
  page.drawText(`Secteur: ${data.sector}`, {
    x: 60,
    y,
    size: 11,
    font: helvetica,
    color: navy,
  })
  y -= 15
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  page.drawText(`Date: ${date}`, {
    x: 60,
    y,
    size: 11,
    font: helvetica,
    color: navy,
  })

  // Grade box
  y -= 50
  page.drawRectangle({
    x: 50,
    y: y - 70,
    width: width - 100,
    height: 80,
    color: navy,
  })

  y -= 25
  page.drawText('Votre niveau de maturite IA', {
    x: 60,
    y,
    size: 12,
    font: helvetica,
    color: rgb(1, 1, 1),
  })
  y -= 35
  page.drawText(data.grade, {
    x: 60,
    y,
    size: 48,
    font: helveticaBold,
    color: cyan,
  })
  page.drawText(GRADE_DESCRIPTIONS[data.grade] || '', {
    x: 120,
    y: y + 15,
    size: 10,
    font: helvetica,
    color: rgb(0.8, 0.8, 0.8),
  })

  // Summary
  y -= 50
  page.drawText('Synthese', {
    x: 50,
    y,
    size: 14,
    font: helveticaBold,
    color: navy,
  })
  y -= 20
  // Word wrap summary
  const summaryWords = data.summary.split(' ')
  let line = ''
  for (const word of summaryWords) {
    const testLine = line + (line ? ' ' : '') + word
    if (testLine.length > 80) {
      page.drawText(line, { x: 50, y, size: 11, font: helvetica, color: gray })
      y -= 15
      line = word
    } else {
      line = testLine
    }
  }
  if (line) {
    page.drawText(line, { x: 50, y, size: 11, font: helvetica, color: gray })
    y -= 15
  }

  // Scores
  y -= 25
  page.drawText('Scores par dimension', {
    x: 50,
    y,
    size: 14,
    font: helveticaBold,
    color: navy,
  })

  y -= 25
  const avgScore = Math.round(Object.values(data.scores).reduce((a, b) => a + b, 0) / 6)

  for (const [key, value] of Object.entries(data.scores)) {
    const label = DIMENSION_LABELS[key] || key
    page.drawText(label, { x: 50, y, size: 10, font: helvetica, color: navy })

    // Score bar background
    page.drawRectangle({
      x: 180,
      y: y - 3,
      width: 200,
      height: 12,
      color: lightGray,
    })

    // Score bar
    const barColor = value >= 60 ? rgb(0.1, 0.6, 0.3) : value >= 40 ? rgb(0.9, 0.6, 0.1) : rgb(0.8, 0.2, 0.2)
    page.drawRectangle({
      x: 180,
      y: y - 3,
      width: (value / 100) * 200,
      height: 12,
      color: barColor,
    })

    page.drawText(`${value}/100`, { x: 390, y, size: 10, font: helveticaBold, color: navy })
    y -= 20
  }

  y -= 10
  page.drawText(`Score moyen: ${avgScore}/100`, {
    x: 50,
    y,
    size: 12,
    font: helveticaBold,
    color: navy,
  })

  // Recommendations
  y -= 35
  page.drawText('Nos recommandations prioritaires', {
    x: 50,
    y,
    size: 14,
    font: helveticaBold,
    color: navy,
  })

  y -= 20
  for (let i = 0; i < data.recommendations.length; i++) {
    const rec = data.recommendations[i]
    page.drawText(`${i + 1}.`, { x: 50, y, size: 11, font: helveticaBold, color: cyan })

    // Word wrap recommendation
    const recWords = rec.split(' ')
    let recLine = ''
    let firstLine = true
    for (const word of recWords) {
      const testLine = recLine + (recLine ? ' ' : '') + word
      if (testLine.length > 70) {
        page.drawText(recLine, { x: firstLine ? 70 : 70, y, size: 10, font: helvetica, color: gray })
        y -= 14
        recLine = word
        firstLine = false
      } else {
        recLine = testLine
      }
    }
    if (recLine) {
      page.drawText(recLine, { x: 70, y, size: 10, font: helvetica, color: gray })
      y -= 18
    }
  }

  // Pack recommendation
  y -= 15
  page.drawRectangle({
    x: 50,
    y: y - 45,
    width: width - 100,
    height: 55,
    color: navy,
  })

  y -= 15
  page.drawText('Accompagnement recommande', {
    x: 60,
    y,
    size: 12,
    font: helvetica,
    color: rgb(1, 1, 1),
  })
  y -= 18
  page.drawText(data.pack, {
    x: 60,
    y,
    size: 14,
    font: helveticaBold,
    color: cyan,
  })
  y -= 15
  page.drawText(PACK_DESCRIPTIONS[data.pack] || '', {
    x: 60,
    y,
    size: 10,
    font: helvetica,
    color: rgb(0.8, 0.8, 0.8),
  })

  // CTA
  y -= 45
  page.drawRectangle({
    x: 50,
    y: y - 45,
    width: width - 100,
    height: 55,
    color: lightGray,
    borderColor: cyan,
    borderWidth: 2,
  })

  y -= 15
  page.drawText('Prochaine etape', {
    x: 60,
    y,
    size: 12,
    font: helveticaBold,
    color: navy,
  })
  y -= 15
  page.drawText('Prenez rendez-vous pour un appel decouverte de 30 minutes.', {
    x: 60,
    y,
    size: 10,
    font: helvetica,
    color: gray,
  })
  y -= 12
  page.drawText('orphea-conseil.com/rendez-vous', {
    x: 60,
    y,
    size: 10,
    font: helveticaBold,
    color: cyan,
  })

  // Footer
  page.drawLine({
    start: { x: 50, y: 40 },
    end: { x: width - 50, y: 40 },
    thickness: 1,
    color: lightGray,
  })

  page.drawText('ORPHEA Conseil - orphea-conseil.com', {
    x: 50,
    y: 25,
    size: 8,
    font: helvetica,
    color: gray,
  })
  page.drawText('Document genere automatiquement', {
    x: width - 180,
    y: 25,
    size: 8,
    font: helvetica,
    color: gray,
  })

  return pdfDoc.save()
}
