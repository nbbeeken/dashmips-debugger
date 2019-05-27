import { DebugClient } from 'vscode-debugadapter-testsupport';

suite('Dashmips Debug Adapter', () => {
	let dc: DebugClient;

	const DEBUG_ADAPTER = './out/debugAdapter.js';

	setup(() => {
		dc = new DebugClient('node', DEBUG_ADAPTER, 'dashmips');
		return dc.start();
	});
	teardown(() => dc.stop());

	suite('basic', () => {
		test('unknown request should produce error', done => {
			dc.send('illegal_request').then(() => {
				done(new Error('does not report error on unknown request'));
			}).catch(() => {
				done();
			});
		});
	});

});
