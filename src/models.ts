export interface SourceLine {
    filename: string
    lineno: number
    line: string
}

export interface Label {
    kind: '.text' | '.data'
    value: number
    name: string
}

export interface MipsProgram {
    name: string
    labels: { [name: string]: Label }
    source: SourceLine[]
    memory: string
    registers: { [regname: string]: number }
}

export interface DebugMessage {
    command: 'start' | 'step' | 'continue' | 'stop'
    program: MipsProgram
    breakpoints?: number[]
    message?: string
    error?: boolean
}
