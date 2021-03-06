import {
    Breakpoint,
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
    Event,
} from 'vscode-debugadapter'
import { DashmipsDebugClient, buildTerminalLaunchRequestParams } from './dashmips'
import { basename } from 'path'
import { DebugProtocol } from 'vscode-debugprotocol'
import { DashmipsBreakpointInfo } from './models'
import { Subject } from './subject'
import { pattern } from './memory_content'
import { Mutex } from 'async-mutex'
import * as vscode from 'vscode'

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

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** Identifier */
    name: string
    /** An absolute path to the "program" to debug. */
    program: string
    /** An absolute path to the current working directory of the program */
    cwd: string
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
    /** The host to connect the socket to */
    host: string
    /** The port to connect the socket to */
    port: number
    /** If debugger should stop on first line or not */
    stopOnEntry: boolean
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    /** Identifier */
    name: string
    /** Format register values */
    registerFormat?: 'hex' | 'oct' | 'dec' | 'bin'
    /** The host to connect the socket to */
    host: string
    /** The port to connect the socket to */
    port: number
    /** If debugger should stop on first line or not */
    stopOnEntry: boolean
}

export class DashmipsDebugSession extends LoggingDebugSession {
    private configurationDone = new Subject()
    private breakpoints: DashmipsBreakpointInfo[] = []
    private client: DashmipsDebugClient
    private config?: LaunchRequestArguments | AttachRequestArguments | any
    private breakpoints_mutex = new Mutex()
    public memoryProvider?: any
    public program_path = ''

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
            this.memoryProvider.stopped = true
            this.visualize()
        })
        this.client.on('step', () => {
            this.sendEvent(new StoppedEvent('step', THREAD_ID))
            this.memoryProvider.stopped = true
            this.visualize()
        })
        this.client.on('error', () => {
            this.memoryProvider.stopped = true
            this.sendEvent(new TerminatedEvent())
        })
        this.client.on('exited', () => {
            this.memoryProvider.stopped = true
            this.sendEvent(new TerminatedEvent())
        })
    }

    protected async visualize() {
        let update_files = ''
        for (let i = 0; i < vscode.workspace.textDocuments.length; i++) {
            if (
                vscode.workspace.textDocuments[i].uri.scheme == 'visual' &&
                vscode.workspace.textDocuments[i].uri.authority.split(pattern).join('/') == this.program_path
            ) {
                update_files += vscode.workspace.textDocuments[i].uri.path
            }
        }
        this.client.call('update_visualizer', [update_files])
        this.client.once('update_visualizer', async (t) => {
            this.memoryProvider.text = t
            for (let i = 0; i < vscode.workspace.textDocuments.length; i++) {
                if (
                    vscode.workspace.textDocuments[i].uri.scheme == 'visual' &&
                    vscode.workspace.textDocuments[i].uri.authority.split(pattern).join('/') == this.program_path
                ) {
                    await this.memoryProvider.onDidChangeEmitter.fire(vscode.workspace.textDocuments[i].uri)
                }
            }
            this.memoryProvider.text = null // <-- This acts as a check if the debug session is active
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
        response.body.supportsTerminateRequest = true
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
        this.memoryProvider.stopped = false // This is for setting breakpoints while waiting on input bug
        this.config = {
            name: args.name,
            program: args.program,
            registerFormat: args.registerFormat || 'dec',
            cwd: args.cwd || '^"\\${workspaceFolder}"',
            host: args.host || 'localhost',
            port: args.port || 2390,
            dashmipsCommand: args.dashmipsCommand || 'python -m dashmips debug',
            dashmipsArgs: args.dashmipsArgs || ['-i', 'localhost', '-p', '2390'],
            args: args.args || [],
            stopOnEntry: args.stopOnEntry || false,
        }

        this.client.connect(this.config.host, this.config.port)

        await this.client.checkAttach.wait(0)
        if (!this.client.attached) {
            this.runInTerminalRequest(...buildTerminalLaunchRequestParams(args))
            // Blocks here until successfully connected
            await this.client.ready()
        }

        this.client.open.notifyAll()
        await this.client.verified.wait(100)

        this.client.call('start')
        this.client.once('start', (pid) => {
            this.client.dashmipsPid = pid.pid
            if (this.config.stopOnEntry) {
                this.sendEvent(new StoppedEvent('entry', THREAD_ID))
                this.visualize()
            } else if (this.breakpoints.length && this.client.stopEntry) {
                this.sendEvent(new StoppedEvent('breakpoint', THREAD_ID))
                this.visualize()
            } else {
                this.client.call('continue', this.breakpoints)
            }
            this.client.stopEntry = false
        })
        this.sendResponse(response)
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
        this.memoryProvider.stopped = false // This is for setting breakpoints while waiting on input bug
        this.config = {
            name: args.name,
            registerFormat: args.registerFormat || 'dec',
            host: args.host || 'localhost',
            port: args.port || 2390,
            stopOnEntry: args.stopOnEntry || false,
        }
        this.client.connect(this.config.host, this.config.port)

        this.client.call('start')
        this.client.once('start', async (pid) => {
            // SetBreakpointsRequest is called with different timing when attaching
            this.client.open.notifyAll()
            await this.client.verified.wait(100)

            this.client.dashmipsPid = pid.pid
            if (this.config.stopOnEntry) {
                this.sendEvent(new StoppedEvent('entry', THREAD_ID))
                this.visualize()
            } else if (this.breakpoints.length && this.client.stopEntry) {
                this.sendEvent(new StoppedEvent('breakpoint', THREAD_ID))
                this.visualize()
            } else {
                this.client.call('continue', this.breakpoints)
            }
            this.client.stopEntry = false
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

        const release = await this.breakpoints_mutex.acquire()

        let path1 = this.convertDebuggerPathToClient(args.source.path!).split('\\').join('/')
        if (path1[0] !== '/') {
            path1 = '/' + path1
        }
        let path2 = String(vscode.window.activeTextEditor?.document.uri.path)
        if (path2[0] !== '/') {
            path2 = '/' + path2
        }

        // Compare the two strings minus the home directory
        if (path1.split('/').slice(2).join('/') !== path2.split('/').slice(2).join('/')) {
            release()
            return this.sendResponse(response)
        }

        if (!this.program_path) {
            this.program_path = this.convertDebuggerPathToClient(args.source.path!).toLowerCase()
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
        if (this.client.stopEntry) {
            await this.client.open.wait(0)
        }

        this.client.call('verify_breakpoints', this.breakpoints)
        this.client.once('verify_breakpoints', ([vscodeBreakpoints, locations]) => {
            response.body = {
                breakpoints: vscodeBreakpoints.map(
                    (bp, idx) =>
                        new Breakpoint(
                            // -1 indicates an unverified breakpoints (not a line of MIPS code)
                            locations[idx] != -1,
                            bp.line,
                            bp.column
                        )
                ),
            }

            if (this.client.stopEntry && !locations.includes(0)) {
                this.client.stopEntry = false
            }
            this.client.verified.notifyAll()
            // Breakpoints are verified by locations argument
            release()
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
                stackFrames: stack.map((f) => {
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

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
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
                        if (registerName !== 'lowest_stack' && registerName !== 'end_heap') {
                            const value = program.registers[registerName]
                            variables.push({
                                name: registerName,
                                type: 'integer',
                                value: this.formatRegister(value),
                                variablesReference: 0,
                            } as DebugProtocol.Variable)
                        }
                    }
                    break
                }
                case VARIABLE_REF.MEMORY_STACK: {
                    variables.push(
                        ...program.memory.stack
                            .split('\n')
                            .slice(0, Math.floor((100663296 - program.registers['lowest_stack']) / 4) + 1)
                            .map(makeMemoryRowIntoVariable)
                    )
                    break
                }
                case VARIABLE_REF.MEMORY_HEAP: {
                    variables.push(
                        ...program.memory.heap
                            .split('\n')
                            .slice(0, Math.floor((program.registers['end_heap'] - 6291456) / 4))
                            .map(makeMemoryRowIntoVariable)
                    )
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
        this.memoryProvider.stopped = false
        this.sendResponse(response)
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        this.client.call('step')
        this.memoryProvider.stopped = false
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
            if (reply) {
                response.body = {
                    result: reply,
                    variablesReference: 0,
                }
                this.sendResponse(response)
            }
        })
    }

    protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
        this.sendEvent(new TerminatedEvent())
        if (this.client.dashmipsPid > 1) {
            process.kill(this.client.dashmipsPid, 'SIGINT')
        }
        this.client.running = false
        this.sendResponse(response)
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        if (this.client.dashmipsPid > 1) {
            process.kill(this.client.dashmipsPid, 'SIGINT')
        }
        this.shutdown()
        this.client.running = false
        this.sendResponse(response)
    }

    static processError = (err: Error, cb?: () => void) => {
        logger.error(`Exception: ${err && err.message ? err.message : ''}`)
        logger.error(err && err.name ? err.name : '')
        logger.error(err && err.stack ? err.stack : '')
        // Catch all, incase we have string exceptions being raised.
        logger.error(err ? err.toString() : '')
        // Wait for 1 second before we die,
        // we need to ensure errors are written to the log file.
        setTimeout(cb ? cb : () => {}, 1000)
    }
}
