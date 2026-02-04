const menuRootStyles = theme => {
  return {
    '& > ul > li:not(:last-of-type)': {
      marginInlineEnd: theme.spacing(2)
    }
  }
}

export default menuRootStyles
