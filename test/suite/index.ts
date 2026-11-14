import * as path from 'path'
import Mocha from 'mocha'
import { glob as globP } from 'glob'
import util from 'node:util'

const glob: (ptn: string, options: any, cb: (err: Error | null, files: string[]) => void) => void =
    util.callbackify(globP)

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
    })

    const testsRoot = path.resolve(__dirname, '..')

    return new Promise((c, e) => {
        glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
            if (err) {
                return e(err)
            }

            // Add files to the test suite
            files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)))

            try {
                // Run the mocha test
                mocha.run((failures) => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`))
                    } else {
                        c()
                    }
                })
            } catch (err) {
                console.error(err)
                e(err)
            }
        })
    })
}
