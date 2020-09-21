/* eslint-disable prettier/prettier */
import { HoverProvider, TextDocument, Position, CancellationToken, Hover } from 'vscode'

class DashmipsCommands {
    register = '(?:\\$(?:(?:0|t[0-9]|s[0-7]|v[0-1]|a[0-3])|zero|sp|fp|gp|ra))'
    label = '\\b[\\w]+\\b'

    number = '((?:\\b(?:0[xX])(?:_?[0-9a-fA-F])+\\b|\\b(?:0(?:b|B)(?:_?[0-1])+)\\b|\\b(?:0(?:o|O)(?:_?[0-7])+)\\b|(?:(?:\\+|-)?)(?:(?:[1-9](?:_?[0-9])*)|(?:0(?:_?0)*))|\'(?:[\\x00-\\x7F]|\\\\[0abfnrt\\\\ve])\'))'

    comment = '\\#.*'
    string = '(["\'])(.*)\\1'

    instr_gap = '\\s+'
    args_gap = '\\s*,\\s*'

    imm_PATTERN = '\\s+(\\b[\\w]+\\b)'

    public descriptions: any = {
        syscall: 'Call syscall specified in $v0.',
        j: 'Jump unconditionally : Jump to statement at target address',
        jal: 'Jump and link : Set $ra to Program Counter (return address) then jump to statement at target address',
        la: 'Load Address : Set $rd to label\'s address',
        li: 'Load Immediate : Set $rd to 32-bit immediate',
        move: 'Move : Set $rd to contents of $rs',
        beqz: 'Branch if Equal Zero : Branch to statement at label if $rd is equal to zero',
        bnez: 'Branch if Not Equal Zero : Branch to statement at label if $rd is not equal to zero',
        b: 'Branch : Branch to statement at label unconditionally',
        bgt: 'Branch if Greater Than : Branch to statement at label if $rd is greater than $rs',
        blt: 'Branch if Less Than : Branch to statement at label if $rd is less than $rs',
        neg: 'Negate : Set $rd to negation of $rs',
        bge: 'Branch if Greater or Equal : Branch to statement at label if $rd is greater or equal to $rs',
        ble: 'Branch if Less or Equal : Branch to statement at label if $rd is less than or equal to $rs',
    }
    public formats: any = {
        syscall: '',
        j: 'j target',
        jal: 'jal target',
        la: 'la $rd,label',
        li: 'li $rd,100',
        move: 'move $rd,$rs',
        beqz: 'beqz $rd,label',
        bnez: 'bnez $rd,label',
        b: 'b label',
        bgt: 'bgt $rd,$rs,label',
        blt: 'blt $rd,$rs,label',
        neg: 'neg $rd,$rs',
        bge: 'bge $rd,$rs,label',
        ble: 'ble $rd,$rs,label',
    }
    public regex: any = {
        syscall: new RegExp('syscall'),
        j: new RegExp(`j${this.imm_PATTERN}`),
        jal: new RegExp(`jal${this.imm_PATTERN}`),
        la: new RegExp(`${this.instr_gap}${this.register}${this.args_gap}${this.label}|%${this.label}`),
        li: new RegExp(`${this.instr_gap}${this.register}${this.args_gap}(${this.number}|${this.label})`),
        move: new RegExp(`${this.instr_gap}${this.register}${this.args_gap}${this.register}|%${this.label}`),
        beqz: new RegExp(`${this.instr_gap}(${this.register})${this.args_gap}(${this.label})`),
        bnez: new RegExp(`${this.instr_gap}(${this.register})${this.args_gap}(${this.label})`),
        b: new RegExp(`b${this.instr_gap}(${this.label})`),
        bgt: new RegExp(`${this.instr_gap}${this.register}${this.args_gap}(${this.register}|${this.number})${this.args_gap}(${this.label})`),
        blt: new RegExp(`${this.instr_gap}${this.register}${this.args_gap}(${this.register}|${this.number})${this.args_gap}(${this.label})`),
        neg: new RegExp(`${this.instr_gap}${this.register}${this.args_gap}${this.register}`),
        bge: new RegExp(`${this.instr_gap}(${this.register})${this.args_gap}(${this.register})${this.args_gap}(${this.label})`),
        ble: new RegExp(`${this.instr_gap}(${this.register})${this.args_gap}(${this.register})${this.args_gap}(${this.label})`),
    }

    public getDescription(word: string): string {
        return this.descriptions[word]
    }
    public getFormatting(line: string, word: string): string {
        return this.formats[word]
    }
    public checkRegex(line: string, word: string): boolean {
        return this.regex[word].test(line)
    }
    public checkWord(word: string): boolean {
        return this.regex.hasOwnProperty(word) && this.descriptions.hasOwnProperty(word) && this.formats.hasOwnProperty(word)
    }
}

export class DashmipsHoverProvider implements HoverProvider {
    public provideHover(document: TextDocument, position: Position, token: CancellationToken): Hover {
        const commands = new DashmipsCommands()
        const word = document.getText(document.getWordRangeAtPosition(position))
        const line = document.lineAt(position).text
        if (commands.checkWord(word)) {
            if (commands.checkRegex(line, word)) {
                return new Hover(commands.getDescription(word))
            } else {
                return new Hover(commands.getFormatting(line, word))
            }
        } else {
            return new Hover('')
        }
    }
}
