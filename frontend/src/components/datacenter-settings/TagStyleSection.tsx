'use client'

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

interface TagColorEntry {
  tag: string
  bg: string
  fg: string
}

interface Props {
  tagColors: TagColorEntry[]
  tagShape: string
  tagOrdering: string
  tagCaseSensitive: boolean
  onTagColorsChange: (colors: TagColorEntry[]) => void
  onTagShapeChange: (shape: string) => void
  onTagOrderingChange: (ordering: string) => void
  onTagCaseSensitiveChange: (value: boolean) => void
  t: (key: string) => string
}

export default function TagStyleSection({
  tagColors, tagShape, tagOrdering, tagCaseSensitive,
  onTagColorsChange, onTagShapeChange, onTagOrderingChange, onTagCaseSensitiveChange,
  t,
}: Props) {
  const theme = useTheme()

  const addTagColor = () => {
    onTagColorsChange([...tagColors, { tag: '', bg: '#1565c0', fg: '#ffffff' }])
  }

  const updateTagColor = (index: number, field: keyof TagColorEntry, value: string) => {
    onTagColorsChange(tagColors.map((e, i) => i === index ? { ...e, [field]: value } : e))
  }

  const removeTagColor = (index: number) => {
    onTagColorsChange(tagColors.filter((_, i) => i !== index))
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <i className="ri-price-tag-3-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
          <Typography variant="subtitle1" fontWeight={700}>{t('dcSettingsTagStyleTitle')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('dcSettingsTagStyleDesc')}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('dcSettingsTagShape')}</InputLabel>
            <Select
              value={tagShape}
              label={t('dcSettingsTagShape')}
              onChange={e => onTagShapeChange(e.target.value)}
            >
              <MenuItem value="full">{t('dcSettingsTagShapeFull')}</MenuItem>
              <MenuItem value="circle">{t('dcSettingsTagShapeCircle')}</MenuItem>
              <MenuItem value="dense">{t('dcSettingsTagShapeDense')}</MenuItem>
              <MenuItem value="none">{t('dcSettingsTagShapeNone')}</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('dcSettingsTagOrdering')}</InputLabel>
            <Select
              value={tagOrdering}
              label={t('dcSettingsTagOrdering')}
              onChange={e => onTagOrderingChange(e.target.value)}
            >
              <MenuItem value="config">{t('dcSettingsTagOrderingConfig')}</MenuItem>
              <MenuItem value="alphabetical">{t('dcSettingsTagOrderingAlpha')}</MenuItem>
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={tagCaseSensitive}
                onChange={e => onTagCaseSensitiveChange(e.target.checked)}
                size="small"
              />
            }
            label={<Typography variant="body2">{t('dcSettingsTagCaseSensitive')}</Typography>}
          />
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('dcSettingsTagColors')}</Typography>

        {tagColors.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('dcSettingsNoOverrides')}
          </Typography>
        )}

        <Stack spacing={1} sx={{ mb: 1.5 }}>
          {tagColors.map((entry, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                label={t('dcSettingsTagName')}
                value={entry.tag}
                onChange={e => updateTagColor(i, 'tag', e.target.value)}
                sx={{ width: 160 }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary">{t('dcSettingsTagBg')}</Typography>
                <input
                  type="color"
                  value={entry.bg}
                  onChange={e => updateTagColor(i, 'bg', e.target.value)}
                  style={{ width: 32, height: 32, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary">{t('dcSettingsTagFg')}</Typography>
                <input
                  type="color"
                  value={entry.fg}
                  onChange={e => updateTagColor(i, 'fg', e.target.value)}
                  style={{ width: 32, height: 32, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                />
              </Box>
              <Chip
                label={entry.tag || 'tag'}
                size="small"
                sx={{
                  bgcolor: entry.bg,
                  color: entry.fg,
                  fontWeight: 600,
                  fontSize: 11,
                  height: 22,
                  borderRadius: tagShape === 'circle' ? '50%' : tagShape === 'dense' ? 0.5 : 1,
                  minWidth: tagShape === 'circle' ? 22 : undefined,
                  '& .MuiChip-label': { px: tagShape === 'circle' ? 0 : 0.75 },
                }}
              />
              <IconButton size="small" onClick={() => removeTagColor(i)} color="error">
                <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Stack>
          ))}
        </Stack>

        <Button
          size="small"
          startIcon={<i className="ri-add-line" />}
          onClick={addTagColor}
          variant="outlined"
        >
          {t('dcSettingsAddTag')}
        </Button>
      </CardContent>
    </Card>
  )
}
