import { Socket } from 'net'
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
    private socket!: Socket
    private url!: string
    private cutoff_data: string
    private cutoff_data_length: number

    private _readyNotifier = new Subject()

    constructor() {
        super()
        this.cutoff_data = "";
        this.cutoff_data_length = 0;
    }

    connect(host: string, port: number) {
        this.socket = new Socket()
        this.socket.on('connect', this.onOpen)
        this.socket.setEncoding('utf8');
        this.socket.connect({ port, host })
    }

    private onOpen = () => {
        this.socket.on('data', this.onMessage)
        this.socket.on('close', this.onError)
        this.socket.on('error', this.onError)
        this._readyNotifier.notify()
    }

    private onError = (error?: Error) => {
        this.emit('error', error)
    }

    private onMessage = (data: string) => {
        if (this.cutoff_data !== "") {
            data = `${JSON.stringify({ size: this.cutoff_data_length })}${this.cutoff_data}${data}`
            this.cutoff_data = "";
            this.cutoff_data_length = 0;
        }
        let re = /{"size": [0-9]+}/;
        while (data) {

            var m = re.exec(data)
            if (m) {

                var n = JSON.parse(m[0])["size"]

                var message = data.slice(m[0].length, n + m[0].length)
                data = data.slice(n + m[0].length)

                try {
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
                } catch {
                    this.cutoff_data = message;
                    this.cutoff_data_length = n;
                    break;
                }
            }
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
        const message = JSON.stringify({ method, params })
        this.socket.write(JSON.stringify({ size: message.length }) + message)
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
