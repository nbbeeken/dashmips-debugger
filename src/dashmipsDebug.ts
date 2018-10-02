import {
    LoggingDebugSession, InitializedEvent, logger, Logger,
    Breakpoint, StoppedEvent, Thread, Source, Scope, Handles, StackFrame
} from "vscode-debugadapter";
import { DebugProtocol } from 'vscode-debugprotocol';
import { DashmipsClient } from "./dashmipsClient";

import * as vscode from 'vscode';
import { Subject } from "./Subject";
import { basename, dirname } from "path";

export function info(msg: string) {
    vscode.window.showInformationMessage(msg);
}
export function error(msg: string) {
    vscode.window.showErrorMessage(msg);
}

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
    /** enable logging the Debug Adapter Protocol */
    trace?: boolean;
}

export class DashmipsDebugSession extends LoggingDebugSession {


    private configurationDone = new Subject();
    private dashmipsClient: DashmipsClient;
    private variableHandles = new Handles<string>();

    public constructor() {
        super("");

        this.dashmipsClient = new DashmipsClient();

        this.dashmipsClient.on('stopOnEntry', () => {
            this.sendEvent(new StoppedEvent('entry', 0));
        });
        this.dashmipsClient.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', 0));
		});

        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(false);
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

        logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

        await this.configurationDone.wait(1000);

        const termArgs: DebugProtocol.RunInTerminalRequestArguments = {
            kind: 'integrated',
            title: 'Dashmips Debug Console',
            cwd: dirname(args.program),
            args: `python -m dashmips debug`.split(' '),
        };

        this.runInTerminalRequest(termArgs, 5000, (res) => {
            if (res.success) {
                this.dashmipsClient.start(args.program);
                this.sendResponse(response);
            } else {
                this.sendErrorResponse(response, {id: 1, format: "Can't start dashmips"});
                this.shutdown();
            }
        });
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ) {

        for (const bp of args.breakpoints) {
            this.dashmipsClient.addBreakpoint(bp.line, args.source.path);
        }

        const breakpoints = this.dashmipsClient.breakpoints.map(l => {
            const src = new Source(
                basename(l.filename),
                this.convertDebuggerPathToClient(l.filename),
                undefined, undefined, 'dashmips-adapter-data'
            );
            return new Breakpoint(true, l.lineNumber, 0, src) as DebugProtocol.Breakpoint;
        });

        response.body = {
            breakpoints
        };
        this.sendResponse(response);
    }

    protected async threadsRequest(
        response: DebugProtocol.ThreadsResponse
    ) {
        response.body = {
            threads: [new Thread(0, "main")]
        };
        this.sendResponse(response);
    }

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ) {
        const stack = this.dashmipsClient.stack();

        response.body = {
            stackFrames: stack.map(f => {
                return new StackFrame(f.index, f.name,
                    new Source(
                        basename(f.file),
                        this.convertDebuggerPathToClient(f.file),
                        undefined, undefined, 'dashmips-adapter-data'),
                    f.line
                );
            }),
            totalFrames: stack.length,
        };
        this.sendResponse(response);
    }

    protected async scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments
    ) {

        const scopes: Scope[] = [];
        scopes.push(new Scope(
            "Registers",
            this.variableHandles.create("register"),
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
        const id = this.variableHandles.get(args.variablesReference);

        for (const regname in this.dashmipsClient.registers) {
            const value = this.dashmipsClient.registers[regname];
            variables.push({
                name: regname,
                type: "integer",
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
    ) { }

    protected async reverseContinueRequest(
        response: DebugProtocol.ReverseContinueResponse,
        args: DebugProtocol.ReverseContinueArguments
    ) { }

    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments
    ) {
        await this.dashmipsClient.step();
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
            if (this.dashmipsClient.registers.hasOwnProperty(args.expression)) {
                const regvalue = this.dashmipsClient.registers[args.expression];
                reply = regvalue.toString();
            }
            if (this.dashmipsClient.labels.hasOwnProperty(args.expression)) {
                const label = this.dashmipsClient.labels[args.expression];
                reply = `${label.value}`;
            }
        }

		response.body = {
			result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}
}
