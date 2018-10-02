import { connect, TcpNetConnectOpts } from "net";
import { execSync, exec, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { SourceBreakpoint } from "vscode";
import { Source } from "vscode-debugadapter";

export const defaultConnectOpts: TcpNetConnectOpts = {
    host: "localhost",
    port: 9999,
    readable: true,
    writable: true,
    timeout: 3000,
} as TcpNetConnectOpts;

export interface SourceLine {
    filename: string;
    lineno: number;
    line: string;
}

export interface Label {
    type: string;
    value: number;
    name: string;
}

export interface MipsProgram {
    name: string;
    labels: { [name: string]: Label };
    source: SourceLine[];
    memory: string;
    registers: { [regname: string]: number };
}

export interface DebugMessage {
    command: "start" | "step" | "continue";
    program: MipsProgram;
    breakpoints?: number[];
    message?: string;
    error?: boolean;
}

export async function sendMessage(
    message: DebugMessage,
    connectOpts = defaultConnectOpts,
): Promise<DebugMessage> {

    const connection = connect(connectOpts);
    connection.setEncoding("utf8");

    let buffer = "";
    connection.on("data", (data) => {
        buffer += data;
    });

    return new Promise<DebugMessage>((resolve, reject) => {
        connection.on("error", (err) => reject(err));
        connection.on("timeout", () => reject(new Error("timeout")));
        connection.on("connect", () => {
            const msgasstring = JSON.stringify(message) + "\r\n\r\n";
            connection.write(msgasstring);
            connection.on("end", () => {
                connection.destroy();
                const resp = JSON.parse(buffer) as DebugMessage;
                resolve(resp);
            });
        });
    });
}

export function verifyBreakPoint(line: number, program: MipsProgram) {
    for (let i = 0; i < program.source.length; i++) {
        if (line === program.source[i].lineno) {
            return i;
        }
    }
    return -1;
}

export function isDashmipsInstalled(): boolean {
    try {
        execSync(
            "python -m dashmips -v",
            { encoding: "utf8" }
        );
        return true;
    } catch{
        return false;
    }
}

export function compileMips(filename: string): MipsProgram {
    if (!isDashmipsInstalled()) {
        throw Error("Dashmips not installed");
    }

    const stdout = execSync(
        `python -m dashmips compile ${filename} --json`,
        { encoding: "utf8" }
    );

    return JSON.parse(stdout.trim()) as MipsProgram;
}

let server: ChildProcess | null = null;

export function startServer(): ChildProcess {
    server = exec("python -m dashmips debug");
    server.on("exit", (code, signal) => { server = null; });
    return server;
}

export function stopServer() {
    if (!!server) {
        server.kill();
    }
}

interface SourceIdxToFileLine {
    sourceIndex: number;
    lineNumber: number;
    filename: string;
}

export class DashmipsClient extends EventEmitter {

    private mipsProgram: MipsProgram;
    private sourceLineBreakpoints: number[] = [];

    get registers() {
        return this.mipsProgram.registers;
    }

    get labels() {
        return this.mipsProgram.labels;
    }

    get breakpoints(): SourceIdxToFileLine[] {
        const list = [];
        for (const srcLineBp of this.sourceLineBreakpoints) {
            const srcLine = this.mipsProgram.source[srcLineBp];
            list.push({
                sourceIndex: srcLineBp,
                lineNumber: srcLine.lineno,
                filename: srcLine.filename,
            });
        }
        return list;
    }

    get currentLine(): SourceIdxToFileLine {
        const srcIdx = this.mipsProgram.registers['pc'];
        const srcline = this.mipsProgram.source[srcIdx];
        return {
            sourceIndex: srcIdx,
            lineNumber: srcline.lineno,
            filename: srcline.filename,
        };
    }

    addBreakpoint(breakpoint: number, source: string): any {
        if((!!this.mipsProgram) === false) {
            return;
        }
        for (let idx = 0; idx < this.mipsProgram.source.length; idx++) {
            const srcline = this.mipsProgram.source[idx];
            // srcline.filename === source NEEDS TO BE CHECKED
            if (breakpoint === srcline.lineno && true) {
                this.sourceLineBreakpoints.push(idx);
            }
        }
    }

    constructor() {
        super();
    }

    public start(filename: string) {
        this.mipsProgram = compileMips(filename);
        this.verifyBreakpoints();
        this.entry();
    }

    public async entry() {
		const msg = await sendMessage({
            command: 'start',
            program: this.mipsProgram,
        });
        this.mipsProgram = msg.program;
        this.sendEvent('stopOnEntry');
    }

    public async step() {
        const msg = await sendMessage({
            command: 'step',
            program: this.mipsProgram,
        });
        this.mipsProgram = msg.program;
        this.sendEvent('stopOnStep');
    }

    public verifyBreakpoints() {
		if (this.mipsProgram) {
			for(const bp of this.sourceLineBreakpoints) {
				if (bp < this.mipsProgram.source.length) {
                    const srcLine = this.mipsProgram.source[bp];
                    this.sendEvent('breakpointValidated', {
                        sourceIndex: bp,
                        lineNumber: srcLine.lineno,
                        filename: srcLine.filename,
                    });
                }
			}
		}
    }

    public stack() {
        return [{
            index: 0,
            name: "main",
            file: this.currentLine.filename,
            line: this.currentLine.lineNumber
        }];
    }

    private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}

}
