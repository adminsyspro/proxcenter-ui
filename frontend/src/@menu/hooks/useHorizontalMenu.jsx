// React Imports
import { useContext } from 'react'

// Context Imports
import { HorizontalMenuContext } from '../components/horizontal-menu/Menu'

const useHorizontalMenu = () => {
  // Hooks
  const context = useContext(HorizontalMenuContext)

  if (context === undefined) {
    //TODO: set better error message
    throw new Error('Menu Component is required!')
  }

  return context
}

export default useHorizontalMenu
