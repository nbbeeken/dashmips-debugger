'use strict';
import * as Net from 'net';
import * as vscode from 'vscode';
import {
    debug, DebugConfigurationProvider, WorkspaceFolder, DebugConfiguration,
    ProviderResult, CancellationToken
} from 'vscode';
import { DashmipsDebugSession } from './dashmipsDebug';

const EMBED_DEBUG_ADAPTER: "yes" | "no" | string = process.env.EMBED_DEBUG_ADAPTER || "no";

export function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(
        vscode.commands.registerCommand('extension.dashmips.getProgramName', () => {
            return vscode.window.showInputBox({
                placeHolder: "Please enter the name of a mips file in workspace",
                value: "test.mips"
            });
        })
    );

    const provider = new DashmipsConfigurationProvider();
    context.subscriptions.push(
        debug.registerDebugConfigurationProvider('dashmips', provider)
    );
    context.subscriptions.push(provider);
}

export function deactivate() { }

export class DashmipsConfigurationProvider implements DebugConfigurationProvider {

    private server?: Net.Server;

    resolveDebugConfiguration(
        folder: WorkspaceFolder | undefined,
        config: DebugConfiguration,
        token?: CancellationToken
    ): ProviderResult<DebugConfiguration> {

        if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'mips' ) {
				config.type = 'dashmips';
				config.name = 'Launch Current File';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
        }

        if (!config.program) {
            return vscode.window.showInformationMessage("Cannot find a program to debug")
            .then(_ => { return undefined; });
        }

        if (EMBED_DEBUG_ADAPTER === "yes") {
            // DEBUGGING ONLY
            // THIS WILL MAKE BREAKPOINTS IN debugAdapter.ts work
			if (!this.server) {
				this.server = Net.createServer(socket => {
					const session = new DashmipsDebugSession();
					session.setRunAsServer(true);
					session.start(socket as NodeJS.ReadableStream, socket);
				}).listen(0);
			}
			config.debugServer = this.server.address().port;
		}

        return config;
    }
    dispose() {
        if (this.server) {
			this.server.close();
		}
    }
}
