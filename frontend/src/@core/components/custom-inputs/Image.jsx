// MUI Imports
import Grid from '@mui/material/Grid'
import Checkbox from '@mui/material/Checkbox'
import { styled } from '@mui/material/styles'

// Third-party Imports
import classnames from 'classnames'

const Root = styled('div', {
  name: 'MuiCustomImage',
  slot: 'Root'
})({
  blockSize: '100%',
  display: 'flex',
  borderRadius: 'var(--mui-shape-borderRadius)',
  cursor: 'pointer',
  overflow: 'hidden',
  position: 'relative',
  alignItems: 'center',
  flexDirection: 'column',
  justifyContent: 'center',
  border: '1px solid var(--mui-palette-customColors-inputBorder)',
  '&:hover': {
    borderColor: 'var(--mui-palette-action-active)'
  },
  '&.active': {
    borderColor: 'var(--mui-palette-primary-main)'
  },
  '&:not(.active):not(:hover) .MuiCheckbox-root': {
    display: 'none'
  }
})

const CheckboxInput = styled(Checkbox, {
  name: 'MuiCustomImage',
  slot: 'Input'
})({
  top: 7,
  right: 7,
  position: 'absolute'
})

const Image = styled('img', {
  name: 'MuiCustomImage',
  slot: 'Image'
})({
  maxWidth: '100%'
})

const CustomCheckboxImg = props => {
  // Props
  const { type, data, name, selected, gridProps, handleChange, color = 'primary' } = props

  // Vars
  const { alt, img, value } = data

  const renderComponent = () => {
    return (
      <Grid {...gridProps}>
        <Root className={classnames({ active: selected.includes(value) })} onClick={() => handleChange(value)}>
          {typeof img === 'string' ? <Image src={img} alt={alt ?? `checkbox-image-${value}`} /> : img}
          {type === 'radio' ? null : (
            <CheckboxInput
              color={color}
              name={`${name}-${value}`}
              checked={selected.includes(value)}
              onChange={() => handleChange(value)}
            />
          )}
        </Root>
      </Grid>
    )
  }

  return data ? renderComponent() : null
}

export default CustomCheckboxImg
