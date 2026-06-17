// CSS module declarations
declare module '*.css' {
  const content: { [className: string]: string }
  export default content
}

declare module 'xterm/css/xterm.css'

// jpeg-js ships no type definitions. We only use the encoder.
declare module 'jpeg-js' {
  interface RawImageData {
    data: Uint8Array | Buffer
    width: number
    height: number
  }
  export function encode(imgData: RawImageData, quality?: number): RawImageData
  export function decode(jpegData: Uint8Array | Buffer, opts?: Record<string, unknown>): RawImageData
  const _default: { encode: typeof encode; decode: typeof decode }
  export default _default
}
