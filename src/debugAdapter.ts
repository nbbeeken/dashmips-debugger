
import { MipsDebugSession } from './debug'

process.stdin.on('error', () => { })
process.stdout.on('error', () => { })
process.stderr.on('error', () => { })

process.on('uncaughtException', MipsDebugSession.processError)

MipsDebugSession.run(MipsDebugSession)
