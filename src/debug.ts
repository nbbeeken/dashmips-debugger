import {
    Breakpoint,
    Handles,
    InitializedEvent,
    Logger,
    LoggingDebugSession,
    Scope,
    Source,
    StackFrame,
    StoppedEvent,
    TerminatedEvent,
    Thread,
    logger,
} from 'vscode-debugadapter'
import { DashmipsDebugClient, buildTerminalLaunchRequestParams } from './dashmips'
import { basename } from 'path'
import { DebugProtocol } from 'vscode-debugprotocol'
import { DashmipsBreakpointInfo } from './models'
import { Subject } from './subject'

const DEBUG_LOGS = true
export const THREAD_ID = 0
export const THREAD_NAME = 'main'

const enum VARIABLE_REF {
    _, // no zero
    REGISTERS,
    MEMORY_STACK,
    MEMORY_HEAP,
    MEMORY_DATA,
}

type DebuggerMethods = 'start' | 'step' | 'continue' | 'stop' | 'info'

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** Identifier */
    name: string
    /** An absolute path to the "program" to debug. */
    program: string
    /** Format register values */
    registerFormat?: 'hex' | 'oct' | 'dec' | 'bin'
    /** Where to launch the debug target: integrated terminal, or external terminal. */
    console: 'integratedTerminal' | 'externalTerminal'
    /** Arguments for mips program */
    args: string[]
    /** Arguments for dashmips debugger */
    dashmipsArgs: string[]
    /** The command used to launch dashmips debugger */
    dashmipsCommand: string
    host: string
    port: number
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    host: string
    port: number
}

export class DashmipsDebugSession extends LoggingDebugSession {
    private configurationDone = new Subject()
    private variableHandles = new Handles<string>()
    private breakpoints: DashmipsBreakpointInfo[] = []
    private client: DashmipsDebugClient
    private config?: LaunchRequestArguments | AttachRequestArguments | any

    private set loggingEnabled(value: boolean) {
        logger.setup(value ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, true)
    }

    public constructor() {
        super()
        this.setDebuggerLinesStartAt1(true)
        this.setDebuggerColumnsStartAt1(false)
        this.loggingEnabled = DEBUG_LOGS
        this.client = new DashmipsDebugClient()

        this.client.on('continue', () => {
            this.sendEvent(new StoppedEvent('breakpoint', THREAD_ID))
        })
        this.client.on('step', () => {
            this.sendEvent(new StoppedEvent('step', THREAD_ID))
        })
        this.client.on('error', () => {
            this.sendEvent(new TerminatedEvent())
        })
    }

    protected async initializeRequest(
        response: DebugProtocol.InitializeResponse,
        args: DebugProtocol.InitializeRequestArguments
    ) {
        response.body = response.body || {}
        response.body.supportsConfigurationDoneRequest = true
        response.body.supportsEvaluateForHovers = true
        response.body.supportsStepBack = false
        response.body.supportsValueFormattingOptions = true
        this.sendResponse(response)
        this.sendEvent(new InitializedEvent())
    }

