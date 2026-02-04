'use client';

import { ReactNode } from 'react';

import { usePathname } from 'next/navigation';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';

export default function DashboardWidthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Routes "console" à afficher en pleine largeur
  const fullWidth =
    pathname.startsWith('/infrastructure/inventory');

  if (fullWidth) {
    // IMPORTANT: pas de Container => full width réel
    return (
      <Box sx={{ width: '100%', maxWidth: '100%', p: 0, m: 0 }}>
        {children}
      </Box>
    );
  }

  // Comportement normal (pages centrées)
  return (
    <Container maxWidth="lg">
      {children}
    </Container>
  );
}

