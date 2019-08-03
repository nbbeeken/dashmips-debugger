import { client as WebSocketClient } from 'websocket'
import * as rpc from 'vscode-jsonrpc'

export class DashmipsClient {

    private ws: WebSocketClient
    private connection: rpc.MessageConnection

    constructor(
        public dashmipsHost: string = 'localhost',
        public dashmipsPort: number = 2390,
    ) {
        this.ws = new WebSocketClient()
        this.connection = rpc.createMessageConnection(
            new rpc.StreamMessageReader(this.ws.socket),
            new rpc.StreamMessageWriter(this.ws.socket),
        )
        this.connection.listen()
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('timeout'))
            }, 8000)
            this.ws.addListener('connect', () => {
                clearTimeout(timeout)
                resolve()
            })
            this.ws.addListener('connectFailed', reject)
            this.ws.connect(`ws://${this.dashmipsHost}:${this.dashmipsPort}`)
        })
    }

    static errorHandler = () => {
        throw Error('Could not connect to dashmips!')
    }

    async sendStart() {
        let req = new rpc.RequestType<string, string, string, string>('start')
        let resp = await this.connection.sendRequest(req, 'Hello World')
        return resp
    }
}
