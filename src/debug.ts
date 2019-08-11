import { basename } from 'path'
import { Breakpoint, Handles, InitializedEvent, logger, Logger, LoggingDebugSession, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread } from 'vscode-debugadapter'
import { DebugProtocol } from 'vscode-debugprotocol'
import { client as WebSocket, connection as Connection } from 'websocket'
import { ContinueRPCReturn, InfoRPCReturn, RPCReturn, StartRPCReturn, MipsProgram, StepRPCReturn } from './models'
import { Subject } from './subject'

const DEBUG_LOGS = true
export const THREAD_ID = 0
export const THREAD_NAME = 'main'

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
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    host: string
    port: number
}

type MyBreakpoint = {
    line: number
    src: Source
    column?: number
    condition?: string
    hitCondition?: string
    logMessage?: string
}

export class DashmipsDebugSession extends LoggingDebugSession {
    private configurationDone = new Subject()
    private variableHandles = new Handles<string>()
    private breakpoints: MyBreakpoint[] = []
    private isFirstBreakpointSetCall = true
    private dashmipsPid: number = -1
    private clientLaunched = new Subject()
    private ws: WebSocket
    private config?: LaunchRequestArguments | AttachRequestArguments | any
    private wsConnection?: Connection

    private get program(): Promise<MipsProgram> {
        const programPromise = new Promise<MipsProgram>((resolve, reject) => {
            this.callDebuggerMethod('info').then(({ result }) => resolve(result.program)).catch(reject)
        })
        return programPromise
    }

    private async getCurrentLine() {
        const program = await this.program
        return program.source[program.registers['pc']]
    }

    private set loggingEnabled(value: boolean) {
        logger.setup(value ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, true)
    }

    public constructor() {
        super()
        this.setDebuggerLinesStartAt1(true)
        this.setDebuggerColumnsStartAt1(false)
        this.loggingEnabled = DEBUG_LOGS
        this.ws = new WebSocket()
    }

