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
    registers: { [registerName: string]: number }
}

export interface DebugMessage {
    command: 'start' | 'step' | 'continue' | 'stop'
    program: MipsProgram
    breakpoints?: number[]
    message?: string
    error?: boolean
}

export interface RPCReturn {
    result: unknown
}

export interface StartRPCReturn extends RPCReturn {
    result: { pid: number }
}

export interface ContinueRPCReturn extends RPCReturn {
    result: {
        stopped: boolean
        breakpoints: number[]
    } | {
        exited: boolean
    }
}

export interface StepRPCReturn {
    result: {
        stopped: boolean
    } | {
        exited: boolean
    }
}

export interface InfoRPCReturn extends RPCReturn {
    result: { program: MipsProgram }
}
