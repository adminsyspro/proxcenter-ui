const menuRootStyles = theme => {
  return {
    '& > ul > li:not(:last-of-type)': {
      marginInlineEnd: theme.spacing(0.5)
    }
  }
}

export default menuRootStyles
