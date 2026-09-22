// Platform globals the library touches, declared ambiently so consumers do not
// inherit lib.dom by importing this package (same approach as the parser).
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
