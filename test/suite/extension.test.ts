// import { DebugClient } from 'vscode-debugadapter-testsupport'
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode'
import { expect } from 'chai'
// import * as myExtension from '../../extension';

describe('A Dashmips extension for VSCode', () => {
    before(() => {
        vscode.window.showInformationMessage('Start all tests!')
    })
    after(() => {
        vscode.window.showInformationMessage('All tests done!')
    })

    // let dc: DebugClient

    // const DEBUG_ADAPTER = './out/debugAdapter.js'

    // setup(() => {
    //     dc = new DebugClient('node', DEBUG_ADAPTER, 'dashmips')
    //     return dc.start()
    // })
    // teardown(() => dc.stop())

    context('on activation', () => {
        // test('unknown request should produce error', async () => {
        //     dc.send('illegal_request')
        //         .then(() => {
        //             done(new Error('does not report error on unknown request'))
        //         })
        //         .catch(() => {
        //             done()
        //         })
        // })

        it('should check if 2 equals 2', async () => {
            expect(2).to.equal(2)
        })
    })
})
