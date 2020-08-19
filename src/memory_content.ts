import * as vscode from 'vscode'
import * as cp from 'child_process'

export const pattern = '%(%)('

export class MemoryContentProvider implements vscode.TextDocumentContentProvider {
    public onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>()
    onDidChange = this.onDidChangeEmitter.event

    provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
        if (vscode.debug.activeDebugSession) {
            vscode.window.showInformationMessage('Not implemented')
            return ''
        } else {
            if (uri.path.includes('Stack')) {
                let command =
                    'env /Users/joshuamitchener/Desktop/DASHMIPS/interpreter/.venv/bin/python -m dashmips v ' +
                    uri.authority.split(pattern).pop() +
                    ' --s'
                if (uri.path.includes('Int')) {
                    command += ' --i'
                } else if (uri.path.includes('Float')) {
                    command += ' --f'
                }

                const data = cp.execSync(command, { cwd: vscode.workspace.rootPath, env: process.env }).toString()
                if (data) {
                    return data
                } else {
                    return 'Error: File failed to compile.'
                }
            } else if (uri.path.includes('Heap')) {
                let command =
                    'env /Users/joshuamitchener/Desktop/DASHMIPS/interpreter/.venv/bin/python -m dashmips v ' +
                    uri.authority.split(pattern).pop() +
                    ' --h'
                if (uri.path.includes('Int')) {
                    command += ' --i'
                } else if (uri.path.includes('Float')) {
                    command += ' --f'
                }

                const data = cp.execSync(command, { cwd: vscode.workspace.rootPath, env: process.env }).toString()
                if (data) {
                    return data
                } else {
                    return 'Error: File failed to compile.'
                }
            } else if (uri.path.includes('Data')) {
                let command =
                    'env /Users/joshuamitchener/Desktop/DASHMIPS/interpreter/.venv/bin/python -m dashmips v ' +
                    uri.authority.split(pattern).pop() +
                    ' --d'
                if (uri.path.includes('Int')) {
                    command += ' --i'
                } else if (uri.path.includes('Float')) {
                    command += ' --f'
                }
                const data = cp.execSync(command, { cwd: vscode.workspace.rootPath, env: process.env }).toString()
                if (data) {
                    return data
                } else {
                    return 'Error: File failed to compile.'
                }
            }
        }
    }
}
