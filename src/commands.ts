import * as vscode from 'vscode'
import * as path from 'path'
import { pattern } from './memory_content'

function get_filename() {
    if (vscode.window.activeTextEditor?.document.uri.scheme == 'visual') {
        return pattern + vscode.window.activeTextEditor?.document.uri.authority.split(pattern).slice(1).join(pattern)
    } else {
        if (vscode.window.activeTextEditor?.document.uri.path.includes(pattern)) {
            vscode.window.showErrorMessage('Error: path to file cannot contain sequence: ' + pattern)
            return 'Error: Pattern'
        } else if (vscode.window.activeTextEditor?.document.uri.path.includes(' ')) {
            vscode.window.showErrorMessage('Error: path to file cannot contain spaces')
            return 'Error: Pattern'
        } else {
            return vscode.window.activeTextEditor?.document.uri.path.split(path.sep).join(pattern)
        }
    }
}

export function registerCommands() {
    vscode.commands.registerCommand('View Stack', async () => {
        const filename = get_filename()

        if (!filename) {
            vscode.window.showErrorMessage('Please select a file to visualize.')
            return
        } else if (filename == 'Error: Pattern') {
            return
        }

        const uri = vscode.Uri.parse('visual://' + filename + '/Stack: Ascii')
        const doc = await vscode.workspace.openTextDocument(uri) // calls back into the provider
        await vscode.window.showTextDocument(doc, { preview: false })
    })

    vscode.commands.registerCommand('View Heap', async () => {
        const filename = get_filename()

        if (!filename) {
            vscode.window.showErrorMessage('Please select a file to visualize.')
            return
        } else if (filename == 'Error: Pattern') {
            return
        }

        const uri = vscode.Uri.parse('visual://' + filename + '/Heap: Ascii')
        const doc = await vscode.workspace.openTextDocument(uri) // calls back into the provider
        await vscode.window.showTextDocument(doc, { preview: false })
    })

    vscode.commands.registerCommand('View Data', async () => {
        const filename = get_filename()

        if (!filename) {
            vscode.window.showErrorMessage('Please select a file to visualize.')
            return
        } else if (filename == 'Error: Pattern') {
            return
        }

        const uri = vscode.Uri.parse('visual://' + filename + '/Data: Ascii')
        const doc = await vscode.workspace.openTextDocument(uri) // calls back into the provider
        await vscode.window.showTextDocument(doc, { preview: false })
    })

    vscode.commands.registerCommand('View Int', async () => {
        if (!vscode.window.activeTextEditor) {
            return // no editor
        }
        const { document } = vscode.window.activeTextEditor
        if (document.uri.scheme !== 'visual') {
            return // not my scheme
        }
        // get path-components, reverse it, and create a new uri
        const newPath = document.uri.path.split(':')[0] + ': Int'
        const newUri = document.uri.with({ path: newPath })
        await vscode.window.showTextDocument(newUri, { preview: false })
    })

    vscode.commands.registerCommand('View Ascii', async () => {
        if (!vscode.window.activeTextEditor) {
            return // no editor
        }
        const { document } = vscode.window.activeTextEditor
        if (document.uri.scheme !== 'visual') {
            return // not my scheme
        }
        // get path-components, reverse it, and create a new uri
        const newPath = document.uri.path.split(':')[0] + ': Ascii'
        const newUri = document.uri.with({ path: newPath })
        await vscode.window.showTextDocument(newUri, { preview: false })
    })

    vscode.commands.registerCommand('View Float', async () => {
        if (!vscode.window.activeTextEditor) {
            return // no editor
        }
        const { document } = vscode.window.activeTextEditor
        if (document.uri.scheme !== 'visual') {
            return // not my scheme
        }
        // get path-components, reverse it, and create a new uri
        const newPath = document.uri.path.split(':')[0] + ': Float'
        const newUri = document.uri.with({ path: newPath })
        await vscode.window.showTextDocument(newUri, { preview: false })
    })
}
