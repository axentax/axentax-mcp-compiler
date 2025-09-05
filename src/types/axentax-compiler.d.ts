declare module 'axentax-compiler/dist/conductor.js' {
  export interface AllowAnnotation {
    name: string
    dualIdRestrictions: number[]
  }
  export interface ConvertToObj {
    id: number
    error: null | { message: string; line: number; linePos: number; token: string | null }
    response: any | null
    midi?: ArrayBuffer | null
    midiRequest?: true
    compileMsec?: number
  }
  export class Conductor {
    static convertToObj(
      hasStyleCompile: boolean,
      hasMidiBuild: boolean,
      syntax: string,
      allowAnnotation: AllowAnnotation[],
      chordDic: Map<any, any>,
      mapSeed: Record<string, any>
    ): ConvertToObj
  }
}