    protected async initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments) {
        response.body = response.body || {}
        response.body.supportsConfigurationDoneRequest = true
        response.body.supportsEvaluateForHovers = true
        response.body.supportsStepBack = false
        response.body.supportsValueFormattingOptions = true
        this.sendResponse(response)
        this.sendEvent(new InitializedEvent())
    }

    protected async configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments) {
        super.configurationDoneRequest(response, args)
        // notify the launchRequest that configuration has finished
        this.configurationDone.notify()
    }

    private async requestTerminalLaunch(launchArgs: LaunchRequestArguments): Promise<string | void> {
        // This will never reject, since vscode is weird with long running processes
        // We will detect failure to launch when we are unable to connect to ws
        return new Promise(resolve => {
            const args = [...launchArgs.dashmipsCommand.split(' '), ...launchArgs.dashmipsArgs, launchArgs.program]
            if (launchArgs.args && launchArgs.args.length > 0) {
                // Mips arguments
                args.push('-a', ...launchArgs.args)
            }

            const kind = launchArgs.console.slice(0, -('Terminal'.length))

            const termArgs = {
                title: 'Dashmips',
                kind,
                args,
            } as DebugProtocol.RunInTerminalRequestArguments

            const termReqHandler = (resp: DebugProtocol.Response | DebugProtocol.RunInTerminalResponse) => {
                if (!resp.success) {
                    logger.error('vscode failed to launch dashmips')
                    this.requestTermination()
                    return resolve('timeout')
                }
                resolve()
            }
            this.sendRequest('runInTerminal', termArgs, 2000, termReqHandler)
        })
    }

    private async callDebuggerMethod(method: 'info', params?: any[]): Promise<InfoRPCReturn>
    private async callDebuggerMethod(method: 'start', params?: any[]): Promise<StartRPCReturn>
    private async callDebuggerMethod(method: 'step', params?: any[]): Promise<StepRPCReturn>
    private async callDebuggerMethod(method: 'continue', params?: any[]): Promise<ContinueRPCReturn>
    private async callDebuggerMethod(method: DebuggerMethods, params?: any[]): Promise<RPCReturn> {
        params = params ? params : []
        return new Promise((resolve, reject) => {
            if (!this.wsConnection) {
                return reject(new Error('Cannot send with no connection'))
            }
            this.wsConnection.once('message', data => {
                return resolve(JSON.parse(data.utf8Data!))
            })
            this.wsConnection.send(JSON.stringify({ method, params }))
        })
    }

    private async connectToDashmips(host: string, port: number) {
        return new Promise((resolve, reject) => {
            this.ws.once('connect', async (connection: Connection) => {
                this.wsConnection = connection
                this.dashmipsPid = (await this.callDebuggerMethod('start')).result.pid
                this.wsConnection.on('close', this.requestTermination)
                this.wsConnection.on('error', this.requestTermination)
                this.wsConnection.on('error', reject)
                this.clientLaunched.notify()
                resolve()
            })
            this.ws.connect(`ws://${host}:${port}`)
        })
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        this.config = args
        await this.requestTerminalLaunch(args) // always succeeds
        try {
            await this.connectToDashmips('localhost', 2390)
            this.sendResponse(response)
        } catch (ex) {
            DashmipsDebugSession.processError(ex, () => {
                this.sendErrorResponse(response, ex)
                this.requestTermination()
            })
        }
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
        this.config = args
        await this.connectToDashmips(args.host, args.port)
        this.sendResponse(response)
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
        await this.clientLaunched.wait(Infinity)

        if (!args.breakpoints) {
            return this.sendResponse(response)
        }

        this.breakpoints = args.breakpoints.map(bp => {
            const path = this.convertDebuggerPathToClient(args.source.path!)
            return {
                src: new Source(
                    basename(path), path, undefined, undefined, 'dashmips'
                ),
                ...bp
            }
        })


        if (this.isFirstBreakpointSetCall) {
            // On the first breakpoint set call we run until the breakpoints set
            // subsequent calls should not 'continue' the program
            const { result } = (await this.callDebuggerMethod('continue', this.breakpoints))
            if ('stopped' in result) {
                this.sendEvent(new StoppedEvent('breakpoint', THREAD_ID))
                response.body = {
                    breakpoints: this.breakpoints.map(bp => new Breakpoint(
                        result.breakpoints.includes(bp.line), bp.line, bp.column, bp.src
                    ))
                }
                return this.sendResponse(response)
            }
            if ('exited' in result) {
                this.requestTermination()
            }
            this.isFirstBreakpointSetCall = false
        }

        response.body = {
            breakpoints: this.breakpoints.map(bp => new Breakpoint(true, bp.line, bp.column, bp.src))
        }
        return this.sendResponse(response)
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse) {
        response.body = {
            threads: [new Thread(THREAD_ID, THREAD_NAME)]
        }
        this.sendResponse(response)
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
        const currentLine = await this.getCurrentLine()
        const stack = [{
            index: THREAD_ID,
            name: THREAD_NAME,
            file: currentLine.filename,
            line: currentLine.lineno
        }]
        response.body = {
            stackFrames: stack.map(f => {
                return new StackFrame(f.index, f.name,
                    new Source(
                        basename(f.file),
                        this.convertDebuggerPathToClient(f.file),
                        undefined, undefined, 'dashmips-adapter-data'),
                    f.line
                )
            }),
            totalFrames: stack.length,
        }
        this.sendResponse(response)
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
        const scopes: Scope[] = []
        scopes.push(new Scope(
            'Registers',
            this.variableHandles.create('register'),
            false
        ))
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
                return value.toString(10).padStart(10, '0')
            case 'hex':
            default:
                return '0x' + value.toString(16).padStart(8, '0')
        }
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
        const program = await this.program
        if (!program) {
            return this.sendErrorResponse(response, 0)
        }

        const variables: DebugProtocol.Variable[] = []
        for (const registerName in program.registers) {
            const value = program.registers[registerName]
            variables.push({
                name: registerName,
                type: 'integer',
                value: this.formatRegister(value),
                variablesReference: 0,
            } as DebugProtocol.Variable)
        }
        response.body = {
            variables
        }
        this.sendResponse(response)
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
        const { result } = (await this.callDebuggerMethod('continue', this.breakpoints))
        if ('stopped' in result) {
            this.sendEvent(new StoppedEvent('breakpoint', THREAD_ID))
        }
        if ('exited' in result) {
            this.requestTermination()
        }
        this.sendResponse(response)
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        const { result } = await this.callDebuggerMethod('step')
        if ('stopped' in result) {
            this.sendEvent(new StoppedEvent('step', THREAD_ID))
        }
        if ('exited' in result) {
            this.requestTermination()
        }
        this.sendResponse(response)
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        const program = await this.program
        let reply = undefined
        if (args.context === 'hover') {
            if (program.registers.hasOwnProperty(args.expression)) {
                const registerValue = program.registers[args.expression]
                reply = this.formatRegister(registerValue)
            }
            if (program.labels.hasOwnProperty(args.expression)) {
                const label = program.labels[args.expression]
                reply = `${label.value}`
            }
        }

        response.body = {
            result: reply ?
                reply : `eval(ctx: '${args.context}', '${args.expression}')`,
            variablesReference: 0
        }
        this.sendResponse(response)
    }

    private requestTermination = (error?: Error) => {
        logger.error('termination requested from within for:')
        logger.error(error ? error.toString() : '')
        this.sendEvent(new TerminatedEvent())
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        if (this.dashmipsPid > 1) {
            process.kill(this.dashmipsPid, 'SIGINT')
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
