import * as vscode from 'vscode'
import * as cp from 'child_process'
import * as path from 'path'

export const pattern = '\\'

export class MemoryContentProvider implements vscode.TextDocumentContentProvider {
    public factory?: vscode.DebugAdapterDescriptorFactory
    public text?: string
    public onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>()
    onDidChange = this.onDidChangeEmitter.event

    provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
        function check(text: string, i: any) {
            const s = '&&&&'
            const message = 'Please visualize the file before debugging.'

            if (text.split(s)[i] == ' ' || text.split(s)[i] == '') {
                return message
            } else {
                return text.split(s + ' ')[i]
            }
        }
        if (vscode.debug.activeDebugSession && this.text) {
            if (uri.path.includes('Stack: Ascii')) {
                return check(this.text, 0)
            } else if (uri.path.includes('Stack: Int')) {
                return check(this.text, 1)
            } else if (uri.path.includes('Stack: Float')) {
                return check(this.text, 2)
            } else if (uri.path.includes('Heap: Ascii')) {
                return check(this.text, 3)
            } else if (uri.path.includes('Heap: Int')) {
                return check(this.text, 4)
            } else if (uri.path.includes('Heap: Float')) {
                return check(this.text, 5)
            } else if (uri.path.includes('Data: Ascii')) {
                return check(this.text, 6)
            } else if (uri.path.includes('Data: Int')) {
                return check(this.text, 7)
            } else if (uri.path.includes('Data: Float')) {
                return check(this.text, 8)
            }
        } else {
            if (uri.path.includes('Stack')) {
                let command =
                    'python -m dashmips v ' +
                    uri.authority.split(pattern).join(path.sep)
                if (uri.path.includes('Int')) {
                    command += ' --si'
                } else if (uri.path.includes('Float')) {
                    command += ' --sf'
                } else {
                    command += ' --sa'
                }

                return cp.execSync(command, {cwd: vscode.workspace.rootPath, env: process.env }).toString()

            } else if (uri.path.includes('Heap')) {
                let command =
                    'python -m dashmips v ' +
                    uri.authority.split(pattern).join(path.sep)
                if (uri.path.includes('Int')) {
                    command += ' --hi'
                } else if (uri.path.includes('Float')) {
                    command += ' --hf'
                } else {
                    command += ' --ha'
                }

                return cp.execSync(command, {cwd: vscode.workspace.rootPath, env: process.env }).toString()

            } else if (uri.path.includes('Data')) {
                let command =
                    'python -m dashmips v ' +
                    uri.authority.split(pattern).join(path.sep)
                if (uri.path.includes('Int')) {
                    command += ' --di'
                } else if (uri.path.includes('Float')) {
                    command += ' --df'
                } else {
                    command += ' --da'
                }

                return cp.execSync(command, {cwd: vscode.workspace.rootPath, env: process.env }).toString()
            }
        }
    }
}
