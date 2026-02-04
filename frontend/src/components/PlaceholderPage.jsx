'use client'

// MUI Imports
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'

// Component Imports
import PageHeader from '@components/PageHeader'

const PlaceholderPage = ({ title, subtitle, todos = [] }) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <PageHeader title={title} subtitle={subtitle} />

      <Grid container spacing={6}>
        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant='h6' sx={{ mb: 2 }}>
                Démarrage rapide
              </Typography>
              <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                Cette page est un squelette pour démarrer. Remplace les cartes par tes composants (tables, graphs, forms)
                et branche les appels API.
              </Typography>

              {todos.length ? (
                <List dense>
                  {todos.map((t, idx) => (
                    <ListItem key={idx} disableGutters>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <i className='ri-checkbox-blank-circle-line text-[10px]' />
                      </ListItemIcon>
                      <ListItemText primary={t} />
                    </ListItem>
                  ))}
                </List>
              ) : null}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant='h6' sx={{ mb: 2 }}>
                Idées UI
              </Typography>
              <List dense>
                <ListItem disableGutters>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <i className='ri-table-line' />
                  </ListItemIcon>
                  <ListItemText primary='Table + filtres (recherche, tags, état)' />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <i className='ri-line-chart-line' />
                  </ListItemIcon>
                  <ListItemText primary='Graphes: CPU/RAM/IO + tendances' />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <i className='ri-settings-3-line' />
                  </ListItemIcon>
                  <ListItemText primary='Actions rapides (migrations, start/stop, apply policy)' />
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}

export default PlaceholderPage
