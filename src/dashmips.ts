import { Socket } from 'net'
import { DashmipsBreakpointInfo, DashmipsResponse, DebuggerMethods, InfoRPCReturn } from './models'
import { EventEmitter } from 'events'
import { logger } from 'vscode-debugadapter'
import { DebugProtocol } from 'vscode-debugprotocol'
import { Subject } from './subject'

export interface DashmipsDebugClient {
    on(event: 'start', listener: (pid: { pid: number }) => void): this
    on(event: 'exited', listener: () => void): this
    on(event: 'continue', listener: () => void): this
    on(event: 'step', listener: () => void): this
    on(event: 'info', listener: (_: InfoRPCReturn) => void): this
    on(event: 'error', listener: (error?: Error) => void): this
    on(event: 'verify_breakpoints', listener: (_: [DashmipsBreakpointInfo[], number[]]) => void): this
    on(event: 'update_visualizer', listener: (t: string) => void): this

    once(event: 'start', listener: (pid: { pid: number }) => void): this
    once(event: 'exited', listener: () => void): this
    once(event: 'continue', listener: () => void): this
    once(event: 'step', listener: () => void): this
    once(event: 'info', listener: (_: InfoRPCReturn) => void): this
    once(event: 'error', listener: (error?: Error) => void): this
    once(event: 'verify_breakpoints', listener: (_: [DashmipsBreakpointInfo[], number[]]) => void): this
    once(event: 'update_visualizer', listener: (t: string) => void): this
}

export class DashmipsDebugClient extends EventEmitter {
    public dashmipsPid = -1
    public open = new Subject()
    public verified = new Subject()
    public checkAttach = new Subject()
    public attached = false
    public stopEntry = true
    private socket!: Socket
    private url!: string
    private cutoffData: string
    private cutoffDataLength: number
    private host = ''
    private port = -1
    public running = true

    private _readyNotifier = new Subject()

    constructor() {
        super()
        this.cutoffData = ''
        this.cutoffDataLength = 0
    }

    connect(host: string, port: number) {
        this.host = host
        this.port = port
        this.socket = new Socket()
        this.socket.on('connect', this.onOpen)
        this.socket.on('error', this.notConnected)
        this.socket.setEncoding('utf8')
        this.socket.connect({ port, host })
    }

    private onOpen = () => {
        this.attached = true
        this.checkAttach.notify()
        this.socket.on('data', this.onMessage)
        this.socket.on('close', this.onError)
        this.socket.on('error', this.onError)
        this._readyNotifier.notify()
    }

    private notConnected = () => {
        this.checkAttach.notify()
        if (this.running) {
            setTimeout(() => this.socket.connect(this.port, this.host), 100)
        }
    }

    private onError = (error?: Error) => {
        this.emit('error', error)
    }

    private onMessage = (data: string) => {
        if (this.cutoffData !== '') {
            data = `${JSON.stringify({ size: this.cutoffDataLength })}${this.cutoffData}${data}`
            this.cutoffData = ''
            this.cutoffDataLength = 0
        }
        const re = /{\s*"size"\s*:\s*\d+\s*}/
        while (data) {
            const match = re.exec(data)
            if (match) {
                const { size } = JSON.parse(match[0])

                const message = data.slice(match[0].length, size + match[0].length)
                data = data.slice(size + match[0].length)

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
                    this.cutoffData = message
                    this.cutoffDataLength = size
                    break
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
    public call(method: 'update_visualizer', params: any[]): void
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
    const cwd = launchArgs.cwd

    const termArgs = {
        title: 'Dashmips',
        cwd,
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
