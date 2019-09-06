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
    memory: {
        stack: string
        heap: string
        data: string
    }
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
    result: { stopped: boolean; breakpoints: number[] } | { exited: boolean }
}

export interface StepRPCReturn {
    result: { stopped: boolean } | { exited: boolean }
}

export interface InfoRPCReturn extends RPCReturn {
    program: MipsProgram
}

export type DebuggerMethods = 'start' | 'step' | 'continue' | 'stop' | 'info' | 'verify_breakpoints'

export interface DashmipsResponse {
    method: DebuggerMethods
    result?: any
    error?: any
}

export interface DashmipsBreakpointInfo {
    id: number
    path: string
    line: number
    column?: number
    condition?: string
    hitCondition?: string
    logMessage?: string
}
