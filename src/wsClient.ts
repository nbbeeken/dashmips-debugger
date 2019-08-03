import { client as WebSocketClient, connection as Connection } from 'websocket'

// export class DashmipsClient {

//     private ws: WebSocketClient
//     private wsConnection?: Connection
//     private connection?: rpc.MessageConnection

//     constructor(
//         public dashmipsHost: string = 'localhost',
//         public dashmipsPort: number = 2390,
//     ) {
//         this.ws = new WebSocketClient()
//     }

//     async connect(): Promise<void> {
//         return new Promise((resolve, reject) => {
//             const timeout = setTimeout(() => {
//                 reject(new Error('timeout'))
//             }, 8000)
//             this.ws.addListener('connect', (connection: Connection) => {
//                 clearTimeout(timeout)
//                 this.wsConnection = connection
//                 let [reader, writer] = [new rpc.StreamMessageReader(connection.socket), new rpc.StreamMessageWriter(connection.socket)];
//                 this.connection = rpc.createMessageConnection(reader, writer)
//                 this.connection.listen()
//                 resolve()
//             })
//             this.ws.addListener('connectFailed', reject)
//             this.ws.connect(`ws://${this.dashmipsHost}:${this.dashmipsPort}`)
//         })
//     }

//     static errorHandler = () => {
//         throw Error('Could not connect to dashmips!')
//     }

//     async sendStart() {
//         let req = new rpc.RequestType<string, string, string, string>('start')
//         let resp = await this.connection!.sendRequest(req, 'Hello World')
//         // this.wsConnection!.send(JSON.stringify(req))
//         return ''
//     }
// }
