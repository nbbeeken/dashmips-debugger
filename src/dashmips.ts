import { EventEmitter } from 'events'

import { logger } from 'vscode-debugadapter'
import { DebugProtocol } from 'vscode-debugprotocol'

import { client as WebSocket, connection as Connection, IMessage as Message } from 'websocket'
import { DebuggerMethods, DashmipsResponse, DashmipsBreakpointInfo, MipsProgram, InfoRPCReturn } from './models'
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
    private websocket: WebSocket
    private url!: string
    private connection!: Connection

    private _readyNotifier = new Subject()

    constructor() {
        super()
        this.websocket = new WebSocket()
    }

    connect(url: string) {
        this.url = url
        this.websocket.on('connect', this.onConnect)
        this.websocket.connect(this.url, undefined, undefined, undefined, { timeout: 0 })
    }

    private onConnect = (connection: Connection) => {
        this.connection = connection
        this.connection.on('message', this.onMessage)
        this.connection.on('close', this.onError)
        this.connection.on('error', this.onError)
        this._readyNotifier.notify()
    }

    private onError = (error?: Error) => {
        this.emit('error', error)
    }

    private onMessage = (message: Message) => {
        const response: DashmipsResponse = JSON.parse(message.utf8Data!)
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
        this.connection.send(JSON.stringify({ method, params }))
    }


}

type BuildTermParams = [DebugProtocol.RunInTerminalRequestArguments, number, (response: DebugProtocol.RunInTerminalResponse) => void]
export function buildTerminalLaunchRequestParams(launchArgs: any): BuildTermParams {
    // This will never reject, since vscode is weird with long running processes
    // We will detect failure to launch when we are unable to connect to ws
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
        }
    }
    return [termArgs, 2000, termReqHandler]
}
