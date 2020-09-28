import * as vscode from 'vscode'
import * as cp from 'child_process'

class DashmipsCommands {
    public snippets: Record<string, Record<string, string>>
    constructor() {
        this.snippets = JSON.parse(
            cp
                .execSync('python -m dashmips utils --snippets', { cwd: vscode.workspace.rootPath, env: process.env })
                .toString()
        )
    }

    public getDescription(word: string): string {
        return this.snippets[word]['description']
    }
    public getFormatting(word: string): string {
        return this.snippets[word]['format']
    }
    public checkRegex(line: string, word: string): boolean {
        const regex = new RegExp(this.snippets[word]['regex'])
        return regex.test(line)
    }
    public checkWord(word: string): boolean {
        return this.snippets.hasOwnProperty(word)
    }
}

export class DashmipsHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.Hover {
        const commands = new DashmipsCommands()
        const word = document.getText(document.getWordRangeAtPosition(position))
        const line = document.lineAt(position).text
        if (commands.checkWord(word)) {
            if (commands.checkRegex(line, word)) {
                return new vscode.Hover(commands.getDescription(word))
            } else {
                return new vscode.Hover(commands.getFormatting(word))
            }
        } else {
            return new vscode.Hover('')
        }
    }
}
