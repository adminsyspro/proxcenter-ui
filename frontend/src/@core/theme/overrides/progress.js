const progress = {
  MuiLinearProgress: {
    styleOverrides: {
      root: {
        height: 6,
        borderRadius: 'var(--mui-shape-borderRadius)',
        '& .MuiLinearProgress-bar': {
          borderRadius: 'var(--mui-shape-borderRadius)'
        }
      }
    }
  }
}

export default progress
