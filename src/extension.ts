'use strict';
import * as Net from 'net';
import * as vscode from 'vscode';
import {
    CancellationToken,
    debug,
    DebugConfiguration,
    DebugConfigurationProvider,
    ProviderResult,
    WorkspaceFolder
} from 'vscode';

import { isDashmipsInstalled } from './client';
import { MipsDebugSession } from './debug';

const EMBED_DEBUG_ADAPTER = false;

export function activate(context: vscode.ExtensionContext) {

    if (!isDashmipsInstalled()) {
        vscode.window.showErrorMessage(
            'Install Dashmips with pip?',
            'Yes', 'No'
        ).then((value) => {
            if (value === 'Yes') {
                const term = vscode.window.createTerminal('Install Dashmips');
                term.show(true);
                term.sendText('pip install dashmips', true);
            }
        });
    }

    const provider = new DashmipsConfigurationProvider();
    context.subscriptions.push(
        debug.registerDebugConfigurationProvider('dashmips', provider)
    );
    context.subscriptions.push(provider);
}

export function deactivate() { }

export class DashmipsConfigurationProvider
    implements DebugConfigurationProvider {

    private server?: Net.Server;
    private terminal?: vscode.Terminal;

    resolveDebugConfiguration(
        folder: WorkspaceFolder | undefined,
        config: DebugConfiguration,
        token?: CancellationToken
    ): ProviderResult<DebugConfiguration> {

        const logArg = config.log ? '-l' : '';

        if (config.launchDebugger !== false) {
            this.terminal = vscode.window.createTerminal('Dashmips');
            this.terminal.sendText(`python -m dashmips debug ${logArg}`, true);
            this.terminal.show(false);
        }

        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'mips') {
                config.type = 'dashmips';
                config.name = 'Launch Current File';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = true;
            }
        }

        // Debug console not at all useful yet.
        config.internalConsoleOptions = 'neverOpen';

        if (!config.program) {
            return vscode.window.showInformationMessage(
                'Cannot find a program to debug'
            ).then(_ => { return undefined; });
        }

        if (EMBED_DEBUG_ADAPTER) {
            if (!this.server) {
                this.server = Net.createServer(socket => {
                    const session = new MipsDebugSession();
                    session.setRunAsServer(true);
                    session.start(socket as NodeJS.ReadableStream, socket);
                }).listen(0);
            }
            const addr = (this.server.address() as Net.AddressInfo);
            config.debugServer = addr.port;
        }
        return config;
    }
    dispose() {
        if (this.server) {
            this.server.close();
        }
    }
}
