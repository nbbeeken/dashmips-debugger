import * as WebSocket from 'ws'
import { DashmipsBreakpointInfo, DashmipsResponse, DebuggerMethods, InfoRPCReturn } from './models'
import { EventEmitter } from 'events'
import { logger } from 'vscode-debugadapter'
import { DebugProtocol } from 'vscode-debugprotocol'
import { Subject } from './subject'

export interface DashmipsDebugClient {
    on(event: 'start', listener: (pid: number) => void): this
    on(event: 'exited', listener: () => void): this
    on(event: 'continue', listener: () => void): this
    on(event: 'step', listener: () => void): this
    on(event: 'info', listener: (_: InfoRPCReturn) => void): this
    on(event: 'error', listener: (error?: Error) => void): this
    on(event: 'verify_breakpoints', listener: (_: [DashmipsBreakpointInfo[], number[]]) => void): this

    once(event: 'start', listener: (pid: number) => void): this
    once(event: 'exited', listener: () => void): this
    once(event: 'continue', listener: () => void): this
    once(event: 'step', listener: () => void): this
    once(event: 'info', listener: (_: InfoRPCReturn) => void): this
    once(event: 'error', listener: (error?: Error) => void): this
    once(event: 'verify_breakpoints', listener: (_: [DashmipsBreakpointInfo[], number[]]) => void): this
}

export class DashmipsDebugClient extends EventEmitter {
    public dashmipsPid: number = -1
    private websocket!: WebSocket
    private url!: string

    private _readyNotifier = new Subject()

    constructor() {
        super()
    }

    connect(url: string) {
        this.url = url
        this.websocket = new WebSocket(this.url, { handshakeTimeout: 0 })
        this.websocket.on('open', this.onOpen)
    }

    private onOpen = () => {
        this.websocket.on('message', this.onMessage)
        this.websocket.on('close', this.onError)
        this.websocket.on('error', this.onError)
        this._readyNotifier.notify()
    }

    private onError = (error?: Error) => {
        this.emit('error', error)
    }

    private onMessage = (message: string) => {
        const response: DashmipsResponse = JSON.parse(message)
        if (response.error) {
            this.emit('error', response.error)
        }
        if (response.result) {
            if (response.result.exited) {
                return this.emit('exited', response)
            }
            this.emit(response.method, response.result)
        }
    }

    /**
     * Blocks until connection is ready or throws
     */
    public async ready(): Promise<void> {
        return await this._readyNotifier.wait(0)
    }

    public call(method: 'info', params?: any[]): void
    public call(method: 'start', params?: any[]): void
    public call(method: 'step', params?: any[]): void
    public call(method: 'continue', params?: any[]): void
    public call(method: 'verify_breakpoints', params: DashmipsBreakpointInfo[]): void
    public call(method: DebuggerMethods, params?: any[]): void {
        params = params ? params : []
        this.websocket.send(JSON.stringify({ method, params }))
    }
}

type BuildTermParams = [
    DebugProtocol.RunInTerminalRequestArguments,
    number,
    (response: DebugProtocol.RunInTerminalResponse) => void
]
export function buildTerminalLaunchRequestParams(launchArgs: any): BuildTermParams {
    // This will never reject, since vscode is weird with long running processes
    // We will detect failure to launch when we are unable to connect to ws
    const args = [...launchArgs.dashmipsCommand.split(' '), ...launchArgs.dashmipsArgs, launchArgs.program]
    if (launchArgs.args && launchArgs.args.length > 0) {
        // Mips arguments
        args.push('-a', ...launchArgs.args)
    }

    const kind = launchArgs.console.slice(0, -'Terminal'.length)

    const termArgs = {
        title: 'Dashmips',
        kind,
        args,
    } as DebugProtocol.RunInTerminalRequestArguments

    const termReqHandler = (resp: DebugProtocol.Response | DebugProtocol.RunInTerminalResponse) => {
        if (!resp.success) {
            logger.error('vscode failed to launch dashmips')
        }
    }
    return [termArgs, 2000, termReqHandler]
}
