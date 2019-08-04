const process = require('process')
import { DashmipsDebugSession } from './debug'

process.stdin.on('error', () => { })
process.stdout.on('error', () => { })
process.stderr.on('error', () => { })

process.on('uncaughtException', DashmipsDebugSession.processError)

DashmipsDebugSession.run(DashmipsDebugSession)