    protected async configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ) {
        super.configurationDoneRequest(response, args)
        // notify the launchRequest that configuration has finished
        this.configurationDone.notify()
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        this.config = args
        this.runInTerminalRequest(...buildTerminalLaunchRequestParams(args))
        await this.configurationDone.wait(1500)
        this.client.connect(args.host, args.port)
        this.client.open = true
        this.client.call('start')
        this.client.once('start', pid => {
            this.client.dashmipsPid = pid
            this.sendEvent(new StoppedEvent('entry', THREAD_ID))
        })
        this.sendResponse(response)
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
        this.config = args
        await this.configurationDone.wait(1500)
        this.client.connect(args.host, args.port)
        this.client.open = true
        this.client.call('start')
        this.client.once('start', pid => {
            this.client.dashmipsPid = pid
            this.sendEvent(new StoppedEvent('entry', THREAD_ID))
        })
        this.sendResponse(response)
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ) {
        if (!args.breakpoints) {
            return this.sendResponse(response)
        }

        this.breakpoints = args.breakpoints.map((bp, idx) => {
            const path = this.convertDebuggerPathToClient(args.source.path!)
            return {
                id: idx,
                path,
                ...bp,
            } as DashmipsBreakpointInfo
        })

        // We need to block here until the socket is open
        if (!this.client.open) {
            await this.configurationDone.wait(1600)
        }

        this.client.call('verify_breakpoints', this.breakpoints)
        this.client.once('verify_breakpoints', ([vscodeBreakpoints, locations]) => {
            response.body = {
                breakpoints: vscodeBreakpoints.map(
                    (bp, _) =>
                        new Breakpoint(
                            true,
                            bp.line,
                            bp.column,
                        )
                ),
            }
            for (var i = 0; i < locations.length; i++) {
                if (locations[i] == -1)
                    response.body.breakpoints[i].verified = false
            }
            return this.sendResponse(response)
        })
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse) {
        response.body = {
            threads: [new Thread(THREAD_ID, THREAD_NAME)],
        }
        this.sendResponse(response)
    }

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ) {
        this.client.call('info')
        this.client.once('info', ({ program }) => {
            const currentLine = program.source[program.registers['pc']]
            const stack = [
                {
                    index: THREAD_ID,
                    name: THREAD_NAME,
                    file: currentLine.filename,
                    line: currentLine.lineno,
                },
            ]
            response.body = {
                stackFrames: stack.map(f => {
                    return new StackFrame(
                        f.index,
                        f.name,
                        new Source(
                            basename(f.file),
                            this.convertDebuggerPathToClient(f.file),
                            undefined,
                            undefined,
                            'dashmips-adapter-data'
                        ),
                        f.line
                    )
                }),
                totalFrames: stack.length,
            }
            this.sendResponse(response)
        })
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
        const scopes: Scope[] = []
        scopes.push(
            new Scope('Registers', VARIABLE_REF.REGISTERS, false),
            new Scope('Memory: stack', VARIABLE_REF.MEMORY_STACK, false),
            new Scope('Memory: heap', VARIABLE_REF.MEMORY_HEAP, false),
            new Scope('Memory: data', VARIABLE_REF.MEMORY_DATA, false)
        )
        response.body = { scopes }
        this.sendResponse(response)
    }

    private formatRegister(value: number): string {
        switch (this.config!.registerFormat || 'hex') {
            case 'oct':
                return '0o' + value.toString(8).padStart(11, '0')
            case 'bin':
                return '0b' + value.toString(2).padStart(32, '0')
            case 'dec':
                return value.toString(10)
            case 'hex':
            default:
                return '0x' + value.toString(16).padStart(8, '0')
        }
    }

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ) {
        const makeMemoryRowIntoVariable = (row: string): DebugProtocol.Variable => {
            const [index] = row.split('  ', 1)
            const rest = row.substring(index.length).trimLeft()
            return {
                name: index,
                type: 'string',
                value: rest,
                variablesReference: 0,
            }
        }
        this.client.call('info')
        this.client.once('info', ({ program }) => {
            const variables: DebugProtocol.Variable[] = []
            const variablesReference = args.variablesReference as VARIABLE_REF
            switch (variablesReference) {
                case VARIABLE_REF.REGISTERS: {
                    for (const registerName in program.registers) {
                        const value = program.registers[registerName]
                        variables.push({
                            name: registerName,
                            type: 'integer',
                            value: this.formatRegister(value),
                            variablesReference: 0,
                        } as DebugProtocol.Variable)
                    }
                    break
                }
                case VARIABLE_REF.MEMORY_STACK: {
                    variables.push(...program.memory.stack.split('\n').map(makeMemoryRowIntoVariable))
                    break
                }
                case VARIABLE_REF.MEMORY_HEAP: {
                    variables.push(...program.memory.heap.split('\n').map(makeMemoryRowIntoVariable))
                    break
                }
                case VARIABLE_REF.MEMORY_DATA: {
                    variables.push(...program.memory.data.split('\n').map(makeMemoryRowIntoVariable))
                    break
                }
            }

            response.body = {
                variables,
            }
            this.sendResponse(response)
        })
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
        this.client.call('continue', this.breakpoints)
        this.sendResponse(response)
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        this.client.call('step')
        this.sendResponse(response)
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        // Find out what type of request is being made
        this.client.call('info')
        const hasOwnProperty = (obj: any, prop: string) => Object.prototype.hasOwnProperty.call(obj, prop)
        this.client.once('info', ({ program }) => {
            let reply = undefined
            if (args.context === 'hover') {
                if (hasOwnProperty(program.registers, args.expression)) {
                    const registerValue = program.registers[args.expression]
                    reply = this.formatRegister(registerValue)
                }
                if (hasOwnProperty(program.labels, args.expression)) {
                    const label = program.labels[args.expression]
                    reply = `${label.value}`
                }
            }
            response.body = {
                result: reply ? reply : `eval(ctx: '${args.context}', '${args.expression}')`,
                variablesReference: 0,
            }
            this.sendResponse(response)
        })
    }

    private requestTermination = (error?: Error) => {
        logger.error('termination requested from within for:')
        logger.error(error ? error.toString() : '')
        this.sendEvent(new TerminatedEvent())
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        if (this.client.dashmipsPid > 1) {
            process.kill(this.client.dashmipsPid, 'SIGINT')
        }
        this.shutdown()
    }

    static processError = (err: Error, cb?: () => void) => {
        logger.error(`Exception: ${err && err.message ? err.message : ''}`)
        logger.error(err && err.name ? err.name : '')
        logger.error(err && err.stack ? err.stack : '')
        // Catch all, incase we have string exceptions being raised.
        logger.error(err ? err.toString() : '')
        // Wait for 1 second before we die,
        // we need to ensure errors are written to the log file.
        setTimeout(cb ? cb : () => { }, 1000)
    }
}
