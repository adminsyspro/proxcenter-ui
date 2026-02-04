export default function FullscreenLayout({ children }) {
  return (
    <div style={{ 
      position: 'fixed',
      inset: 0,
      margin: 0, 
      padding: 0, 
      overflow: 'hidden',
      background: '#000'
    }}>
      {children}
    </div>
  )
}
