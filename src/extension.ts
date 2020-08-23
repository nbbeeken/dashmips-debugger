'use strict'
import * as Net from 'net'
import * as vscode from 'vscode'
import * as path from 'path'
import {
    CancellationToken,
    DebugConfiguration,
    DebugConfigurationProvider,
    Disposable,
    ProviderResult,
    WorkspaceFolder,
    debug,
} from 'vscode'
import { execSync } from 'child_process'
import { DashmipsDebugSession } from './debug'
import { registerCommands } from './commands'
import { MemoryContentProvider, pattern } from './memory_content'

const EMBED_DEBUG_ADAPTER = true

export async function activate(context: vscode.ExtensionContext) {
    try {
        return await activateUnsafe(context)
    } catch (ex) {
        console.error('Failed to activate extension:', ex)
        throw ex
    }
}

async function activateUnsafe(context: vscode.ExtensionContext) {
    const pleaseCheckDashmipsExists = vscode.workspace.getConfiguration().get('dashmips.checkDashmipsExists')
    if (pleaseCheckDashmipsExists && !checkDashmipsExists()) {
        vscode.window.showErrorMessage('Install Dashmips with pip?', 'Yes', 'No').then((value) => {
            if (value === 'Yes') {
                const term = vscode.window.createTerminal('Install Dashmips')
                term.show(true)
                term.sendText('pip install dashmips', true)
            }
        })
    }
    const provider = new DashmipsConfigurationProvider()
    context.subscriptions.push(debug.registerDebugConfigurationProvider('dashmips', provider))
    context.subscriptions.push(provider)

    const memoryProvider = new MemoryContentProvider()
    const registration = Disposable.from(
        vscode.workspace.registerTextDocumentContentProvider('visual', memoryProvider)
    )

    context.subscriptions.push(registration)

    registerCommands()

    vscode.workspace.onDidSaveTextDocument((e: vscode.TextDocument) => {
        for (let i = 0; i < vscode.workspace.textDocuments.length; i++) {
            if (
                vscode.workspace.textDocuments[i].uri.scheme == 'visual' &&
                vscode.workspace.textDocuments[i].uri.authority.split(pattern).join(path.sep) == e.uri.path.toLowerCase()
            ) {
                const documentUriToUpdate = vscode.workspace.textDocuments[i].uri
                memoryProvider.onDidChangeEmitter.fire(documentUriToUpdate)
            }
        }
    })

    if (EMBED_DEBUG_ADAPTER) {
        const factory = new DashmipsDebugAdapterDescriptorFactory()
        factory.memoryProvider = memoryProvider
        context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('dashmips', factory))
        context.subscriptions.push(factory)
    }
}

export function deactivate() {}

export class DashmipsConfigurationProvider implements DebugConfigurationProvider {
    private server?: Net.Server
    private terminal?: vscode.Terminal

    resolveDebugConfiguration(
        folder: WorkspaceFolder | undefined,
        config: DebugConfiguration,
        token?: CancellationToken
    ): ProviderResult<DebugConfiguration> {
        config.internalConsoleOptions = 'neverOpen'

        if (!config.type && !config.request && !config.name) {
            // No configuration generated yet
            const editor = vscode.window.activeTextEditor
            if (editor && editor.document.languageId === 'mips') {
                config.type = 'dashmips'
                config.name = 'dashmips (Run Current File)'
                config.request = 'launch'
                config.program = '${file}'
                config.dashmipsCommand = 'python -m dashmips debug'
            }
        }

        if (config.request === 'launch' && !config.program) {
            return vscode.window.showInformationMessage('Cannot find a program to debug').then(() => undefined)
        }

        const launchDefaults = {
            args: [],
            dashmipsArgs: [],
            console: 'integratedTerminal',
            dashmipsCommand: 'python -m dashmips debug',
            name: 'dashmips (Run Current File)',
        }

        const attachDefaults = {
            host: 'localhost',
            port: 2390,
        }

        return { ...(config.request === 'launch' ? launchDefaults : attachDefaults), ...config } as DebugConfiguration
    }

    dispose() {
        if (this.server) {
            this.server.close()
        }
    }
}

export class DashmipsDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    public memoryProvider?: vscode.TextDocumentContentProvider
    private server?: Net.Server

    createDebugAdapterDescriptor(
        session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        if (!this.server) {
            // start listening on a random port
            this.server = Net.createServer((socket) => {
                const session = new DashmipsDebugSession()
                session.memoryProvider = this.memoryProvider
                session.setRunAsServer(true)
                session.start(socket as NodeJS.ReadableStream, socket)
            }).listen(0)
        }

        const addr = this.server.address() as Net.AddressInfo
        // make VS Code connect to debug server
        return new vscode.DebugAdapterServer(addr.port)
    }

    dispose() {
        if (this.server) {
            this.server.close()
        }
    }
}

export function checkDashmipsExists(): boolean {
    try {
        execSync('python -m dashmips -v', { encoding: 'utf8' })
        return true
    } catch {
        return false
    }
}
