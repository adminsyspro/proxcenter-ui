'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material'

interface ReportType {
  type: string
  name: string
  description: string
  sections: Array<{
    id: string
    name: string
    description: string
  }>
}

interface Language {
  code: string
  name: string
}

interface ReportGeneratorProps {
  reportTypes: ReportType[]
  languages: Language[]
  onGenerate: (request: any) => Promise<void>
  loading: boolean
}

export default function ReportGenerator({ reportTypes, languages, onGenerate, loading }: ReportGeneratorProps) {
  const t = useTranslations()
  const [generating, setGenerating] = useState(false)

  // Form state
  const [selectedType, setSelectedType] = useState('')
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('en')

  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date()

    date.setMonth(date.getMonth() - 1)

    return date.toISOString().split('T')[0]
  })

  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedSections, setSelectedSections] = useState<string[]>([])
  const [allSections, setAllSections] = useState(true)

  const selectedReportType = reportTypes.find(rt => rt.type === selectedType)

  const handleTypeChange = (type: string) => {
    setSelectedType(type)
    setSelectedSections([])
    setAllSections(true)
  }

  const handleSectionToggle = (sectionId: string) => {
    if (selectedSections.includes(sectionId)) {
      setSelectedSections(selectedSections.filter(s => s !== sectionId))
    } else {
      setSelectedSections([...selectedSections, sectionId])
    }
  }

  const handleAllSectionsToggle = () => {
    if (allSections) {
      setAllSections(false)
      setSelectedSections([])
    } else {
      setAllSections(true)
      setSelectedSections([])
    }
  }

  const handleGenerate = async () => {
    if (!selectedType || !dateFrom || !dateTo) return

    setGenerating(true)

    try {
      await onGenerate({
        type: selectedType,
        name: name || undefined,
        date_from: dateFrom,
        date_to: dateTo,
        sections: allSections ? [] : selectedSections,
        language: language,
      })

      // Reset form after successful generation
      setName('')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Box sx={{ p: 3, overflow: 'auto' }}>
      <Typography variant="h6" sx={{ mb: 3 }}>
        {t('reports.newReport')}
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 800 }}>
        {/* Report Type Selection */}
        <FormControl fullWidth>
          <InputLabel>{t('reports.reportType')}</InputLabel>
          <Select
            value={selectedType}
            label={t('reports.reportType')}
            onChange={(e) => handleTypeChange(e.target.value)}
          >
            {reportTypes.map((rt) => (
              <MenuItem key={rt.type} value={rt.type}>
                <Box>
                  <Typography variant="body1">{rt.name}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {rt.description}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Report Name (optional) */}
        <TextField
          label={t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={selectedType ? `${selectedReportType?.name || selectedType} Report` : ''}
          helperText={t('common.optional')}
        />

        {/* Date Range */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label={t('reports.dateFrom')}
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            label={t('reports.dateTo')}
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
        </Box>

        {/* Language Selection */}
        <FormControl fullWidth>
          <InputLabel>{t('reports.language')}</InputLabel>
          <Select
            value={language}
            label={t('reports.language')}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {languages.map((lang) => (
              <MenuItem key={lang.code} value={lang.code}>
                {lang.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Sections Selection */}
        {selectedReportType && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
                {t('reports.sections')}
              </Typography>

              <FormGroup>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={allSections}
                      onChange={handleAllSectionsToggle}
                    />
                  }
                  label={t('reports.allSections')}
                />

                {!allSections && (
                  <Box sx={{ pl: 3, mt: 1 }}>
                    {selectedReportType.sections.map((section) => (
                      <FormControlLabel
                        key={section.id}
                        control={
                          <Checkbox
                            checked={selectedSections.includes(section.id)}
                            onChange={() => handleSectionToggle(section.id)}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="body2">{section.name}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>
                              {section.description}
                            </Typography>
                          </Box>
                        }
                        sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}
                      />
                    ))}
                  </Box>
                )}
              </FormGroup>
            </CardContent>
          </Card>
        )}

        {/* Generate Button */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={!selectedType || generating || loading}
            startIcon={generating ? <CircularProgress size={20} color="inherit" /> : <i className="ri-file-pdf-line" />}
            size="large"
          >
            {generating ? t('reports.generating') : t('reports.generate')}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
