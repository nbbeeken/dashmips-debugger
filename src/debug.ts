import {
    LoggingDebugSession, InitializedEvent, logger, Logger,
    Breakpoint, StoppedEvent, Thread,
    Source, Scope, Handles, StackFrame, TerminatedEvent,
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';

import { Subject } from './subject';
import { basename, dirname } from 'path';
import { Client } from './client';
import { DebugMessage } from './models';
import { LogLevel } from 'vscode-debugadapter/lib/logger';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** Automatically stop target after launch.
     * If not specified, target does not stop. */
    stopOnEntry?: boolean;
    /** Enable dashmips logger */
    log?: boolean;
    /** Enable dashmips logger */
    registerFormat?: 'hex' | 'oct' | 'dec' | 'bin';
}

export class MipsDebugSession extends LoggingDebugSession {
    private configurationDone = new Subject();
    private client: Client;
    private variableHandles = new Handles<string>();
    private dashmipsPid: number;
    private config: LaunchRequestArguments;
    private clientLaunched = new Subject();

    private set loggingEnabled(value: boolean) {
        if (value) {
            logger.setup(LogLevel.Verbose, true);
        }
    }

    public constructor() {
        super();
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(false);
    }

    private setEventHandlers() {
        if (!this.client) {
            return;
        }

        // 'step', 'breakpoint', 'exception', 'pause', 'entry', 'goto'

        this.client.on(
            'start', (msg: DebugMessage) => {
                this.dashmipsPid = parseInt(msg.message);
                this.sendEvent(new StoppedEvent('entry', 0));
            }
        );

        this.client.on(
            'step', () => this.sendEvent(new StoppedEvent('step', 0))
        );

        this.client.on(
            'continue', () => this.sendEvent(new StoppedEvent('breakpoint', 0))
        );

        this.client.on(
            'stop', () => {
                process.kill(this.dashmipsPid, 'SIGTERM');
                this.sendEvent(new TerminatedEvent());
            }
        );

        this.client.on(
            'error', (err) => {
                logger.error(err);
                this.sendEvent(new TerminatedEvent());
            }
        );
        this.client.on(
            'end', () => this.sendEvent(new TerminatedEvent())
        );
    }

    protected async initializeRequest(
        response: DebugProtocol.InitializeResponse,
        args: DebugProtocol.InitializeRequestArguments
    ) {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = true;
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected async configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ) {
        super.configurationDoneRequest(response, args);
        // notify the launchRequest that configuration has finished
        this.configurationDone.notify();
    }

    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: LaunchRequestArguments
    ) {

        logger.setup(false ?
            Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false
        );

        this.config = args;

        try {
            this.client = new Client(
                this.convertDebuggerPathToClient(args.program)
            );
            this.setEventHandlers();
            this.clientLaunched.notify();
            this.sendResponse(response);
        } catch(ex) {
            this.sendErrorResponse(response, ex);
        }
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ) {
        await this.clientLaunched.wait(2000);

        this.client.breakpointsFromVscode(args.source.path, args.breakpoints);

        const breakpoints = this.client.vscodeBreakPoints.map(l => {
            const src = new Source(
                basename(l.filename),
                this.convertDebuggerPathToClient(l.filename),
                undefined, undefined, 'dashmips'
            );
            return new Breakpoint(true, l.lineno, 0, src);
        }) as DebugProtocol.Breakpoint[];

        response.body = {
            breakpoints
        };
        this.sendResponse(response);
    }

    protected async threadsRequest(
        response: DebugProtocol.ThreadsResponse
    ) {
        response.body = {
            threads: [new Thread(0, 'main')]
        };
        this.sendResponse(response);
    }

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ) {
        response.body = {
            stackFrames: this.client.stack.map(f => {
                return new StackFrame(f.index, f.name,
                    new Source(
                        basename(f.file),
                        this.convertDebuggerPathToClient(f.file),
                        undefined, undefined, 'dashmips-adapter-data'),
                    f.line
                );
            }),
            totalFrames: this.client.stack.length,
        };
        this.sendResponse(response);
    }

    protected async scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments
    ) {

        const scopes: Scope[] = [];
        scopes.push(new Scope(
            'Registers',
            this.variableHandles.create('register'),
            false
        ));

        response.body = { scopes };
        this.sendResponse(response);
    }

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ) {
        const variables: DebugProtocol.Variable[] = [];
        // const id = this.variableHandles.get(args.variablesReference);

        for (const regname in this.client.program.registers) {
            const value = this.client.program.registers[regname];
            variables.push({
                name: regname,
                type: 'integer',
                value: this.formatRegister(value),
                variablesReference: 0,
            } as DebugProtocol.Variable);
        }

        response.body = {
            variables
        };
        this.sendResponse(response);
    }

    formatRegister(value: number): string {
        switch (this.config.registerFormat) {
            case 'hex':
                return '0x' + value.toString(16).padStart(8, '0');
            case 'oct':
                return '0o' + value.toString(8).padStart(11, '0');
            case 'bin':
                return '0b' + value.toString(2).padStart(32, '0');
            case 'dec':
            default:
                return value.toString(10).padStart(10, '0');
        }
    }

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        args: DebugProtocol.ContinueArguments
    ) {
        this.client.continue();
        this.sendResponse(response);
    }

    protected async reverseContinueRequest(
        response: DebugProtocol.ReverseContinueResponse,
        args: DebugProtocol.ReverseContinueArguments
    ) { }

    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments
    ) {
        this.client.step();
        this.sendResponse(response);
    }

    protected async stepBackRequest(
        response: DebugProtocol.StepBackResponse,
        args: DebugProtocol.StepBackArguments
    ) { }

    protected evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ) {

        let reply = undefined;
        if (args.context === 'hover') {
            if (this.client.program.registers.hasOwnProperty(args.expression)) {
                const regvalue = this.client.program.registers[args.expression];
                reply = regvalue.toString();
            }
            if (this.client.program.labels.hasOwnProperty(args.expression)) {
                const label = this.client.program.labels[args.expression];
                reply = `${label.value}`;
            }
        }

        response.body = {
            result: reply ?
                reply : `eval(ctx: '${args.context}', '${args.expression}')`,
            variablesReference: 0
        };
        this.sendResponse(response);
    }

    protected disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        args: DebugProtocol.DisconnectArguments
    ) {
        this.client.stop();
        process.kill(this.dashmipsPid, 'SIGTERM');
        this.shutdown();
    }

    static processError = (err: Error) => {
        logger.error(`Exception: ${err && err.message ? err.message : ''}`);
        logger.error(err && err.name ? err.name : '');
        logger.error(err && err.stack ? err.stack : '');
        // Catch all, incase we have string exceptions being raised.
        logger.error(err ? err.toString() : '');
        // Wait for 1 second before we die,
        // we need to ensure errors are written to the log file.
        setTimeout(() => process.exit(-1), 100);
    }

}
