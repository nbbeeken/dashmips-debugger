import {
    LoggingDebugSession, InitializedEvent, logger, Logger,
    Breakpoint, StoppedEvent, Thread,
    Source, Scope, Handles, StackFrame, TerminatedEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';

import { Subject } from './subject';
import { basename, dirname } from 'path';
import { Client } from './client';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** Automatically stop target after launch.
     * If not specified, target does not stop. */
    stopOnEntry?: boolean;
    /** enable logging the Debug Adapter Protocol */
    trace?: boolean;
}

export class DebugSession extends LoggingDebugSession {


    private configurationDone = new Subject();
    private client: Client;
    private variableHandles = new Handles<string>();
    private dashmipsPid: number;

    public constructor() {
        super('');
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(false);
    }

    private setEventHandlers() {
        if (!this.client) {
            return;
        }

        // 'step', 'breakpoint', 'exception', 'pause', 'entry', 'goto'

        this.client.on(
            'start', () => this.sendEvent(new StoppedEvent('entry', 0))
        );

        this.client.on(
            'step', () => this.sendEvent(new StoppedEvent('step', 0))
        );

        this.client.on(
            'continue', () => this.sendEvent(new StoppedEvent('breakpoint', 0))
        );

        this.client.on(
            'error', (err) => {
                console.error(err);
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

        logger.setup(
            args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

        await this.configurationDone.wait(1000);

        const termArgs: DebugProtocol.RunInTerminalRequestArguments = {
            kind: 'integrated',
            title: 'Dashmips',
            cwd: dirname(args.program),
            args: `python -m dashmips debug -l`.split(' '),
        };

        this.runInTerminalRequest(termArgs, 5000, (res) => {
            if (res.success) {
                this.dashmipsPid = res.body.processId;
                this.client = new Client(
                    this.convertDebuggerPathToClient(args.program)
                );
                this.setEventHandlers();
                this.sendResponse(response);
            } else {
                this.sendErrorResponse(
                    response, { id: 1, format: 'Cannot start dashmips' }
                );
                this.shutdown();
            }
        });
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ) {

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
                value: value.toString(),
                variablesReference: 0,
            } as DebugProtocol.Variable);
        }

        response.body = {
            variables
        };
        this.sendResponse(response);
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

}
