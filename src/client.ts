import { EventEmitter } from 'events';
import { Socket, TcpNetConnectOpts, connect } from 'net';
import { MipsProgram, DebugMessage, SourceLine } from './models';
import { execSync } from 'child_process';
import { DebugProtocol } from 'vscode-debugprotocol';
import { basename } from 'path';

const connOpts: TcpNetConnectOpts = {
    host: 'localhost',
    port: 9999,
    readable: true,
    writable: true,
    timeout: 0, // Should never timeout.
} as TcpNetConnectOpts;


export class Client extends EventEmitter {
    public program: MipsProgram;
    public pathToMain: string;
    private socket: Socket;
    private breakpoints: Set<number>;  // These are indexes into program.source
    private buffer = '';

    get vscodeBreakPoints(): SourceLine[] {
        const list: SourceLine[] = [];
        if (!(!!this.program)) {
            return list;
        }
        for (const srcLineBp of this.breakpoints) {
            const srcLine = this.program.source[srcLineBp];
            list.push(srcLine);
        }
        return list;
    }

    public breakpointsFromVscode(
        path: string,
        breakpoints: DebugProtocol.SourceBreakpoint[]
    ) {
        if ((!!this.program) === false) {
            return;
        }
        for (const vsbp of breakpoints) {
            for (let idx = 0; idx < this.program.source.length; idx++) {
                const srcline = this.program.source[idx];
                // srcline.filename === source NEEDS TO BE CHECKED
                if (vsbp.line === srcline.lineno && true) {
                    this.breakpoints.add(idx);
                }
            }
        }
    }

    get currentLn() {
        return this.program.source[this.program.registers.pc];
    }

    get stack() {
        return [{
            index: 0,
            name: 'main',
            file: this.currentLn.filename,
            line: this.currentLn.lineno
        }];
    }

    public step() {
        const cur = this.currentLn;
        this.send({
            command: 'step',
            message: `Stepping from ${basename(cur.filename)}:${cur.lineno}`,
        });
    }

    public continue() {
        const cur = this.currentLn;
        this.send({
            command: 'continue',
            message: `Continue from ${basename(cur.filename)}:${cur.lineno}`,
        });
    }

    public stop() {
        const cur = this.currentLn;
        this.send({
            command: 'stop',
            message: `Stopping on ${basename(cur.filename)}:${cur.lineno}`,
        });
    }

    constructor(program: string, sockOpts?: TcpNetConnectOpts) {
        super();

        this.program = compileMips(program);
        if (this.program === null) {
            throw Error('Mips could not be compiled');
        }
        this.pathToMain = program;

        this.breakpoints = new Set<number>();

        const opts = {
            ...connOpts,
            ...sockOpts,
        };
        this.socket = connect(opts);
        this.socket.setEncoding('utf8');

        this.socket.once('connect', this.onConnect);
        this.socket.once('error', (err) => this.emit('error', err));
        this.socket.once('end', () => this.emit('end'));

        this.socket.on('data', (data) => {
            this.buffer += data;
            if (this.buffer.endsWith('\n')) {
                const msg = JSON.parse(this.buffer.trim());
                this.buffer = '';
                this.emit('message', msg);
            }
        });

        this.on('message', this.onMessage);
    }

    private send(message: DebugMessage | any) {
        const messageFull = {
            program: this.program,
            breakpoints: [...this.breakpoints],
            ...message,
        };
        const msgTxt = JSON.stringify(messageFull) + '\n';
        return this.socket.write(msgTxt);
    }

    private onConnect = () => {
        const message: DebugMessage = {
            command: 'start',
            program: this.program,
            message: 'init'
        };
        this.send(message);
    }

    private onMessage = (message: DebugMessage) => {
        this.program = message.program;
        message.breakpoints.map(bp => this.breakpoints.add(bp));
        if (message.error) {
            this.emit('error', message);
        } else {
            this.emit(message.command, message);
        }
    }
}

export function compileMips(filename: string): MipsProgram | null {
    if (!isDashmipsInstalled()) {
        throw Error('Dashmips not installed');
    }

    try {
        const stdout = execSync(
            `python -m dashmips compile ${filename} --json`,
            { encoding: 'utf8' }
        );
        return JSON.parse(stdout.trim()) as MipsProgram;
    } catch {
        return null;
    }
}

export function isDashmipsInstalled(): boolean {
    try {
        execSync(
            'python -m dashmips -v', { encoding: 'utf8' }
        );
        return true;
    } catch {
        return false;
    }
}
