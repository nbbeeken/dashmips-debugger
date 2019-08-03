import {
    LoggingDebugSession, InitializedEvent, logger, Logger,
    Breakpoint, StoppedEvent, Thread,
    Source, Scope, Handles, StackFrame, TerminatedEvent,
} from 'vscode-debugadapter'
import { DebugProtocol } from 'vscode-debugprotocol'

import { Subject } from './subject'
import { basename, dirname } from 'path'
import { Client } from './client'
import { DebugMessage } from './models'
import { DashmipsClient } from './wsClient'

const DEBUG_LOGS = true
export const THREAD_ID = 0
export const THREAD_NAME = 'main'

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

export class MipsDebugSession extends LoggingDebugSession {
    private configurationDone = new Subject()
    private client?: Client
    private variableHandles = new Handles<string>()
    private dashmipsHandle?: DebugProtocol.RunInTerminalResponse
    private config?: LaunchRequestArguments
    private clientLaunched = new Subject()


    private set loggingEnabled(value: boolean) {
        logger.setup(value ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, true)
    }

    public constructor() {
        super()
        this.setDebuggerLinesStartAt1(true)
        this.setDebuggerColumnsStartAt1(false)
        this.loggingEnabled = DEBUG_LOGS
    }

    private setEventHandlers() {
        if (!this.client) {
            return
        }

        // 'step', 'breakpoint', 'exception', 'pause', 'entry', 'goto'

        this.client.on(
            'start', (msg: DebugMessage) => {
                // this.dashmipsPid = parseInt(msg.message)
                this.sendEvent(new StoppedEvent('entry', THREAD_ID))
            }
        )

        this.client.on(
            'step', () => this.sendEvent(new StoppedEvent('step', THREAD_ID))
        )

        this.client.on(
            'continue', () => this.sendEvent(new StoppedEvent('breakpoint', THREAD_ID))
        )

        this.client.on(
            'stop', () => {
                process.kill(this.dashmipsHandle!.body.processId!, 'SIGTERM')
                this.sendEvent(new TerminatedEvent())
            }
        )

        this.client.on(
            'error', err => {
                logger.error(err)
                this.sendEvent(new TerminatedEvent())
            }
        )
        this.client.on(
            'end', () => this.sendEvent(new TerminatedEvent())
        )
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

    private async requestTerminalLaunch(launchArgs: LaunchRequestArguments) {
        return new Promise((resolve, reject) => {
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
                    logger.error('Vscode failed to launch dashmips')
                    this.sendEvent(new TerminatedEvent())
                    reject(new Error(`Run In Terminal: ${resp.message}`))
                }
                this.dashmipsHandle = resp as DebugProtocol.RunInTerminalResponse
                resolve()
            }
            this.sendRequest('runInTerminal', termArgs, 8000, termReqHandler)
        })
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        try {
            this.requestTerminalLaunch(args)
            const client = new DashmipsClient()
            await client.connect()
            let r = await client.sendStart()
            logger.warn(`Start said: ${r}`)
            this.sendResponse(response)
        } catch (ex) {
            MipsDebugSession.processError(ex, () => {
                this.sendErrorResponse(response, ex)
                this.sendEvent(new TerminatedEvent())
            })
        }
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {

        // this.client.breakpointsFromVscode(args.source.path, args.breakpoints)

        // const breakpoints = this.client.vscodeBreakPoints.map(l => {
        //     const src = new Source(
        //         basename(l.filename),
        //         this.convertDebuggerPathToClient(l.filename),
        //         undefined, undefined, 'dashmips'
        //     )
        //     return new Breakpoint(true, l.lineno, 0, src)
        // }) as DebugProtocol.Breakpoint[]

        // response.body = {
        //     breakpoints
        // }
        this.sendResponse(response)
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse) {
        response.body = {
            threads: [new Thread(THREAD_ID, THREAD_NAME)]
        }
        this.sendResponse(response)
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
        response.body = {
            stackFrames: this.client!.stack.map(f => {
                return new StackFrame(f.index, f.name,
                    new Source(
                        basename(f.file),
                        this.convertDebuggerPathToClient(f.file),
                        undefined, undefined, 'dashmips-adapter-data'),
                    f.line
                )
            }),
            totalFrames: this.client!.stack.length,
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

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
        const variables: DebugProtocol.Variable[] = []
        // const id = this.variableHandles.get(args.variablesReference);

        for (const name in this.client!.program.registers) {
            const value = this.client!.program.registers[name]
            variables.push({
                name,
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

    formatRegister(value: number): string {
        switch (this.config!.registerFormat) {
            case 'hex':
                return '0x' + value.toString(16).padStart(8, '0')
            case 'oct':
                return '0o' + value.toString(8).padStart(11, '0')
            case 'bin':
                return '0b' + value.toString(2).padStart(32, '0')
            case 'dec':
            default:
                return value.toString(10).padStart(10, '0')
        }
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
        this.client!.continue()
        this.sendResponse(response)
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        this.client!.step()
        this.sendResponse(response)
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {

        let reply = undefined
        if (args.context === 'hover') {
            if (this.client!.program.registers.hasOwnProperty(args.expression)) {
                const regvalue = this.client!.program.registers[args.expression]
                reply = regvalue.toString()
            }
            if (this.client!.program.labels.hasOwnProperty(args.expression)) {
                const label = this.client!.program.labels[args.expression]
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

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        this.client!.stop()
        process.kill(this.dashmipsHandle!.body.processId!, 'SIGINT')
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
