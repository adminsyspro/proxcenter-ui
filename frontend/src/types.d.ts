// CSS module declarations
declare module '*.css' {
  const content: { [className: string]: string }
  export default content
}

declare module 'xterm/css/xterm.css'
